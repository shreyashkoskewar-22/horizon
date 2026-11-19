'use strict';
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { getDb } = require('../db');
const { z, text, optText, email, password, url, id, validate, parse } = require('../lib/validation');
const { HttpError, nowSql, toSql, addHours, parseSql, hmac, safeEqual, emailDomain, hostFromUrl, domainMatches } = require('../lib/util');
const { ORG_TYPES, ACADEMIC_LEVELS } = require('../lib/constants');
const { isFreeEmailDomain } = require('../lib/email-domains');
const { requireAuth, USER_SQL } = require('../middleware/auth');
const { csrfToken, limiters } = require('../middleware/security');
const { requireCaptcha } = require('../services/captcha');
const { audit, notify, notifyAdmins, sendMail } = require('../services/events');
const { publicUser, verificationState, nextFor, homeFor, institutionForEmail } = require('../services/users');
const files = require('../services/files');

const router = express.Router();
const db = () => getDb();
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-password', 4);
const YEAR = new Date().getUTCFullYear();

const nameRule = text(2, 100, 'Full name').refine((n) => /^[\p{L}][\p{L}\p{M}'.\- ]*$/u.test(n), 'Use letters, spaces, apostrophes and hyphens only.');
const base = {
  fullName: nameRule,
  email,
  password,
  confirmPassword: z.string({ error: 'Please confirm your password.' }),
  acceptTerms: z.literal(true, { error: 'You must accept the Terms of Use and Privacy Policy.' }),
  captchaToken: z.string().max(2048).optional(),
};
const studentSchema = z.object({
  accountType: z.literal('student'),
  ...base,
  institutionId: id,
  programme: text(2, 120, 'Academic programme'),
  academicLevel: z.enum(ACADEMIC_LEVELS, { error: 'Select your level of study.' }),
  currentYear: z.coerce.number({ error: 'Select your current year.' }).int().min(1, 'Select your current year.').max(6, 'Select your current year.'),
  graduationYear: z.coerce.number({ error: 'Enter your graduation year.' }).int().min(YEAR - 1, 'Graduation year must be current or upcoming.').max(YEAR + 7, 'Enter a realistic graduation year.'),
});
const recruiterSchema = z.object({
  accountType: z.literal('recruiter'),
  ...base,
  designation: text(2, 100, 'Designation'),
  organisationMode: z.enum(['existing', 'new'], { error: 'Choose your organisation.' }),
  organisationId: id.optional(),
  organisation: z.object({
    name: text(2, 120, 'Organisation name'),
    website: url('Website'),
    orgType: z.enum(ORG_TYPES, { error: 'Select an organisation type.' }),
    country: text(2, 60, 'Country'),
    headquarters: optText(100, 'Headquarters'),
    linkedinUrl: url('LinkedIn page'),
  }).optional(),
  authorisedRepresentative: z.literal(true, { error: 'Confirm that you are authorised to recruit for this organisation.' }),
});
const registerSchema = z.discriminatedUnion('accountType', [studentSchema, recruiterSchema], { error: 'Choose student or recruiter.' }).superRefine((d, ctx) => {
  if (d.password !== d.confirmPassword) ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match.' });
  const local = d.email.split('@')[0].toLowerCase();
  if (local.length >= 4 && d.password.toLowerCase().includes(local)) ctx.addIssue({ code: 'custom', path: ['password'], message: 'Your password should not contain your email name.' });
  if (d.accountType === 'student' && d.graduationYear < YEAR && d.currentYear > 0) ctx.addIssue({ code: 'custom', path: ['graduationYear'], message: 'Graduation year must be current or upcoming.' });
  if (d.accountType === 'recruiter') {
    if (d.organisationMode === 'existing' && !d.organisationId) ctx.addIssue({ code: 'custom', path: ['organisationId'], message: 'Select your organisation.' });
    if (d.organisationMode === 'new' && !d.organisation) ctx.addIssue({ code: 'custom', path: ['organisation.name'], message: 'Enter your organisation details.' });
    if (d.organisationMode === 'new' && d.organisation && !d.organisation.website) ctx.addIssue({ code: 'custom', path: ['organisation.website'], message: 'Enter the official website so we can match your email domain.' });
  }
});
const loginSchema = z.object({ email, password: z.string({ error: 'Password is required.' }).min(1, 'Password is required.').max(128), captchaToken: z.string().max(2048).optional() });

function establishSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.csrfToken = crypto.randomBytes(24).toString('base64url');
      return req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

const freshUser = (userId) => db().get(USER_SQL, [userId]);

async function issueCode(user) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  db().run('UPDATE email_verifications SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL', [nowSql(), user.id]);
  db().run('INSERT INTO email_verifications (user_id, code_hash, expires_at) VALUES (?, ?, ?)',
    [user.id, hmac(config.sessionSecret, `${user.id}:${code}`), toSql(addHours(new Date(), 0.25))]);
  await sendMail({
    to: user.email,
    subject: `${code} is your HORIZON verification code`,
    text: `Hello ${String(user.full_name).split(' ')[0]},\n\nYour HORIZON verification code is ${code}. It expires in 15 minutes.\n\nIf you did not create a HORIZON account, you can ignore this email.\n\n— HORIZON`,
  });
}

function sessionPayload(req, user) {
  return { user: publicUser(user), verification: verificationState(user), next: nextFor(user), home: homeFor(user), csrfToken: csrfToken(req) };
}

router.get('/csrf', (req, res) => res.json({ csrfToken: csrfToken(req) }));

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null, csrfToken: csrfToken(req), suspended: !!req.accountSuspended });
  return res.json(sessionPayload(req, req.user));
});

