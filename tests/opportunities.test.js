'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.setup);
after(h.teardown);

const openCount = () => h.db().value("SELECT COUNT(*) FROM opportunities WHERE status = 'published' AND application_deadline >= date('now')");

describe('search, filters and sorting run on the server', () => {
  test('lists only published, open listings with pagination', async () => {
    const c = await h.as('riya');
    const res = await c.get('/api/opportunities');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, openCount());
    assert.ok(res.body.items.length <= 9);
    const all = await c.get('/api/opportunities', { pageSize: 48 });
    assert.equal(all.body.items.length, openCount());
    assert.ok(all.body.items.every((o) => o.status === 'published' && o.deadline >= h.today()));
    assert.ok(all.body.items.every((o) => o.isDemo === true), 'seeded listings are labelled as demo data');
    const page2 = await c.get('/api/opportunities', { page: 2, pageSize: 5 });
    assert.equal(page2.body.page, 2);
    assert.notEqual(page2.body.items[0].id, (await c.get('/api/opportunities', { page: 1, pageSize: 5 })).body.items[0].id);
  });

  test('keyword search across title, organisation and skills', async () => {
    const c = await h.as('riya');
    const res = await c.get('/api/opportunities', { q: 'robotics' });
    assert.ok(res.body.items.length >= 1);
    assert.ok(res.body.items.every((o) => /robot/i.test(`${o.title} ${o.organisation.name} ${o.summary} ${o.skills.join(' ')}`)));
    const none = await c.get('/api/opportunities', { q: 'zzzz-no-such-thing' });
    assert.equal(none.body.total, 0);
  });

  test('filters by country, payment, work mode and visa sponsorship', async () => {
    const c = await h.as('riya');
    const sg = await c.get('/api/opportunities', { country: 'Singapore', pageSize: 48 });
    assert.ok(sg.body.items.length > 0 && sg.body.items.every((o) => o.country === 'Singapore'));
    const unpaid = await c.get('/api/opportunities', { paid: 'unpaid', pageSize: 48 });
    assert.ok(unpaid.body.items.every((o) => o.isPaid === false));
    const remote = await c.get('/api/opportunities', { workMode: 'remote', pageSize: 48 });
    assert.ok(remote.body.items.every((o) => o.workMode === 'remote'));
    const visa = await c.get('/api/opportunities', { visa: 'yes', pageSize: 48 });
    assert.ok(visa.body.items.every((o) => o.visaSponsorship === 'yes'));
    const multi = await c.get('/api/opportunities', { country: 'Singapore,Germany', pageSize: 48 });
    assert.ok(multi.body.items.every((o) => ['Singapore', 'Germany'].includes(o.country)));
  });

  test('sorts by deadline and by indicative compensation', async () => {
    const c = await h.as('riya');
    const byDeadline = (await c.get('/api/opportunities', { sort: 'deadline', pageSize: 48 })).body.items.map((o) => o.deadline);
    assert.deepEqual(byDeadline, [...byDeadline].sort());
    const byPay = (await c.get('/api/opportunities', { sort: 'compensation', pageSize: 48 })).body.items.map((o) => (o.stipend ? o.stipend.usdMonthly : 0));
    for (let i = 1; i < byPay.length; i += 1) assert.ok(byPay[i - 1] >= byPay[i], 'descending by USD-equivalent stipend');
  });

  test('rejects invalid filter combinations', async () => {
    const c = await h.as('riya');
    const res = await c.get('/api/opportunities', { minComp: 5000, maxComp: 100 });
    assert.equal(res.status, 422);
    assert.ok(res.body.error.fields.maxComp);
  });

  test('students cannot open listings that are not published', async () => {
    const c = await h.as('riya');
    const pending = h.db().get("SELECT id FROM opportunities WHERE status = 'pending_review' LIMIT 1");
    assert.equal((await c.get(`/api/opportunities/${pending.id}`)).status, 404);
  });
});

