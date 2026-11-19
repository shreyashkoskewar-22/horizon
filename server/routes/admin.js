'use strict';
/** Administrator console API. Every route is restricted to approved admin accounts on the server. */
const express = require('express');
const config = require('../config');
const { getDb } = require('../db');
const { z, text, optText, url, date, id, bool, validate, parse } = require('../lib/validation');
const { HttpError, notFound, nowSql, toSql, addHours, todayDate, paginate, pageResult, likeEscape, parseJsonArray, parseJson, slugify } = require('../lib/util');
const { INSTITUTION_CATEGORIES, ORG_TYPES, STAGES, GRIEVANCE_CATEGORIES, GRIEVANCE_STATUSES, GRIEVANCE_OPEN } = require('../lib/constants');
const { allow } = require('../middleware/auth');
const opps = require('../services/opportunities');
const users = require('../services/users');
const G = require('../services/grievances');
const { audit, notify, notifyOrganisation, sendMail } = require('../services/events');

const router = express.Router();
router.use(allow('admin'));
const db = () => getDb();
const like = (s) => `%${likeEscape(String(s || '').slice(0, 80))}%`;

/* --------------------------------------------------------------- Overview */

router.get('/dashboard', (req, res) => {
  const d = db();
  const byStatus = (role) => Object.fromEntries(['approved', 'pending', 'rejected', 'suspended'].map((s) => [s, d.value('SELECT COUNT(*) FROM users WHERE role = ? AND status = ?', [role, s])]));
  const grievances = d.all(`SELECT * FROM grievances WHERE status IN (${GRIEVANCE_OPEN.map(() => '?').join(',')})`, GRIEVANCE_OPEN);
  res.json({
    containsDemoData: !!d.value('SELECT EXISTS (SELECT 1 FROM opportunities WHERE is_demo = 1) OR EXISTS (SELECT 1 FROM organisations WHERE is_demo = 1)'),
    stats: {
      students: byStatus('student'),
      recruiters: byStatus('recruiter'),
      pendingVerifications: d.value("SELECT COUNT(*) FROM verification_requests WHERE status = 'pending'"),
      publishedListings: d.value(`SELECT COUNT(*) FROM opportunities o WHERE ${opps.OPEN_WHERE}`),
      listingsPendingReview: d.value("SELECT COUNT(*) FROM opportunities WHERE status = 'pending_review'"),
      expiredStillPublished: d.value("SELECT COUNT(*) FROM opportunities WHERE status = 'published' AND application_deadline < date('now')"),
      documentsToReview: d.value(`SELECT COUNT(*) FROM documents WHERE is_current = 1 AND ((kind = 'cv' AND (review_status = 'flagged' OR (manual_review_requested = 1 AND review_status <> 'verified'))) OR (kind = 'video' AND review_status = 'pending_review'))`),
      openGrievances: grievances.length,
      overdueGrievances: grievances.filter((g) => G.sla(g).resolutionOverdue || G.sla(g).ackOverdue).length,
      applications: d.value('SELECT COUNT(*) FROM applications'),
    },
    queues: {
      verifications: d.all(`SELECT vr.id, vr.request_type, vr.created_at, u.full_name, COALESCE(i.name, o.name) AS affiliation FROM verification_requests vr
        JOIN users u ON u.id = vr.user_id LEFT JOIN institutions i ON i.id = u.institution_id LEFT JOIN organisations o ON o.id = u.organisation_id
        WHERE vr.status = 'pending' ORDER BY vr.created_at LIMIT 5`),
      grievances: grievances.sort((a, b) => a.resolution_due_at.localeCompare(b.resolution_due_at)).slice(0, 5)
        .map((g) => ({ id: g.id, ticketNo: g.ticket_no, subject: g.subject, priority: g.priority, status: g.status, statusLabel: G.STATUS_LABELS[g.status], sla: G.sla(g) })),
      listings: d.all(`SELECT o.id, o.title, org.name AS organisation, o.updated_at FROM opportunities o JOIN organisations org ON org.id = o.organisation_id
        WHERE o.status = 'pending_review' ORDER BY o.updated_at LIMIT 5`),
    },
  });
});

/* ---------------------------------------------------- Students & recruiters */

function listUsers(role, q) {
  const where = ['u.role = ?'];
  const params = [role];
  if (q.search) { where.push('(u.full_name LIKE ? ESCAPE \'\\\' OR u.email LIKE ? ESCAPE \'\\\')'); params.push(like(q.search), like(q.search)); }
  if (q.status && ['approved', 'pending', 'rejected', 'suspended'].includes(q.status)) { where.push('u.status = ?'); params.push(q.status); }
  if (role === 'student' && q.institutionId) { where.push('u.institution_id = ?'); params.push(Number(q.institutionId) || 0); }
  if (role === 'recruiter' && q.organisationId) { where.push('u.organisation_id = ?'); params.push(Number(q.organisationId) || 0); }
  const p = paginate(q, { defaultSize: 20 });
  const total = db().value(`SELECT COUNT(*) FROM users u WHERE ${where.join(' AND ')}`, params);
  const rows = db().all(`SELECT u.*, i.name AS institution_name, i.short_name AS institution_short, o.name AS organisation_name, o.verification_status AS org_status,
      sp.programme, sp.current_year, rp.designation,
      (SELECT COUNT(*) FROM applications a WHERE a.user_id = u.id) AS app_count,
      (SELECT status FROM verification_requests vr WHERE vr.user_id = u.id ORDER BY vr.id DESC LIMIT 1) AS last_request
    FROM users u LEFT JOIN institutions i ON i.id = u.institution_id LEFT JOIN organisations o ON o.id = u.organisation_id
    LEFT JOIN student_profiles sp ON sp.user_id = u.id LEFT JOIN recruiter_profiles rp ON rp.user_id = u.id
    WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`, [...params, p.pageSize, p.offset]);
  return pageResult(rows.map((u) => ({
    id: u.id, fullName: u.full_name, email: u.email, status: u.status, statusReason: u.status_reason, emailVerified: !!u.email_verified_at,
    verificationMethod: u.verification_method, institution: u.institution_name, institutionShort: u.institution_short, institutionId: u.institution_id,
    organisation: u.organisation_name, organisationId: u.organisation_id, organisationVerified: u.org_status === 'verified', programme: u.programme, currentYear: u.current_year,
    designation: u.designation, applications: u.app_count, lastRequest: u.last_request, createdAt: u.created_at, lastLoginAt: u.last_login_at,
  })), total, p);
}

