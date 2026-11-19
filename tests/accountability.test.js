'use strict';
/**
 * The accountability clock (respondBy / daysToRespond / responseOverdue) and the student's
 * prioritised next actions. Both are derived at read time from existing columns.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { responseClock, nextActions, PRIORITY } = require('../server/services/applications');
const { toSql } = require('../server/lib/util');

before(h.setup);
after(h.teardown);

const DAY = 86400000;
const NOW = Date.parse('2026-11-20T10:00:00Z');
const sqlAgo = (days, from = Date.now()) => toSql(new Date(from - days * DAY));
const horizonRow = (over = {}) => ({ channel: 'horizon', stage: 'applied', submitted_at: sqlAgo(4, NOW), first_response_at: null, ...over });

const userId = (email) => h.db().value('SELECT id FROM users WHERE email = ?', [email]);
const appFor = (email, title) => h.db().get(`SELECT a.* FROM applications a JOIN opportunities o ON o.id = a.opportunity_id
  WHERE a.user_id = ? AND o.title LIKE ?`, [userId(email), `${title}%`]);
const setApp = (id, cols) => {
  const keys = Object.keys(cols);
  h.db().run(`UPDATE applications SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => cols[k]), id]);
};

describe('reply clock rule (one shared helper)', () => {
  test('waiting inside the window counts the days that remain', () => {
    const c = responseClock(horizonRow(), NOW);
    assert.equal(c.respondBy, new Date(NOW - 4 * DAY + 14 * DAY).toISOString());
    assert.equal(c.daysToRespond, 10);
    assert.equal(c.responseOverdue, false);
  });

  test('exactly at the end of the window it is due today, not overdue', () => {
    const c = responseClock(horizonRow({ submitted_at: sqlAgo(14, NOW) }), NOW);
    assert.equal(c.daysToRespond, 0);
    assert.equal(c.responseOverdue, false);
    const oneSecondLater = responseClock(horizonRow({ submitted_at: sqlAgo(14, NOW) }), NOW + 1000);
    assert.equal(oneSecondLater.responseOverdue, true);
    assert.equal(oneSecondLater.daysToRespond, -1);
  });

  test('overdue is negative and flagged', () => {
    const c = responseClock(horizonRow({ submitted_at: sqlAgo(16, NOW) }), NOW);
    assert.equal(c.daysToRespond, -2);
    assert.equal(c.responseOverdue, true);
  });

  test('already answered, withdrawn and external applications have no clock', () => {
    const none = { respondBy: null, daysToRespond: null, responseOverdue: false };
    assert.deepEqual(responseClock(horizonRow({ first_response_at: sqlAgo(1, NOW) }), NOW), none);
    assert.deepEqual(responseClock(horizonRow({ stage: 'withdrawn', submitted_at: sqlAgo(20, NOW) }), NOW), none);
    assert.deepEqual(responseClock(horizonRow({ channel: 'external' }), NOW), none);
    assert.deepEqual(responseClock(horizonRow({ submitted_at: null }), NOW), none);
  });
});

describe('reply clock in the API', () => {
  test('the tracker exposes the clock for a waiting HORIZON application', async () => {
    const app = appFor('riya.demo@iimidr.ac.in', 'Business Analytics');
    setApp(app.id, { submitted_at: sqlAgo(4), first_response_at: null });
    const riya = await h.as('riya');
    const mine = (await riya.get('/api/applications')).body.items.find((a) => a.id === app.id);
    assert.equal(mine.daysToRespond, 10);
    assert.equal(mine.responseOverdue, false);
    assert.ok(Math.abs(Date.parse(mine.respondBy) - (Date.now() + 10 * DAY)) < 60000, 'due 14 days after submission');
    const detail = await riya.get(`/api/applications/${app.id}`);
    assert.equal(detail.body.daysToRespond, 10);
  });

  test('overdue, answered, withdrawn and external applications', async () => {
    const riya = await h.as('riya');
    const app = appFor('riya.demo@iimidr.ac.in', 'Business Analytics');
    setApp(app.id, { submitted_at: sqlAgo(16) });
    let mine = (await riya.get(`/api/applications/${app.id}`)).body;
    assert.equal(mine.responseOverdue, true);
    assert.equal(mine.daysToRespond, -2);

    setApp(app.id, { first_response_at: sqlAgo(1) });
    mine = (await riya.get(`/api/applications/${app.id}`)).body;
    assert.equal(mine.respondBy, null);
    assert.equal(mine.daysToRespond, null);
    assert.equal(mine.responseOverdue, false);

    const external = (await riya.get('/api/applications')).body.items.find((a) => a.channel === 'external');
    assert.equal(external.respondBy, null);
    assert.equal(external.responseOverdue, false);
    setApp(app.id, { first_response_at: null, submitted_at: sqlAgo(4) });
  });

  test('a withdrawn application stops the clock', async () => {
    const arjun = await h.as('arjun');
    const app = appFor('arjun.demo@iitb.ac.in', 'Strategy Consulting');
    const before = (await arjun.get(`/api/applications/${app.id}`)).body;
    assert.equal(before.responseOverdue, true, 'seeded 16 days ago with no reply');
    const withdrawn = await arjun.put(`/api/applications/${app.id}`, { stage: 'withdrawn' });
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.respondBy, null);
    assert.equal(withdrawn.body.responseOverdue, false);
    setApp(app.id, { stage: 'applied' });
  });

  test('the opportunity page shows the clock on the student’s own application only', async () => {
    const app = appFor('riya.demo@iimidr.ac.in', 'Business Analytics');
    setApp(app.id, { submitted_at: sqlAgo(4), first_response_at: null });
    const riya = await h.as('riya');
    const detail = (await riya.get(`/api/opportunities/${app.opportunity_id}`)).body;
    assert.equal(detail.application.id, app.id);
    assert.equal(detail.application.daysToRespond, 10);
    assert.equal(detail.application.responseOverdue, false);
    assert.ok(detail.application.respondBy);
    assert.ok(detail.organisation.verifiedAt, 'verified organisations expose their verification date');

    const arjun = await h.as('arjun');
    const other = (await arjun.get(`/api/opportunities/${app.opportunity_id}`)).body;
    assert.equal(other.application, null, 'another student never sees Riya’s application');

    const mei = await h.as('mei');
    const recruiterView = (await mei.get(`/api/opportunities/${app.opportunity_id}`)).body;
    assert.equal(recruiterView.application, undefined, 'recruiters get no student-only fields');
    assert.equal(recruiterView.applyReadiness, undefined);
    const admin = await h.as('admin');
    const adminView = (await admin.get(`/api/opportunities/${app.opportunity_id}`)).body;
    assert.equal(adminView.application, undefined, 'administrators get no student-only fields');
  });

  test('the recruiter sees the same deadline, oldest first', async () => {
    const mei = await h.as('mei');
    const d = (await mei.get('/api/recruiter/dashboard')).body;
    assert.ok(Array.isArray(d.repliesDue) && d.repliesDue.length >= 2);
    const submitted = d.repliesDue.map((a) => a.submittedAt);
    assert.deepEqual(submitted, [...submitted].sort());
    const riyaApp = appFor('riya.demo@iimidr.ac.in', 'Business Analytics');
    const row = d.repliesDue.find((a) => a.id === riyaApp.id);
    const riya = await h.as('riya');
    const studentSide = (await riya.get(`/api/applications/${riyaApp.id}`)).body;
    assert.equal(row.respondBy, studentSide.respondBy);
    assert.equal(row.overdue, studentSide.responseOverdue);
  });
});

describe('next actions', () => {
  const base = { opportunity_id: 1, opportunity_status: 'published', title: 'Listing', org_name: 'Org', interview_at: null, personal_deadline: null, application_deadline: '2027-06-01', channel: 'external', submitted_at: null, first_response_at: null };
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const verifiedCv = { review_status: 'verified' };

  test('ranks by urgency, one action per application, at most three', () => {
    const apps = [
      { ...base, id: 1, stage: 'interview', interview_at: toSql(new Date(NOW + 10 * DAY)), org_name: 'Later Co' },
      { ...base, id: 2, stage: 'preparing', application_deadline: iso(NOW + 3 * DAY), title: 'Growth Marketing Intern' },
      { ...base, id: 3, stage: 'applied', channel: 'horizon', submitted_at: sqlAgo(20, NOW), org_name: 'Northbank Ridge' },
      { ...base, id: 4, stage: 'interview', interview_at: toSql(new Date(NOW + 30 * 3600000)), org_name: 'Meridian Arc' },
      { ...base, id: 5, stage: 'assessment', personal_deadline: iso(NOW + 2 * DAY) },
      { ...base, id: 6, stage: 'rejected', personal_deadline: iso(NOW + 1 * DAY) },
    ];
    const out = nextActions({ apps, cv: verifiedCv, now: NOW });
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((a) => a.type), ['interview_soon', 'reply_overdue', 'deadline_soon']);
    assert.equal(out[0].title, 'Prepare for your interview with Meridian Arc');
    assert.equal(out[1].title, 'Follow up on your Northbank Ridge application');
    assert.match(out[2].title, /^Apply to Growth Marketing Intern before \d{1,2} [A-Z][a-z]{2}$/);
    for (const a of out) {
      assert.deepEqual(Object.keys(a).sort(), ['dueAt', 'href', 'priority', 'subtitle', 'title', 'type']);
      assert.equal(a.priority, PRIORITY[a.type]);
    }
    const all = nextActions({ apps, cv: null, now: NOW, limit: 10 });
    assert.deepEqual(all.map((a) => a.type), ['interview_soon', 'reply_overdue', 'deadline_soon', 'personal_deadline', 'interview_upcoming', 'profile_blocker']);
    assert.ok(!all.some((a) => a.href.endsWith('open=6')), 'closed applications never produce actions');
  });

  test('ties break by the earliest due date', () => {
    const apps = [
      { ...base, id: 1, stage: 'preparing', application_deadline: iso(NOW + 6 * DAY), title: 'Later' },
      { ...base, id: 2, stage: 'interested', application_deadline: iso(NOW + 2 * DAY), title: 'Sooner' },
    ];
    const out = nextActions({ apps, cv: verifiedCv, now: NOW });
    assert.deepEqual(out.map((a) => a.title.split(' ')[2]), ['Sooner', 'Later']);
  });

  test('is empty when nothing needs attention', () => {
    assert.deepEqual(nextActions({ apps: [], cv: verifiedCv, now: NOW }), []);
    assert.deepEqual(nextActions({ apps: [{ ...base, id: 1, stage: 'applied' }], cv: { review_status: 'auto_verified' }, now: NOW }), []);
  });

  test('CV problems become a profile blocker', () => {
    assert.equal(nextActions({ apps: [], cv: null, now: NOW })[0].type, 'profile_blocker');
    assert.equal(nextActions({ apps: [], cv: { review_status: 'changes_requested' }, now: NOW })[0].href, '/app/profile');
    assert.equal(nextActions({ apps: [], cv: { review_status: 'flagged' }, now: NOW }).length, 1);
  });

  test('the dashboard returns the student’s own actions and reply strip', async () => {
    const riya = await h.as('riya');
    const d = (await riya.get('/api/dashboard')).body;
    assert.ok(Array.isArray(d.nextActions) && d.nextActions.length <= 3);
    const ownIds = new Set(h.db().all('SELECT id FROM applications WHERE user_id = ?', [userId('riya.demo@iimidr.ac.in')]).map((r) => String(r.id)));
    for (const a of d.nextActions) {
      const m = a.href.match(/open=(\d+)/);
      if (m) assert.ok(ownIds.has(m[1]), 'actions only reference the student’s own applications');
    }
    assert.ok(d.awaitingReply && d.awaitingReply.count >= 1);
    assert.ok(ownIds.has(String(d.awaitingReply.next.id)));
    assert.equal(d.awaitingReply.windowDays, 14);
    assert.equal(typeof d.stats.totalOpportunities, 'number', 'existing fields are kept');
  });

  test('a student with nothing pending gets empty actions and no reply strip', async () => {
    const sara = userId('sara.demo@nitt.edu');
    h.db().run('DELETE FROM application_events WHERE application_id IN (SELECT id FROM applications WHERE user_id = ?)', [sara]);
    h.db().run('DELETE FROM applications WHERE user_id = ?', [sara]);
    h.db().run("UPDATE documents SET review_status = 'verified' WHERE user_id = ? AND kind = 'cv'", [sara]);
    const c = await h.as('sara');
    const d = (await c.get('/api/dashboard')).body;
    assert.deepEqual(d.nextActions, []);
    assert.equal(d.awaitingReply, null);
    h.db().run("UPDATE documents SET review_status = 'changes_requested' WHERE user_id = ? AND kind = 'cv'", [sara]);
    const blocked = (await c.get('/api/dashboard')).body;
    assert.equal(blocked.nextActions.length, 1);
    assert.equal(blocked.nextActions[0].type, 'profile_blocker');
  });

  test('recruiters and administrators cannot read a student dashboard', async () => {
    for (const who of ['mei', 'admin']) {
      const c = await h.as(who);
      assert.equal((await c.get('/api/dashboard')).status, 403, who);
      assert.equal((await c.get('/api/applications')).status, 403, who);
    }
    const riyaApp = appFor('riya.demo@iimidr.ac.in', 'Business Analytics');
    const arjun = await h.as('arjun');
    assert.equal((await arjun.get(`/api/applications/${riyaApp.id}`)).status, 404);
    const d = (await arjun.get('/api/dashboard')).body;
    assert.ok(!d.nextActions.some((a) => a.href.endsWith(`open=${riyaApp.id}`)));
    assert.ok(!d.awaitingReply || d.awaitingReply.next.id !== riyaApp.id);
  });
});
