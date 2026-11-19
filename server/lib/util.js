'use strict';
const crypto = require('node:crypto');

/** Timestamps are stored in SQLite's UTC text format: YYYY-MM-DD HH:MM:SS */
const toSql = (d) => (d instanceof Date ? d : new Date(d)).toISOString().replace('T', ' ').slice(0, 19);
const nowSql = () => toSql(new Date());
const parseSql = (s) => (s ? new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`) : null);
const addHours = (d, h) => new Date(d.getTime() + h * 3600 * 1000);
const addDays = (d, n) => addHours(d, n * 24);
const dateOnly = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
const todayDate = () => dateOnly(new Date());

class HttpError extends Error {
  constructor(status, message, { code, fields, details } = {}) {
    super(message);
    this.status = status;
    this.code = code || (status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : status === 401 ? 'AUTH_REQUIRED' : status === 422 ? 'VALIDATION_FAILED' : 'ERROR');
    this.fields = fields;
    this.details = details;
  }
}

const notFound = (what = 'Resource') => new HttpError(404, `${what} not found.`);

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch { return []; }
}
function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const hmac = (secret, value) => crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Domain helpers */
const emailDomain = (email) => String(email).split('@').pop().toLowerCase().trim();
function hostFromUrl(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
/** True when `domain` equals `base` or is a subdomain of it (e.g. smail.iitm.ac.in → iitm.ac.in). */
const domainMatches = (domain, base) => !!domain && !!base && (domain === base || domain.endsWith(`.${base}`));

function initials(name) {
  return String(name || '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'H';
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function paginate(query, { defaultSize = 12, maxSize = 50 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const pageResult = (items, total, { page, pageSize }) => ({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });

/** Escape LIKE wildcards in user input (used with ESCAPE '\'). */
const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

module.exports = {
  toSql, nowSql, parseSql, addHours, addDays, dateOnly, todayDate,
  HttpError, notFound, parseJsonArray, parseJson, sha256, hmac, randomToken, safeEqual,
  emailDomain, hostFromUrl, domainMatches, initials, slugify, paginate, pageResult, likeEscape,
};
