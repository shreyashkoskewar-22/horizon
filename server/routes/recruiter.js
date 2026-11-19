'use strict';
/** Verified recruiter portal: listings, applicant pipeline with mandatory closure, organisation profile. */
const express = require('express');
const config = require('../config');
const { getDb } = require('../db');
const { z, text, optText, url, optDateTime, id, validate, parse } = require('../lib/validation');
const { HttpError, notFound, nowSql, toSql, parseSql, initials } = require('../lib/util');
const { RECRUITER_STATUSES, RECRUITER_TO_STAGE } = require('../lib/constants');
const { allow } = require('../middleware/auth');
const opps = require('../services/opportunities');
const { audit, notify } = require('../services/events');
const users = require('../services/users');
const { responseClock } = require('../services/applications');

const router = express.Router();
const db = () => getDb();
const recruiter = allow('recruiter');

const APP_SELECT = `
  SELECT a.*, u.full_name, u.email, u.institution_id, i.name AS institution_name, i.short_name AS institution_short,
         sp.programme, sp.current_year, sp.graduation_year, sp.academic_level,
         o.title, o.organisation_id, o.application_deadline,
         cv.review_status AS cv_status, v.review_status AS video_status
  FROM applications a
  JOIN users u ON u.id = a.user_id
  JOIN institutions i ON i.id = u.institution_id
  LEFT JOIN student_profiles sp ON sp.user_id = u.id
  JOIN opportunities o ON o.id = a.opportunity_id
  LEFT JOIN documents cv ON cv.id = a.cv_document_id
  LEFT JOIN documents v ON v.id = a.video_document_id`;

function serializeApplicant(a) {
  const waitingDays = a.submitted_at && !a.first_response_at ? Math.floor((Date.now() - parseSql(a.submitted_at).getTime()) / 86400000) : null;
  const clock = responseClock(a); // the same rule the student sees on their tracker
  return {
    id: a.id,
    opportunityId: a.opportunity_id,
    opportunityTitle: a.title,
    student: { id: a.user_id, name: a.full_name, initials: initials(a.full_name), institution: a.institution_name, institutionShort: a.institution_short, programme: a.programme, currentYear: a.current_year, graduationYear: a.graduation_year },
    stage: a.stage,
    recruiterStatus: a.recruiter_status,
    withdrawn: a.stage === 'withdrawn',
    coverNote: a.cover_note,
    recruiterMessage: a.recruiter_message,
    recruiterNotes: a.recruiter_notes,
    interviewAt: a.interview_at,
    submittedAt: a.submitted_at,
    firstResponseAt: a.first_response_at,
    decidedAt: a.decided_at,
    waitingDays,
    respondBy: clock.respondBy,
    daysToRespond: clock.daysToRespond,
    overdue: clock.responseOverdue,
    cv: a.cv_document_id ? { id: a.cv_document_id, status: a.cv_status, url: `/api/documents/${a.cv_document_id}/file` } : null,
    video: a.video_document_id && a.video_status === 'approved' ? { id: a.video_document_id, url: `/api/documents/${a.video_document_id}/file` } : null,
  };
}

function ownApplication(req) {
  const appId = parse(id, req.params.id);
  const a = db().get(`${APP_SELECT} WHERE a.id = ? AND a.channel = 'horizon'`, [appId]);
  if (!a || a.organisation_id !== req.user.organisation_id) throw notFound('Application');
  return a;
}

router.get('/dashboard', recruiter, (req, res) => {
  const orgId = req.user.organisation_id;
  const d = db();
  const apps = d.all(`${APP_SELECT} WHERE a.channel = 'horizon' AND o.organisation_id = ? ORDER BY a.submitted_at DESC`, [orgId]);
  const listings = d.all('SELECT status, COUNT(*) AS n FROM opportunities WHERE organisation_id = ? GROUP BY status', [orgId]);
  const count = (s) => (listings.find((l) => l.status === s) || {}).n || 0;
  const org = d.get('SELECT * FROM organisations WHERE id = ?', [orgId]);
  res.json({
    organisation: { id: org.id, name: org.name, verified: org.verification_status === 'verified', type: org.org_type, isDemo: !!org.is_demo },
    stats: {
      activeListings: d.value(`SELECT COUNT(*) FROM opportunities o WHERE o.organisation_id = ? AND ${opps.OPEN_WHERE}`, [orgId]),
      pendingReview: count('pending_review'),
      drafts: count('draft'),
      totalApplicants: apps.length,
      awaitingResponse: apps.filter((a) => a.recruiter_status === 'submitted' && a.stage !== 'withdrawn').length,
      overdue: apps.filter((a) => serializeApplicant(a).overdue && a.stage !== 'withdrawn').length,
      interviews: apps.filter((a) => a.recruiter_status === 'interview').length,
      offers: apps.filter((a) => a.recruiter_status === 'offer').length,
    },
    pipeline: RECRUITER_STATUSES.map((s) => ({ status: s, count: apps.filter((a) => a.recruiter_status === s && a.stage !== 'withdrawn').length })),
    recentApplicants: apps.slice(0, 6).map(serializeApplicant),
    // Replies due: applicants still waiting for a first response, oldest first.
    repliesDue: apps.filter((a) => responseClock(a).respondBy)
      .sort((x, y) => String(x.submitted_at).localeCompare(String(y.submitted_at))).slice(0, 8).map(serializeApplicant),
    responseStats: opps.responseStats(orgId),
    grievancesAwaiting: d.value("SELECT COUNT(*) FROM grievances WHERE respondent_org_id = ? AND shared_with_respondent = 1 AND status = 'awaiting_response'", [orgId]),
    responseWindowDays: config.recruiterResponseDays,
  });
});

