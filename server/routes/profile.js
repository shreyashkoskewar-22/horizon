'use strict';
/** Profiles (student + recruiter), CV validation uploads, video resumes and private document access. */
const fs = require('node:fs');
const express = require('express');
const config = require('../config');
const { getDb } = require('../db');
const { z, text, optText, url, tagList, id, validate, parse } = require('../lib/validation');
const { HttpError, notFound, nowSql, sha256, hostFromUrl } = require('../lib/util');
const { ACADEMIC_LEVELS } = require('../lib/constants');
const { allow, requireAuth } = require('../middleware/auth');
const { limiters } = require('../middleware/security');
const files = require('../services/files');
const { validateResume } = require('../services/resume-validator');
const { inspectVideo } = require('../services/media');
const { audit, notifyAdmins } = require('../services/events');
const users = require('../services/users');

const router = express.Router();
const db = () => getDb();
const YEAR = new Date().getUTCFullYear();

const linkedin = url('LinkedIn URL').refine((v) => !v || /(^|\.)linkedin\.com$/i.test(hostFromUrl(v)), 'Enter a linkedin.com link.');
const github = url('GitHub URL').refine((v) => !v || /(^|\.)github\.com$/i.test(hostFromUrl(v)), 'Enter a github.com link.');

const studentSchema = z.object({
  programme: text(2, 120, 'Programme'),
  academicLevel: z.enum(ACADEMIC_LEVELS, { error: 'Select your level of study.' }),
  currentYear: z.coerce.number().int().min(1, 'Select your current year.').max(6),
  graduationYear: z.coerce.number().int().min(YEAR - 1, 'Graduation year must be current or upcoming.').max(YEAR + 7, 'Enter a realistic graduation year.'),
  academicInterests: tagList(10, 60, 'Interest'),
  specialisation: optText(120, 'Specialisation'),
  skills: tagList(25, 40, 'Skill'),
  languages: tagList(10, 40, 'Language'),
  preferredCountries: tagList(10, 60, 'Country'),
  preferredIndustries: tagList(10, 60, 'Industry'),
  experience: optText(4000, 'Previous experience'),
  linkedinUrl: linkedin,
  portfolioUrl: url('Portfolio URL'),
  githubUrl: github,
  bio: optText(800, 'Introduction'),
});
const recruiterSchema = z.object({
  designation: text(2, 100, 'Designation'),
  bio: optText(800, 'Introduction'),
  linkedinUrl: linkedin,
});

function profilePayload(user) {
  const cv = users.currentDocument(user.id, 'cv');
  const video = users.currentDocument(user.id, 'video');
  const base = { user: users.publicUser(user), video: users.documentSummary(video) };
  if (user.role === 'student') {
    const profile = users.studentProfileRow(user.id);
    return { ...base, profile, cv: users.documentSummary(cv), completion: users.profileCompletion(profile, cv, video) };
  }
  if (user.role === 'recruiter') return { ...base, profile: users.recruiterProfileRow(user.id) };
  return base;
}

router.get('/profile', allow('student', 'recruiter', 'admin'), (req, res) => res.json(profilePayload(req.user)));

router.put('/profile', allow('student', 'recruiter'), (req, res) => {
  if (req.user.role === 'student') {
    const d = parse(studentSchema, req.body);
    db().run(`UPDATE student_profiles SET programme = ?, academic_level = ?, current_year = ?, graduation_year = ?, academic_interests = ?,
      specialisation = ?, skills = ?, languages = ?, preferred_countries = ?, preferred_industries = ?, experience = ?, linkedin_url = ?,
      portfolio_url = ?, github_url = ?, bio = ?, updated_at = ? WHERE user_id = ?`,
    [d.programme, d.academicLevel, d.currentYear, d.graduationYear, JSON.stringify(d.academicInterests), d.specialisation, JSON.stringify(d.skills),
      JSON.stringify(d.languages), JSON.stringify(d.preferredCountries), JSON.stringify(d.preferredIndustries), d.experience, d.linkedinUrl,
      d.portfolioUrl, d.githubUrl, d.bio, nowSql(), req.user.id]);
  } else {
    const d = parse(recruiterSchema, req.body);
    db().run('UPDATE recruiter_profiles SET designation = ?, bio = ?, linkedin_url = ?, updated_at = ? WHERE user_id = ?', [d.designation, d.bio, d.linkedinUrl, nowSql(), req.user.id]);
  }
  audit(req, 'profile.update', { entityType: 'user', entityId: req.user.id });
  res.json(profilePayload(req.user));
});

/* ------------------------------------------------------------------ CV */

const cvUpload = files.uploader('cv', config.uploads.cvMaxMb, ['pdf']);

