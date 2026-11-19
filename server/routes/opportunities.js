'use strict';
const express = require('express');
const { getDb } = require('../db');
const { z, text, optText, url, date, optDate, id, validate, parse, tagList } = require('../lib/validation');
const { HttpError, notFound, nowSql, todayDate } = require('../lib/util');
const { INDUSTRIES, ORG_TYPES, WORK_MODES, VISA_OPTIONS, ACADEMIC_LEVELS, CURRENCIES } = require('../lib/constants');
const { allow } = require('../middleware/auth');
const opps = require('../services/opportunities');
const { audit, notifyAdmins, notifyOrganisation } = require('../services/events');
const { currentDocument } = require('../services/users');
const { responseClock } = require('../services/applications');

const router = express.Router();
const db = () => getDb();

const listParam = (allowed) => z.preprocess(
  (v) => opps.toList(v),
  z.array(allowed ? z.enum(allowed) : z.string().max(80)).max(20),
).optional();
const emptyToUndef = (v) => (v === '' || v == null ? undefined : v);

const searchSchema = z.object({
  q: z.preprocess(emptyToUndef, z.string().max(100, 'Search is too long.').optional()),
  country: listParam(),
  industry: listParam(),
  orgType: listParam(ORG_TYPES),
  workMode: listParam(WORK_MODES),
  visa: listParam(VISA_OPTIONS),
  paid: z.preprocess(emptyToUndef, z.enum(['paid', 'unpaid']).optional()),
  minComp: z.preprocess(emptyToUndef, z.coerce.number().min(0).max(1_000_000).optional()),
  maxComp: z.preprocess(emptyToUndef, z.coerce.number().min(0).max(1_000_000).optional()),
  duration: z.preprocess(emptyToUndef, z.enum(['short', 'medium', 'long']).optional()),
  deadline: z.preprocess(emptyToUndef, z.enum(['week', 'month', 'quarter']).optional()),
  level: z.preprocess(emptyToUndef, z.enum(ACADEMIC_LEVELS).optional()),
  year: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(6).optional()),
  featured: z.preprocess((v) => v === 'true' || v === '1', z.boolean()).optional(),
  mode: z.preprocess(emptyToUndef, z.enum(['external', 'horizon']).optional()),
  sort: z.preprocess(emptyToUndef, z.enum(['recent', 'deadline', 'compensation', 'duration']).default('recent')),
  page: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(1000).default(1)),
  pageSize: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(48).default(9)),
}).refine((q) => q.minComp == null || q.maxComp == null || q.minComp <= q.maxComp, { path: ['maxComp'], message: 'Maximum must be greater than the minimum.' });

