'use strict';
/** Student-facing endpoints: saved opportunities, application tracker and dashboard. */
const express = require('express');
const config = require('../config');
const { getDb } = require('../db');
const { z, optText, optDate, optDateTime, id, validate, parse } = require('../lib/validation');
const { HttpError, notFound, nowSql, toSql, todayDate, parseJsonArray } = require('../lib/util');
const { STAGES, SUBMITTED_STAGES } = require('../lib/constants');
const { allow } = require('../middleware/auth');
const opps = require('../services/opportunities');
const { audit } = require('../services/events');
const { studentProfileRow, profileCompletion, currentDocument } = require('../services/users');
const { responseClock, nextActions } = require('../services/applications');

const router = express.Router();
const db = () => getDb();
const student = allow('student');

/* ---------------------------------------------------------------- Saved */

router.get('/saved', student, (req, res) => {
  const rows = db().all(`${opps.BASE_SELECT} JOIN saved_opportunities so ON so.opportunity_id = o.id AND so.user_id = ?
    WHERE o.status IN ('published', 'archived') ORDER BY so.created_at DESC`, [req.user.id]);
  res.json({ items: opps.decorate(rows, req.user.id).map((c, i) => ({ ...c, isOpen: rows[i].status === 'published' && rows[i].application_deadline >= todayDate() })) });
});

router.post('/saved/:opportunityId', student, (req, res) => {
  const oppId = parse(id, req.params.opportunityId);
  const opp = db().get("SELECT id FROM opportunities WHERE id = ? AND status = 'published'", [oppId]);
  if (!opp) throw notFound('Opportunity');
  const { changes } = db().run('INSERT OR IGNORE INTO saved_opportunities (user_id, opportunity_id) VALUES (?, ?)', [req.user.id, oppId]);
  res.status(changes ? 201 : 200).json({ saved: true, created: !!changes });
});

router.delete('/saved/:opportunityId', student, (req, res) => {
  const oppId = parse(id, req.params.opportunityId);
  const { changes } = db().run('DELETE FROM saved_opportunities WHERE user_id = ? AND opportunity_id = ?', [req.user.id, oppId]);
  if (!changes) throw notFound('Saved opportunity');
  res.json({ saved: false });
});

/* ---------------------------------------------------------- Applications */

const APP_SELECT = `
  SELECT a.*, o.title, o.country, o.city, o.application_deadline, o.application_mode, o.application_url, o.status AS opportunity_status,
         o.organisation_id, org.name AS org_name
  FROM applications a
  JOIN opportunities o ON o.id = a.opportunity_id
  JOIN organisations org ON org.id = o.organisation_id`;

function serializeApp(a) {
  return {
    id: a.id,
    opportunityId: a.opportunity_id,
    title: a.title || a.snapshot_title,
    organisation: a.org_name || a.snapshot_organisation,
    organisationId: a.organisation_id,
    country: a.country,
    city: a.city,
    deadline: a.application_deadline,
    applicationUrl: a.application_url,
    opportunityStatus: a.opportunity_status,
    channel: a.channel,
    stage: a.stage,
    recruiterStatus: a.recruiter_status,
    recruiterMessage: a.recruiter_message,
    appliedOn: a.applied_on,
    interviewAt: a.interview_at,
    personalDeadline: a.personal_deadline,
    nextAction: a.next_action,
    notes: a.notes,
    coverNote: a.cover_note,
    submittedAt: a.submitted_at,
    firstResponseAt: a.first_response_at,
    ...responseClock(a), // respondBy, daysToRespond, responseOverdue — HORIZON applications awaiting a first reply only
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

function ownApplication(req) {
  const appId = parse(id, req.params.id);
  const a = db().get(`${APP_SELECT} WHERE a.id = ? AND a.user_id = ?`, [appId, req.user.id]);
  if (!a) throw notFound('Application');
  return a;
}

function addEvent(appId, req, type, from, to, message, visibleToRecruiter = 0) {
  db().run(`INSERT INTO application_events (application_id, actor_id, actor_role, event_type, from_value, to_value, message, visible_to_recruiter)
    VALUES (?, ?, 'student', ?, ?, ?, ?, ?)`, [appId, req.user.id, type, from, to, message, visibleToRecruiter]);
}

router.get('/applications', student, (req, res) => {
  const rows = db().all(`${APP_SELECT} WHERE a.user_id = ? ORDER BY a.updated_at DESC`, [req.user.id]);
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0]));
  rows.forEach((r) => { counts[r.stage] += 1; });
  res.json({ items: rows.map(serializeApp), counts });
});