router.post('/register', limiters.register, validate(registerSchema), async (req, res) => {
  const d = req.valid.body;
  await requireCaptcha(d.captchaToken, req.ip);
  if (db().get('SELECT 1 FROM users WHERE email = ?', [d.email])) {
    throw new HttpError(409, 'An account with this email already exists. Try signing in instead.', { code: 'EMAIL_TAKEN', fields: { email: 'This email is already registered.' } });
  }
  const domain = emailDomain(d.email);
  const hash = await bcrypt.hash(d.password, config.bcryptRounds);
  let userId;

  if (d.accountType === 'student') {
    const inst = db().get("SELECT * FROM institutions WHERE id = ? AND is_active = 1 AND verification_status = 'verified'", [d.institutionId]);
    if (!inst) throw new HttpError(422, 'Please select an approved Institution of National Importance.', { fields: { institutionId: 'Select your institution from the approved list.' } });
    const hit = institutionForEmail(d.email);
    if (hit && hit.institution_id !== inst.id) {
      throw new HttpError(422, 'Email domain and institution do not match.', { fields: { email: `This email domain belongs to ${hit.name}. Select that institution, or use your own institute email.` } });
    }
    userId = db().tx(() => {
      const { lastInsertRowid } = db().run(
        "INSERT INTO users (role, full_name, email, password_hash, status, institution_id) VALUES ('student', ?, ?, ?, 'pending', ?)",
        [d.fullName, d.email, hash, inst.id],
      );
      db().run('INSERT INTO student_profiles (user_id, programme, academic_level, current_year, graduation_year) VALUES (?, ?, ?, ?, ?)',
        [lastInsertRowid, d.programme, d.academicLevel, d.currentYear, d.graduationYear]);
      return lastInsertRowid;
    });
  } else {
    if (isFreeEmailDomain(domain)) {
      throw new HttpError(422, 'Use your work email.', { fields: { email: 'Use your work email. Personal providers (Gmail, Outlook, Yahoo and similar) cannot be verified for recruiters.' } });
    }
    let orgId;
    if (d.organisationMode === 'existing') {
      const org = db().get("SELECT * FROM organisations WHERE id = ? AND verification_status = 'verified'", [d.organisationId]);
      if (!org) throw new HttpError(422, 'Select a verified organisation.', { fields: { organisationId: 'Select your organisation from the list.' } });
      if (org.email_domain && !domainMatches(domain, org.email_domain.toLowerCase())) {
        throw new HttpError(422, 'Email domain does not match the organisation.', { fields: { email: `Use your @${org.email_domain} work email to join ${org.name}.` } });
      }
      orgId = org.id;
    } else {
      const o = d.organisation;
      const sameName = db().get("SELECT name FROM organisations WHERE lower(name) = lower(?) AND verification_status = 'verified'", [o.name]);
      if (sameName) throw new HttpError(422, 'Organisation already exists.', { fields: { 'organisation.name': `${sameName.name} is already verified on HORIZON — select it from the list instead.` } });
      const sameDomain = db().get("SELECT name FROM organisations WHERE email_domain = ? AND verification_status = 'verified'", [domain]);
      if (sameDomain) throw new HttpError(422, 'Organisation already exists.', { fields: { 'organisation.name': `Your email domain belongs to ${sameDomain.name}, which is already on HORIZON. Select it from the list.` } });
      orgId = db().run(
        `INSERT INTO organisations (name, org_type, website, email_domain, country, headquarters, linkedin_url, verification_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unverified')`,
        [o.name, o.orgType, o.website, domain, o.country, o.headquarters, o.linkedinUrl],
      ).lastInsertRowid;
    }
    userId = db().tx(() => {
      const { lastInsertRowid } = db().run(
        "INSERT INTO users (role, full_name, email, password_hash, status, organisation_id) VALUES ('recruiter', ?, ?, ?, 'pending', ?)",
        [d.fullName, d.email, hash, orgId],
      );
      db().run('INSERT INTO recruiter_profiles (user_id, designation) VALUES (?, ?)', [lastInsertRowid, d.designation]);
      return lastInsertRowid;
    });
  }

  await establishSession(req, userId);
  const user = freshUser(userId);
  req.user = user;
  await issueCode(user);
  audit(req, 'auth.register', { entityType: 'user', entityId: userId, details: { role: user.role } });
  res.status(201).json(sessionPayload(req, user));
});