router.get('/opportunities', recruiter, (req, res) => {
  const status = ['draft', 'pending_review', 'published', 'rejected', 'archived'].includes(req.query.status) ? req.query.status : null;
  const rows = db().all(`${opps.BASE_SELECT} WHERE o.organisation_id = ? ${status ? 'AND o.status = ?' : ''} ORDER BY o.updated_at DESC`,
    status ? [req.user.organisation_id, status] : [req.user.organisation_id]);
  const counts = new Map(db().all(`SELECT a.opportunity_id, COUNT(*) AS n, SUM(CASE WHEN a.recruiter_status = 'submitted' AND a.stage <> 'withdrawn' THEN 1 ELSE 0 END) AS waiting
    FROM applications a JOIN opportunities o ON o.id = a.opportunity_id WHERE o.organisation_id = ? AND a.channel = 'horizon' GROUP BY a.opportunity_id`, [req.user.organisation_id]).map((r) => [r.opportunity_id, r]));
  res.json({ items: rows.map((r) => ({ ...opps.serializeCard(r), reviewNote: r.review_note, applicants: (counts.get(r.id) || {}).n || 0, awaiting: (counts.get(r.id) || {}).waiting || 0, updatedAt: r.updated_at })) });
});

router.get('/opportunities/:id/applicants', recruiter, (req, res) => {
  const oppId = parse(id, req.params.id);
  const opp = db().get('SELECT * FROM opportunities WHERE id = ? AND organisation_id = ?', [oppId, req.user.organisation_id]);
  if (!opp) throw notFound('Opportunity');
  const status = RECRUITER_STATUSES.includes(req.query.status) ? req.query.status : null;
  const rows = db().all(`${APP_SELECT} WHERE a.opportunity_id = ? AND a.channel = 'horizon' ${status ? 'AND a.recruiter_status = ?' : ''} ORDER BY a.submitted_at ASC`, status ? [oppId, status] : [oppId]);
  res.json({ opportunity: { id: opp.id, title: opp.title, status: opp.status, deadline: opp.application_deadline }, items: rows.map(serializeApplicant) });
});

router.get('/applicants', recruiter, (req, res) => {
  const status = RECRUITER_STATUSES.includes(req.query.status) ? req.query.status : null;
  const params = [req.user.organisation_id];
  if (status) params.push(status);
  const rows = db().all(`${APP_SELECT} WHERE a.channel = 'horizon' AND o.organisation_id = ? ${status ? 'AND a.recruiter_status = ?' : ''} ORDER BY a.submitted_at DESC`, params);
  res.json({ items: rows.map(serializeApplicant) });
});

router.get('/applications/:id', recruiter, (req, res) => {
  const a = ownApplication(req);
  const events = db().all(`SELECT e.*, u.full_name AS actor_name FROM application_events e LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.application_id = ? AND e.visible_to_recruiter = 1 ORDER BY e.created_at, e.id`, [a.id]);
  const profile = users.studentProfileRow(a.user_id);
  const cv = a.cv_document_id ? db().get('SELECT * FROM documents WHERE id = ?', [a.cv_document_id]) : null;
  res.json({
    ...serializeApplicant(a),
    profile,
    cvReport: cv ? users.documentSummary(cv) : null,
    events: events.map((e) => ({ id: e.id, type: e.event_type, actorRole: e.actor_role, actor: e.actor_role === 'student' ? a.full_name : e.actor_name, from: e.from_value, to: e.to_value, message: e.message, createdAt: e.created_at })),
  });
});