router.get('/students', (req, res) => res.json(listUsers('student', req.query)));
router.get('/recruiters', (req, res) => res.json(listUsers('recruiter', req.query)));

router.get('/users/:id', (req, res) => {
  const { USER_SQL } = require('../middleware/auth');
  const u = db().get(USER_SQL, [parse(id, req.params.id)]);
  if (!u || u.role === 'admin') throw notFound('User');
  const docs = db().all('SELECT * FROM documents WHERE user_id = ? AND is_current = 1 ORDER BY id DESC', [u.id]);
  const requests = db().all('SELECT * FROM verification_requests WHERE user_id = ? ORDER BY id DESC', [u.id]);
  res.json({
    user: users.publicUser(u),
    profile: u.role === 'student' ? users.studentProfileRow(u.id) : users.recruiterProfileRow(u.id),
    documents: docs.map(users.documentSummary),
    requests: requests.map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at, reviewedAt: r.reviewed_at, internalNote: r.internal_note, userMessage: r.user_message })),
    applications: db().value('SELECT COUNT(*) FROM applications WHERE user_id = ?', [u.id]),
    lastLoginAt: u.last_login_at,
  });
});

const statusSchema = z.object({ status: z.enum(['approved', 'rejected', 'suspended', 'pending']), reason: optText(500, 'Reason') })
  .superRefine((d, ctx) => { if (['rejected', 'suspended'].includes(d.status) && (!d.reason || d.reason.length < 5)) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give a short reason — the user will see it.' }); });

function changeStatus(req, res) {
  const targetId = parse(id, req.params.id);
  const d = req.valid.body;
  const u = db().get('SELECT * FROM users WHERE id = ?', [targetId]);
  if (!u || u.role === 'admin') throw notFound('User');
  if (d.status === 'approved') {
    if (!u.email_verified_at) throw new HttpError(409, 'This user has not verified their email address yet.');
    if (u.role === 'recruiter' && db().value('SELECT verification_status FROM organisations WHERE id = ?', [u.organisation_id]) !== 'verified') {
      throw new HttpError(409, 'Verify the recruiter’s organisation first (Organisations page or the verification request).');
    }
  }
  db().tx(() => {
    db().run(`UPDATE users SET status = ?, status_reason = ?, verification_method = CASE WHEN ? = 'approved' THEN COALESCE(verification_method, 'manual') ELSE verification_method END, updated_at = ? WHERE id = ?`,
      [d.status, d.status === 'approved' ? null : d.reason, d.status, nowSql(), u.id]);
    if (d.status === 'approved' || d.status === 'rejected') {
      db().run("UPDATE verification_requests SET status = ?, reviewer_id = ?, reviewed_at = ?, user_message = COALESCE(?, user_message) WHERE user_id = ? AND status = 'pending'",
        [d.status === 'approved' ? 'approved' : 'rejected', req.user.id, nowSql(), d.reason, u.id]);
    }
  });
  if (d.status === 'suspended') req.app.locals.sessionStore.destroyForUser(u.id);
  const titles = { approved: 'Your account is verified', rejected: 'Verification unsuccessful', suspended: 'Account suspended', pending: 'Account returned to review' };
  notify(u.id, { type: 'account', title: titles[d.status], body: d.reason || null, link: d.status === 'approved' ? users.homeFor(u) : '/verify' });
  audit(req, 'user.status', { entityType: 'user', entityId: u.id, details: { status: d.status, reason: d.reason } });
  res.json({ ok: true, status: d.status });
}
router.put('/users/:id/status', validate(statusSchema), changeStatus);
router.put('/students/:id/status', validate(statusSchema), changeStatus);

/* --------------------------------------------------------- Verifications */

router.get('/verifications', (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const type = ['student', 'recruiter'].includes(req.query.type) ? req.query.type : null;
  const rows = db().all(`SELECT vr.*, u.full_name, u.email, u.role, u.status AS user_status, u.email_verified_at,
      i.name AS institution_name, i.recognition_reference, sp.programme, sp.current_year, sp.graduation_year,
      o.id AS org_id, o.name AS org_name, o.website AS org_website, o.email_domain AS org_domain, o.verification_status AS org_status, o.org_type, o.country AS org_country,
      rp.designation, d.original_name, d.mime_type, rv.full_name AS reviewer_name
    FROM verification_requests vr JOIN users u ON u.id = vr.user_id
    LEFT JOIN institutions i ON i.id = u.institution_id LEFT JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN organisations o ON o.id = u.organisation_id LEFT JOIN recruiter_profiles rp ON rp.user_id = u.id
    LEFT JOIN documents d ON d.id = vr.document_id LEFT JOIN users rv ON rv.id = vr.reviewer_id
    WHERE vr.status = ? ${type ? 'AND vr.request_type = ?' : ''} ORDER BY vr.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`, type ? [status, type] : [status]);
  res.json({
    items: rows.map((r) => ({
      id: r.id, type: r.request_type, status: r.status, createdAt: r.created_at, reviewedAt: r.reviewed_at, reviewer: r.reviewer_name,
      note: r.submitted_note, registrationNumber: r.registration_number, internalNote: r.internal_note, userMessage: r.user_message,
      autoChecks: parseJsonArray(r.auto_checks),
      user: { id: r.user_id, name: r.full_name, email: r.email, status: r.user_status, emailVerified: !!r.email_verified_at, designation: r.designation },
      institution: r.institution_name ? { name: r.institution_name, recognition: r.recognition_reference, programme: r.programme, currentYear: r.current_year, graduationYear: r.graduation_year } : null,
      organisation: r.org_id ? { id: r.org_id, name: r.org_name, website: r.org_website, emailDomain: r.org_domain, status: r.org_status, type: r.org_type, country: r.org_country } : null,
      document: r.document_id ? { id: r.document_id, name: r.original_name, mimeType: r.mime_type, url: `/api/documents/${r.document_id}/file` } : null,
    })),
  });
});

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  internalNote: optText(1000, 'Internal note'),
  userMessage: optText(500, 'Message to the user'),
  verifyOrganisation: z.boolean().default(false),
  registrationNumber: optText(60, 'Registration number'),
}).superRefine((d, ctx) => {
  if (d.decision === 'reject' && (!d.userMessage || d.userMessage.length < 10)) ctx.addIssue({ code: 'custom', path: ['userMessage'], message: 'Explain what was missing so the user can resubmit (at least 10 characters).' });
});

