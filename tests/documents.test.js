'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');
const { validateResume } = require('../server/services/resume-validator');
const { makePdf } = require('../server/lib/simple-pdf');

before(h.setup);
after(h.teardown);

const RIYA = { fullName: 'Riya Kapoor', institution: { name: 'Indian Institute of Management Indore', short_name: 'IIM Indore' }, graduationYear: 2029 };
const riyaCv = (extra = {}) => h.cvPdf({ name: 'Riya Kapoor', email: 'riya.demo@iimidr.ac.in', institution: 'Indian Institute of Management Indore', programme: 'Integrated Programme in Management', graduationYear: 2029, ...extra });
const status = (report, id) => report.checks.find((c) => c.id === id).result;

describe('resume validation pipeline (unit)', () => {
  test('a clean, matching CV passes automatically', async () => {
    const r = await validateResume(riyaCv(), RIYA);
    assert.equal(r.status, 'auto_verified', JSON.stringify(r.checks.filter((c) => c.result !== 'pass')));
    for (const id of ['signature', 'active_content', 'encryption', 'parse', 'length', 'text_layer', 'name_match', 'institution_match']) assert.equal(status(r, id), 'pass', id);
  });

  test('a non-PDF file is rejected', async () => {
    const r = await validateResume(Buffer.from('<html>not a pdf</html>'), RIYA);
    assert.equal(r.status, 'rejected');
    assert.equal(status(r, 'signature'), 'fail');
  });

  test('a PDF with embedded JavaScript is rejected', async () => {
    const pdf = makePdf([['Riya Kapoor', 'Indian Institute of Management Indore', 'x'.repeat(400)]]).toString('latin1')
      .replace('/Type /Catalog', '/Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>');
    const r = await validateResume(Buffer.from(pdf, 'latin1'), RIYA);
    assert.equal(r.status, 'rejected');
    assert.equal(status(r, 'active_content'), 'fail');
  });

  test('a CV longer than four pages is rejected', async () => {
    const r = await validateResume(riyaCv({ pages: 6 }), RIYA);
    assert.equal(r.status, 'rejected');
    assert.equal(status(r, 'length'), 'fail');
  });

  test('a scanned or empty CV (no text layer) is rejected', async () => {
    const r = await validateResume(makePdf([['CV']]), RIYA);
    assert.equal(r.status, 'rejected');
    assert.equal(status(r, 'text_layer'), 'fail');
  });

  test('a CV with someone else’s name is flagged for manual review', async () => {
    const r = await validateResume(h.cvPdf({ name: 'Somebody Else', institution: 'Indian Institute of Management Indore', graduationYear: 2029 }), RIYA);
    assert.equal(r.status, 'flagged');
    assert.equal(status(r, 'name_match'), 'fail');
  });

  test('a CV that does not mention the verified institution is flagged', async () => {
    const r = await validateResume(h.cvPdf({ name: 'Riya Kapoor', institution: 'Some Other College', graduationYear: 2029 }), RIYA);
    assert.equal(r.status, 'flagged');
    assert.equal(status(r, 'institution_match'), 'fail');
  });

  test('a file already linked to another account is flagged', async () => {
    const r = await validateResume(riyaCv(), { ...RIYA, duplicateOwner: true });
    assert.equal(r.status, 'flagged');
    assert.equal(status(r, 'duplicate'), 'fail');
  });
});