router.get('/applications/:id', student, (req, res) => {
  const a = ownApplication(req);
  const events = db().all(`SELECT e.*, u.full_name AS actor_name FROM application_events e LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.application_id = ? ORDER BY e.created_at ASC, e.id ASC`, [a.id]);
  res.json({
    ...serializeApp(a),
    events: events.map((e) => ({ id: e.id, type: e.event_type, actorRole: e.actor_role, actor: e.actor_role === 'recruiter' ? a.org_name : 'You', from: e.from_value, to: e.to_value, message: e.message, createdAt: e.created_at })),
  });
});

const appFields = {
  stage: z.enum(STAGES, { error: 'Select a stage.' }),
  appliedOn: optDate('Application date'),
  interviewAt: optDateTime('Interview date'),
  personalDeadline: optDate('Personal deadline'),
  nextAction: optText(200, 'Next action'),
  notes: optText(4000, 'Notes'),
};
const createSchema = z.object({ opportunityId: id, ...appFields, stage: appFields.stage.default('interested') });
const updateSchema = z.object(appFields).partial();

router.post('/applications', student, validate(createSchema), (req, res) => {
  const d = req.valid.body;
  const opp = opps.getRow(d.opportunityId);
  if (!opp || opp.status !== 'published') throw new HttpError(422, 'Choose an open opportunity.', { fields: { opportunityId: 'Choose an open opportunity.' } });
  if (db().get('SELECT 1 FROM applications WHERE user_id = ? AND opportunity_id = ?', [req.user.id, opp.id])) {
    throw new HttpError(409, 'This opportunity is already in your application tracker.', { code: 'DUPLICATE' });
  }
  const appliedOn = d.appliedOn || (SUBMITTED_STAGES.includes(d.stage) ? todayDate() : null);
  const newId = db().tx(() => {
    const { lastInsertRowid } = db().run(`INSERT INTO applications (user_id, opportunity_id, channel, stage, applied_on, interview_at, personal_deadline,
      next_action, notes, snapshot_title, snapshot_organisation) VALUES (?, ?, 'external', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, opp.id, d.stage, appliedOn, d.interviewAt ? toSql(d.interviewAt) : null, d.personalDeadline, d.nextAction, d.notes, opp.title, opp.org_name]);
    addEvent(lastInsertRowid, req, 'created', null, d.stage, 'Added to your application tracker.');
    return lastInsertRowid;
  });
  audit(req, 'application.create', { entityType: 'application', entityId: newId });
  res.status(201).json(serializeApp(db().get(`${APP_SELECT} WHERE a.id = ?`, [newId])));
});

router.put('/applications/:id', student, validate(updateSchema), (req, res) => {
  const a = ownApplication(req);
  const d = req.valid.body;
  if (a.channel === 'horizon' && d.stage && d.stage !== a.stage && d.stage !== 'withdrawn') {
    throw new HttpError(409, 'The organisation updates the stage of HORIZON applications. You can withdraw, or edit your notes and dates.', { code: 'STAGE_LOCKED', fields: { stage: 'Updated by the recruiter for HORIZON applications.' } });
  }
  if (a.stage === 'withdrawn' && a.channel === 'horizon' && d.stage && d.stage !== 'withdrawn') {
    throw new HttpError(409, 'Withdrawn HORIZON applications cannot be reopened.', { fields: { stage: 'Withdrawn applications cannot be reopened.' } });
  }
  const changes = {};
  const set = (col, val) => { changes[col] = val; };
  if (d.stage !== undefined && d.stage !== a.stage) set('stage', d.stage);
  if (d.appliedOn !== undefined) set('applied_on', d.appliedOn);
  else if (d.stage && SUBMITTED_STAGES.includes(d.stage) && !a.applied_on) set('applied_on', todayDate());
  if (d.interviewAt !== undefined) set('interview_at', d.interviewAt ? toSql(d.interviewAt) : null);
  if (d.personalDeadline !== undefined) set('personal_deadline', d.personalDeadline);
  if (d.nextAction !== undefined) set('next_action', d.nextAction);
  if (d.notes !== undefined) set('notes', d.notes);
  if (!Object.keys(changes).length) return res.json(serializeApp(a));
  set('updated_at', nowSql());
  if (changes.stage === 'withdrawn' && a.channel === 'horizon') set('recruiter_status', a.recruiter_status);
  db().tx(() => {
    const keys = Object.keys(changes);
    db().run(`UPDATE applications SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => changes[k]), a.id]);
    if (changes.stage) addEvent(a.id, req, changes.stage === 'withdrawn' ? 'withdrawn' : 'stage_changed', a.stage, changes.stage, null, a.channel === 'horizon' ? 1 : 0);
    if (changes.notes !== undefined && changes.notes !== a.notes) addEvent(a.id, req, 'notes_updated', null, null, 'Personal notes updated.');
    const dateKeys = ['applied_on', 'interview_at', 'personal_deadline'].filter((k) => changes[k] !== undefined && changes[k] !== a[k]);
    if (dateKeys.length) addEvent(a.id, req, 'dates_updated', null, null, `Updated ${dateKeys.map((k) => k.replace(/_/g, ' ')).join(', ')}.`);
    if (changes.next_action !== undefined && changes.next_action !== a.next_action) addEvent(a.id, req, 'next_action', null, changes.next_action, null);
  });
  if (changes.stage === 'withdrawn' && a.channel === 'horizon') {
    const { notifyOrganisation } = require('../services/events');
    notifyOrganisation(a.organisation_id, { type: 'applicant', title: 'An applicant withdrew', body: `${req.user.full_name} withdrew from ${a.title}.`, link: `/recruiter/applications/${a.id}` });
  }
  audit(req, 'application.update', { entityType: 'application', entityId: a.id, details: { fields: Object.keys(changes) } });
  res.json(serializeApp(db().get(`${APP_SELECT} WHERE a.id = ?`, [a.id])));
});