const opportunitySchema = z.object({
  organisationId: id.optional(),
  title: text(5, 120, 'Title'),
  summary: text(20, 280, 'Short description'),
  description: text(50, 8000, 'Full description'),
  responsibilities: optText(4000, 'Responsibilities'),
  eligibility: optText(2000, 'Eligibility'),
  academicRequirements: optText(2000, 'Academic requirements'),
  academicLevel: z.enum(['any', ...ACADEMIC_LEVELS]).default('any'),
  eligibleYears: z.array(z.coerce.number().int().min(1).max(6)).max(6).default([]),
  requiredDocuments: optText(1000, 'Required documents'),
  industry: z.enum(INDUSTRIES, { error: 'Select an industry.' }),
  country: text(2, 60, 'Country'),
  city: text(1, 80, 'City'),
  workMode: z.enum(WORK_MODES, { error: 'Select a work arrangement.' }),
  durationWeeks: z.coerce.number({ error: 'Enter the duration in weeks.' }).int('Use whole weeks.').min(1, 'Duration must be at least 1 week.').max(104, 'Duration must be 104 weeks or fewer.'),
  startDate: optDate('Start date'),
  endDate: optDate('End date'),
  isPaid: z.boolean({ error: 'Choose paid or unpaid.' }),
  stipendAmount: z.preprocess(emptyToUndef, z.coerce.number({ error: 'Enter a numeric amount.' }).positive('Amount must be greater than zero.').max(100_000_000).optional()).transform((v) => v ?? null),
  stipendCurrency: z.preprocess(emptyToUndef, z.enum(CURRENCIES).optional()).transform((v) => v ?? null),
  visaSponsorship: z.enum(VISA_OPTIONS, { error: 'Select the visa sponsorship status.' }),
  visaDetails: optText(1000, 'Visa details'),
  relocationSupport: optText(500, 'Relocation support'),
  accommodationSupport: optText(500, 'Accommodation support'),
  applicationDeadline: date('Application deadline'),
  applicationMode: z.enum(['external', 'horizon']).default('external'),
  applicationUrl: url('Application link'),
  sourceName: optText(120, 'Source name'),
  sourceUrl: url('Source link'),
  lastVerifiedAt: optDate('Last verified date'),
  skills: tagList(15, 40, 'Skill'),
  noFeeConfirmed: z.boolean().default(false),
  status: z.enum(['draft', 'pending_review', 'published', 'rejected', 'archived']).optional(),
  isFeatured: z.boolean().optional(),
  isVerified: z.boolean().optional(),
}).superRefine((d, ctx) => {
  if (d.isPaid && !d.stipendAmount) ctx.addIssue({ code: 'custom', path: ['stipendAmount'], message: 'Enter the stipend amount for a paid internship.' });
  if (d.isPaid && !d.stipendCurrency) ctx.addIssue({ code: 'custom', path: ['stipendCurrency'], message: 'Select the stipend currency.' });
  if (d.applicationMode === 'external' && !d.applicationUrl) ctx.addIssue({ code: 'custom', path: ['applicationUrl'], message: 'Add the official application link.' });
  if (d.startDate && d.endDate && d.endDate < d.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be after the start date.' });
  if (!d.noFeeConfirmed) ctx.addIssue({ code: 'custom', path: ['noFeeConfirmed'], message: 'Confirm that applicants will never be charged any fee.' });
});

/** GET /api/opportunities — backend search, filtering, sorting and pagination. */
router.get('/', allow('student', 'admin'), validate(searchSchema, 'query'), (req, res) => {
  res.json(opps.search(req.valid.query, req.user.role === 'student' ? req.user.id : null));
});

/** Filter options built from live, open listings. */
router.get('/filters', allow('student', 'admin'), (req, res) => {
  const d = db();
  const where = `FROM opportunities o JOIN organisations org ON org.id = o.organisation_id WHERE ${opps.OPEN_WHERE}`;
  res.json({
    countries: d.all(`SELECT o.country AS value, COUNT(*) AS count ${where} GROUP BY o.country ORDER BY o.country`),
    industries: d.all(`SELECT o.industry AS value, COUNT(*) AS count ${where} GROUP BY o.industry ORDER BY o.industry`),
    orgTypes: d.all(`SELECT org.org_type AS value, COUNT(*) AS count ${where} GROUP BY org.org_type ORDER BY org.org_type`),
    compRange: d.get(`SELECT MIN(o.stipend_usd_monthly) AS min, MAX(o.stipend_usd_monthly) AS max ${where} AND o.is_paid = 1`),
    total: d.value(`SELECT COUNT(*) ${where}`),
    containsDemoData: !!d.value(`SELECT COUNT(*) ${where} AND o.is_demo = 1`),
  });
});

function loadForViewer(oppId, user) {
  const row = opps.getRow(oppId);
  if (!row) throw notFound('Opportunity');
  if (user.role === 'admin') return row;
  if (user.role === 'recruiter') {
    if (row.organisation_id !== user.organisation_id) throw notFound('Opportunity');
    return row;
  }
  const hasApplication = db().get('SELECT 1 FROM applications WHERE user_id = ? AND opportunity_id = ?', [user.id, row.id]);
  if (row.status !== 'published' && !hasApplication) throw notFound('Opportunity');
  return row;
}

router.get('/:id', allow('student', 'recruiter', 'admin'), (req, res) => {
  const oppId = parse(id, req.params.id);
  const row = loadForViewer(oppId, req.user);
  const detail = opps.serializeDetail(row);
  detail.isOpen = row.status === 'published' && row.application_deadline >= todayDate();
  detail.responseStats = row.application_mode === 'horizon' ? opps.responseStats(row.organisation_id) : null;
  if (req.user.role === 'student') {
    detail.saved = !!db().get('SELECT 1 FROM saved_opportunities WHERE user_id = ? AND opportunity_id = ?', [req.user.id, row.id]);
    const app = db().get('SELECT id, stage, channel, recruiter_status, applied_on, submitted_at, first_response_at FROM applications WHERE user_id = ? AND opportunity_id = ?', [req.user.id, row.id]);
    detail.application = app ? {
      id: app.id, stage: app.stage, channel: app.channel, recruiterStatus: app.recruiter_status, appliedOn: app.applied_on,
      submittedAt: app.submitted_at, firstResponseAt: app.first_response_at, ...responseClock(app),
    } : null;
    const cv = currentDocument(req.user.id, 'cv');
    const video = currentDocument(req.user.id, 'video');
    detail.applyReadiness = {
      cvStatus: cv ? cv.review_status : null,
      cvReady: !!cv && ['auto_verified', 'verified'].includes(cv.review_status),
      videoStatus: video ? video.review_status : null,
      videoReady: !!video && video.review_status === 'approved',
    };
  } else {
    detail.applicantCount = db().value("SELECT COUNT(*) FROM applications WHERE opportunity_id = ? AND channel = 'horizon'", [row.id]);
  }
  res.json(detail);
});

function resolveOrganisation(req, d) {
  if (req.user.role === 'recruiter') return req.user.organisation_id;
  if (!d.organisationId) throw new HttpError(422, 'Select an organisation.', { fields: { organisationId: 'Select an organisation.' } });
  if (!db().get('SELECT 1 FROM organisations WHERE id = ?', [d.organisationId])) throw new HttpError(422, 'Organisation not found.', { fields: { organisationId: 'Organisation not found.' } });
  return d.organisationId;
}

function assertHorizonMode(orgId, d) {
  if (d.applicationMode !== 'horizon') return;
  const org = db().get('SELECT verification_status FROM organisations WHERE id = ?', [orgId]);
  if (!org || org.verification_status !== 'verified') {
    throw new HttpError(422, 'Only verified organisations can receive applications on HORIZON.', { fields: { applicationMode: 'Only verified organisations can receive applications on HORIZON. Use an external application link.' } });
  }
}

router.post('/', allow('admin', 'recruiter'), validate(opportunitySchema), (req, res) => {
  const d = req.valid.body;
  if (d.applicationDeadline < todayDate()) throw new HttpError(422, 'Deadline is in the past.', { fields: { applicationDeadline: 'The application deadline must be today or later.' } });
  const orgId = resolveOrganisation(req, d);
  assertHorizonMode(orgId, d);
  const isAdmin = req.user.role === 'admin';
  const status = isAdmin ? (d.status || 'published') : (d.status === 'draft' ? 'draft' : 'pending_review');
  const cols = {
    ...opps.toColumns(d),
    organisation_id: orgId,
    posted_by: req.user.id,
    status,
    source_name: isAdmin ? d.sourceName : 'Posted by verified recruiter',
    source_url: isAdmin ? d.sourceUrl : null,
    last_verified_at: isAdmin ? (d.lastVerifiedAt || todayDate()) : null,
    is_featured: isAdmin && d.isFeatured ? 1 : 0,
    is_verified: isAdmin && d.isVerified ? 1 : 0,
    published_at: status === 'published' ? nowSql() : null,
  };
  const keys = Object.keys(cols);
  const newId = db().tx(() => {
    const { lastInsertRowid } = db().run(`INSERT INTO opportunities (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => cols[k]));
    opps.syncSkills(lastInsertRowid, d.skills);
    return lastInsertRowid;
  });
  audit(req, 'opportunity.create', { entityType: 'opportunity', entityId: newId, details: { status, title: d.title } });
  if (status === 'pending_review') notifyAdmins({ type: 'listing', title: 'Listing awaiting review', body: d.title, link: '/admin/internships?status=pending_review' });
  res.status(201).json(opps.serializeDetail(opps.getRow(newId)));
});

router.put('/:id', allow('admin', 'recruiter'), validate(opportunitySchema), (req, res) => {
  const oppId = parse(id, req.params.id);
  const existing = db().get('SELECT * FROM opportunities WHERE id = ?', [oppId]);
  if (!existing) throw notFound('Opportunity');
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && existing.organisation_id !== req.user.organisation_id) throw notFound('Opportunity');
  const d = req.valid.body;
  const orgId = isAdmin ? resolveOrganisation(req, { ...d, organisationId: d.organisationId || existing.organisation_id }) : existing.organisation_id;
  assertHorizonMode(orgId, d);
  if (existing.application_mode === 'horizon' && d.applicationMode === 'external' && db().value("SELECT COUNT(*) FROM applications WHERE opportunity_id = ? AND channel = 'horizon'", [oppId])) {
    throw new HttpError(422, 'This listing already has HORIZON applicants.', { fields: { applicationMode: 'Listings with HORIZON applicants must keep on-platform applications.' } });
  }
  let status;
  if (isAdmin) status = d.status || existing.status;
  else if (d.status === 'draft' && existing.status !== 'published') status = 'draft';
  else if (existing.status === 'archived') status = 'archived';
  else status = 'pending_review'; // recruiter edits are re-reviewed before going live
  const cols = {
    ...opps.toColumns(d),
    organisation_id: orgId,
    status,
    updated_at: nowSql(),
    published_at: status === 'published' ? (existing.published_at || nowSql()) : existing.published_at,
    archived_at: status === 'archived' ? (existing.archived_at || nowSql()) : null,
  };
  if (isAdmin) Object.assign(cols, {
    source_name: d.sourceName, source_url: d.sourceUrl, last_verified_at: d.lastVerifiedAt || existing.last_verified_at,
    is_featured: d.isFeatured === undefined ? existing.is_featured : (d.isFeatured ? 1 : 0),
    is_verified: d.isVerified === undefined ? existing.is_verified : (d.isVerified ? 1 : 0),
  });
  const keys = Object.keys(cols);
  db().tx(() => {
    db().run(`UPDATE opportunities SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => cols[k]), oppId]);
    opps.syncSkills(oppId, d.skills);
    db().run('UPDATE applications SET snapshot_title = ? WHERE opportunity_id = ?', [d.title, oppId]);
  });
  audit(req, 'opportunity.update', { entityType: 'opportunity', entityId: oppId, details: { status } });
  if (!isAdmin && status === 'pending_review') notifyAdmins({ type: 'listing', title: 'Edited listing awaiting review', body: d.title, link: '/admin/internships?status=pending_review' });
  res.json(opps.serializeDetail(opps.getRow(oppId)));
});

