'use strict';
/**
 * Grievance redressal for students, recruiters and guests (no account needed).
 * Simple: one form, plain-language categories. Transparent: ticket number, SLA timers and a full
 * timeline visible to the complainant. Accessible: works signed-out with a tracking key.
 */
const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const { getDb } = require('../db');
const { z, text, optText, email, id, bool, validate, parse } = require('../lib/validation');
const { HttpError, notFound, nowSql, toSql, addHours, sha256 } = require('../lib/util');
const { GRIEVANCE_CATEGORIES, GRIEVANCE_OPEN } = require('../lib/constants');
const { limiters } = require('../middleware/security');
const files = require('../services/files');
const { requireCaptcha } = require('../services/captcha');
const { audit, notify, notifyAdmins, sendMail } = require('../services/events');
const G = require('../services/grievances');
const opps = require('../services/opportunities');

const router = express.Router();
const db = () => getDb();
const emptyToUndef = (v) => (v === '' || v == null ? undefined : v);

const evidenceUpload = files.uploader('evidence', config.uploads.proofMaxMb, ['pdf', 'png', 'jpg', 'jpeg']);

const createSchema = z.object({
  category: z.enum(Object.keys(GRIEVANCE_CATEGORIES), { error: 'Choose what this is about.' }),
  subject: text(5, 120, 'Subject'),
  description: text(30, 4000, 'Description'),
  againstType: z.preprocess(emptyToUndef, z.enum(['platform', 'opportunity', 'organisation', 'user']).default('platform')),
  againstId: z.preprocess(emptyToUndef, id.optional()),
  isAnonymous: z.preprocess(emptyToUndef, bool.default(false)),
  declaration: bool.refine((v) => v === true, 'Confirm that the information you provided is accurate.'),
  guestName: z.preprocess(emptyToUndef, text(2, 80, 'Your name').optional()),
  guestEmail: z.preprocess(emptyToUndef, email.optional()),
  captchaToken: z.string().max(2048).optional(),
});

function resolveTarget(type, targetId, user) {
  if (type === 'platform' || !targetId) return { type: 'platform', id: null, label: 'HORIZON platform', orgId: null };
  if (type === 'opportunity') {
    const row = opps.getRow(targetId);
    if (!row) throw new HttpError(422, 'Listing not found.', { fields: { againstId: 'We could not find that listing.' } });
    return { type, id: row.id, label: `${row.org_name} — ${row.title}`, orgId: row.organisation_id };
  }
  if (type === 'organisation') {
    const org = db().get('SELECT id, name FROM organisations WHERE id = ?', [targetId]);
    if (!org) throw new HttpError(422, 'Organisation not found.', { fields: { againstId: 'We could not find that organisation.' } });
    return { type, id: org.id, label: org.name, orgId: org.id };
  }
  const target = db().get('SELECT u.id, u.full_name, u.role, u.organisation_id, o.name AS org FROM users u LEFT JOIN organisations o ON o.id = u.organisation_id WHERE u.id = ?', [targetId]);
  if (!target || (user && target.id === user.id)) throw new HttpError(422, 'User not found.', { fields: { againstId: 'We could not find that user.' } });
  return { type, id: target.id, label: target.role === 'recruiter' ? `${target.org} — ${target.full_name}` : `${target.full_name} (${target.role})`, orgId: target.role === 'recruiter' ? target.organisation_id : null };
}

function makeAccessKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

