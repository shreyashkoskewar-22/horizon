'use strict';
/**
 * Grievance redressal: SLA timers, role-scoped views, escalation rules and the public
 * transparency report. Default timelines follow the IT (Intermediary Guidelines) Rules, 2021
 * pattern — acknowledge within 24 hours, resolve within 15 days — and are configurable.
 */
const config = require('../config');
const { getDb } = require('../db');
const { toSql, nowSql, parseSql, addHours, sha256, safeEqual } = require('../lib/util');
const { GRIEVANCE_CATEGORIES, GRIEVANCE_OPEN } = require('../lib/constants');

const STATUS_LABELS = {
  submitted: 'Submitted', acknowledged: 'Acknowledged', under_review: 'Under review',
  awaiting_response: 'Awaiting response from the other party', resolved: 'Resolved', rejected: 'Closed — not upheld', closed: 'Closed',
};

function dueDates(priority, from = new Date()) {
  const g = config.grievance;
  const resolveHours = priority === 'urgent' ? g.urgentResolveHours : g.resolveDays * 24;
  return { ack_due_at: toSql(addHours(from, g.ackHours)), resolution_due_at: toSql(addHours(from, resolveHours)) };
}

const ticketNo = (id, createdAt) => `GRV-${String(createdAt || nowSql()).slice(0, 4)}-${String(id).padStart(5, '0')}`;

function sla(g) {
  const now = Date.now();
  const open = GRIEVANCE_OPEN.includes(g.status);
  const ackDue = parseSql(g.ack_due_at).getTime();
  const resDue = parseSql(g.resolution_due_at).getTime();
  return {
    open,
    ackDueAt: g.ack_due_at,
    resolutionDueAt: g.resolution_due_at,
    ackOverdue: !g.acknowledged_at && now > ackDue,
    resolutionOverdue: open && now > resDue,
    hoursToResolution: open ? Math.round((resDue - now) / 3600000) : null,
    acknowledgedOnTime: g.acknowledged_at ? parseSql(g.acknowledged_at).getTime() <= ackDue : null,
    resolvedOnTime: g.resolved_at ? parseSql(g.resolved_at).getTime() <= resDue : null,
  };
}

function canEscalate(g) {
  if (g.level >= 2) return false;
  if (GRIEVANCE_OPEN.includes(g.status)) return Date.now() > parseSql(g.resolution_due_at).getTime();
  if (['resolved', 'rejected'].includes(g.status) && g.resolved_at) {
    return Date.now() - parseSql(g.resolved_at).getTime() <= config.grievance.appealDays * 86400000;
  }
  return false;
}

const canGiveFeedback = (g) => ['resolved', 'rejected'].includes(g.status) && g.satisfaction_rating == null;
const canReopen = (g) => ['resolved', 'rejected'].includes(g.status) && g.resolved_at
  && Date.now() - parseSql(g.resolved_at).getTime() <= config.grievance.reopenDays * 86400000;

/** Determines how the requester relates to a grievance: admin | complainant | respondent | null. */
function accessScope(req, g) {
  const u = req.user;
  if (u && u.role === 'admin' && u.status === 'approved') return 'admin';
  if (u && g.complainant_id && g.complainant_id === u.id) return 'complainant';
  if (u && u.role === 'recruiter' && u.status === 'approved' && g.shared_with_respondent && g.respondent_org_id === u.organisation_id) return 'respondent';
  const key = req.get('x-grievance-key');
  if (!u && key && g.access_key_hash && safeEqual(sha256(key.trim().toUpperCase()), g.access_key_hash)) return 'complainant';
  return null;
}