describe('saved opportunities', () => {
  test('save, list and unsave', async () => {
    const c = await h.as('sara');
    const opp = (await c.get('/api/opportunities', { pageSize: 1 })).body.items[0];
    const first = await c.post(`/api/saved/${opp.id}`);
    assert.equal(first.status, 201);
    const again = await c.post(`/api/saved/${opp.id}`);
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false);
    assert.ok((await c.get('/api/saved')).body.items.some((o) => o.id === opp.id));
    assert.equal((await c.get(`/api/opportunities/${opp.id}`)).body.saved, true);
    assert.equal((await c.del(`/api/saved/${opp.id}`)).status, 200);
    assert.equal((await c.del(`/api/saved/${opp.id}`)).status, 404);
    assert.ok(!(await c.get('/api/saved')).body.items.some((o) => o.id === opp.id));
  });
});

describe('application tracker', () => {
  test('create, update stage and dates, view history, delete', async () => {
    const c = await h.as('sara');
    const tracked = new Set((await c.get('/api/applications')).body.items.map((a) => a.opportunityId));
    const opp = (await c.get('/api/opportunities', { mode: 'external', pageSize: 48 })).body.items.find((o) => !tracked.has(o.id));
    const created = await c.post('/api/applications', { opportunityId: opp.id, stage: 'interested', notes: 'Ask a senior about the team.' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.channel, 'external');
    const dup = await c.post('/api/applications', { opportunityId: opp.id });
    assert.equal(dup.status, 409);

    const moved = await c.put(`/api/applications/${created.body.id}`, { stage: 'applied', nextAction: 'Follow up in two weeks' });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.stage, 'applied');
    assert.equal(moved.body.appliedOn, h.today(), 'applied date set automatically');
    const interview = await c.put(`/api/applications/${created.body.id}`, { stage: 'interview', interviewAt: new Date(Date.now() + 3 * 86400000).toISOString() });
    assert.equal(interview.body.stage, 'interview');
    assert.ok(interview.body.interviewAt);

    const bad = await c.put(`/api/applications/${created.body.id}`, { stage: 'hired' });
    assert.equal(bad.status, 422);

    const detail = await c.get(`/api/applications/${created.body.id}`);
    assert.ok(detail.body.events.length >= 3);
    assert.equal((await c.del(`/api/applications/${created.body.id}`)).status, 200);
    assert.equal((await c.get(`/api/applications/${created.body.id}`)).status, 404);
  });

  test('students cannot read or change another student’s application', async () => {
    const riyaApp = h.db().get("SELECT a.id FROM applications a JOIN users u ON u.id = a.user_id WHERE u.email = 'riya.demo@iimidr.ac.in' LIMIT 1");
    const c = await h.as('sara');
    assert.equal((await c.get(`/api/applications/${riyaApp.id}`)).status, 404);
    assert.equal((await c.put(`/api/applications/${riyaApp.id}`, { notes: 'x' })).status, 404);
    assert.equal((await c.del(`/api/applications/${riyaApp.id}`)).status, 404);
  });
});

