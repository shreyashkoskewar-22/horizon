'use strict';
/**
 * Production bootstrap: migrates the database, loads reference data (the official INI list and
 * country guides) if missing, and creates an administrator account. Never loads demo data.
 *
 *   ADMIN_EMAIL=you@yourdomain.org ADMIN_PASSWORD='…' ADMIN_NAME='Your Name' npm run admin:create
 *
 * The password must have 12+ characters with upper- and lower-case letters and a number.
 */
const bcrypt = require('bcryptjs');
const config = require('../server/config');
const { getDb, closeDb } = require('../server/db');
const { migrate } = require('../server/db/migrate');
const { seedInstitutions, seedDestinations } = require('../server/db/reference-data');
const { nowSql } = require('../server/lib/util');

function fail(msg) { console.error(`\n[admin:create] ${msg}\n`); process.exit(1); }

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
const name = String(process.env.ADMIN_NAME || 'HORIZON Administrator').trim();

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Set ADMIN_EMAIL to a valid email address.');
if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
  fail('Set ADMIN_PASSWORD to at least 12 characters with upper- and lower-case letters and a number.');
}
if (name.length < 2 || name.length > 100) fail('ADMIN_NAME must be 2–100 characters.');

const db = getDb();
migrate(db, { log: () => {} });
const inst = seedInstitutions(db);
if (inst.inserted) console.log(`[admin:create] loaded ${inst.inserted} institutions from the Ministry of Education list`);
const existing = db.get('SELECT id, role FROM users WHERE email = ?', [email]);
if (existing) fail(`An account with ${email} already exists (${existing.role}).`);
const id = db.run(`INSERT INTO users (role, full_name, email, password_hash, status, email_verified_at, verification_method)
  VALUES ('admin', ?, ?, ?, 'approved', ?, 'manual')`, [name, email, bcrypt.hashSync(password, config.bcryptRounds), nowSql()]).lastInsertRowid;
const dest = seedDestinations(db, id);
if (dest) console.log(`[admin:create] loaded ${dest} destination guides — review each against its official source before launch`);
db.run("INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, details) VALUES (NULL, 'system', 'admin.created', 'user', ?, ?)", [id, JSON.stringify({ email })]);
closeDb();
console.log(`[admin:create] administrator ${email} created (${config.env}). Sign in at ${config.appUrl}/login`);
