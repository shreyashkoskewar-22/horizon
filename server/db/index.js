'use strict';
/**
 * SQLite access layer. Uses better-sqlite3 when it is installed (optional dependency)
 * and falls back to Node's built-in node:sqlite (Node >= 22.13), so the project runs
 * even where native modules cannot be compiled. Every query uses prepared statements.
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { toSql } = require('../lib/util');

function openDriver(file) {
  const preference = (process.env.SQLITE_DRIVER || 'auto').toLowerCase();
  if (preference !== 'node') {
    try {
      const Better = require('better-sqlite3');
      const raw = new Better(file);
      return { name: 'better-sqlite3', prepare: (sql) => raw.prepare(sql), exec: (sql) => raw.exec(sql), close: () => raw.close() };
    } catch (err) {
      if (preference === 'better') throw err;
    }
  }
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    throw new Error('No SQLite driver available. Install dependencies with "npm install" (better-sqlite3) or use Node.js 22.13+ (built-in node:sqlite).');
  }
  const raw = new DatabaseSync(file);
  return { name: 'node:sqlite', prepare: (sql) => raw.prepare(sql), exec: (sql) => raw.exec(sql), close: () => raw.close() };
}

function convert(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return toSql(v);
  return v;
}
function normalise(params) {
  if (params === undefined || params === null) return [];
  if (Array.isArray(params)) return params.map(convert);
  if (typeof params === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(params)) out[k] = convert(v);
    return [out];
  }
  return [convert(params)];
}

class Database {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.driver = openDriver(file);
    this.cache = new Map();
    this.depth = 0;
    const journal = config.isVercel ? 'DELETE' : 'WAL';
    this.exec(`PRAGMA journal_mode = ${journal}; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;`);
  }

  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.driver.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  get(sql, params) { const row = this.stmt(sql).get(...normalise(params)); return row ? { ...row } : undefined; }
  all(sql, params) { return this.stmt(sql).all(...normalise(params)).map((r) => ({ ...r })); }
  value(sql, params) { const row = this.stmt(sql).get(...normalise(params)); return row ? Object.values(row)[0] : undefined; }
  run(sql, params) {
    const r = this.stmt(sql).run(...normalise(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  exec(sql) { this.driver.exec(sql); }

  /** Synchronous transaction; nested calls join the outer transaction. */
  tx(fn) {
    if (this.depth > 0) return fn();
    this.depth += 1;
    this.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.exec('COMMIT');
      return result;
    } catch (err) {
      try { this.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      this.depth -= 1;
    }
  }

  close() { this.cache.clear(); this.driver.close(); }
}

let instance = null;
function getDb() {
  if (!instance) instance = new Database(config.databaseFile);
  return instance;
}
function closeDb() {
  if (instance) { instance.close(); instance = null; }
}

module.exports = { Database, getDb, closeDb };
