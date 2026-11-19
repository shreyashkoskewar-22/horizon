'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.setup);
after(h.teardown);

const ADMIN_ENDPOINTS = [
  ['get', '/api/admin/dashboard'], ['get', '/api/admin/students'], ['get', '/api/admin/recruiters'], ['get', '/api/admin/verifications'],
  ['get', '/api/admin/institutions'], ['get', '/api/admin/organisations'], ['get', '/api/admin/opportunities'], ['get', '/api/admin/documents'],
  ['get', '/api/admin/destinations'], ['get', '/api/admin/grievances'], ['get', '/api/admin/reports'], ['get', '/api/admin/audit'],
  ['post', '/api/admin/institutions'], ['put', '/api/admin/users/1/status'], ['put', '/api/admin/verifications/1'], ['post', '/api/admin/opportunities/archive-expired'],
  ['delete', '/api/admin/destinations/1'], ['put', '/api/admin/grievances/1'],
];

describe('administrator access control', () => {
  test('anonymous users get 401 on every admin endpoint', async () => {
    const c = h.client();
    for (const [method, url] of ADMIN_ENDPOINTS) {
      const res = method === 'get' ? await c.get(url) : await c[method === 'delete' ? 'del' : method](url, {});
      assert.equal(res.status, 401, `${method} ${url}`);
    }
  });

  test('students and recruiters get 403 even when calling admin URLs directly', async () => {
    for (const who of ['riya', 'mei']) {
      const c = await h.as(who);
      for (const [method, url] of ADMIN_ENDPOINTS) {
        const res = method === 'get' ? await c.get(url) : await c[method === 'delete' ? 'del' : method](url, { status: 'approved', decision: 'approve' });
        assert.equal(res.status, 403, `${who} ${method} ${url}`);
      }
    }
    assert.equal(h.db().value("SELECT status FROM users WHERE id = 1"), 'approved');
  });

  test('admins are not shown student or recruiter workspaces', async () => {
    const admin = await h.as('admin');
    assert.equal((await admin.get('/app')).headers.location, '/admin');
    assert.equal((await admin.get('/admin')).status, 200);
  });
});