router.post('/', limiters.grievance, evidenceUpload, async (req, res) => {
  const d = parse(createSchema, req.body);
  const user = req.user || null;
  if (!user) {
    if (!d.guestName || !d.guestEmail) {
      throw new HttpError(422, 'Tell us how to reach you.', { fields: { guestName: d.guestName ? undefined : 'Enter your name.', guestEmail: d.guestEmail ? undefined : 'Enter an email address so we can update you.' } });
    }
    await requireCaptcha(d.captchaToken, req.ip);
  }
  const target = resolveTarget(d.againstType, d.againstId, user);

  let evidence = null;
  if (req.file) {
    const type = files.sniff(files.readHead(req.file.path));
    if (!['pdf', 'png', 'jpeg'].includes(type)) throw new HttpError(422, 'Evidence must be a PDF, JPG or PNG file.', { fields: { evidence: 'Upload a PDF, JPG or PNG file.' } });
    evidence = files.storeDocument({ file: req.file, userId: user ? user.id : null, kind: 'grievance_evidence', type, sha256: await files.hashFile(req.file.path) });
  }

  const priority = GRIEVANCE_CATEGORIES[d.category].priority;
  const due = G.dueDates(priority);
  const accessKey = user ? null : makeAccessKey();
  const now = nowSql();
  const gid = db().tx(() => {
    const { lastInsertRowid } = db().run(`INSERT INTO grievances (complainant_id, guest_name, guest_email, access_key_hash, category, subject, description,
      against_type, against_id, against_label, respondent_org_id, priority, status, is_anonymous, evidence_document_id, ack_due_at, resolution_due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?)`,
    [user ? user.id : null, user ? null : d.guestName, user ? null : d.guestEmail, accessKey ? sha256(accessKey) : null, d.category, d.subject, d.description,
      target.type, target.id, target.label, target.orgId, priority, d.isAnonymous && target.orgId ? 1 : 0, evidence ? evidence.id : null, due.ack_due_at, due.resolution_due_at, now, now]);
    db().run('UPDATE grievances SET ticket_no = ? WHERE id = ?', [G.ticketNo(lastInsertRowid, now), lastInsertRowid]);
    G.addEvent(lastInsertRowid, { actorId: user ? user.id : null, actorRole: 'complainant', type: 'submitted', visibility: 'complainant', to: 'submitted', message: null });
    G.addEvent(lastInsertRowid, {
      actorRole: 'system', type: 'receipt', visibility: 'complainant',
      message: `Your grievance was received. A person from the grievance desk will acknowledge it within ${config.grievance.ackHours} hours, and our resolution target is ${priority === 'urgent' ? `${config.grievance.urgentResolveHours} hours (urgent)` : `${config.grievance.resolveDays} days`}.`,
    });
    return lastInsertRowid;
  });
  const g = db().get('SELECT * FROM grievances WHERE id = ?', [gid]);
  notifyAdmins({ type: 'grievance', title: `${priority === 'urgent' ? 'URGENT: ' : ''}New grievance ${g.ticket_no}`, body: d.subject, link: `/admin/grievances/${gid}` });
  const to = user ? user.email : d.guestEmail;
  await sendMail({
    to,
    subject: `Grievance ${g.ticket_no} received — HORIZON`,
    text: `We received your grievance "${d.subject}".\n\nTicket: ${g.ticket_no}\n${accessKey ? `Tracking key: ${accessKey} (keep this private — you need it to follow your ticket)\n` : ''}Acknowledgement due: ${g.ack_due_at} UTC\nResolution target: ${g.resolution_due_at} UTC\n\nTrack it at ${config.appUrl}/grievance-redressal${accessKey ? '#track' : ''}\n\n— HORIZON Grievance Desk`,
  });
  audit(req, 'grievance.create', { entityType: 'grievance', entityId: gid, details: { category: d.category, priority, guest: !user }, actorRole: user ? undefined : 'guest' });
  res.status(201).json({ id: gid, ticketNo: g.ticket_no, accessKey, ackDueAt: g.ack_due_at, resolutionDueAt: g.resolution_due_at, priority });
});

const listSelect = 'SELECT g.* FROM grievances g';
const summary = (g) => ({
  id: g.id, ticketNo: g.ticket_no, subject: g.subject, category: g.category, categoryLabel: (GRIEVANCE_CATEGORIES[g.category] || {}).label,
  status: g.status, statusLabel: G.STATUS_LABELS[g.status], priority: g.priority, level: g.level, against: g.against_label,
  sla: G.sla(g), createdAt: g.created_at, updatedAt: g.updated_at, isDemo: !!g.is_demo,
});