describe('CV upload API', () => {
  test('accepts a valid CV and stores it privately', async () => {
    const c = await h.as('riya');
    const res = await c.upload('/api/profile/cv', 'cv', riyaCv({ extraLines: ['Updated November 2026'] }), 'Riya_CV.pdf');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.report.status, 'auto_verified');
    assert.equal(res.body.document.status, 'auto_verified');
    const file = await c.get(res.body.document.url);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'application/pdf');
    const profile = await c.get('/api/profile');
    assert.equal(profile.body.cv.id, res.body.document.id);
  });

  test('rejects an invalid CV, explains why and keeps the previous one', async () => {
    const c = await h.as('riya');
    const before = (await c.get('/api/profile')).body.cv;
    const res = await c.upload('/api/profile/cv', 'cv', Buffer.from('MZ fake executable renamed to pdf'), 'cv.pdf');
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'CV_REJECTED');
    assert.ok(res.body.report.checks.some((ch) => ch.result === 'fail'));
    assert.equal((await c.get('/api/profile')).body.cv.id, before.id);
  });

  test('rejects wrong extensions before reading the file', async () => {
    const c = await h.as('riya');
    const res = await c.upload('/api/profile/cv', 'cv', riyaCv(), 'cv.docx');
    assert.equal(res.status, 422);
  });

  test('a flagged CV blocks HORIZON applications until reviewed, and admins can verify it', async () => {
    const c = await h.as('sara');
    const res = await c.upload('/api/profile/cv', 'cv', h.cvPdf({ name: 'Different Person', institution: 'National Institute of Technology, Tiruchirappalli', graduationYear: h.YEAR + 1 }), 'cv.pdf');
    assert.equal(res.status, 201);
    assert.equal(res.body.report.status, 'flagged');
    const opp = h.db().get("SELECT o.id FROM opportunities o JOIN organisations g ON g.id = o.organisation_id WHERE o.status = 'published' AND o.application_mode = 'horizon' AND g.verification_status = 'verified' AND o.application_deadline >= date('now') AND o.id NOT IN (SELECT opportunity_id FROM applications WHERE user_id = (SELECT id FROM users WHERE email = 'sara.demo@nitt.edu')) LIMIT 1");
    const apply = await c.post(`/api/opportunities/${opp.id}/apply`, { consent: true });
    assert.equal(apply.body.error.code, 'CV_REQUIRED');

    const admin = await h.as('admin');
    const queue = await admin.get('/api/admin/documents', { kind: 'cv' });
    const item = queue.body.items.find((d) => d.id === res.body.document.id);
    assert.ok(item, 'flagged CV is in the review queue');
    assert.equal((await admin.put(`/api/admin/documents/${item.id}/review`, { decision: 'changes_requested' })).status, 422);
    assert.equal((await admin.put(`/api/admin/documents/${item.id}/review`, { decision: 'verified', note: 'Name differs because of a recent legal name change; confirmed with ID.' })).status, 200);
    assert.equal((await c.post(`/api/opportunities/${opp.id}/apply`, { consent: true })).status, 201);
  });

  test('students can request manual verification of an automatically checked CV', async () => {
    const c = await h.as('riya');
    const res = await c.post('/api/profile/cv/request-review');
    assert.equal(res.status, 200);
    assert.equal(res.body.document.manualReviewRequested, true);
  });

  test('other students and anonymous visitors cannot fetch a CV', async () => {
    const riya = await h.as('riya');
    const url = (await riya.get('/api/profile')).body.cv.url;
    assert.equal((await (await h.as('arjun')).get(url)).status, 404);
    assert.equal((await h.client().get(url)).status, 401);
  });
});

/** Minimal MP4 header whose movie header declares the given duration. */
function fakeMp4(seconds) {
  const ftyp = Buffer.alloc(24); ftyp.writeUInt32BE(24, 0); ftyp.write('ftypisom', 4, 'latin1'); ftyp.writeUInt32BE(512, 12); ftyp.write('isomiso2', 16, 'latin1');
  const mvhd = Buffer.alloc(108); mvhd.writeUInt32BE(108, 0); mvhd.write('mvhd', 4, 'latin1');
  mvhd.writeUInt32BE(1000, 20); mvhd.writeUInt32BE(seconds * 1000, 24);
  const moov = Buffer.alloc(8); moov.writeUInt32BE(8 + mvhd.length, 0); moov.write('moov', 4, 'latin1');
  return Buffer.concat([ftyp, moov, mvhd]);
}

describe('video resumes', () => {
  const video = () => fs.readFileSync(path.join(__dirname, '..', 'server', 'db', 'seed-assets', 'demo-student-video.mp4'));

  test('accepts a short MP4 and holds it for moderation', async () => {
    const c = await h.as('arjun');
    const res = await c.upload('/api/profile/video', 'video', video(), 'intro.mp4', { durationSeconds: 8 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.document.status, 'pending_review');
    assert.equal((await c.get('/api/profile')).body.video.id, res.body.document.id);
  });

  test('rejects files that are not real videos', async () => {
    const c = await h.as('arjun');
    const res = await c.upload('/api/profile/video', 'video', Buffer.from('definitely not a video file at all'), 'clip.mp4');
    assert.equal(res.status, 422);
  });

  test('rejects videos longer than the limit, measured from the file itself', async () => {
    const c = await h.as('arjun');
    const res = await c.upload('/api/profile/video', 'video', fakeMp4(600), 'long.mp4', { durationSeconds: 30 });
    assert.equal(res.status, 422, 'the browser-reported duration cannot override the measured one');
    assert.match(res.body.error.fields.video, /600 seconds/);
  });

  test('a video can be attached to an application only after approval', async () => {
    const c = await h.as('arjun');
    const opp = h.db().get("SELECT o.id FROM opportunities o JOIN organisations g ON g.id = o.organisation_id WHERE o.status = 'published' AND o.application_mode = 'horizon' AND g.verification_status = 'verified' AND o.application_deadline >= date('now') AND o.id NOT IN (SELECT opportunity_id FROM applications WHERE user_id = (SELECT id FROM users WHERE email = 'arjun.demo@iitb.ac.in')) LIMIT 1");
    const res = await c.post(`/api/opportunities/${opp.id}/apply`, { consent: true, includeVideo: true });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'VIDEO_NOT_READY');
  });
});
