'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.setup);
after(h.teardown);

const DESC = 'Someone claiming to be from the recruiter asked me to pay a refundable deposit before the interview.';

describe('filing grievances', () => {
  test('a signed-in student gets a ticket, SLA deadlines and an urgent priority for fee demands', async () => {
    const c = await h.as('riya');
    const org = h.db().get("SELECT id FROM organisations WHERE name = 'Northbank Ridge Capital'");
    const res = await c.post('/api/grievances', { category: 'fee_demand', subject: 'Deposit requested on WhatsApp', description: DESC, againstType: 'organisation', againstId: org.id, declaration: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.ticketNo, /^GRV-\d{4}-\d{5}$/);
    assert.equal(res.body.priority, 'urgent');
    assert.equal(res.body.accessKey, null, 'signed-in users track in their dashboard');
    const hours = (new Date(`${res.body.resolutionDueAt.replace(' ', 'T')}Z`) - Date.now()) / 3600000;
    assert.ok(hours > 70 && hours <= 72.1, 'urgent grievances get a 72-hour target');

    const view = await c.get(`/api/grievances/${res.body.id}`);
    assert.equal(view.body.scope, 'complainant');
    assert.equal(view.body.status, 'submitted');
    assert.ok(view.body.events.some((e) => e.type === 'receipt'));
    assert.ok(!view.body.events.some((e) => e.visibility === 'internal'));
    assert.ok((await c.get('/api/grievances/mine')).body.filed.some((g) => g.id === res.body.id));
  });

  test('validates input and requires the accuracy declaration', async () => {
    const c = await h.as('riya');
    const res = await c.post('/api/grievances', { category: 'nonsense', subject: 'Hi', description: 'Too short' });
    assert.equal(res.status, 422);
    for (const f of ['category', 'subject', 'description', 'declaration']) assert.ok(res.body.error.fields[f], f);
  });

  test('guests can file with a CAPTCHA and track with a private key', async () => {
    const guest = h.client();
    const noCaptcha = await guest.post('/api/grievances', { category: 'privacy', subject: 'Remove my old data', description: 'Please delete the account I created last year with my personal email address.', declaration: true, guestName: 'Asha Guest', guestEmail: 'asha.guest@example.org' });
    assert.equal(noCaptcha.status, 400);
    const noContact = await guest.post('/api/grievances', { category: 'privacy', subject: 'Remove my old data', description: 'Please delete the account I created last year with my personal email address.', declaration: true, captchaToken: h.CAPTCHA });
    assert.equal(noContact.status, 422);
    const res = await guest.post('/api/grievances', { category: 'privacy', subject: 'Remove my old data', description: 'Please delete the account I created last year with my personal email address.', declaration: true, guestName: 'Asha Guest', guestEmail: 'asha.guest@example.org', captchaToken: h.CAPTCHA });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.accessKey, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const wrong = await h.client().post('/api/grievances/track', { ticketNo: res.body.ticketNo, accessKey: 'AAAA-BBBB-CCCC' });
    assert.equal(wrong.status, 404);
    const tracked = await h.client().post('/api/grievances/track', { ticketNo: res.body.ticketNo.toLowerCase(), accessKey: res.body.accessKey.toLowerCase() });
    assert.equal(tracked.status, 200);
    assert.equal(tracked.body.subject, 'Remove my old data');

    const other = h.client();
    assert.equal((await other.get(`/api/grievances/${res.body.id}`)).status, 404);
    const withKey = await other.get(`/api/grievances/${res.body.id}`).set('X-Grievance-Key', res.body.accessKey);
    assert.equal(withKey.status, 200);
    const msg = await other.post(`/api/grievances/${res.body.id}/messages`, { message: 'Adding: the account email was asha@gmail.com.' }, { 'X-Grievance-Key': res.body.accessKey });
    assert.equal(msg.status, 201);
  });

  test('other users cannot read someone else’s grievance', async () => {
    const riya = await h.as('riya');
    const res = await riya.post('/api/grievances', { category: 'technical', subject: 'Upload page froze', description: 'The CV upload page froze twice on my phone while showing the progress bar.', declaration: true });
    const sara = await h.as('sara');
    assert.equal((await sara.get(`/api/grievances/${res.body.id}`)).status, 404);
    assert.equal((await sara.post(`/api/grievances/${res.body.id}/messages`, { message: 'hello there' })).status, 404);
    const mei = await h.as('mei');
    assert.equal((await mei.get(`/api/grievances/${res.body.id}`)).status, 404);
  });
});

describe('resolution workflow', () => {
  test('acknowledge, request the organisation’s response, decide, and collect feedback', async () => {
    const arjun = await h.as('arjun');
    const opp = h.db().get("SELECT o.id FROM opportunities o JOIN organisations g ON g.id = o.organisation_id WHERE g.name = 'Meridian Arc Consulting' AND o.status = 'published' LIMIT 1");
    const filed = await arjun.post('/api/grievances', { category: 'offer_mismatch', subject: 'Stipend differs from the listing', description: 'The offer email quotes a lower stipend than the listing on HORIZON showed when I applied.', againstType: 'opportunity', againstId: opp.id, declaration: true, isAnonymous: false });
    assert.equal(filed.status, 201);
    const gid = filed.body.id;

    const mei = await h.as('mei');
    assert.equal((await mei.get(`/api/grievances/${gid}`)).status, 404, 'not shared with the organisation until the desk decides to');

    const admin = await h.as('admin');
    const empty = await admin.put(`/api/admin/grievances/${gid}`, {});
    assert.equal(empty.status, 422);
    const ack = await admin.put(`/api/admin/grievances/${gid}`, { status: 'under_review', message: 'We are looking into this.', assignToMe: true, internalNote: 'Check the offer letter template.' });
    assert.equal(ack.status, 200);
    assert.ok(ack.body.acknowledgedAt);
    assert.ok(ack.body.events.some((e) => e.visibility === 'internal'));

    const studentView = await arjun.get(`/api/grievances/${gid}`);
    assert.ok(!studentView.body.events.some((e) => e.type === 'internal_note'), 'internal notes stay internal');

    const req = await admin.put(`/api/admin/grievances/${gid}`, { requestResponse: true, message: 'Please explain the difference in stipend.' });
    assert.equal(req.status, 200);
    assert.equal(req.body.status, 'awaiting_response');
    const concerning = await mei.get('/api/grievances/mine');
    assert.ok(concerning.body.concerning.some((g) => g.id === gid));
    const respondentView = await mei.get(`/api/grievances/${gid}`);
    assert.equal(respondentView.body.scope, 'respondent');
    assert.equal(respondentView.body.complainant.email, undefined, 'respondent never sees contact details');
    const reply = await mei.post(`/api/grievances/${gid}/messages`, { message: 'The listing showed the pre-tax figure; we will correct the offer to match it.' });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.status, 'under_review');
    assert.equal((await mei.post(`/api/grievances/${gid}/escalate`, { reason: 'Respondents cannot escalate a grievance.' })).status, 403);

    const noSummary = await admin.put(`/api/admin/grievances/${gid}`, { status: 'resolved' });
    assert.equal(noSummary.status, 422);
    const resolved = await admin.put(`/api/admin/grievances/${gid}`, { status: 'resolved', resolutionSummary: 'Meridian Arc corrected the offer to the advertised stipend and confirmed in writing.' });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.status, 'resolved');

    const decided = await arjun.get(`/api/grievances/${gid}`);
    assert.equal(decided.body.permissions.feedback, true);
    assert.equal(decided.body.permissions.escalate, true, 'appeal window open after a decision');
    const fb = await arjun.post(`/api/grievances/${gid}/feedback`, { rating: 5, comment: 'Quick and fair.' });
    assert.equal(fb.status, 200);
    assert.equal(fb.body.status, 'closed');
    assert.equal((await arjun.post(`/api/grievances/${gid}/feedback`, { rating: 4 })).status, 409, 'feedback only once');
    assert.equal((await arjun.post(`/api/grievances/${gid}/messages`, { message: 'One more thing' })).status, 409, 'closed tickets accept no messages');
  });

  test('escalation to Level 2 after a decision', async () => {
    const riya = await h.as('riya');
    const filed = await riya.post('/api/grievances', { category: 'verification', subject: 'Verification took too long', description: 'My manual verification was rejected without a clear reason being shared with me.', declaration: true });
    const gid = filed.body.id;
    assert.equal((await riya.post(`/api/grievances/${gid}/escalate`, { reason: 'Nothing has happened yet, please escalate.' })).status, 409, 'cannot escalate before a deadline passes or a decision');
    const admin = await h.as('admin');
    await admin.put(`/api/admin/grievances/${gid}`, { status: 'rejected', resolutionSummary: 'The document was unreadable; the reason was in the rejection message.' });
    const esc = await riya.post(`/api/grievances/${gid}/escalate`, { reason: 'I did not receive any message explaining the rejection.' });
    assert.equal(esc.status, 200);
    assert.equal(esc.body.level, 2);
    assert.equal(esc.body.status, 'under_review');
  });

  test('the public transparency report publishes aggregates only', async () => {
    const res = await h.client().get('/api/public/grievance-report');
    assert.equal(res.status, 200);
    assert.ok(res.body.totals.received >= 6);
    assert.equal(res.body.containsDemoData, true);
    const text = JSON.stringify(res.body);
    for (const secret of ['riya.demo', 'asha.guest', 'Deposit requested', 'GRV-']) assert.ok(!text.includes(secret), `report must not include ${secret}`);
  });
});
