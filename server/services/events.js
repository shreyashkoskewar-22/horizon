'use strict';
/** Cross-cutting side effects: audit trail, in-app notifications and outbound email. */
const nodemailer = require('nodemailer');
const config = require('../config');
const { getDb } = require('../db');

function audit(req, action, { entityType = null, entityId = null, details = null, actorId, actorRole } = {}) {
  getDb().run(
    'INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [actorId ?? req?.user?.id ?? null, actorRole ?? req?.user?.role ?? 'system', action, entityType, entityId ?? null, details ? JSON.stringify(details) : null, req?.ip ?? null],
  );
}

function notify(userId, { type, title, body = null, link = null }) {
  if (!userId) return;
  getDb().run('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)', [userId, type, title, body, link]);
}

function notifyAdmins(payload) {
  for (const { id } of getDb().all("SELECT id FROM users WHERE role = 'admin' AND status = 'approved'")) notify(id, payload);
}

function notifyOrganisation(orgId, payload) {
  if (!orgId) return;
  for (const { id } of getDb().all("SELECT id FROM users WHERE role = 'recruiter' AND status = 'approved' AND organisation_id = ?", [orgId])) notify(id, payload);
}

let transport = null;
function mailTransport() {
  if (!config.mail.host) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
  }
  return transport;
}

/** Sends through SMTP when configured; otherwise logs to the console and the dev outbox. */
async function sendMail({ to, subject, text }) {
  const t = mailTransport();
  let status = 'logged';
  let error = null;
  if (t) {
    try { await t.sendMail({ from: config.mail.from, to, subject, text }); status = 'sent'; } catch (err) { status = 'failed'; error = err.message; console.error(`[mail] failed to send to ${to}: ${err.message}`); }
  } else if (!config.isTest) {
    console.log(`\n[mail:dev] To: ${to}\n[mail:dev] Subject: ${subject}\n${text.split('\n').map((l) => `[mail:dev] ${l}`).join('\n')}\n`);
  }
  getDb().run('INSERT INTO email_outbox (to_email, subject, body, status, error) VALUES (?, ?, ?, ?, ?)', [to, subject, config.mail.devMailbox ? text : null, status, error]);
  return { status };
}

module.exports = { audit, notify, notifyAdmins, notifyOrganisation, sendMail };