router.put('/verifications/:id', validate(decisionSchema), (req, res) => {
  const vr = db().get('SELECT * FROM verification_requests WHERE id = ?', [parse(id, req.params.id)]);
  if (!vr) throw notFound('Verification request');
  if (vr.status !== 'pending') throw new HttpError(409, 'This request has already been decided.');
  const u = db().get('SELECT * FROM users WHERE id = ?', [vr.user_id]);
  const d = req.valid.body;
  const now = nowSql();
  if (d.decision === 'approve') {
    if (!u.email_verified_at) throw new HttpError(409, 'The user has not verified their email address yet.');
    if (u.role === 'recruiter') {
      const org = db().get('SELECT * FROM organisations WHERE id = ?', [u.organisation_id]);
      if (org.verification_status !== 'verified' && !d.verifyOrganisation) {
        throw new HttpError(422, 'Verify the organisation to approve this recruiter.', { fields: { verifyOrganisation: 'Recruiters can only be approved for verified organisations. Tick “Also verify organisation”.' } });
      }
    }
  }
  db().tx(() => {
    db().run('UPDATE verification_requests SET status = ?, reviewer_id = ?, internal_note = ?, user_message = ?, reviewed_at = ? WHERE id = ?',
      [d.decision === 'approve' ? 'approved' : 'rejected', req.user.id, d.internalNote, d.userMessage, now, vr.id]);
    if (vr.document_id) db().run('UPDATE documents SET review_status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?', [d.decision === 'approve' ? 'approved' : 'rejected', req.user.id, now, d.internalNote, vr.document_id]);
    if (d.decision === 'approve') {
      db().run("UPDATE users SET status = 'approved', status_reason = NULL, verification_method = 'manual', updated_at = ? WHERE id = ?", [now, u.id]);
      if (u.role === 'recruiter' && d.verifyOrganisation) {
        db().run("UPDATE organisations SET verification_status = 'verified', verified_at = ?, registration_number = COALESCE(?, registration_number, ?), updated_at = ? WHERE id = ?",
          [now, d.registrationNumber, vr.registration_number, now, u.organisation_id]);
      }
    } else {
      db().run("UPDATE users SET status = 'rejected', status_reason = ?, updated_at = ? WHERE id = ?", [d.userMessage, now, u.id]);
    }
  });
  notify(u.id, d.decision === 'approve'
    ? { type: 'verification', title: 'You are verified', body: 'Your documents were approved. Welcome to HORIZON.', link: users.homeFor(u) }
    : { type: 'verification', title: 'Verification unsuccessful', body: d.userMessage, link: '/verify' });
  audit(req, `verification.${d.decision}`, { entityType: 'user', entityId: u.id, details: { requestId: vr.id, verifyOrganisation: d.verifyOrganisation } });
  if (d.decision === 'approve' && d.verifyOrganisation) audit(req, 'organisation.verify', { entityType: 'organisation', entityId: u.organisation_id });
  res.json({ ok: true });
});

/* ----------------------------------------------------------- Institutions */

const domainRe = /^(?=.{4,100}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const institutionSchema = z.object({
  name: text(3, 200, 'Institution name'),
  shortName: optText(60, 'Short name'),
  category: z.enum(INSTITUTION_CATEGORIES, { error: 'Select a category.' }),
  city: optText(80, 'City'),
  state: optText(80, 'State'),
  officialWebsite: url('Official website'),
  recognitionReference: text(3, 300, 'Official recognition reference'),
  recognitionSourceUrl: url('Recognition source link'),
  verificationStatus: z.enum(['verified', 'unverified']),
  verificationNote: optText(500, 'Verification note'),
  isActive: z.boolean().default(true),
  domains: z.array(z.object({ domain: z.string().trim().toLowerCase().regex(domainRe, 'Enter a domain like iitb.ac.in'), isVerified: z.boolean().default(false) })).max(10).default([]),
}).superRefine((d, ctx) => {
  if (d.verificationStatus === 'verified' && !d.recognitionSourceUrl) ctx.addIssue({ code: 'custom', path: ['recognitionSourceUrl'], message: 'An institution can only be approved after checking an official source — add its link.' });
});

function serializeInstitution(r, domains) {
  return {
    id: r.id, name: r.name, shortName: r.short_name, category: r.category, city: r.city, state: r.state, officialWebsite: r.official_website,
    recognitionReference: r.recognition_reference, recognitionSourceUrl: r.recognition_source_url, verificationStatus: r.verification_status,
    verificationNote: r.verification_note, isActive: !!r.is_active, verifiedAt: r.verified_at, studentCount: r.student_count || 0,
    domains: domains.filter((x) => x.institution_id === r.id).map((x) => ({ id: x.id, domain: x.domain, isVerified: !!x.is_verified })),
  };
}

router.get('/institutions', (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.search) { where.push('(i.name LIKE ? ESCAPE \'\\\' OR i.short_name LIKE ? ESCAPE \'\\\' OR i.city LIKE ? ESCAPE \'\\\')'); params.push(like(req.query.search), like(req.query.search), like(req.query.search)); }
  if (INSTITUTION_CATEGORIES.includes(req.query.category)) { where.push('i.category = ?'); params.push(req.query.category); }
  if (req.query.status === 'verified' || req.query.status === 'unverified') { where.push('i.verification_status = ?'); params.push(req.query.status); }
  if (req.query.status === 'inactive') where.push('i.is_active = 0');
  const p = paginate(req.query, { defaultSize: 25, maxSize: 200 });
  const total = db().value(`SELECT COUNT(*) FROM institutions i WHERE ${where.join(' AND ')}`, params);
  const rows = db().all(`SELECT i.*, (SELECT COUNT(*) FROM users u WHERE u.institution_id = i.id) AS student_count FROM institutions i
    WHERE ${where.join(' AND ')} ORDER BY i.verification_status DESC, i.name LIMIT ? OFFSET ?`, [...params, p.pageSize, p.offset]);
  const domains = rows.length ? db().all(`SELECT * FROM institution_domains WHERE institution_id IN (${rows.map(() => '?').join(',')})`, rows.map((r) => r.id)) : [];
  res.json(pageResult(rows.map((r) => serializeInstitution(r, domains)), total, p));
});

function saveDomains(instId, domains) {
  db().run('DELETE FROM institution_domains WHERE institution_id = ?', [instId]);
  for (const dmn of domains) {
    const clash = db().get('SELECT i.name FROM institution_domains d JOIN institutions i ON i.id = d.institution_id WHERE d.domain = ?', [dmn.domain]);
    if (clash) throw new HttpError(409, `The domain ${dmn.domain} is already registered to ${clash.name}.`, { fields: { domains: `${dmn.domain} belongs to ${clash.name}.` } });
    db().run('INSERT INTO institution_domains (institution_id, domain, is_verified) VALUES (?, ?, ?)', [instId, dmn.domain, dmn.isVerified ? 1 : 0]);
  }
}