function view(g, scope) {
  const db = getDb();
  const complainant = g.complainant_id
    ? db.get(`SELECT u.id, u.full_name, u.email, u.role, i.name AS institution, o.name AS organisation FROM users u
              LEFT JOIN institutions i ON i.id = u.institution_id LEFT JOIN organisations o ON o.id = u.organisation_id WHERE u.id = ?`, [g.complainant_id])
    : null;
  const visibility = scope === 'admin' ? ['parties', 'complainant', 'internal'] : scope === 'complainant' ? ['parties', 'complainant'] : ['parties'];
  const events = db.all(`
    SELECT e.*, u.full_name AS actor_name FROM grievance_events e LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.grievance_id = ? AND e.visibility IN (${visibility.map(() => '?').join(',')}) ORDER BY e.created_at ASC, e.id ASC`, [g.id, ...visibility]);
  const evidence = g.evidence_document_id && scope !== 'respondent' ? db.get('SELECT id, original_name, mime_type, size_bytes FROM documents WHERE id = ?', [g.evidence_document_id]) : null;
  const assignee = scope === 'admin' && g.assigned_to ? db.get('SELECT id, full_name FROM users WHERE id = ?', [g.assigned_to]) : null;

  let who;
  if (scope === 'respondent') {
    who = g.is_anonymous ? { name: 'Anonymous complainant', anonymous: true } : { name: complainant ? complainant.full_name : g.guest_name, role: complainant ? complainant.role : 'guest' };
  } else {
    who = complainant
      ? { id: complainant.id, name: complainant.full_name, email: scope === 'admin' ? complainant.email : undefined, role: complainant.role, institution: complainant.institution, organisation: complainant.organisation }
      : { name: g.guest_name, email: scope === 'admin' ? g.guest_email : undefined, role: 'guest' };
  }

  const actorLabel = (e) => {
    if (e.actor_role === 'system') return 'HORIZON (automatic)';
    if (e.actor_role === 'admin') return scope === 'admin' && e.actor_name ? `${e.actor_name} (Grievance desk)` : 'HORIZON Grievance Desk';
    if (e.actor_role === 'respondent') return g.against_label ? `${g.against_label.split(' — ')[0]} (respondent)` : 'Respondent organisation';
    if (e.actor_role === 'complainant') return scope === 'respondent' && g.is_anonymous ? 'Complainant' : (who.name || 'Complainant');
    return e.actor_role;
  };

  return {
    id: g.id,
    ticketNo: g.ticket_no,
    category: g.category,
    categoryLabel: (GRIEVANCE_CATEGORIES[g.category] || {}).label || g.category,
    subject: g.subject,
    description: g.description,
    against: { type: g.against_type, id: g.against_id, label: g.against_label },
    priority: g.priority,
    status: g.status,
    statusLabel: STATUS_LABELS[g.status],
    level: g.level,
    levelLabel: g.level === 2 ? 'Level 2 — Grievance Officer' : 'Level 1 — Grievance desk',
    isAnonymous: !!g.is_anonymous,
    sharedWithRespondent: !!g.shared_with_respondent,
    hasRespondent: !!g.respondent_org_id,
    complainant: who,
    evidence: evidence ? { id: evidence.id, name: evidence.original_name, url: scope === 'admin' || g.complainant_id ? `/api/documents/${evidence.id}/file` : null } : null,
    assignee: assignee ? { id: assignee.id, name: assignee.full_name } : null,
    sla: sla(g),
    responseDueAt: g.response_due_at,
    acknowledgedAt: g.acknowledged_at,
    resolvedAt: g.resolved_at,
    closedAt: g.closed_at,
    escalatedAt: g.escalated_at,
    resolutionSummary: g.resolution_summary,
    satisfaction: g.satisfaction_rating ? { rating: g.satisfaction_rating, comment: g.satisfaction_comment } : null,
    isDemo: !!g.is_demo,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    scope,
    permissions: {
      message: scope !== null && !['closed'].includes(g.status) && (scope !== 'respondent' || g.status === 'awaiting_response' || GRIEVANCE_OPEN.includes(g.status)),
      escalate: scope === 'complainant' && canEscalate(g),
      feedback: scope === 'complainant' && canGiveFeedback(g),
      reopen: scope === 'complainant' && canReopen(g),
    },
    events: events.map((e) => ({
      id: e.id, type: e.event_type, visibility: e.visibility, actor: actorLabel(e), actorRole: e.actor_role,
      fromStatus: e.from_status, toStatus: e.to_status, message: e.message, createdAt: e.created_at,
    })),
  };
}