describe('applying on HORIZON with a validated CV', () => {
  const horizonListing = (email) => h.db().get(`SELECT o.id, o.organisation_id FROM opportunities o JOIN organisations g ON g.id = o.organisation_id
    WHERE o.status = 'published' AND o.application_mode = 'horizon' AND g.verification_status = 'verified' AND o.application_deadline >= date('now')
      AND o.id NOT IN (SELECT a.opportunity_id FROM applications a JOIN users u ON u.id = a.user_id WHERE u.email = ?) ORDER BY o.id LIMIT 1`, [email]);

  test('requires consent, submits once, syncs to the tracker and to the recruiter', async () => {
    const c = await h.as('arjun');
    const opp = horizonListing('arjun.demo@iitb.ac.in');
    const noConsent = await c.post(`/api/opportunities/${opp.id}/apply`, { coverNote: 'Keen to join.' });
    assert.equal(noConsent.status, 422);
    assert.ok(noConsent.body.error.fields.consent);
    const applied = await c.post(`/api/opportunities/${opp.id}/apply`, { coverNote: 'I would bring strong SQL and modelling skills.', consent: true });
    assert.equal(applied.status, 201, JSON.stringify(applied.body));
    const twice = await c.post(`/api/opportunities/${opp.id}/apply`, { consent: true });
    assert.equal(twice.status, 409);

    const app = (await c.get(`/api/applications/${applied.body.id}`)).body;
    assert.equal(app.channel, 'horizon');
    assert.equal(app.stage, 'applied');
    assert.equal(app.recruiterStatus, 'submitted');

    const locked = await c.put(`/api/applications/${app.id}`, { stage: 'offer' });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, 'STAGE_LOCKED');
    const del = await c.del(`/api/applications/${app.id}`);
    assert.equal(del.body.error.code, 'WITHDRAW_FIRST');
    const notes = await c.put(`/api/applications/${app.id}`, { notes: 'Prepare a 2-minute intro.' });
    assert.equal(notes.status, 200);
  });

  test('an external listing cannot be applied to on HORIZON', async () => {
    const c = await h.as('arjun');
    const ext = h.db().get("SELECT id FROM opportunities WHERE status = 'published' AND application_mode = 'external' LIMIT 1");
    assert.equal((await c.post(`/api/opportunities/${ext.id}/apply`, { consent: true })).status, 409);
  });

  test('a student without a validated CV cannot apply', async () => {
    const c = await h.as('sara');
    assert.equal((await c.del('/api/profile/cv')).status, 200);
    const opp = horizonListing('sara.demo@nitt.edu');
    const res = await c.post(`/api/opportunities/${opp.id}/apply`, { consent: true });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CV_REQUIRED');
  });
});