router.post('/institutions', validate(institutionSchema), (req, res) => {
  const d = req.valid.body;
  if (db().get('SELECT 1 FROM institutions WHERE name = ?', [d.name])) throw new HttpError(409, 'An institution with this name already exists.', { fields: { name: 'Already exists.' } });
  const instId = db().tx(() => {
    const { lastInsertRowid } = db().run(`INSERT INTO institutions (name, short_name, category, city, state, official_website, recognition_reference, recognition_source_url,
      verification_status, verification_note, is_active, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.name, d.shortName, d.category, d.city, d.state, d.officialWebsite, d.recognitionReference, d.recognitionSourceUrl, d.verificationStatus, d.verificationNote, d.isActive ? 1 : 0, d.verificationStatus === 'verified' ? nowSql() : null]);
    saveDomains(lastInsertRowid, d.domains);
    return lastInsertRowid;
  });
  audit(req, 'institution.create', { entityType: 'institution', entityId: instId, details: { name: d.name, status: d.verificationStatus } });
  res.status(201).json({ id: instId });
});

router.put('/institutions/:id', validate(institutionSchema), (req, res) => {
  const instId = parse(id, req.params.id);
  const existing = db().get('SELECT * FROM institutions WHERE id = ?', [instId]);
  if (!existing) throw notFound('Institution');
  const d = req.valid.body;
  if (db().get('SELECT 1 FROM institutions WHERE name = ? AND id <> ?', [d.name, instId])) throw new HttpError(409, 'Another institution already uses this name.', { fields: { name: 'Already used.' } });
  db().tx(() => {
    db().run(`UPDATE institutions SET name = ?, short_name = ?, category = ?, city = ?, state = ?, official_website = ?, recognition_reference = ?, recognition_source_url = ?,
      verification_status = ?, verification_note = ?, is_active = ?, verified_at = ?, updated_at = ? WHERE id = ?`,
    [d.name, d.shortName, d.category, d.city, d.state, d.officialWebsite, d.recognitionReference, d.recognitionSourceUrl, d.verificationStatus, d.verificationNote,
      d.isActive ? 1 : 0, d.verificationStatus === 'verified' ? (existing.verified_at || nowSql()) : null, nowSql(), instId]);
    saveDomains(instId, d.domains);
  });
  audit(req, 'institution.update', { entityType: 'institution', entityId: instId, details: { status: d.verificationStatus, active: d.isActive } });
  res.json({ ok: true });
});

/** "Delete" deactivates: existing students keep their history, new registrations are blocked. */
router.delete('/institutions/:id', (req, res) => {
  const instId = parse(id, req.params.id);
  const { changes } = db().run('UPDATE institutions SET is_active = 0, updated_at = ? WHERE id = ?', [nowSql(), instId]);
  if (!changes) throw notFound('Institution');
  audit(req, 'institution.deactivate', { entityType: 'institution', entityId: instId });
  res.json({ deactivated: true });
});

/* ---------------------------------------------------------- Organisations */

const orgSchema = z.object({
  name: text(2, 120, 'Organisation name'),
  orgType: z.enum(ORG_TYPES, { error: 'Select a type.' }),
  website: url('Website'),
  emailDomain: z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null), z.string().regex(domainRe, 'Enter a domain like example.com').nullable()),
  country: text(2, 60, 'Country'),
  headquarters: optText(100, 'Headquarters'),
  description: optText(3000, 'Description'),
  linkedinUrl: url('LinkedIn page'),
  registrationNumber: optText(60, 'Registration number'),
  verificationStatus: z.enum(['verified', 'unverified', 'rejected']),
});

router.get('/organisations', (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.search) { where.push('o.name LIKE ? ESCAPE \'\\\''); params.push(like(req.query.search)); }
  if (['verified', 'unverified', 'rejected'].includes(req.query.status)) { where.push('o.verification_status = ?'); params.push(req.query.status); }
  const p = paginate(req.query, { defaultSize: 25, maxSize: 200 });
  const total = db().value(`SELECT COUNT(*) FROM organisations o WHERE ${where.join(' AND ')}`, params);
  const rows = db().all(`SELECT o.*, (SELECT COUNT(*) FROM users u WHERE u.organisation_id = o.id AND u.role = 'recruiter') AS recruiters,
      (SELECT COUNT(*) FROM opportunities x WHERE x.organisation_id = o.id) AS listings
    FROM organisations o WHERE ${where.join(' AND ')} ORDER BY o.name LIMIT ? OFFSET ?`, [...params, p.pageSize, p.offset]);
  res.json(pageResult(rows.map((o) => ({
    id: o.id, name: o.name, orgType: o.org_type, website: o.website, emailDomain: o.email_domain, country: o.country, headquarters: o.headquarters,
    description: o.description, linkedinUrl: o.linkedin_url, registrationNumber: o.registration_number, verificationStatus: o.verification_status,
    verifiedAt: o.verified_at, isDemo: !!o.is_demo, recruiters: o.recruiters, listings: o.listings,
  })), total, p));
});

function saveOrg(req, orgId) {
  const d = req.valid.body;
  const values = [d.name, d.orgType, d.website, d.emailDomain, d.country, d.headquarters, d.description, d.linkedinUrl, d.registrationNumber, d.verificationStatus];
  if (orgId) {
    const existing = db().get('SELECT * FROM organisations WHERE id = ?', [orgId]);
    if (!existing) throw notFound('Organisation');
    db().run(`UPDATE organisations SET name = ?, org_type = ?, website = ?, email_domain = ?, country = ?, headquarters = ?, description = ?, linkedin_url = ?,
      registration_number = ?, verification_status = ?, verified_at = ?, updated_at = ? WHERE id = ?`,
    [...values, d.verificationStatus === 'verified' ? (existing.verified_at || nowSql()) : null, nowSql(), orgId]);
    if (existing.verification_status !== d.verificationStatus) audit(req, d.verificationStatus === 'verified' ? 'organisation.verify' : 'organisation.unverify', { entityType: 'organisation', entityId: orgId });
    return orgId;
  }
  return db().run(`INSERT INTO organisations (name, org_type, website, email_domain, country, headquarters, description, linkedin_url, registration_number, verification_status, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...values, d.verificationStatus === 'verified' ? nowSql() : null]).lastInsertRowid;
}

router.post('/organisations', validate(orgSchema), (req, res) => {
  const orgId = saveOrg(req, null);
  audit(req, 'organisation.create', { entityType: 'organisation', entityId: orgId });
  res.status(201).json({ id: orgId });
});
router.put('/organisations/:id', validate(orgSchema), (req, res) => {
  const orgId = saveOrg(req, parse(id, req.params.id));
  audit(req, 'organisation.update', { entityType: 'organisation', entityId: orgId });
  res.json({ ok: true });
});

/* ---------------------------------------------------------- Opportunities */

router.get('/opportunities', (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (['draft', 'pending_review', 'published', 'rejected', 'archived'].includes(req.query.status)) { where.push('o.status = ?'); params.push(req.query.status); }
  if (req.query.status === 'expired') where.push("o.status = 'published' AND o.application_deadline < date('now')");
  if (req.query.q) { where.push('(o.title LIKE ? ESCAPE \'\\\' OR org.name LIKE ? ESCAPE \'\\\' OR o.country LIKE ? ESCAPE \'\\\')'); params.push(like(req.query.q), like(req.query.q), like(req.query.q)); }
  const p = paginate(req.query, { defaultSize: 20 });
  const total = db().value(`SELECT COUNT(*) FROM opportunities o JOIN organisations org ON org.id = o.organisation_id WHERE ${where.join(' AND ')}`, params);
  const rows = db().all(`${opps.BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE o.status WHEN 'pending_review' THEN 0 ELSE 1 END, o.updated_at DESC LIMIT ? OFFSET ?`, [...params, p.pageSize, p.offset]);
  const apps = new Map(rows.length ? db().all(`SELECT opportunity_id, COUNT(*) AS n FROM applications WHERE opportunity_id IN (${rows.map(() => '?').join(',')}) GROUP BY opportunity_id`, rows.map((r) => r.id)).map((r) => [r.opportunity_id, r.n]) : []);
  res.json(pageResult(rows.map((r) => ({ ...opps.serializeCard(r), reviewNote: r.review_note, applications: apps.get(r.id) || 0, updatedAt: r.updated_at, expired: r.application_deadline < todayDate() })), total, p));
});

router.put('/opportunities/:id/review', validate(z.object({ decision: z.enum(['publish', 'reject']), note: optText(1000, 'Review note') })
  .superRefine((d, ctx) => { if (d.decision === 'reject' && (!d.note || d.note.length < 10)) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Tell the recruiter what to change (at least 10 characters).' }); })), (req, res) => {
  const oppId = parse(id, req.params.id);
  const o = db().get('SELECT * FROM opportunities WHERE id = ?', [oppId]);
  if (!o) throw notFound('Opportunity');
  const d = req.valid.body;
  if (d.decision === 'publish') {
    db().run("UPDATE opportunities SET status = 'published', review_note = NULL, published_at = COALESCE(published_at, ?), last_verified_at = ?, updated_at = ? WHERE id = ?", [nowSql(), todayDate(), nowSql(), oppId]);
  } else {
    db().run("UPDATE opportunities SET status = 'rejected', review_note = ?, updated_at = ? WHERE id = ?", [d.note, nowSql(), oppId]);
  }
  notifyOrganisation(o.organisation_id, { type: 'listing', title: d.decision === 'publish' ? `Listing published: ${o.title}` : `Changes needed: ${o.title}`, body: d.note || 'Your listing passed review and is now visible to verified students.', link: '/recruiter/listings' });
  audit(req, `opportunity.${d.decision === 'publish' ? 'publish' : 'reject'}`, { entityType: 'opportunity', entityId: oppId, details: { note: d.note } });
  res.json({ ok: true });
});

router.patch('/opportunities/:id/flags', validate(z.object({ isFeatured: z.boolean().optional(), isVerified: z.boolean().optional(), status: z.enum(['published', 'archived', 'draft']).optional() })), (req, res) => {
  const oppId = parse(id, req.params.id);
  const o = db().get('SELECT * FROM opportunities WHERE id = ?', [oppId]);
  if (!o) throw notFound('Opportunity');
  const d = req.valid.body;
  const sets = []; const params = [];
  if (d.isFeatured !== undefined) { sets.push('is_featured = ?'); params.push(d.isFeatured ? 1 : 0); }
  if (d.isVerified !== undefined) { sets.push('is_verified = ?'); params.push(d.isVerified ? 1 : 0); if (d.isVerified) { sets.push('last_verified_at = ?'); params.push(todayDate()); } }
  if (d.status) {
    if (d.status === 'published' && o.application_deadline < todayDate()) throw new HttpError(409, 'Extend the deadline before republishing an expired listing.');
    sets.push('status = ?'); params.push(d.status);
    if (d.status === 'published') { sets.push('published_at = COALESCE(published_at, ?)'); params.push(nowSql()); }
    if (d.status === 'archived') { sets.push('archived_at = ?'); params.push(nowSql()); }
  }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = ?'); params.push(nowSql());
  db().run(`UPDATE opportunities SET ${sets.join(', ')} WHERE id = ?`, [...params, oppId]);
  audit(req, d.status === 'archived' ? 'opportunity.archive' : 'opportunity.flags', { entityType: 'opportunity', entityId: oppId, details: d });
  res.json({ ok: true });
});

router.post('/opportunities/archive-expired', (req, res) => {
  const count = opps.archiveExpired();
  audit(req, 'opportunity.archive_expired', { details: { count } });
  res.json({ archived: count, message: count ? `Archived ${count} expired listing${count === 1 ? '' : 's'}.` : 'No expired listings to archive.' });
});

/* -------------------------------------------------------------- Documents */

router.get('/documents', (req, res) => {
  const kind = req.query.kind === 'video' ? 'video' : 'cv';
  const all = req.query.status === 'all';
  const where = kind === 'cv'
    ? (all ? "d.kind = 'cv' AND d.is_current = 1" : "d.kind = 'cv' AND d.is_current = 1 AND (d.review_status = 'flagged' OR (d.manual_review_requested = 1 AND d.review_status <> 'verified'))")
    : (all ? "d.kind = 'video' AND d.is_current = 1" : "d.kind = 'video' AND d.is_current = 1 AND d.review_status = 'pending_review'");
  const rows = db().all(`SELECT d.*, u.full_name, u.role, u.email, i.name AS institution, o.name AS organisation FROM documents d JOIN users u ON u.id = d.user_id
    LEFT JOIN institutions i ON i.id = u.institution_id LEFT JOIN organisations o ON o.id = u.organisation_id WHERE ${where} ORDER BY d.created_at ASC LIMIT 200`);
  res.json({ items: rows.map((r) => ({ ...users.documentSummary(r), owner: { id: r.user_id, name: r.full_name, role: r.role, email: r.email, affiliation: r.institution || r.organisation } })) });
});

router.put('/documents/:id/review', validate(z.object({ decision: z.enum(['verified', 'changes_requested', 'approved', 'rejected']), note: optText(1000, 'Note') })), (req, res) => {
  const doc = db().get('SELECT * FROM documents WHERE id = ?', [parse(id, req.params.id)]);
  if (!doc || !['cv', 'video'].includes(doc.kind)) throw notFound('Document');
  const d = req.valid.body;
  const allowed = doc.kind === 'cv' ? ['verified', 'changes_requested'] : ['approved', 'rejected'];
  if (!allowed.includes(d.decision)) throw new HttpError(422, `Use ${allowed.join(' or ')} for this document.`, { fields: { decision: 'Invalid decision for this document type.' } });
  if (['changes_requested', 'rejected'].includes(d.decision) && (!d.note || d.note.length < 10)) throw new HttpError(422, 'Explain what needs to change.', { fields: { note: 'Explain what needs to change (at least 10 characters).' } });
  db().run('UPDATE documents SET review_status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, manual_review_requested = 0 WHERE id = ?', [d.decision, d.note, req.user.id, nowSql(), doc.id]);
  const owner = db().get('SELECT * FROM users WHERE id = ?', [doc.user_id]);
  const what = doc.kind === 'cv' ? 'CV' : 'video';
  const title = { verified: 'Your CV is HORIZON-verified', changes_requested: 'Changes requested on your CV', approved: 'Your video was approved', rejected: 'Your video was not approved' }[d.decision];
  notify(owner.id, { type: 'document', title, body: d.note || `The HORIZON team reviewed your ${what}.`, link: owner.role === 'recruiter' ? '/recruiter/profile' : '/app/profile' });
  audit(req, `document.${d.decision}`, { entityType: 'document', entityId: doc.id });
  res.json({ ok: true });
});

/* ------------------------------------------------------------ Destinations */

const linkList = z.array(z.object({ label: text(2, 120, 'Link label'), url: z.string().trim().refine((u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } }, 'Enter a valid https:// link.') })).max(12).default([]);
const destinationSchema = z.object({
  country: text(2, 60, 'Country'),
  slug: optText(60, 'Slug'),
  region: optText(60, 'Region'),
  overview: text(30, 3000, 'Overview'),
  majorSectors: z.array(text(2, 60, 'Sector')).max(15).default([]),
  commonDurations: optText(500, 'Common durations'),
  workArrangements: optText(3000, 'Work arrangements'),
  visaResources: linkList,
  officialLinks: linkList,
  relocationConsiderations: optText(3000, 'Relocation considerations'),
  sourceUrl: url('Source').refine((v) => !!v, 'A source link is required for visa and immigration content.'),
  lastUpdated: date('Last updated date'),
  isPublished: z.boolean().default(true),
});

router.get('/destinations', (req, res) => {
  res.json({ items: db().all('SELECT * FROM destination_resources ORDER BY country').map((r) => ({
    id: r.id, country: r.country, slug: r.slug, region: r.region, overview: r.overview, majorSectors: parseJsonArray(r.major_sectors), commonDurations: r.common_durations,
    workArrangements: r.work_arrangements, visaResources: parseJsonArray(r.visa_resources), officialLinks: parseJsonArray(r.official_links),
    relocationConsiderations: r.relocation_considerations, sourceUrl: r.source_url, lastUpdated: r.last_updated, isPublished: !!r.is_published, updatedAt: r.updated_at,
  })) });
});

function saveDestination(req, destId) {
  const d = req.valid.body;
  const slug = slugify(d.slug || d.country);
  const clash = db().get('SELECT id FROM destination_resources WHERE (slug = ? OR country = ?) AND id <> ?', [slug, d.country, destId || 0]);
  if (clash) throw new HttpError(409, 'A destination with this country or slug already exists.', { fields: { country: 'Already exists.' } });
  const values = [d.country, slug, d.region, d.overview, JSON.stringify(d.majorSectors), d.commonDurations, d.workArrangements, JSON.stringify(d.visaResources), JSON.stringify(d.officialLinks), d.relocationConsiderations, d.sourceUrl, d.lastUpdated, d.isPublished ? 1 : 0, req.user.id];
  if (destId) {
    const { changes } = db().run(`UPDATE destination_resources SET country = ?, slug = ?, region = ?, overview = ?, major_sectors = ?, common_durations = ?, work_arrangements = ?,
      visa_resources = ?, official_links = ?, relocation_considerations = ?, source_url = ?, last_updated = ?, is_published = ?, updated_by = ?, updated_at = ? WHERE id = ?`, [...values, nowSql(), destId]);
    if (!changes) throw notFound('Destination');
    return destId;
  }
  return db().run(`INSERT INTO destination_resources (country, slug, region, overview, major_sectors, common_durations, work_arrangements, visa_resources, official_links,
    relocation_considerations, source_url, last_updated, is_published, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, values).lastInsertRowid;
}
router.post('/destinations', validate(destinationSchema), (req, res) => {
  const destId = saveDestination(req, null);
  audit(req, 'destination.create', { entityType: 'destination', entityId: destId });
  res.status(201).json({ id: destId });
});
router.put('/destinations/:id', validate(destinationSchema), (req, res) => {
  const destId = saveDestination(req, parse(id, req.params.id));
  audit(req, 'destination.update', { entityType: 'destination', entityId: destId });
  res.json({ ok: true });
});
router.delete('/destinations/:id', (req, res) => {
  const destId = parse(id, req.params.id);
  const { changes } = db().run('DELETE FROM destination_resources WHERE id = ?', [destId]);
  if (!changes) throw notFound('Destination');
  audit(req, 'destination.delete', { entityType: 'destination', entityId: destId });
  res.json({ deleted: true });
});

/* -------------------------------------------------------------- Grievances */

router.get('/grievances', (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (GRIEVANCE_STATUSES.includes(req.query.status)) { where.push('g.status = ?'); params.push(req.query.status); }
  if (req.query.status === 'open') where.push(`g.status IN (${GRIEVANCE_OPEN.map((s) => `'${s}'`).join(',')})`);
  if (GRIEVANCE_CATEGORIES[req.query.category]) { where.push('g.category = ?'); params.push(req.query.category); }
  if (['normal', 'high', 'urgent'].includes(req.query.priority)) { where.push('g.priority = ?'); params.push(req.query.priority); }
  if (req.query.q) { where.push('(g.ticket_no LIKE ? ESCAPE \'\\\' OR g.subject LIKE ? ESCAPE \'\\\')'); params.push(like(req.query.q), like(req.query.q)); }
  let rows = db().all(`SELECT g.*, u.full_name AS complainant_name, a.full_name AS assignee_name FROM grievances g LEFT JOIN users u ON u.id = g.complainant_id
    LEFT JOIN users a ON a.id = g.assigned_to WHERE ${where.join(' AND ')}
    ORDER BY CASE WHEN g.status IN ('resolved','rejected','closed') THEN 1 ELSE 0 END, CASE g.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, g.resolution_due_at ASC LIMIT 300`, params);
  if (req.query.overdue === '1') rows = rows.filter((g) => { const s = G.sla(g); return s.ackOverdue || s.resolutionOverdue; });
  res.json({ items: rows.map((g) => ({
    id: g.id, ticketNo: g.ticket_no, subject: g.subject, category: g.category, categoryLabel: GRIEVANCE_CATEGORIES[g.category].label, priority: g.priority,
    status: g.status, statusLabel: G.STATUS_LABELS[g.status], level: g.level, against: g.against_label, complainant: g.complainant_name || `${g.guest_name} (guest)`,
    assignee: g.assignee_name, sla: G.sla(g), createdAt: g.created_at, isDemo: !!g.is_demo,
  })) });
});

router.get('/grievances/:id', (req, res) => {
  const g = db().get('SELECT * FROM grievances WHERE id = ?', [parse(id, req.params.id)]);
  if (!g) throw notFound('Grievance');
  res.json(G.view(g, 'admin'));
});

const grievanceUpdateSchema = z.object({
  status: z.enum(GRIEVANCE_STATUSES).optional(),
  message: optText(3000, 'Message'),
  audience: z.enum(['complainant', 'parties']).default('complainant'),
  internalNote: optText(3000, 'Internal note'),
  priority: z.enum(['normal', 'high', 'urgent']).optional(),
  assignToMe: z.boolean().default(false),
  requestResponse: z.boolean().default(false),
  resolutionSummary: optText(3000, 'Resolution summary'),
});

router.put('/grievances/:id', validate(grievanceUpdateSchema), async (req, res) => {
  const g = db().get('SELECT * FROM grievances WHERE id = ?', [parse(id, req.params.id)]);
  if (!g) throw notFound('Grievance');
  const d = req.valid.body;
  const now = new Date();
  const updates = {};
  let status = d.status && d.status !== g.status ? d.status : null;
  if (d.requestResponse) status = 'awaiting_response';
  if (status === 'awaiting_response') {
    if (!g.respondent_org_id) throw new HttpError(422, 'This grievance is not linked to an organisation that can respond.', { fields: { status: 'No respondent organisation.' } });
    updates.shared_with_respondent = 1;
    updates.response_due_at = toSql(addHours(now, config.grievance.respondentDays * 24));
  }
  if (status && ['resolved', 'rejected'].includes(status)) {
    if (!d.resolutionSummary || d.resolutionSummary.length < 10) throw new HttpError(422, 'Write a resolution summary for the complainant.', { fields: { resolutionSummary: 'Explain the outcome and any action taken (at least 10 characters).' } });
    updates.resolution_summary = d.resolutionSummary;
    updates.resolved_at = toSql(now);
  }
  if (status === 'closed') updates.closed_at = toSql(now);
  if (status) updates.status = status;
  if (d.priority && d.priority !== g.priority) updates.priority = d.priority;
  if (d.assignToMe) updates.assigned_to = req.user.id;
  if (!g.acknowledged_at && (status || d.message || d.assignToMe)) updates.acknowledged_at = toSql(now);
  if (!Object.keys(updates).length && !d.message && !d.internalNote) throw new HttpError(422, 'Nothing to update.', { fields: { message: 'Add a message, note or status change.' } });

  const shared = !!(g.shared_with_respondent || updates.shared_with_respondent);
  db().tx(() => {
    const keys = Object.keys(updates);
    if (keys.length) db().run(`UPDATE grievances SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => updates[k]), toSql(now), g.id]);
    if (updates.acknowledged_at && status !== 'acknowledged') G.addEvent(g.id, { actorId: req.user.id, actorRole: 'admin', type: 'acknowledged', visibility: 'complainant', message: 'Your grievance has been acknowledged by the grievance desk.' });
    if (status === 'awaiting_response') {
      G.addEvent(g.id, { actorId: req.user.id, actorRole: 'admin', type: 'response_requested', visibility: 'parties', from: g.status, to: status,
        message: d.message || `The grievance desk asked the organisation to respond within ${config.grievance.respondentDays} days.` });
    } else if (status) {
      const msg = ['resolved', 'rejected'].includes(status) ? d.resolutionSummary : d.message;
      G.addEvent(g.id, { actorId: req.user.id, actorRole: 'admin', type: 'status_changed', visibility: shared && d.audience === 'parties' ? 'parties' : (shared && ['resolved', 'rejected', 'closed'].includes(status) ? 'parties' : 'complainant'), from: g.status, to: status, message: msg });
      if (['resolved', 'rejected'].includes(status) && d.message) G.addEvent(g.id, { actorId: req.user.id, actorRole: 'admin', type: 'message', visibility: 'complainant', message: d.message });
    } else if (d.message) {
      G.addEvent(g.id, { actorId: req.user.id, actorRole: 'admin', type: 'message', visibility: shared && d.audience === 'parties' ? 'parties' : 'complainant', message: d.message });
    }
    if (updates.priority) G.addEvent(g.id, { actorId: req.user.id, actorRole: 'admin', type: 'priority_changed', visibility: 'internal', from: g.priority, to: updates.priority });
    if (d.assignToMe) G.addEvent(g.id, { actorId: req.user.id, actorRole: 'admin', type: 'assigned', visibility: 'internal', message: `Assigned to ${req.user.full_name}.` });
    if (d.internalNote) G.addEvent(g.id, { actorId: req.user.id, actorRole: 'admin', type: 'internal_note', visibility: 'internal', message: d.internalNote });
  });

  if (status === 'awaiting_response') notifyOrganisation(g.respondent_org_id, { type: 'grievance', title: `Response requested: ${g.ticket_no}`, body: g.subject, link: `/recruiter/grievances/${g.id}` });
  if (status || d.message) {
    const label = status ? G.STATUS_LABELS[status] : 'New message';
    if (g.complainant_id) notify(g.complainant_id, { type: 'grievance', title: `${g.ticket_no}: ${label}`, body: d.message || d.resolutionSummary || null, link: `/app/grievances/${g.id}` });
    else if (g.guest_email) await sendMail({ to: g.guest_email, subject: `Update on grievance ${g.ticket_no}`, text: `Status: ${label}\n${d.message || d.resolutionSummary || ''}\n\nFollow your ticket at ${config.appUrl}/grievance-redressal#track using your tracking key.\n\n— HORIZON Grievance Desk` });
  }
  audit(req, 'grievance.update', { entityType: 'grievance', entityId: g.id, details: { status, priority: updates.priority } });
  res.json(G.view(db().get('SELECT * FROM grievances WHERE id = ?', [g.id]), 'admin'));
});