function addEvent(grievanceId, { actorId = null, actorRole, type, visibility = 'complainant', from = null, to = null, message = null }) {
  getDb().run(
    `INSERT INTO grievance_events (grievance_id, actor_id, actor_role, event_type, visibility, from_status, to_status, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [grievanceId, actorId, actorRole, type, visibility, from, to, message],
  );
  getDb().run('UPDATE grievances SET updated_at = ? WHERE id = ?', [nowSql(), grievanceId]);
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Aggregated, anonymised statistics for the public transparency page. */
function transparencyReport() {
  const db = getDb();
  const rows = db.all('SELECT * FROM grievances');
  const total = rows.length;
  const resolvedRows = rows.filter((g) => g.resolved_at);
  const acked = rows.filter((g) => g.acknowledged_at);
  const resolutionDays = resolvedRows.map((g) => (parseSql(g.resolved_at) - parseSql(g.created_at)) / 86400000);
  const ackHours = acked.map((g) => (parseSql(g.acknowledged_at) - parseSql(g.created_at)) / 3600000);
  const byCategory = Object.entries(GRIEVANCE_CATEGORIES).map(([key, c]) => ({
    key, label: c.label,
    received: rows.filter((g) => g.category === key).length,
    resolved: rows.filter((g) => g.category === key && g.resolved_at).length,
  })).filter((c) => c.received > 0);
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    months.push({
      month: key,
      received: rows.filter((g) => g.created_at.startsWith(key)).length,
      resolved: rows.filter((g) => g.resolved_at && g.resolved_at.startsWith(key)).length,
    });
  }
  const actions = db.get(`SELECT
      SUM(CASE WHEN action = 'opportunity.archive' OR action = 'opportunity.reject' THEN 1 ELSE 0 END) AS listings_removed,
      SUM(CASE WHEN action = 'user.status' AND details LIKE '%"status":"suspended"%' THEN 1 ELSE 0 END) AS accounts_suspended
    FROM audit_logs`) || {};
  const ratings = rows.filter((g) => g.satisfaction_rating).map((g) => g.satisfaction_rating);
  return {
    generatedAt: new Date().toISOString(),
    containsDemoData: rows.some((g) => g.is_demo),
    commitments: { ackHours: config.grievance.ackHours, resolveDays: config.grievance.resolveDays, urgentResolveHours: config.grievance.urgentResolveHours, appealDays: config.grievance.appealDays },
    officer: { name: config.grievance.officerName, email: config.grievance.officerEmail },
    totals: {
      received: total,
      open: rows.filter((g) => GRIEVANCE_OPEN.includes(g.status)).length,
      resolved: resolvedRows.length,
      escalated: rows.filter((g) => g.level === 2).length,
      acknowledgedWithinTarget: acked.length ? Math.round((acked.filter((g) => sla(g).acknowledgedOnTime).length / acked.length) * 100) : null,
      resolvedWithinTarget: resolvedRows.length ? Math.round((resolvedRows.filter((g) => sla(g).resolvedOnTime).length / resolvedRows.length) * 100) : null,
      medianAckHours: ackHours.length ? Math.round(median(ackHours) * 10) / 10 : null,
      medianResolutionDays: resolutionDays.length ? Math.round(median(resolutionDays) * 10) / 10 : null,
      averageSatisfaction: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
      listingsRemoved: actions.listings_removed || 0,
      accountsSuspended: actions.accounts_suspended || 0,
    },
    byCategory,
    byMonth: months,
  };
}

module.exports = { STATUS_LABELS, dueDates, ticketNo, sla, canEscalate, canGiveFeedback, canReopen, accessScope, view, addEvent, transparencyReport };