/** Deletes a listing; listings with tracked applications are archived instead to preserve history. */
router.delete('/:id', allow('admin', 'recruiter'), (req, res) => {
  const oppId = parse(id, req.params.id);
  const existing = db().get('SELECT * FROM opportunities WHERE id = ?', [oppId]);
  if (!existing) throw notFound('Opportunity');
  if (req.user.role === 'recruiter' && existing.organisation_id !== req.user.organisation_id) throw notFound('Opportunity');
  const apps = db().value('SELECT COUNT(*) FROM applications WHERE opportunity_id = ?', [oppId]);
  if (apps > 0) {
    db().run("UPDATE opportunities SET status = 'archived', archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ?", [nowSql(), nowSql(), oppId]);
    audit(req, 'opportunity.archive', { entityType: 'opportunity', entityId: oppId, details: { reason: 'delete_with_applications', applications: apps } });
    return res.json({ deleted: false, archived: true, message: `Archived instead of deleted — ${apps} application${apps === 1 ? '' : 's'} reference this listing.` });
  }
  db().run('DELETE FROM opportunities WHERE id = ?', [oppId]);
  audit(req, 'opportunity.delete', { entityType: 'opportunity', entityId: oppId, details: { title: existing.title } });
  return res.json({ deleted: true, archived: false, message: 'Listing deleted.' });
});

