'use strict';
/** Destinations, organisation profiles, student profiles (for recruiters) and notifications. */
const express = require('express');
const { getDb } = require('../db');
const { id, parse } = require('../lib/validation');
const { notFound, parseJsonArray, initials } = require('../lib/util');
const { allow, requireAuth } = require('../middleware/auth');
const opps = require('../services/opportunities');
const users = require('../services/users');

const router = express.Router();
const db = () => getDb();

function serializeDestination(r, extra = {}) {
  return {
    id: r.id, country: r.country, slug: r.slug, region: r.region, overview: r.overview,
    majorSectors: parseJsonArray(r.major_sectors), commonDurations: r.common_durations, workArrangements: r.work_arrangements,
    visaResources: parseJsonArray(r.visa_resources), officialLinks: parseJsonArray(r.official_links),
    relocationConsiderations: r.relocation_considerations, sourceUrl: r.source_url, lastUpdated: r.last_updated,
    isPublished: !!r.is_published, updatedAt: r.updated_at, ...extra,
  };
}

router.get('/destinations', allow('student', 'recruiter', 'admin'), (req, res) => {
  const rows = db().all(`SELECT dr.*, (SELECT COUNT(*) FROM opportunities o WHERE o.country = dr.country AND ${opps.OPEN_WHERE}) AS open_count
    FROM destination_resources dr WHERE dr.is_published = 1 ORDER BY open_count DESC, dr.country`);
  res.json({ items: rows.map((r) => serializeDestination(r, { openListings: r.open_count })) });
});

router.get('/destinations/:slug', allow('student', 'recruiter', 'admin'), (req, res) => {
  const slug = String(req.params.slug).slice(0, 80);
  const r = db().get('SELECT * FROM destination_resources WHERE slug = ? AND is_published = 1', [slug]);
  if (!r) throw notFound('Destination');
  const listings = opps.decorate(opps.listOpen({ extraWhere: 'AND o.country = ?', params: [r.country], limit: 6, orderBy: 'o.application_deadline ASC' }), req.user.role === 'student' ? req.user.id : null);
  res.json(serializeDestination(r, { listings, openListings: db().value(`SELECT COUNT(*) FROM opportunities o WHERE o.country = ? AND ${opps.OPEN_WHERE}`, [r.country]) }));
});

/** Public-inside-HORIZON organisation profile with verification status and response transparency. */
router.get('/organisations/:id', allow('student', 'recruiter', 'admin'), (req, res) => {
  const orgId = parse(id, req.params.id);
  const org = db().get('SELECT * FROM organisations WHERE id = ?', [orgId]);
  if (!org) throw notFound('Organisation');
  if (req.user.role === 'recruiter' && org.id !== req.user.organisation_id && org.verification_status !== 'verified') throw notFound('Organisation');
  const recruiters = db().all(`SELECT u.id, u.full_name, rp.designation, rp.bio, rp.linkedin_url,
      (SELECT d.id FROM documents d WHERE d.user_id = u.id AND d.kind = 'video' AND d.is_current = 1 AND d.review_status = 'approved' ORDER BY d.id DESC LIMIT 1) AS video_id
    FROM users u JOIN recruiter_profiles rp ON rp.user_id = u.id WHERE u.organisation_id = ? AND u.role = 'recruiter' AND u.status = 'approved' ORDER BY u.full_name`, [org.id]);
  const listings = opps.decorate(opps.listOpen({ extraWhere: 'AND o.organisation_id = ?', params: [org.id], limit: 12, orderBy: 'o.application_deadline ASC' }), req.user.role === 'student' ? req.user.id : null);
  res.json({
    id: org.id, name: org.name, initials: initials(org.name), type: org.org_type, website: org.website, country: org.country, headquarters: org.headquarters,
    description: org.description, linkedinUrl: org.linkedin_url, verified: org.verification_status === 'verified', verificationStatus: org.verification_status,
    verifiedAt: org.verified_at, isDemo: !!org.is_demo, emailDomain: org.email_domain,
    recruiters: recruiters.map((r) => ({ id: r.id, name: r.full_name, initials: initials(r.full_name), designation: r.designation, bio: r.bio, linkedinUrl: r.linkedin_url, videoUrl: r.video_id ? `/api/documents/${r.video_id}/file` : null })),
    listings,
    responseStats: opps.responseStats(org.id),
  });
});

/** Student profile, visible to the student, admins, and recruiters whose organisation received a HORIZON application from them. */
router.get('/students/:id', allow('recruiter', 'admin', 'student'), (req, res) => {
  const studentId = parse(id, req.params.id);
  if (req.user.role === 'student' && req.user.id !== studentId) throw notFound('Student');
  if (req.user.role === 'recruiter') {
    const linked = db().get(`SELECT 1 FROM applications a JOIN opportunities o ON o.id = a.opportunity_id
      WHERE a.user_id = ? AND a.channel = 'horizon' AND o.organisation_id = ?`, [studentId, req.user.organisation_id]);
    if (!linked) throw notFound('Student');
  }
  const { USER_SQL } = require('../middleware/auth');
  const s = db().get(USER_SQL, [studentId]);
  if (!s || s.role !== 'student') throw notFound('Student');
  const profile = users.studentProfileRow(s.id);
  const cv = users.currentDocument(s.id, 'cv');
  const video = users.currentDocument(s.id, 'video');
  res.json({
    id: s.id, fullName: s.full_name, initials: initials(s.full_name), institution: { id: s.institution_id, name: s.institution_name, shortName: s.institution_short },
    verified: s.status === 'approved', verificationMethod: s.verification_method, profile,
    cvStatus: cv ? cv.review_status : null, hasApprovedVideo: !!video && video.review_status === 'approved',
    email: req.user.role === 'admin' ? s.email : undefined,
  });
});

/* -------------------------------------------------------- Notifications */

router.get('/notifications', requireAuth, (req, res) => {
  const items = db().all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40', [req.user.id]);
  res.json({
    unread: db().value('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user.id]),
    items: items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: !!n.read_at, createdAt: n.created_at })),
  });
});

router.post('/notifications/read-all', requireAuth, (req, res) => {
  db().run("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", [req.user.id]);
  res.json({ ok: true });
});

router.post('/notifications/:id/read', requireAuth, (req, res) => {
  const nid = parse(id, req.params.id);
  db().run("UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ? AND user_id = ?", [nid, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