router.delete('/applications/:id', student, (req, res) => {
  const a = ownApplication(req);
  if (a.channel === 'horizon' && a.stage !== 'withdrawn') {
    throw new HttpError(409, 'Applications submitted on HORIZON are shared with the organisation. Withdraw it first; the record is then kept for both sides.', { code: 'WITHDRAW_FIRST' });
  }
  if (a.channel === 'horizon') throw new HttpError(409, 'Withdrawn HORIZON applications are retained so the organisation’s records stay accurate.', { code: 'RETAINED' });
  db().run('DELETE FROM applications WHERE id = ?', [a.id]);
  audit(req, 'application.delete', { entityType: 'application', entityId: a.id });
  res.json({ deleted: true });
});

/* ------------------------------------------------------------- Dashboard */

router.get('/dashboard', student, (req, res) => {
  const d = db();
  const uid = req.user.id;
  const profile = studentProfileRow(uid);
  const cv = currentDocument(uid, 'cv');
  const video = currentDocument(uid, 'video');
  const apps = d.all(`${APP_SELECT} WHERE a.user_id = ?`, [uid]);
  const progress = STAGES.map((s) => ({ stage: s, count: apps.filter((a) => a.stage === s).length }));

  // Recommendations: explainable score from stated preferences, skills and eligibility.
  const prefC = new Set(profile.preferredCountries.map((x) => x.toLowerCase()));
  const prefI = new Set(profile.preferredIndustries.map((x) => x.toLowerCase()));
  const mySkills = new Set(profile.skills.map((x) => x.toLowerCase()));
  const tracked = new Set(apps.map((a) => a.opportunity_id));
  const candidates = opps.listOpen({ orderBy: 'o.application_deadline ASC', limit: 200 })
    .filter((r) => !tracked.has(r.id))
    .filter((r) => r.academic_level === 'any' || r.academic_level === profile.academicLevel);
  const scored = candidates.map((r) => {
    const reasons = [];
    let score = 0;
    if (prefC.has(r.country.toLowerCase())) { score += 3; reasons.push(`in ${r.country}`); }
    if (prefI.has(r.industry.toLowerCase())) { score += 3; reasons.push(r.industry); }
    const skills = r.skill_list ? r.skill_list.split('|') : [];
    const overlap = skills.filter((s) => mySkills.has(s.toLowerCase()));
    if (overlap.length) { score += Math.min(4, overlap.length); reasons.push(`${overlap.length} matching skill${overlap.length > 1 ? 's' : ''} (${overlap.slice(0, 2).join(', ')})`); }
    const years = parseJsonArray(r.eligible_years);
    if (!years.length || years.includes(profile.currentYear)) score += 1;
    else score -= 5;
    if (r.is_featured) score += 0.5;
    return { r, score, reasons };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
  const recommended = opps.decorate(scored.map((x) => x.r), uid).map((c, i) => ({ ...c, reasons: scored[i].reasons }));

  const recent = opps.decorate(opps.listOpen({ limit: 4 }), uid);
  const savedRows = d.all(`${opps.BASE_SELECT} JOIN saved_opportunities so ON so.opportunity_id = o.id AND so.user_id = ? WHERE ${opps.OPEN_WHERE} ORDER BY so.created_at DESC LIMIT 4`, [uid]);

  const deadlines = [
    ...d.all(`SELECT o.id, o.title, org.name AS org, o.application_deadline AS date, 'saved' AS source FROM saved_opportunities so
      JOIN opportunities o ON o.id = so.opportunity_id JOIN organisations org ON org.id = o.organisation_id
      WHERE so.user_id = ? AND ${opps.OPEN_WHERE.replace(/o\./g, 'o.')} AND o.application_deadline <= date('now', '+45 days')
      AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_id = so.user_id AND a.opportunity_id = o.id AND a.stage NOT IN ('interested','preparing'))`, [uid]),
    ...apps.filter((a) => ['interested', 'preparing'].includes(a.stage) && a.application_deadline >= todayDate())
      .map((a) => ({ id: a.opportunity_id, applicationId: a.id, title: a.title, org: a.org_name, date: a.application_deadline, source: 'application deadline' })),
    ...apps.filter((a) => a.personal_deadline && a.personal_deadline >= todayDate() && !['rejected', 'withdrawn'].includes(a.stage))
      .map((a) => ({ id: a.opportunity_id, applicationId: a.id, title: a.title, org: a.org_name, date: a.personal_deadline, source: 'personal deadline' })),
    ...apps.filter((a) => a.interview_at && a.interview_at >= nowSql() && a.stage === 'interview')
      .map((a) => ({ id: a.opportunity_id, applicationId: a.id, title: a.title, org: a.org_name, date: a.interview_at, source: 'interview' })),
  ].sort((x, y) => String(x.date).localeCompare(String(y.date))).slice(0, 6);

  const destinations = d.all(`SELECT o.country, COUNT(*) AS count, dr.slug FROM opportunities o
    LEFT JOIN destination_resources dr ON dr.country = o.country AND dr.is_published = 1
    WHERE ${opps.OPEN_WHERE} GROUP BY o.country ORDER BY count DESC LIMIT 6`);

  // Accountability strip: the student's own HORIZON applications still waiting for a first reply.
  const waiting = apps.map((a) => ({ a, clock: responseClock(a) })).filter((x) => x.clock.respondBy)
    .sort((x, y) => x.clock.respondBy.localeCompare(y.clock.respondBy));
  const awaitingReply = waiting.length ? {
    count: waiting.length,
    overdue: waiting.filter((x) => x.clock.responseOverdue).length,
    windowDays: config.recruiterResponseDays,
    next: { id: waiting[0].a.id, opportunityId: waiting[0].a.opportunity_id, title: waiting[0].a.title || waiting[0].a.snapshot_title, organisation: waiting[0].a.org_name || waiting[0].a.snapshot_organisation, submittedAt: waiting[0].a.submitted_at, ...waiting[0].clock },
  } : null;

  res.json({
    user: { firstName: req.user.full_name.split(' ')[0], fullName: req.user.full_name, institution: req.user.institution_name, programme: profile.programme, currentYear: profile.currentYear, graduationYear: profile.graduationYear },
    stats: {
      totalOpportunities: d.value(`SELECT COUNT(*) FROM opportunities o WHERE ${opps.OPEN_WHERE}`),
      saved: d.value('SELECT COUNT(*) FROM saved_opportunities so JOIN opportunities o ON o.id = so.opportunity_id WHERE so.user_id = ? AND o.status = \'published\'', [uid]),
      applicationsSubmitted: apps.filter((a) => a.applied_on || SUBMITTED_STAGES.includes(a.stage)).length,
      interviews: apps.filter((a) => a.stage === 'interview').length,
      offers: apps.filter((a) => a.stage === 'offer').length,
    },
    recommended,
    recent,
    progress,
    deadlines,
    saved: opps.decorate(savedRows, uid),
    destinations,
    profile: { completion: profileCompletion(profile, cv, video), cvStatus: cv ? cv.review_status : null, videoStatus: video ? video.review_status : null },
    nextActions: nextActions({ apps, cv }),
    awaitingReply,
    containsDemoData: !!d.value(`SELECT COUNT(*) FROM opportunities o WHERE ${opps.OPEN_WHERE} AND o.is_demo = 1`),
  });
});

module.exports = router;