/* ----------------------------------------------------------------- Reports */

router.get('/reports', (req, res) => {
  const d = db();
  const count = (sql, p = []) => d.value(sql, p) || 0;
  const horizonApps = d.all("SELECT submitted_at, first_response_at FROM applications WHERE channel = 'horizon' AND submitted_at IS NOT NULL");
  const responded = horizonApps.filter((a) => a.first_response_at);
  const verDurations = d.all("SELECT (julianday(reviewed_at) - julianday(created_at)) * 24 AS h FROM verification_requests WHERE reviewed_at IS NOT NULL").map((r) => r.h);
  res.json({
    generatedAt: new Date().toISOString(),
    containsDemoData: count('SELECT COUNT(*) FROM opportunities WHERE is_demo = 1') + count('SELECT COUNT(*) FROM organisations WHERE is_demo = 1') + count('SELECT COUNT(*) FROM grievances WHERE is_demo = 1') > 0,
    students: {
      total: count("SELECT COUNT(*) FROM users WHERE role = 'student'"),
      byStatus: d.all("SELECT status AS label, COUNT(*) AS value FROM users WHERE role = 'student' GROUP BY status ORDER BY value DESC"),
      byInstitution: d.all("SELECT COALESCE(i.short_name, i.name) AS label, COUNT(*) AS value FROM users u JOIN institutions i ON i.id = u.institution_id WHERE u.role = 'student' GROUP BY i.id ORDER BY value DESC LIMIT 10"),
      byMethod: d.all("SELECT COALESCE(verification_method, 'not yet verified') AS label, COUNT(*) AS value FROM users WHERE role = 'student' GROUP BY label ORDER BY value DESC"),
    },
    recruiters: {
      total: count("SELECT COUNT(*) FROM users WHERE role = 'recruiter'"),
      byStatus: d.all("SELECT status AS label, COUNT(*) AS value FROM users WHERE role = 'recruiter' GROUP BY status ORDER BY value DESC"),
      verifiedOrganisations: count("SELECT COUNT(*) FROM organisations WHERE verification_status = 'verified'"),
    },
    internships: {
      active: count(`SELECT COUNT(*) FROM opportunities o WHERE ${opps.OPEN_WHERE}`),
      byStatus: d.all('SELECT status AS label, COUNT(*) AS value FROM opportunities GROUP BY status ORDER BY value DESC'),
      byCountry: d.all(`SELECT country AS label, COUNT(*) AS value FROM opportunities o WHERE ${opps.OPEN_WHERE} GROUP BY country ORDER BY value DESC`),
      byIndustry: d.all(`SELECT industry AS label, COUNT(*) AS value FROM opportunities o WHERE ${opps.OPEN_WHERE} GROUP BY industry ORDER BY value DESC`),
      byMode: d.all(`SELECT CASE application_mode WHEN 'horizon' THEN 'Apply on HORIZON' ELSE 'Employer site' END AS label, COUNT(*) AS value FROM opportunities o WHERE ${opps.OPEN_WHERE} GROUP BY application_mode`),
      paidShare: (() => { const t = count(`SELECT COUNT(*) FROM opportunities o WHERE ${opps.OPEN_WHERE}`); return t ? Math.round((count(`SELECT COUNT(*) FROM opportunities o WHERE ${opps.OPEN_WHERE} AND is_paid = 1`) / t) * 100) : null; })(),
    },
    applications: {
      total: count('SELECT COUNT(*) FROM applications'),
      byStage: STAGES.map((s) => ({ label: s, value: count('SELECT COUNT(*) FROM applications WHERE stage = ?', [s]) })),
      horizonSubmitted: horizonApps.length,
      horizonResponded: responded.length,
      averageResponseDays: responded.length ? Math.round((responded.reduce((t, a) => t + (new Date(`${a.first_response_at.replace(' ', 'T')}Z`) - new Date(`${a.submitted_at.replace(' ', 'T')}Z`)) / 86400000, 0) / responded.length) * 10) / 10 : null,
      savedOpportunities: count('SELECT COUNT(*) FROM saved_opportunities'),
    },
    documents: {
      cvs: d.all("SELECT review_status AS label, COUNT(*) AS value FROM documents WHERE kind = 'cv' AND is_current = 1 GROUP BY review_status"),
      videos: d.all("SELECT review_status AS label, COUNT(*) AS value FROM documents WHERE kind = 'video' AND is_current = 1 GROUP BY review_status"),
    },
    verifications: {
      byStatus: d.all('SELECT status AS label, COUNT(*) AS value FROM verification_requests GROUP BY status'),
      averageReviewHours: verDurations.length ? Math.round((verDurations.reduce((a, b) => a + b, 0) / verDurations.length) * 10) / 10 : null,
    },
    grievances: G.transparencyReport().totals,
  });
});

/* -------------------------------------------------------------- Audit log */

router.get('/audit', (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.action) { where.push('a.action LIKE ? ESCAPE \'\\\''); params.push(like(req.query.action)); }
  if (req.query.entityType) { where.push('a.entity_type = ?'); params.push(String(req.query.entityType).slice(0, 40)); }
  const p = paginate(req.query, { defaultSize: 30, maxSize: 100 });
  const total = db().value(`SELECT COUNT(*) FROM audit_logs a WHERE ${where.join(' AND ')}`, params);
  const rows = db().all(`SELECT a.*, u.full_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...params, p.pageSize, p.offset]);
  res.json(pageResult(rows.map((r) => ({ id: r.id, action: r.action, actor: r.actor_name || r.actor_role, actorRole: r.actor_role, entityType: r.entity_type, entityId: r.entity_id, details: parseJson(r.details), ip: r.ip, createdAt: r.created_at })), total, p));
});

module.exports = router;
