'use strict';
const { getDb } = require('../db');
const { parseJsonArray, likeEscape, initials, nowSql, parseSql } = require('../lib/util');
const { toUsdMonthly } = require('../lib/constants');
const config = require('../config');

const BASE_SELECT = `
  SELECT o.*, org.name AS org_name, org.org_type, org.verification_status AS org_status, org.website AS org_website,
         org.is_demo AS org_is_demo, org.verified_at AS org_verified_at,
         (SELECT group_concat(s.name, '|') FROM opportunity_skills os JOIN skills s ON s.id = os.skill_id WHERE os.opportunity_id = o.id) AS skill_list
  FROM opportunities o
  JOIN organisations org ON org.id = o.organisation_id`;

const OPEN_WHERE = "o.status = 'published' AND o.application_deadline >= date('now')";

const toList = (v) => (v == null || v === '' ? [] : (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean).slice(0, 20));

const SORTS = {
  recent: 'COALESCE(o.published_at, o.created_at) DESC, o.id DESC',
  deadline: 'o.application_deadline ASC, o.id ASC',
  compensation: 'o.is_paid DESC, COALESCE(o.stipend_usd_monthly, 0) DESC, o.id ASC',
  duration: 'o.duration_weeks ASC, o.id ASC',
};

/** Builds the WHERE clause for discovery filters. All values are bound parameters. */
function buildFilters(q) {
  const where = [OPEN_WHERE];
  const params = [];
  const inList = (column, values) => {
    if (!values.length) return;
    where.push(`${column} IN (${values.map(() => '?').join(', ')})`);
    params.push(...values);
  };
  if (q.q) {
    for (const term of String(q.q).trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
      const like = `%${likeEscape(term)}%`;
      where.push(`(o.title LIKE ? ESCAPE '\\' OR org.name LIKE ? ESCAPE '\\' OR o.country LIKE ? ESCAPE '\\' OR o.city LIKE ? ESCAPE '\\'
        OR o.industry LIKE ? ESCAPE '\\' OR o.summary LIKE ? ESCAPE '\\' OR o.description LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM opportunity_skills os JOIN skills s ON s.id = os.skill_id WHERE os.opportunity_id = o.id AND s.name LIKE ? ESCAPE '\\'))`);
      params.push(like, like, like, like, like, like, like, like);
    }
  }
  inList('o.country', toList(q.country));
  inList('o.industry', toList(q.industry));
  inList('org.org_type', toList(q.orgType));
  inList('o.work_mode', toList(q.workMode));
  inList('o.visa_sponsorship', toList(q.visa));
  if (q.paid === 'paid') where.push('o.is_paid = 1');
  if (q.paid === 'unpaid') where.push('o.is_paid = 0');
  if (q.minComp != null) { where.push('COALESCE(o.stipend_usd_monthly, 0) >= ?'); params.push(Number(q.minComp)); }
  if (q.maxComp != null) { where.push('COALESCE(o.stipend_usd_monthly, 0) <= ?'); params.push(Number(q.maxComp)); }
  if (q.duration === 'short') where.push('o.duration_weeks <= 8');
  if (q.duration === 'medium') where.push('o.duration_weeks BETWEEN 9 AND 16');
  if (q.duration === 'long') where.push('o.duration_weeks > 16');
  if (q.deadline) {
    const days = { week: 7, month: 30, quarter: 90 }[q.deadline];
    where.push(`o.application_deadline <= date('now', '+${days} days')`);
  }
  if (q.level) { where.push("(o.academic_level = 'any' OR o.academic_level = ?)"); params.push(q.level); }
  if (q.year) { where.push('(json_array_length(o.eligible_years) = 0 OR EXISTS (SELECT 1 FROM json_each(o.eligible_years) WHERE value = ?))'); params.push(Number(q.year)); }
  if (q.featured) where.push('o.is_featured = 1');
  if (q.mode) { where.push('o.application_mode = ?'); params.push(q.mode); }
  return { where: where.join(' AND '), params };
}

function serializeCard(r, { saved = false, stage = null } = {}) {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    organisation: { id: r.organisation_id, name: r.org_name, initials: initials(r.org_name), type: r.org_type, verified: r.org_status === 'verified' },
    country: r.country,
    city: r.city,
    industry: r.industry,
    workMode: r.work_mode,
    durationWeeks: r.duration_weeks,
    isPaid: !!r.is_paid,
    stipend: r.is_paid ? { amount: r.stipend_amount, currency: r.stipend_currency, usdMonthly: r.stipend_usd_monthly } : null,
    deadline: r.application_deadline,
    visaSponsorship: r.visa_sponsorship,
    applicationMode: r.application_mode,
    status: r.status,
    isFeatured: !!r.is_featured,
    isVerified: !!r.is_verified,
    isDemo: !!r.is_demo,
    skills: r.skill_list ? r.skill_list.split('|') : [],
    publishedAt: r.published_at,
    lastVerifiedAt: r.last_verified_at,
    saved: !!saved,
    applicationStage: stage,
  };
}

function serializeDetail(r) {
  return {
    ...serializeCard(r),
    description: r.description,
    responsibilities: r.responsibilities,
    eligibility: r.eligibility,
    academicRequirements: r.academic_requirements,
    academicLevel: r.academic_level,
    eligibleYears: parseJsonArray(r.eligible_years),
    requiredDocuments: r.required_documents,
    startDate: r.start_date,
    endDate: r.end_date,
    visaDetails: r.visa_details,
    relocationSupport: r.relocation_support,
    accommodationSupport: r.accommodation_support,
    applicationUrl: r.application_url,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    noFeeConfirmed: !!r.no_fee_confirmed,
    reviewNote: r.review_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
    organisation: {
      id: r.organisation_id, name: r.org_name, initials: initials(r.org_name), type: r.org_type,
      verified: r.org_status === 'verified', verifiedAt: r.org_status === 'verified' ? r.org_verified_at : null, website: r.org_website, isDemo: !!r.org_is_demo,
    },
  };
}

