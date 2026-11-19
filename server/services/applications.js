'use strict';
/**
 * Application rules shared by several routes, kept here so each rule exists in exactly one place:
 * the recruiter reply clock ("accountability clock") and the student's prioritised next actions.
 * Everything is derived at read time from existing columns; nothing here writes to the database.
 */
const config = require('../config');
const { parseSql } = require('../lib/util');

const DAY = 86400000;
const HOUR = 3600000;

/**
 * Verified recruiters promise a first response to every HORIZON application within
 * config.recruiterResponseDays of submission. The clock runs while a submitted HORIZON application
 * has no first response and has not been withdrawn; every other application gets nulls.
 *
 * Takes an applications row (snake_case columns) and returns:
 *   respondBy        ISO-8601 UTC time the reply is due, or null
 *   daysToRespond    whole days left, rounded up; 0 at the moment it falls due; once overdue, minus
 *                    the whole days elapsed since the due time (at least -1)
 *   responseOverdue  true once the due time has passed without a reply
 */
function responseClock(a, now = Date.now()) {
  const waiting = !!a && a.channel === 'horizon' && !!a.submitted_at && !a.first_response_at && a.stage !== 'withdrawn';
  if (!waiting) return { respondBy: null, daysToRespond: null, responseOverdue: false };
  const due = parseSql(a.submitted_at).getTime() + config.recruiterResponseDays * DAY;
  const diff = due - now;
  // Days left round up (13.2 days left reads "14 days"); days overdue count whole days, at least one.
  const daysToRespond = diff >= 0 ? Math.ceil(diff / DAY) : -Math.max(1, Math.floor(-diff / DAY));
  return { respondBy: new Date(due).toISOString(), daysToRespond, responseOverdue: diff < 0 };
}

/** Lower number = more urgent. Ties break on the earliest due time. */
const PRIORITY = { interview_soon: 1, reply_overdue: 2, deadline_soon: 3, personal_deadline: 4, interview_upcoming: 5, profile_blocker: 6 };
const CLOSED = ['rejected', 'withdrawn'];

const shortDate = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dueTime = (x) => (x.dueAt ? Date.parse(x.dueAt) : Number.POSITIVE_INFINITY);
const byPriority = (x, y) => (x.priority - y.priority) || (dueTime(x) - dueTime(y));

/**
 * Up to `limit` prioritised actions for a student's dashboard, built only from that student's own
 * application rows (APP_SELECT in routes/student.js) and current CV. Each action:
 *   { type, priority, title, subtitle, href, dueAt }
 * dueAt is an ISO-8601 date (YYYY-MM-DD) for day deadlines, a UTC date-time for interviews and
 * reply deadlines, or null when there is no deadline. One action per application at most.
 */
function nextActions({ apps = [], cv = null, now = Date.now(), limit = 3 } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const weekOut = new Date(now + 7 * DAY).toISOString().slice(0, 10);
  const make = (type, fields) => ({ type, priority: PRIORITY[type], ...fields });
  const actions = [];

  for (const a of apps) {
    if (CLOSED.includes(a.stage)) continue;
    const title = a.title || a.snapshot_title;
    const org = a.org_name || a.snapshot_organisation;
    const open = `/app/applications?open=${a.id}`;
    const options = [];

    if (a.interview_at && a.stage !== 'offer') {
      const at = parseSql(a.interview_at).getTime();
      if (at >= now && at <= now + 72 * HOUR) options.push(make('interview_soon', { title: `Prepare for your interview with ${org}`, subtitle: title, href: open, dueAt: new Date(at).toISOString() }));
      else if (at > now + 72 * HOUR && at <= now + 14 * DAY) options.push(make('interview_upcoming', { title: `Prepare for your interview with ${org}`, subtitle: title, href: open, dueAt: new Date(at).toISOString() }));
    }
    const clock = responseClock(a, now);
    if (clock.responseOverdue) {
      options.push(make('reply_overdue', { title: `Follow up on your ${org} application`, subtitle: `${title} · no reply within ${config.recruiterResponseDays} days`, href: open, dueAt: clock.respondBy }));
    }
    const deadline = a.application_deadline;
    if (['interested', 'preparing'].includes(a.stage) && a.opportunity_status === 'published' && deadline && deadline >= today && deadline <= weekOut) {
      options.push(make('deadline_soon', { title: `Apply to ${title} before ${shortDate(deadline)}`, subtitle: `${org} · applications close soon`, href: `/app/opportunities/${a.opportunity_id}`, dueAt: deadline }));
    }
    if (a.personal_deadline && a.stage !== 'offer' && a.personal_deadline >= today && a.personal_deadline <= weekOut) {
      options.push(make('personal_deadline', { title: `Meet your ${shortDate(a.personal_deadline)} deadline for ${title}`, subtitle: a.next_action || `${org} · a deadline you set`, href: open, dueAt: a.personal_deadline }));
    }
    if (options.length) actions.push(options.sort(byPriority)[0]);
  }

  const cvStatus = cv ? cv.review_status : null;
  if (!cv) {
    actions.push(make('profile_blocker', { title: 'Upload your CV to apply on HORIZON', subtitle: 'Verified recruiters receive applications only with a validated CV.', href: '/app/profile', dueAt: null }));
  } else if (cvStatus === 'changes_requested') {
    actions.push(make('profile_blocker', { title: 'Update your CV — a reviewer asked for changes', subtitle: 'You can apply on HORIZON again once the new version passes.', href: '/app/profile', dueAt: null }));
  } else if (cvStatus === 'flagged') {
    actions.push(make('profile_blocker', { title: 'Check your CV report while it is reviewed', subtitle: 'HORIZON applications open once a reviewer clears your CV.', href: '/app/profile', dueAt: null }));
  }

  return actions.sort(byPriority).slice(0, limit);
}

module.exports = { responseClock, nextActions, PRIORITY };