const decisionSchema = z.object({
  recruiterStatus: z.enum(RECRUITER_STATUSES, { error: 'Choose a status.' }),
  message: optText(2000, 'Message to candidate'),
  interviewAt: optDateTime('Interview date'),
  recruiterNotes: optText(4000, 'Private notes'),
}).superRefine((d, ctx) => {
  if (d.recruiterStatus === 'not_selected' && (!d.message || d.message.length < 20)) {
    ctx.addIssue({ code: 'custom', path: ['message'], message: 'Share a short, respectful reason or next step (at least 20 characters). Every candidate receives closure on HORIZON.' });
  }
  if (d.recruiterStatus === 'interview' && !d.interviewAt) ctx.addIssue({ code: 'custom', path: ['interviewAt'], message: 'Add the interview date and time.' });
});

router.put('/applications/:id', recruiter, validate(decisionSchema), (req, res) => {
  const a = ownApplication(req);
  if (a.stage === 'withdrawn') throw new HttpError(409, 'The candidate has withdrawn this application.');
  const d = req.valid.body;
  const now = nowSql();
  const statusChanged = d.recruiterStatus !== a.recruiter_status;
  const newStage = RECRUITER_TO_STAGE[d.recruiterStatus];
  db().tx(() => {
    db().run(`UPDATE applications SET recruiter_status = ?, stage = ?, recruiter_message = COALESCE(?, recruiter_message), recruiter_notes = ?,
      interview_at = ?, first_response_at = COALESCE(first_response_at, ?), decided_at = CASE WHEN ? IN ('offer','not_selected') THEN COALESCE(decided_at, ?) ELSE decided_at END,
      updated_at = ? WHERE id = ?`,
    [d.recruiterStatus, newStage, d.message, d.recruiterNotes, d.interviewAt ? toSql(d.interviewAt) : (d.recruiterStatus === 'interview' ? a.interview_at : a.interview_at), (statusChanged || d.message) ? now : null, d.recruiterStatus, now, now, a.id]);
    if (statusChanged || d.message) {
      db().run(`INSERT INTO application_events (application_id, actor_id, actor_role, event_type, from_value, to_value, message, visible_to_recruiter)
        VALUES (?, ?, 'recruiter', ?, ?, ?, ?, 1)`, [a.id, req.user.id, statusChanged ? 'recruiter_status' : 'recruiter_message', a.recruiter_status, d.recruiterStatus, d.message]);
    }
  });
  if (statusChanged || d.message) {
    const label = { submitted: 'Submitted', under_review: 'Under review', shortlisted: 'Shortlisted', assessment: 'Assessment', interview: 'Interview invitation', offer: 'Offer', not_selected: 'Decision' }[d.recruiterStatus];
    notify(a.user_id, { type: 'application', title: `${a.title}: ${label}`, body: d.message || `Your application status is now "${label}".`, link: '/app/applications' });
  }
  audit(req, 'application.recruiter_update', { entityType: 'application', entityId: a.id, details: { from: a.recruiter_status, to: d.recruiterStatus } });
  res.json(serializeApplicant(db().get(`${APP_SELECT} WHERE a.id = ?`, [a.id])));
});

const orgSchema = z.object({
  description: optText(3000, 'Description'),
  website: url('Website'),
  linkedinUrl: url('LinkedIn page'),
  headquarters: optText(100, 'Headquarters'),
  country: text(2, 60, 'Country'),
});

router.get('/organisation', recruiter, (req, res) => {
  const org = db().get('SELECT * FROM organisations WHERE id = ?', [req.user.organisation_id]);
  res.json({ id: org.id, name: org.name, type: org.org_type, website: org.website, emailDomain: org.email_domain, country: org.country, headquarters: org.headquarters, description: org.description, linkedinUrl: org.linkedin_url, registrationNumber: org.registration_number, verificationStatus: org.verification_status, verifiedAt: org.verified_at, isDemo: !!org.is_demo });
});

router.put('/organisation', recruiter, validate(orgSchema), (req, res) => {
  const org = db().get('SELECT * FROM organisations WHERE id = ?', [req.user.organisation_id]);
  const d = req.valid.body;
  const website = org.verification_status === 'verified' ? org.website : d.website; // verified identity fields are locked
  db().run('UPDATE organisations SET description = ?, website = ?, linkedin_url = ?, headquarters = ?, country = ?, updated_at = ? WHERE id = ?',
    [d.description, website, d.linkedinUrl, d.headquarters, d.country, nowSql(), org.id]);
  audit(req, 'organisation.update', { entityType: 'organisation', entityId: org.id });
  res.json({ ok: true, websiteLocked: org.verification_status === 'verified' });
});

module.exports = router;