router.get('/mine', (req, res) => {
  if (!req.user) throw new HttpError(401, 'Please sign in to see your grievances.', { code: 'AUTH_REQUIRED' });
  const filed = db().all(`${listSelect} WHERE g.complainant_id = ? ORDER BY g.created_at DESC`, [req.user.id]);
  const concerning = req.user.role === 'recruiter' && req.user.status === 'approved'
    ? db().all(`${listSelect} WHERE g.respondent_org_id = ? AND g.shared_with_respondent = 1 ORDER BY g.updated_at DESC`, [req.user.organisation_id])
    : [];
  res.json({ filed: filed.map(summary), concerning: concerning.map(summary) });
});

router.post('/track', limiters.track, validate(z.object({ ticketNo: text(5, 30, 'Ticket number'), accessKey: text(8, 20, 'Tracking key') })), (req, res) => {
  const { ticketNo, accessKey } = req.valid.body;
  const g = db().get('SELECT * FROM grievances WHERE ticket_no = ?', [ticketNo.toUpperCase()]);
  const ok = g && g.access_key_hash && sha256(accessKey.trim().toUpperCase()) === g.access_key_hash;
  if (!ok) throw new HttpError(404, 'No grievance matches that ticket number and tracking key.', { fields: { accessKey: 'Check the ticket number and tracking key from your confirmation.' } });
  res.json(G.view(g, 'complainant'));
});

function loadScoped(req) {
  const gid = parse(id, req.params.id);
  const g = db().get('SELECT * FROM grievances WHERE id = ?', [gid]);
  if (!g) throw notFound('Grievance');
  const scope = G.accessScope(req, g);
  if (!scope) throw notFound('Grievance');
  return { g, scope };
}

router.get('/:id', (req, res) => {
  const { g, scope } = loadScoped(req);
  res.json(G.view(g, scope));
});

router.post('/:id/messages', validate(z.object({ message: text(2, 3000, 'Message') })), (req, res) => {
  const { g, scope } = loadScoped(req);
  if (g.status === 'closed') throw new HttpError(409, 'This grievance is closed. File a new one if you need further help.');
  const actorId = req.user ? req.user.id : null;
  const { message } = req.valid.body;
  if (scope === 'respondent') {
    G.addEvent(g.id, { actorId, actorRole: 'respondent', type: 'respondent_reply', visibility: 'parties', message });
    if (g.status === 'awaiting_response') {
      db().run("UPDATE grievances SET status = 'under_review' WHERE id = ?", [g.id]);
      G.addEvent(g.id, { actorRole: 'system', type: 'status_changed', visibility: 'parties', from: 'awaiting_response', to: 'under_review', message: 'Response received from the organisation. The grievance desk is reviewing it.' });
    }
    if (g.complainant_id) notify(g.complainant_id, { type: 'grievance', title: `Update on ${g.ticket_no}`, body: 'The organisation responded to your grievance.', link: `/app/grievances/${g.id}` });
    notifyAdmins({ type: 'grievance', title: `Respondent replied on ${g.ticket_no}`, body: g.subject, link: `/admin/grievances/${g.id}` });
  } else if (scope === 'complainant') {
    G.addEvent(g.id, { actorId, actorRole: 'complainant', type: 'message', visibility: 'complainant', message });
    if (g.assigned_to) notify(g.assigned_to, { type: 'grievance', title: `New message on ${g.ticket_no}`, body: g.subject, link: `/admin/grievances/${g.id}` });
    else notifyAdmins({ type: 'grievance', title: `New message on ${g.ticket_no}`, body: g.subject, link: `/admin/grievances/${g.id}` });
  } else {
    G.addEvent(g.id, { actorId, actorRole: 'admin', type: 'message', visibility: 'complainant', message });
  }
  audit(req, 'grievance.message', { entityType: 'grievance', entityId: g.id, details: { scope }, actorRole: req.user ? undefined : 'guest' });
  res.status(201).json(G.view(db().get('SELECT * FROM grievances WHERE id = ?', [g.id]), scope));
});