router.post('/login', limiters.login, validate(loginSchema), async (req, res) => {
  const d = req.valid.body;
  await requireCaptcha(d.captchaToken, req.ip);
  const invalid = new HttpError(401, 'Incorrect email or password.', { code: 'INVALID_CREDENTIALS' });
  const user = db().get('SELECT * FROM users WHERE email = ?', [d.email]);
  if (!user) { await bcrypt.compare(d.password, DUMMY_HASH); throw invalid; }
  if (user.locked_until && parseSql(user.locked_until) > new Date()) {
    throw new HttpError(429, 'Too many failed attempts on this account. Try again in 15 minutes.', { code: 'ACCOUNT_LOCKED' });
  }
  const ok = await bcrypt.compare(d.password, user.password_hash);
  if (!ok) {
    const fails = user.failed_logins + 1;
    if (fails >= 8) db().run('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?', [toSql(addHours(new Date(), 0.25)), user.id]);
    else db().run('UPDATE users SET failed_logins = ? WHERE id = ?', [fails, user.id]);
    audit(req, 'auth.login_failed', { entityType: 'user', entityId: user.id, actorId: null, actorRole: 'anonymous' });
    throw invalid;
  }
  if (user.status === 'suspended') {
    throw new HttpError(403, 'This account has been suspended. If you believe this is a mistake, contact the grievance desk.', { code: 'ACCOUNT_SUSPENDED' });
  }
  db().run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [nowSql(), user.id]);
  await establishSession(req, user.id);
  const loaded = freshUser(user.id);
  req.user = loaded;
  audit(req, 'auth.login', { entityType: 'user', entityId: user.id });
  res.json(sessionPayload(req, loaded));
});

router.post('/logout', (req, res, next) => {
  const userId = req.user && req.user.id;
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('horizon.sid', { path: '/', httpOnly: true, sameSite: 'lax', secure: config.isProd });
    if (userId) audit(req, 'auth.logout', { entityType: 'user', entityId: userId, actorId: userId });
    return res.json({ ok: true });
  });
});