function search(q, userId) {
  const db = getDb();
  const { where, params } = buildFilters(q);
  const total = db.value(`SELECT COUNT(*) FROM opportunities o JOIN organisations org ON org.id = o.organisation_id WHERE ${where}`, params);
  const rows = db.all(`${BASE_SELECT} WHERE ${where} ORDER BY ${SORTS[q.sort] || SORTS.recent} LIMIT ? OFFSET ?`, [...params, q.pageSize, (q.page - 1) * q.pageSize]);
  return { items: decorate(rows, userId), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

/** Adds saved / application-stage flags for the current user to card rows. */
function decorate(rows, userId) {
  if (!rows.length) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const saved = new Set(userId ? db.all(`SELECT opportunity_id FROM saved_opportunities WHERE user_id = ? AND opportunity_id IN (${marks})`, [userId, ...ids]).map((r) => r.opportunity_id) : []);
  const stages = new Map(userId ? db.all(`SELECT opportunity_id, stage FROM applications WHERE user_id = ? AND opportunity_id IN (${marks})`, [userId, ...ids]).map((r) => [r.opportunity_id, r.stage]) : []);
  return rows.map((r) => serializeCard(r, { saved: saved.has(r.id), stage: stages.get(r.id) || null }));
}

function getRow(id) { return getDb().get(`${BASE_SELECT} WHERE o.id = ?`, [id]); }

function listOpen({ orderBy = SORTS.recent, limit = 6, extraWhere = '', params = [] } = {}) {
  return getDb().all(`${BASE_SELECT} WHERE ${OPEN_WHERE} ${extraWhere} ORDER BY ${orderBy} LIMIT ?`, [...params, limit]);
}

function syncSkills(opportunityId, names) {
  const db = getDb();
  db.run('DELETE FROM opportunity_skills WHERE opportunity_id = ?', [opportunityId]);
  for (const name of [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 15)) {
    db.run('INSERT INTO skills (name) VALUES (?) ON CONFLICT(name) DO NOTHING', [name]);
    const skillId = db.value('SELECT id FROM skills WHERE name = ?', [name]);
    db.run('INSERT OR IGNORE INTO opportunity_skills (opportunity_id, skill_id) VALUES (?, ?)', [opportunityId, skillId]);
  }
}

/** Maps validated API input onto opportunity columns. */
function toColumns(d) {
  return {
    title: d.title,
    summary: d.summary,
    description: d.description,
    responsibilities: d.responsibilities,
    eligibility: d.eligibility,
    academic_requirements: d.academicRequirements,
    academic_level: d.academicLevel,
    eligible_years: JSON.stringify(d.eligibleYears || []),
    required_documents: d.requiredDocuments,
    industry: d.industry,
    country: d.country,
    city: d.city,
    work_mode: d.workMode,
    duration_weeks: d.durationWeeks,
    start_date: d.startDate,
    end_date: d.endDate,
    is_paid: d.isPaid ? 1 : 0,
    stipend_amount: d.isPaid ? d.stipendAmount : null,
    stipend_currency: d.isPaid ? d.stipendCurrency : null,
    stipend_usd_monthly: toUsdMonthly(d.isPaid, d.stipendAmount, d.stipendCurrency),
    visa_sponsorship: d.visaSponsorship,
    visa_details: d.visaDetails,
    relocation_support: d.relocationSupport,
    accommodation_support: d.accommodationSupport,
    application_deadline: d.applicationDeadline,
    application_mode: d.applicationMode,
    application_url: d.applicationUrl,
    no_fee_confirmed: d.noFeeConfirmed ? 1 : 0,
  };
}

/**
 * Transparency metric shown on organisation pages: share of HORIZON applications that received
 * a first response within the recruiter response window. Null until there is enough data.
 */
function responseStats(orgId) {
  const days = config.recruiterResponseDays;
  const rows = getDb().all(`
    SELECT a.submitted_at, a.first_response_at FROM applications a
    JOIN opportunities o ON o.id = a.opportunity_id
    WHERE o.organisation_id = ? AND a.channel = 'horizon' AND a.submitted_at IS NOT NULL`, [orgId]);
  const now = Date.now();
  let eligible = 0; let within = 0; let totalDays = 0; let responded = 0;
  for (const r of rows) {
    const sub = parseSql(r.submitted_at).getTime();
    const res = r.first_response_at ? parseSql(r.first_response_at).getTime() : null;
    const windowOver = now - sub > days * 86400000;
    if (res || windowOver) eligible += 1;
    if (res) { responded += 1; totalDays += (res - sub) / 86400000; if (res - sub <= days * 86400000) within += 1; }
  }
  return {
    windowDays: days,
    applications: rows.length,
    sample: eligible,
    responseRate: eligible >= 3 ? Math.round((within / eligible) * 100) : null,
    averageResponseDays: responded ? Math.round((totalDays / responded) * 10) / 10 : null,
    enoughData: eligible >= 3,
  };
}

function archiveExpired() {
  return getDb().run("UPDATE opportunities SET status = 'archived', archived_at = ?, updated_at = ? WHERE status = 'published' AND application_deadline < date('now')", [nowSql(), nowSql()]).changes;
}

module.exports = { BASE_SELECT, OPEN_WHERE, SORTS, buildFilters, search, decorate, getRow, listOpen, serializeCard, serializeDetail, syncSkills, toColumns, responseStats, archiveExpired, toList };