router.post('/:id/escalate', validate(z.object({ reason: text(10, 2000, 'Reason') })), (req, res) => {
  const { g, scope } = loadScoped(req);
  if (scope !== 'complainant') throw new HttpError(403, 'Only the person who filed the grievance can escalate it.');
  if (!G.canEscalate(g)) throw new HttpError(409, 'This grievance cannot be escalated yet. You can escalate if the resolution deadline passes, or within the appeal window after a decision.');
  const now = new Date();
  db().run("UPDATE grievances SET level = 2, status = 'under_review', escalated_at = ?, resolution_due_at = ?, updated_at = ? WHERE id = ?",
    [toSql(now), toSql(addHours(now, config.grievance.resolveDays * 24)), toSql(now), g.id]);
  G.addEvent(g.id, { actorId: req.user ? req.user.id : null, actorRole: 'complainant', type: 'escalated', visibility: 'complainant', from: g.status, to: 'under_review', message: req.valid.body.reason });
  G.addEvent(g.id, { actorRole: 'system', type: 'receipt', visibility: 'complainant', message: `Escalated to the Grievance Officer (${config.grievance.officerName}). A new ${config.grievance.resolveDays}-day resolution window has started.` });
  notifyAdmins({ type: 'grievance', title: `Escalated: ${g.ticket_no}`, body: g.subject, link: `/admin/grievances/${g.id}` });
  audit(req, 'grievance.escalate', { entityType: 'grievance', entityId: g.id, actorRole: req.user ? undefined : 'guest' });
  res.json(G.view(db().get('SELECT * FROM grievances WHERE id = ?', [g.id]), scope));
});

router.post('/:id/feedback', validate(z.object({
  rating: z.coerce.number().int().min(1, 'Choose a rating.').max(5),
  comment: optText(1000, 'Comment'),
  reopen: z.boolean().default(false),
})), (req, res) => {
  const { g, scope } = loadScoped(req);
  if (scope !== 'complainant') throw new HttpError(403, 'Only the person who filed the grievance can respond to the decision.');
  const d = req.valid.body;
  const now = new Date();
  if (d.reopen) {
    if (!G.canReopen(g)) throw new HttpError(409, `Grievances can be reopened within ${config.grievance.reopenDays} days of a decision. You can still escalate within the appeal window.`);
    db().run("UPDATE grievances SET status = 'under_review', resolution_due_at = ?, updated_at = ? WHERE id = ?", [toSql(addHours(now, config.grievance.resolveDays * 24)), toSql(now), g.id]);
    G.addEvent(g.id, { actorId: req.user ? req.user.id : null, actorRole: 'complainant', type: 'reopened', visibility: 'complainant', from: g.status, to: 'under_review', message: d.comment || 'Reopened by the complainant.' });
    notifyAdmins({ type: 'grievance', title: `Reopened: ${g.ticket_no}`, body: g.subject, link: `/admin/grievances/${g.id}` });
  } else {
    if (!G.canGiveFeedback(g)) throw new HttpError(409, 'Feedback can be given once, after a decision.');
    db().run("UPDATE grievances SET satisfaction_rating = ?, satisfaction_comment = ?, status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?",
      [d.rating, d.comment, toSql(now), toSql(now), g.id]);
    G.addEvent(g.id, { actorId: req.user ? req.user.id : null, actorRole: 'complainant', type: 'feedback', visibility: 'complainant', from: g.status, to: 'closed', message: `Rated the resolution ${d.rating}/5.${d.comment ? ` “${d.comment}”` : ''}` });
  }
  audit(req, d.reopen ? 'grievance.reopen' : 'grievance.feedback', { entityType: 'grievance', entityId: g.id, actorRole: req.user ? undefined : 'guest' });
  res.json(G.view(db().get('SELECT * FROM grievances WHERE id = ?', [g.id]), scope));
});

module.exports = router;
module.exports.GRIEVANCE_OPEN = GRIEVANCE_OPEN;