router.post('/verify-email', requireAuth, limiters.otp, validate(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') })), (req, res) => {
  const u = req.user;
  if (u.email_verified_at) return res.json(sessionPayload(req, u));
  const row = db().get('SELECT * FROM email_verifications WHERE user_id = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1', [u.id]);
  if (!row || parseSql(row.expires_at) < new Date()) throw new HttpError(422, 'This code has expired. Request a new one.', { fields: { code: 'This code has expired. Request a new one.' } });
  if (row.attempts >= 5) throw new HttpError(429, 'Too many incorrect attempts. Request a new code.', { fields: { code: 'Too many incorrect attempts. Request a new code.' } });
  if (!safeEqual(hmac(config.sessionSecret, `${u.id}:${req.valid.body.code}`), row.code_hash)) {
    db().run('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    const left = 4 - row.attempts;
    throw new HttpError(422, 'Incorrect code.', { fields: { code: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Request a new one.' } });
  }
  db().tx(() => {
    db().run('UPDATE email_verifications SET consumed_at = ? WHERE id = ?', [nowSql(), row.id]);
    db().run('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?', [nowSql(), nowSql(), u.id]);
    if (u.role === 'student' && u.status === 'pending') {
      const hit = institutionForEmail(u.email);
      if (hit && hit.institution_id === u.institution_id) {
        db().run("UPDATE users SET status = 'approved', verification_method = 'email_domain', status_reason = NULL WHERE id = ?", [u.id]);
        notify(u.id, { type: 'verification', title: 'You are verified', body: `Your ${hit.name} email confirmed your enrolment. Welcome to HORIZON.`, link: '/app' });
        audit(req, 'user.auto_approved', { entityType: 'user', entityId: u.id, details: { method: 'email_domain', domain: hit.domain } });
      }
    }
  });
  audit(req, 'auth.email_verified', { entityType: 'user', entityId: u.id });
  const fresh = freshUser(u.id);
  return res.json(sessionPayload(req, fresh));
});

router.post('/resend-code', requireAuth, limiters.resend, async (req, res) => {
  if (req.user.email_verified_at) throw new HttpError(409, 'Your email is already verified.');
  await issueCode(req.user);
  res.json({ ok: true, message: `A new code was sent to ${req.user.email}.` });
});

const proofUpload = files.uploader('document', config.uploads.proofMaxMb, ['pdf', 'png', 'jpg', 'jpeg']);
const proofSchema = z.object({
  note: optText(1000, 'Note'),
  registrationNumber: optText(60, 'Registration number'),
});

router.post('/verification-proof', requireAuth, limiters.upload, proofUpload, async (req, res) => {
  const u = req.user;
  if (u.role === 'admin') throw new HttpError(403, 'Administrators do not need verification.');
  if (!u.email_verified_at) throw new HttpError(409, 'Verify your email address first.');
  if (u.status === 'approved') throw new HttpError(409, 'Your account is already verified.');
  if (db().get("SELECT 1 FROM verification_requests WHERE user_id = ? AND status = 'pending'", [u.id])) {
    throw new HttpError(409, 'Your documents are already under review.');
  }
  const body = parse(proofSchema, req.body);
  if (!req.file) throw new HttpError(422, 'Attach your proof document.', { fields: { document: 'Attach a PDF, JPG or PNG file.' } });
  const type = files.sniff(files.readHead(req.file.path));
  if (!['pdf', 'png', 'jpeg'].includes(type)) {
    throw new HttpError(422, 'The file content is not a valid PDF, JPG or PNG.', { fields: { document: 'The file content is not a valid PDF, JPG or PNG.' } });
  }
  const sha = await files.hashFile(req.file.path);
  const domain = emailDomain(u.email);
  const checks = [{ label: 'Email address verified', ok: true, detail: u.email }];
  if (u.role === 'student') {
    const inst = db().get('SELECT * FROM institutions WHERE id = ?', [u.institution_id]);
    const hit = institutionForEmail(u.email);
    checks.push({ label: 'Institution is a verified INI', ok: inst.verification_status === 'verified' && !!inst.is_active, detail: inst.recognition_reference });
    checks.push({
      label: 'Email domain matches institution',
      ok: !!hit && hit.institution_id === u.institution_id,
      detail: hit ? (hit.institution_id === u.institution_id ? `Matches ${hit.domain}` : `Domain belongs to ${hit.name}`) : 'No verified email domain on file for this institution — check the ID card manually',
    });
    checks.push({ label: 'Institutional (non-personal) email', ok: !isFreeEmailDomain(domain), detail: domain });
  } else {
    const org = db().get('SELECT * FROM organisations WHERE id = ?', [u.organisation_id]);
    const host = hostFromUrl(org.website);
    checks.push({ label: 'Work email (not a personal provider)', ok: !isFreeEmailDomain(domain), detail: domain });
    checks.push({ label: 'Email domain matches organisation website', ok: !!host && (domainMatches(domain, host) || domainMatches(host, domain)), detail: host ? `${domain} ↔ ${host}` : 'No website on file' });
    checks.push({ label: 'Organisation already verified on HORIZON', ok: org.verification_status === 'verified', detail: org.name });
    checks.push({ label: 'Company registration number provided', ok: !!body.registrationNumber, detail: body.registrationNumber || 'Not provided' });
  }
  checks.push({ label: 'File type confirmed by content signature', ok: true, detail: type.toUpperCase() });

  const kind = u.role === 'student' ? 'id_proof' : 'org_proof';
  const doc = files.storeDocument({ file: req.file, userId: u.id, kind, type, sha256: sha, reviewStatus: 'submitted' });
  db().tx(() => {
    db().run(
      `INSERT INTO verification_requests (user_id, request_type, document_id, submitted_note, registration_number, auto_checks)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [u.id, u.role === 'student' ? 'student' : 'recruiter', doc.id, body.note, body.registrationNumber, JSON.stringify(checks)],
    );
    if (u.status === 'rejected') db().run("UPDATE users SET status = 'pending', updated_at = ? WHERE id = ?", [nowSql(), u.id]);
  });
  notifyAdmins({ type: 'verification', title: `New ${u.role} verification request`, body: `${u.full_name} submitted proof for review.`, link: '/admin/verifications' });
  audit(req, 'verification.submitted', { entityType: 'user', entityId: u.id, details: { kind } });
  res.status(201).json(sessionPayload(req, freshUser(u.id)));
});

/** Development-only mail preview so the demo works without SMTP. Shows only the signed-in user's own mail. */
router.get('/dev-mailbox', requireAuth, (req, res) => {
  if (!config.mail.devMailbox || (config.isProd && process.env.ALLOW_DEMO_SEED !== 'true')) throw new HttpError(404, 'Not available.');
  const messages = db().all('SELECT subject, body, created_at FROM email_outbox WHERE to_email = ? ORDER BY id DESC LIMIT 3', [req.user.email]);
  res.json({ messages });
});

module.exports = router;