describe('verification queue', () => {
  test('approves a pending student after document review', async () => {
    const admin = await h.as('admin');
    const list = await admin.get('/api/admin/verifications', { type: 'student' });
    const kabir = list.body.items.find((v) => v.user.email === 'kabir.pending@example.org');
    assert.ok(kabir, 'pending request listed');
    assert.ok(kabir.autoChecks.length >= 3);
    assert.ok(kabir.document.url.startsWith('/api/documents/'));
    const doc = await admin.get(kabir.document.url);
    assert.equal(doc.status, 200);

    const res = await admin.put(`/api/admin/verifications/${kabir.id}`, { decision: 'approve', internalNote: 'ID card matches name and AIIMS enrolment.' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const again = await admin.put(`/api/admin/verifications/${kabir.id}`, { decision: 'approve' });
    assert.equal(again.status, 409);
    const student = await h.as('kabir');
    assert.equal((await student.get('/api/opportunities')).status, 200);
    assert.ok((await student.get('/api/notifications')).body.items.some((n) => /verified/i.test(n.title)));
  });

  test('a recruiter can only be approved together with a verified organisation', async () => {
    const admin = await h.as('admin');
    const daniel = (await admin.get('/api/admin/verifications', { type: 'recruiter' })).body.items.find((v) => v.user.email === 'daniel@harbourline.example');
    const blocked = await admin.put(`/api/admin/verifications/${daniel.id}`, { decision: 'approve' });
    assert.equal(blocked.status, 422);
    assert.ok(blocked.body.error.fields.verifyOrganisation);
    const rejectNoMsg = await admin.put(`/api/admin/verifications/${daniel.id}`, { decision: 'reject' });
    assert.equal(rejectNoMsg.status, 422);
    const ok = await admin.put(`/api/admin/verifications/${daniel.id}`, { decision: 'approve', verifyOrganisation: true, registrationNumber: 'DEMO-REG-001' });
    assert.equal(ok.status, 200);
    assert.equal(h.db().value("SELECT verification_status FROM organisations WHERE name = 'Harbourline Signal Analytics'"), 'verified');
    const recruiter = await h.as('daniel');
    assert.equal((await recruiter.get('/api/recruiter/dashboard')).status, 200);
  });

  test('rejection reaches the user with a reason', async () => {
    const reg = h.client();
    await reg.post('/api/auth/register', h.studentPayload({ email: 'nisha.test@example.org', fullName: 'Nisha Rao', institutionId: h.institutionId('All India Institute of Medical Sciences, New Delhi'), programme: 'MBBS' }));
    await reg.post('/api/auth/verify-email', { code: await h.latestCode(reg) });
    await reg.upload('/api/auth/verification-proof', 'document', h.cvPdf({ name: 'Nisha Rao', institution: 'AIIMS', graduationYear: h.YEAR + 2 }), 'id.pdf');
    const admin = await h.as('admin');
    const req = (await admin.get('/api/admin/verifications')).body.items.find((v) => v.user.email === 'nisha.test@example.org');
    const res = await admin.put(`/api/admin/verifications/${req.id}`, { decision: 'reject', userMessage: 'The ID image is cropped; upload a photo showing your name and validity date.' });
    assert.equal(res.status, 200);
    const me = await reg.get('/api/auth/me');
    assert.equal(me.body.user.status, 'rejected');
    assert.match(me.body.verification.statusReason || me.body.user.statusReason, /cropped/);
  });
});

describe('student and recruiter management', () => {
  test('lists, searches and filters students', async () => {
    const admin = await h.as('admin');
    const all = await admin.get('/api/admin/students');
    assert.ok(all.body.total >= 4);
    const search = await admin.get('/api/admin/students', { search: 'riya' });
    assert.equal(search.body.items.length, 1);
    assert.equal(search.body.items[0].institutionShort, 'IIM Indore');
    const approved = await admin.get('/api/admin/students', { status: 'approved' });
    assert.ok(approved.body.items.every((u) => u.status === 'approved'));
    const detail = await admin.get(`/api/admin/users/${search.body.items[0].id}`);
    assert.equal(detail.status, 200);
    assert.ok(detail.body.documents.some((d) => d.kind === 'cv'));
    assert.equal((await admin.get('/api/admin/users/1')).status, 404, 'admin accounts are not managed here');
  });

  test('cannot approve someone whose email is unverified', async () => {
    const reg = h.client();
    await reg.post('/api/auth/register', h.studentPayload({ email: 'unverified.test@iitb.ac.in', fullName: 'Kiran Das' }));
    const u = h.db().get("SELECT id FROM users WHERE email = 'unverified.test@iitb.ac.in'");
    const admin = await h.as('admin');
    const res = await admin.put(`/api/admin/users/${u.id}/status`, { status: 'approved' });
    assert.equal(res.status, 409);
  });
});

describe('institution management', () => {
  test('creates, updates, filters and deactivates institutions', async () => {
    const admin = await h.as('admin');
    const base = {
      name: 'Test Institute of National Importance', shortName: 'TINI', category: 'Other INI', city: 'Pune', state: 'Maharashtra',
      officialWebsite: 'https://tini.example', recognitionReference: 'Test Act, 2026', verificationStatus: 'unverified', isActive: true,
      domains: [{ domain: 'tini.example', isVerified: false }],
    };
    const noSource = await admin.post('/api/admin/institutions', { ...base, verificationStatus: 'verified' });
    assert.equal(noSource.status, 422);
    assert.ok(noSource.body.error.fields.recognitionSourceUrl, 'verified status needs an official source');
    const created = await admin.post('/api/admin/institutions', base);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const dupName = await admin.post('/api/admin/institutions', base);
    assert.equal(dupName.status, 409);
    const clash = await admin.post('/api/admin/institutions', { ...base, name: 'Another Test Institute', domains: [{ domain: 'iitb.ac.in', isVerified: true }] });
    assert.equal(clash.status, 409, 'a domain can only belong to one institution');

    const updated = await admin.put(`/api/admin/institutions/${created.body.id}`, { ...base, verificationStatus: 'verified', recognitionSourceUrl: 'https://www.education.gov.in/en/node/198', domains: [{ domain: 'tini.example', isVerified: true }] });
    assert.equal(updated.status, 200);
    const found = (await admin.get('/api/admin/institutions', { search: 'TINI' })).body.items[0];
    assert.equal(found.verificationStatus, 'verified');
    assert.deepEqual(found.domains.map((d) => [d.domain, d.isVerified]), [['tini.example', true]]);
    assert.ok((await h.client().get('/api/public/institutions')).body.items.some((i) => i.id === created.body.id), 'now available for registration');

    assert.equal((await admin.del(`/api/admin/institutions/${created.body.id}`)).status, 200);
    assert.ok(!(await h.client().get('/api/public/institutions')).body.items.some((i) => i.id === created.body.id), 'deactivated institutions are hidden');
    const reg = await h.client().post('/api/auth/register', h.studentPayload({ email: 'someone@tini.example', institutionId: created.body.id }));
    assert.equal(reg.status, 422);
    const inactive = await admin.get('/api/admin/institutions', { status: 'inactive' });
    assert.ok(inactive.body.items.some((i) => i.id === created.body.id));
  });
});

describe('internship management', () => {
  test('admin creates, edits, features, archives and deletes listings', async () => {
    const admin = await h.as('admin');
    const org = h.db().get("SELECT id FROM organisations WHERE name = 'Northbank Ridge Capital'");
    const noOrg = await admin.post('/api/opportunities', h.listingPayload());
    assert.equal(noOrg.status, 422);
    const created = await admin.post('/api/opportunities', h.listingPayload({ organisationId: org.id, sourceName: 'Company careers page', sourceUrl: 'https://example.com/careers' }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'published');
    assert.equal(created.body.lastVerifiedAt, h.today());

    const edited = await admin.put(`/api/opportunities/${created.body.id}`, h.listingPayload({ organisationId: org.id, title: 'Data Strategy Intern (Updated)' }));
    assert.equal(edited.status, 200);
    assert.equal(edited.body.title, 'Data Strategy Intern (Updated)');
    const flags = await admin.patch(`/api/admin/opportunities/${created.body.id}/flags`, { isFeatured: true, isVerified: true });
    assert.equal(flags.status, 200);
    const riya = await h.as('riya');
    assert.ok((await riya.get('/api/opportunities', { featured: 'true', pageSize: 48 })).body.items.some((o) => o.id === created.body.id));

    const archived = await admin.patch(`/api/admin/opportunities/${created.body.id}/flags`, { status: 'archived' });
    assert.equal(archived.status, 200);
    assert.equal((await riya.get(`/api/opportunities/${created.body.id}`)).status, 404);
    const deleted = await admin.del(`/api/opportunities/${created.body.id}`);
    assert.equal(deleted.body.deleted, true);
    assert.equal(h.db().value('SELECT COUNT(*) FROM opportunities WHERE id = ?', [created.body.id]), 0);
  });

  test('listings with applications are archived instead of deleted', async () => {
    const admin = await h.as('admin');
    const withApps = h.db().get("SELECT o.id FROM opportunities o WHERE EXISTS (SELECT 1 FROM applications a WHERE a.opportunity_id = o.id) LIMIT 1");
    const res = await admin.del(`/api/opportunities/${withApps.id}`);
    assert.equal(res.body.deleted, false);
    assert.equal(res.body.archived, true);
    assert.equal(h.db().value('SELECT status FROM opportunities WHERE id = ?', [withApps.id]), 'archived');
  });

  test('reviews recruiter submissions: send back with a note, then publish', async () => {
    const mei = await h.as('mei');
    const sub = await mei.post('/api/opportunities', h.listingPayload({ title: 'Pricing Analytics Intern' }));
    const admin = await h.as('admin');
    const queue = await admin.get('/api/admin/opportunities', { status: 'pending_review' });
    assert.ok(queue.body.items.some((o) => o.id === sub.body.id));
    assert.equal((await admin.put(`/api/admin/opportunities/${sub.body.id}/review`, { decision: 'reject' })).status, 422);
    const back = await admin.put(`/api/admin/opportunities/${sub.body.id}/review`, { decision: 'reject', note: 'Please add the stipend frequency and the team size.' });
    assert.equal(back.status, 200);
    const mine = (await mei.get('/api/recruiter/opportunities', { status: 'rejected' })).body.items.find((o) => o.id === sub.body.id);
    assert.match(mine.reviewNote, /stipend/);
    assert.equal((await admin.put(`/api/admin/opportunities/${sub.body.id}/review`, { decision: 'publish' })).status, 200);
    assert.equal((await (await h.as('riya')).get(`/api/opportunities/${sub.body.id}`)).status, 200);
  });

  test('archives expired listings', async () => {
    const id = h.db().value("SELECT id FROM opportunities WHERE status = 'published' ORDER BY id DESC LIMIT 1");
    h.db().run("UPDATE opportunities SET application_deadline = date('now', '-2 days') WHERE id = ?", [id]);
    const admin = await h.as('admin');
    const expired = await admin.get('/api/admin/opportunities', { status: 'expired' });
    assert.ok(expired.body.items.some((o) => o.id === id));
    const res = await admin.post('/api/admin/opportunities/archive-expired');
    assert.ok(res.body.archived >= 1);
    assert.equal(h.db().value('SELECT status FROM opportunities WHERE id = ?', [id]), 'archived');
    const republish = await admin.patch(`/api/admin/opportunities/${id}/flags`, { status: 'published' });
    assert.equal(republish.status, 409, 'expired listings need a new deadline first');
  });
});

describe('organisations, documents, destinations, reports and audit', () => {
  test('organisation CRUD and verification', async () => {
    const admin = await h.as('admin');
    const created = await admin.post('/api/admin/organisations', { name: 'Fjord Climate Lab', orgType: 'Research institution', website: 'https://fjord.example', emailDomain: 'fjord.example', country: 'Norway', verificationStatus: 'unverified' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const bad = await admin.post('/api/admin/organisations', { name: 'X Org', orgType: 'Not a type', country: 'Norway', verificationStatus: 'unverified' });
    assert.equal(bad.status, 422);
    const upd = await admin.put(`/api/admin/organisations/${created.body.id}`, { name: 'Fjord Climate Lab', orgType: 'Research institution', website: 'https://fjord.example', emailDomain: 'fjord.example', country: 'Norway', verificationStatus: 'verified' });
    assert.equal(upd.status, 200);
    const found = (await admin.get('/api/admin/organisations', { search: 'Fjord' })).body.items[0];
    assert.equal(found.verificationStatus, 'verified');
    assert.ok(found.verifiedAt);
  });

  test('document moderation: approve a video so it becomes visible', async () => {
    const mei = await h.as('mei');
    const fs = require('node:fs');
    const video = fs.readFileSync(require('node:path').join(__dirname, '..', 'server', 'db', 'seed-assets', 'demo-recruiter-video.mp4'));
    const up = await mei.upload('/api/profile/video', 'video', video, 'intro.mp4', { durationSeconds: 8 });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.document.status, 'pending_review');
    const riya = await h.as('riya');
    assert.equal((await riya.get(up.body.document.url)).status, 404, 'hidden until moderated');
    const admin = await h.as('admin');
    const queue = await admin.get('/api/admin/documents', { kind: 'video' });
    assert.ok(queue.body.items.some((d) => d.id === up.body.document.id));
    assert.equal((await admin.put(`/api/admin/documents/${up.body.document.id}/review`, { decision: 'rejected' })).status, 422, 'rejection needs a note');
    assert.equal((await admin.put(`/api/admin/documents/${up.body.document.id}/review`, { decision: 'verified' })).status, 422, 'CV decisions do not apply to videos');
    assert.equal((await admin.put(`/api/admin/documents/${up.body.document.id}/review`, { decision: 'approved' })).status, 200);
    assert.equal((await riya.get(up.body.document.url)).status, 200);
  });

  test('destination guides require an official source and a date', async () => {
    const admin = await h.as('admin');
    const base = { country: 'Ireland', region: 'Europe', overview: 'Dublin hosts European headquarters for many technology and finance firms that run summer programmes.', majorSectors: ['Technology', 'Finance'], visaResources: [{ label: 'Irish Immigration Service', url: 'https://www.irishimmigration.ie/' }], lastUpdated: h.today(), isPublished: true };
    const noSource = await admin.post('/api/admin/destinations', base);
    assert.equal(noSource.status, 422);
    assert.ok(noSource.body.error.fields.sourceUrl);
    const badLink = await admin.post('/api/admin/destinations', { ...base, sourceUrl: 'https://www.irishimmigration.ie/', visaResources: [{ label: 'Bad', url: 'javascript:alert(1)' }] });
    assert.equal(badLink.status, 422);
    const created = await admin.post('/api/admin/destinations', { ...base, sourceUrl: 'https://www.irishimmigration.ie/' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const riya = await h.as('riya');
    const guide = await riya.get('/api/destinations/ireland');
    assert.equal(guide.status, 200);
    assert.equal(guide.body.sourceUrl, 'https://www.irishimmigration.ie/');
    assert.equal(guide.body.lastUpdated, h.today());
    assert.equal((await admin.del(`/api/admin/destinations/${created.body.id}`)).status, 200);
    assert.equal((await riya.get('/api/destinations/ireland')).status, 404);
  });

  test('reports flag demo data and the audit log records admin actions', async () => {
    const admin = await h.as('admin');
    const reports = await admin.get('/api/admin/reports');
    assert.equal(reports.status, 200);
    assert.equal(reports.body.containsDemoData, true);
    assert.ok(reports.body.students.total >= 4);
    const audit = await admin.get('/api/admin/audit', { action: 'verification' });
    assert.ok(audit.body.items.some((e) => e.action === 'verification.approve'));
    const logins = await admin.get('/api/admin/audit', { action: 'auth.login' });
    assert.ok(logins.body.total > 0);
  });
});