router.post('/profile/cv', allow('student'), limiters.upload, cvUpload, async (req, res) => {
  const u = req.user;
  if (!req.file) throw new HttpError(422, 'Choose a PDF file to upload.', { fields: { cv: 'Choose a PDF file to upload.' } });
  const buffer = await fs.promises.readFile(req.file.path);
  const hash = sha256(buffer);
  const duplicate = db().get("SELECT 1 FROM documents WHERE kind = 'cv' AND sha256 = ? AND user_id <> ?", [hash, u.id]);
  const institution = db().get('SELECT name, short_name FROM institutions WHERE id = ?', [u.institution_id]);
  const profile = users.studentProfileRow(u.id);
  const report = await validateResume(buffer, { fullName: u.full_name, institution, graduationYear: profile.graduationYear, duplicateOwner: !!duplicate });
  if (report.status === 'rejected') {
    audit(req, 'cv.rejected', { entityType: 'user', entityId: u.id, details: { failed: report.checks.filter((c) => c.result === 'fail').map((c) => c.id) } });
    const first = report.checks.find((c) => c.result === 'fail');
    return res.status(422).json({ error: { code: 'CV_REJECTED', message: 'Your CV did not pass validation. Fix the issues listed and upload again.', fields: { cv: first ? first.detail : 'Validation failed.' } }, report });
  }
  const previous = db().all("SELECT * FROM documents WHERE user_id = ? AND kind = 'cv' AND is_current = 1", [u.id]);
  const doc = db().tx(() => {
    db().run("UPDATE documents SET is_current = 0 WHERE user_id = ? AND kind = 'cv'", [u.id]);
    return files.storeDocument({ file: req.file, userId: u.id, kind: 'cv', type: 'pdf', sha256: hash, reviewStatus: report.status, report, meta: report.meta });
  });
  previous.forEach((p) => files.deleteDocumentIfUnused(p));
  if (report.status === 'flagged') notifyAdmins({ type: 'document', title: 'CV flagged for manual review', body: u.full_name, link: '/admin/documents' });
  audit(req, 'cv.upload', { entityType: 'document', entityId: doc.id, details: { status: report.status } });
  return res.status(201).json({ document: users.documentSummary(doc), report });
});

router.post('/profile/cv/request-review', allow('student'), (req, res) => {
  const cv = users.currentDocument(req.user.id, 'cv');
  if (!cv) throw new HttpError(409, 'Upload a CV first.');
  if (cv.review_status === 'verified') throw new HttpError(409, 'Your CV is already verified by HORIZON.');
  db().run('UPDATE documents SET manual_review_requested = 1 WHERE id = ?', [cv.id]);
  notifyAdmins({ type: 'document', title: 'Manual CV verification requested', body: req.user.full_name, link: '/admin/documents' });
  audit(req, 'cv.review_requested', { entityType: 'document', entityId: cv.id });
  res.json({ document: users.documentSummary(db().get('SELECT * FROM documents WHERE id = ?', [cv.id])) });
});

router.delete('/profile/cv', allow('student'), (req, res) => {
  const cv = users.currentDocument(req.user.id, 'cv');
  if (!cv) throw notFound('CV');
  db().run('UPDATE documents SET is_current = 0 WHERE id = ?', [cv.id]);
  files.deleteDocumentIfUnused(cv);
  audit(req, 'cv.delete', { entityType: 'document', entityId: cv.id });
  res.json({ deleted: true });
});

/* --------------------------------------------------------------- Video */

const videoUpload = files.uploader('video', config.uploads.videoMaxMb, ['mp4', 'mov', 'webm', 'm4v']);

