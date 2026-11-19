'use strict';
/** Applies numbered SQL migrations from ./migrations exactly once each. Usage: npm run db:migrate */
const fs = require('node:fs');
const path = require('node:path');

function migrate(db, { log = console.log } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const dir = path.join(__dirname, 'migrations');
  let files = [];
  try {
    if (fs.existsSync(dir)) {
      files = fs.readdirSync(dir).filter((f) => /^\d+_[\w-]+\.sql$/.test(f)).sort();
    }
  } catch (e) {
    files = [];
  }

  const applied = new Set(db.all('SELECT version FROM schema_migrations').map((r) => r.version));
  let count = 0;

  if (files.length === 0 && !applied.has('001_initial.sql')) {
    const sql = require('./initial-sql');
    db.tx(() => {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (version) VALUES (?)', ['001_initial.sql']);
    });
    count += 1;
    log(`[db] applied embedded migration 001_initial.sql`);
  } else {
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      db.tx(() => {
        db.exec(sql);
        db.run('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
      });
      count += 1;
      log(`[db] applied migration ${file}`);
    }
  }
  return count;
}

module.exports = { migrate };

if (require.main === module) {
  const { getDb, closeDb } = require('./index');
  const db = getDb();
  const n = migrate(db);
  console.log(n ? `[db] ${n} migration(s) applied to ${db.file}` : `[db] schema is up to date (${db.file})`);
  closeDb();
}