describe('recruiter pipeline', () => {
  const meridianApp = () => h.db().get(`SELECT a.id, a.cv_document_id FROM applications a JOIN opportunities o ON o.id = a.opportunity_id JOIN organisations g ON g.id = o.organisation_id
    JOIN users u ON u.id = a.user_id WHERE g.name = 'Meridian Arc Consulting' AND a.channel = 'horizon' AND u.email = 'arjun.demo@iitb.ac.in'`);

  test('sees its own applicants only', async () => {
    const mei = await h.as('mei');
    const list = await mei.get('/api/recruiter/applicants');
    assert.equal(list.status, 200);
    assert.ok(list.body.items.length >= 1);
    const app = meridianApp();
    assert.equal((await mei.get(`/api/recruiter/applications/${app.id}`)).status, 200);
    const eleanor = await h.as('eleanor');
    assert.equal((await eleanor.get(`/api/recruiter/applications/${app.id}`)).status, 404);
    assert.equal((await eleanor.put(`/api/recruiter/applications/${app.id}`, { recruiterStatus: 'shortlisted' })).status, 404);
  });

  test('applicant CVs are private: shared only with the organisation applied to', async () => {
    const app = meridianApp();
    const mei = await h.as('mei');
    const cv = await mei.get(`/api/documents/${app.cv_document_id}/file`);
    assert.equal(cv.status, 200);
    assert.equal(cv.headers['content-type'], 'application/pdf');
    assert.match(cv.headers['cache-control'], /no-store/);
    assert.equal((await (await h.as('eleanor')).get(`/api/documents/${app.cv_document_id}/file`)).status, 404);
    assert.equal((await (await h.as('riya')).get(`/api/documents/${app.cv_document_id}/file`)).status, 404);
    assert.equal((await h.client().get(`/api/documents/${app.cv_document_id}/file`)).status, 401);
    const stored = h.db().get('SELECT stored_name FROM documents WHERE id = ?', [app.cv_document_id]);
    assert.equal((await h.client().get(`/storage/cvs/${stored.stored_name}`)).status, 404);
    assert.equal((await h.client().get(`/cvs/${stored.stored_name}`)).status, 404);
  });

  test('status updates require closure messages and sync to the student', async () => {
    const mei = await h.as('mei');
    const app = meridianApp();
    const noReason = await mei.put(`/api/recruiter/applications/${app.id}`, { recruiterStatus: 'not_selected', message: 'No.' });
    assert.equal(noReason.status, 422);
    assert.ok(noReason.body.error.fields.message);
    const noDate = await mei.put(`/api/recruiter/applications/${app.id}`, { recruiterStatus: 'interview' });
    assert.equal(noDate.status, 422);
    assert.ok(noDate.body.error.fields.interviewAt);
    const when = new Date(Date.now() + 5 * 86400000).toISOString();
    const ok = await mei.put(`/api/recruiter/applications/${app.id}`, { recruiterStatus: 'interview', interviewAt: when, message: 'Please join a 30-minute case interview.' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.firstResponseAt);

    const arjun = await h.as('arjun');
    const mine = await arjun.get(`/api/applications/${app.id}`);
    assert.equal(mine.body.stage, 'interview');
    assert.equal(mine.body.recruiterStatus, 'interview');
    assert.ok(mine.body.events.some((e) => e.actorRole === 'recruiter'));
    const notes = (await arjun.get('/api/notifications')).body.items;
    assert.ok(notes.some((n) => /Interview/i.test(n.title)));
  });

  test('a withdrawn application cannot be updated by the recruiter', async () => {
    const arjun = await h.as('arjun');
    const app = meridianApp();
    assert.equal((await arjun.put(`/api/applications/${app.id}`, { stage: 'withdrawn' })).status, 200);
    const mei = await h.as('mei');
    assert.equal((await mei.put(`/api/recruiter/applications/${app.id}`, { recruiterStatus: 'offer' })).status, 409);
  });

  test('recruiter listings need the no-fee pledge and go to review', async () => {
    const mei = await h.as('mei');
    const noPledge = await mei.post('/api/opportunities', h.listingPayload({ noFeeConfirmed: false }));
    assert.equal(noPledge.status, 422);
    assert.ok(noPledge.body.error.fields.noFeeConfirmed);
    const missingPay = await mei.post('/api/opportunities', h.listingPayload({ stipendAmount: null }));
    assert.equal(missingPay.status, 422);
    const pastDeadline = await mei.post('/api/opportunities', h.listingPayload({ applicationDeadline: '2020-01-01' }));
    assert.equal(pastDeadline.status, 422);
    const created = await mei.post('/api/opportunities', h.listingPayload({ applicationMode: 'horizon', applicationUrl: null, status: 'published' }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'pending_review', 'recruiters cannot self-publish');
    const riya = await h.as('riya');
    assert.equal((await riya.get(`/api/opportunities/${created.body.id}`)).status, 404, 'not visible before review');
    const other = await h.as('eleanor');
    assert.equal((await other.put(`/api/opportunities/${created.body.id}`, h.listingPayload())).status, 404);
    assert.equal((await other.del(`/api/opportunities/${created.body.id}`)).status, 404);
  });

  test('recruiters cannot use student-only or admin-only endpoints', async () => {
    const mei = await h.as('mei');
    assert.equal((await mei.get('/api/opportunities')).status, 403);
    assert.equal((await mei.get('/api/applications')).status, 403);
    assert.equal((await mei.get('/api/admin/dashboard')).status, 403);
  });
});

describe('dashboard', () => {
  test('returns personalised data for the student', async () => {
    const c = await h.as('riya');
    const res = await c.get('/api/dashboard');
    assert.equal(res.status, 200);
    assert.equal(res.body.stats.totalOpportunities, openCount());
    assert.ok(Array.isArray(res.body.recommended));
    assert.ok(res.body.profile.completion.percent > 0);
  });
});