router.post('/profile/video', allow('student', 'recruiter'), limiters.upload, videoUpload, async (req, res) => {
  const u = req.user;
  if (!req.file) throw new HttpError(422, 'Choose a video file to upload.', { fields: { video: 'Choose an MP4, MOV or WebM video.' } });
  const info = await inspectVideo(req.file.path, req.file.size);
  if (!info.type) throw new HttpError(422, 'The file content is not a supported video.', { fields: { video: 'Upload an MP4, MOV or WebM video.' } });
  const max = config.uploads.videoMaxSeconds;
  const clientDuration = Number.parseFloat(req.body.durationSeconds);
  const checks = [
    { id: 'format', label: 'Video format', result: 'pass', detail: `${info.type.toUpperCase()} container confirmed from file contents.` },
    { id: 'size', label: 'File size', result: 'pass', detail: `${(req.file.size / 1048576).toFixed(1)} MB (limit ${config.uploads.videoMaxMb} MB).` },
  ];
  const measured = info.duration;
  const duration = measured ?? (Number.isFinite(clientDuration) && clientDuration > 0 ? clientDuration : null);
  if (duration != null && duration > max + 1) {
    throw new HttpError(422, `Video resumes must be ${max} seconds or shorter.`, { fields: { video: `This video is ${Math.round(duration)} seconds long; the limit is ${max} seconds.` } });
  }
  if (measured != null) checks.push({ id: 'duration', label: 'Length', result: measured < 15 ? 'warn' : 'pass', detail: `${Math.round(measured)} seconds measured from the file${measured < 15 ? ' — consider 60–90 seconds to introduce yourself properly.' : '.'}` });
  else if (duration != null) checks.push({ id: 'duration', label: 'Length', result: 'warn', detail: `${Math.round(duration)} seconds reported by your browser; a reviewer will confirm it.` });
  else checks.push({ id: 'duration', label: 'Length', result: 'warn', detail: 'Length could not be measured automatically; a reviewer will confirm it.' });
  checks.push({ id: 'moderation', label: 'Human review', result: 'warn', detail: 'Videos are checked by the HORIZON team before anyone else can see them.' });

  const hash = await files.hashFile(req.file.path);
  const previous = db().all("SELECT * FROM documents WHERE user_id = ? AND kind = 'video' AND is_current = 1", [u.id]);
  const report = { status: 'pending_review', checks, checkedAt: new Date().toISOString() };
  const doc = db().tx(() => {
    db().run("UPDATE documents SET is_current = 0 WHERE user_id = ? AND kind = 'video'", [u.id]);
    return files.storeDocument({ file: req.file, userId: u.id, kind: 'video', type: info.type, sha256: hash, reviewStatus: 'pending_review', report, meta: { durationSeconds: duration, measured: measured != null } });
  });
  previous.forEach((p) => files.deleteDocumentIfUnused(p));
  notifyAdmins({ type: 'document', title: 'Video awaiting moderation', body: `${u.full_name} (${u.role})`, link: '/admin/documents?kind=video' });
  audit(req, 'video.upload', { entityType: 'document', entityId: doc.id });
  res.status(201).json({ document: users.documentSummary(doc), report });
});

router.delete('/profile/video', allow('student', 'recruiter'), (req, res) => {
  const video = users.currentDocument(req.user.id, 'video');
  if (!video) throw notFound('Video');
  db().run('UPDATE documents SET is_current = 0 WHERE id = ?', [video.id]);
  files.deleteDocumentIfUnused(video);
  audit(req, 'video.delete', { entityType: 'document', entityId: video.id });
  res.json({ deleted: true });
});

/* ---------------------------------------------------- Private documents */

function canAccess(user, doc) {
  if (!user) return false;
  if (doc.user_id && doc.user_id === user.id) return true;
  if (user.status !== 'approved') return false;
  if (user.role === 'admin') return true;
  const owner = doc.user_id ? db().get('SELECT role, status, organisation_id FROM users WHERE id = ?', [doc.user_id]) : null;
  if (user.role === 'recruiter' && ['cv', 'video'].includes(doc.kind)) {
    const linked = db().get(`SELECT 1 FROM applications a JOIN opportunities o ON o.id = a.opportunity_id
      WHERE a.channel = 'horizon' AND (a.cv_document_id = ? OR a.video_document_id = ?) AND o.organisation_id = ?`, [doc.id, doc.id, user.organisation_id]);
    if (linked && (doc.kind === 'cv' || doc.review_status === 'approved')) return true;
    if (doc.kind === 'video' && doc.review_status === 'approved' && owner && owner.role === 'recruiter' && owner.organisation_id === user.organisation_id) return true;
  }
  if (user.role === 'student' && doc.kind === 'video' && doc.review_status === 'approved' && doc.is_current && owner && owner.role === 'recruiter' && owner.status === 'approved') return true;
  return false;
}

router.get('/documents/:id/file', requireAuth, (req, res, next) => {
  const docId = parse(id, req.params.id);
  const doc = db().get('SELECT * FROM documents WHERE id = ?', [docId]);
  if (!doc || !canAccess(req.user, doc)) throw notFound('Document');
  const disposition = req.query.download === '1' || !['application/pdf', 'video/mp4', 'video/webm', 'video/quicktime', 'image/png', 'image/jpeg'].includes(doc.mime_type) ? 'attachment' : 'inline';
  const ascii = doc.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.sendFile(files.absolutePath(doc), {
    headers: {
      'Content-Type': doc.mime_type,
      'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  }, (err) => { if (err && !res.headersSent) next(err.code === 'ENOENT' ? notFound('Document') : err); });
});

module.exports = router;