const applySchema = z.object({
  coverNote: optText(2000, 'Cover note'),
  includeVideo: z.boolean().default(false),
  consent: z.literal(true, { error: 'Confirm that you agree to share your profile with this organisation.' }),
});

/** Apply on HORIZON to a verified organisation's listing; the student's tracker syncs automatically. */
router.post('/:id/apply', allow('student'), validate(applySchema), (req, res) => {
  const oppId = parse(id, req.params.id);
  const d = req.valid.body;
  const row = opps.getRow(oppId);
  if (!row || row.status !== 'published') throw notFound('Opportunity');
  if (row.application_mode !== 'horizon') throw new HttpError(409, 'This listing uses the employer’s own application process. Use the official link and track it here.');
  if (row.application_deadline < todayDate()) throw new HttpError(409, 'The application deadline has passed.');
  if (row.org_status !== 'verified') throw new HttpError(409, 'This organisation is not accepting HORIZON applications right now.');
  const cv = currentDocument(req.user.id, 'cv');
  if (!cv || !['auto_verified', 'verified'].includes(cv.review_status)) {
    throw new HttpError(409, 'Upload a CV that passes HORIZON validation before applying.', { code: 'CV_REQUIRED' });
  }
  let videoId = null;
  if (d.includeVideo) {
    const video = currentDocument(req.user.id, 'video');
    if (!video || video.review_status !== 'approved') throw new HttpError(409, 'Your video resume has not been approved yet. Apply without it or wait for the review.', { code: 'VIDEO_NOT_READY' });
    videoId = video.id;
  }
  const existing = db().get('SELECT * FROM applications WHERE user_id = ? AND opportunity_id = ?', [req.user.id, oppId]);
  if (existing && existing.channel === 'horizon') throw new HttpError(409, 'You have already applied to this opportunity on HORIZON.');
  const now = nowSql();
  const appId = db().tx(() => {
    let aid;
    if (existing) {
      db().run(`UPDATE applications SET channel = 'horizon', stage = 'applied', recruiter_status = 'submitted', applied_on = ?, cover_note = ?,
        cv_document_id = ?, video_document_id = ?, submitted_at = ?, updated_at = ? WHERE id = ?`,
      [todayDate(), d.coverNote, cv.id, videoId, now, now, existing.id]);
      aid = existing.id;
    } else {
      aid = db().run(`INSERT INTO applications (user_id, opportunity_id, channel, stage, recruiter_status, applied_on, cover_note, cv_document_id,
        video_document_id, submitted_at, snapshot_title, snapshot_organisation) VALUES (?, ?, 'horizon', 'applied', 'submitted', ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, oppId, todayDate(), d.coverNote, cv.id, videoId, now, row.title, row.org_name]).lastInsertRowid;
    }
    db().run(`INSERT INTO application_events (application_id, actor_id, actor_role, event_type, from_value, to_value, message, visible_to_recruiter)
      VALUES (?, ?, 'student', 'submitted', ?, 'applied', ?, 1)`, [aid, req.user.id, existing ? existing.stage : null, 'Application submitted on HORIZON with a validated CV' + (videoId ? ' and video resume.' : '.')]);
    return aid;
  });
  notifyOrganisation(row.organisation_id, { type: 'applicant', title: `New applicant: ${req.user.full_name}`, body: row.title, link: `/recruiter/applications/${appId}` });
  audit(req, 'application.submit', { entityType: 'application', entityId: appId, details: { opportunityId: oppId } });
  res.status(201).json({ id: appId, message: `Application sent to ${row.org_name}. Track its progress in My Applications.` });
});

module.exports = router;
module.exports.opportunitySchema = opportunitySchema;
