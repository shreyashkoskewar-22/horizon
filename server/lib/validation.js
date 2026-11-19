'use strict';
/** Shared Zod building blocks: every string is trimmed and stripped of control characters. */
const { z } = require('zod');
const { HttpError } = require('./util');

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (v) => (typeof v === 'string' ? v.replace(CONTROL, '').replace(/\r\n/g, '\n').trim() : v);
const emptyToNull = (v) => { const c = clean(v); return c === '' || c === undefined ? null : c; };

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isHttpUrl(s) {
  try { const u = new URL(s); return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname; } catch { return false; }
}
function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const text = (min, max, label = 'This field') => z.preprocess(clean, z.string({ error: `${label} is required.` })
  .min(min, min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
  .max(max, `${label} must be ${max} characters or fewer.`));

const optText = (max, label = 'This field') => z.preprocess(emptyToNull, z.string().max(max, `${label} must be ${max} characters or fewer.`).nullable()).optional().transform((v) => v ?? null);

const email = z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.string({ error: 'Email is required.' })
  .min(1, 'Email is required.').max(254, 'Email is too long.').regex(EMAIL_RE, 'Enter a valid email address.'));

const password = z.string({ error: 'Password is required.' })
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password must be 128 characters or fewer.')
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Use upper- and lower-case letters and at least one number.');

const url = (label = 'Link') => z.preprocess(emptyToNull, z.string().max(500, `${label} is too long.`)
  .refine(isHttpUrl, 'Enter a valid link starting with https://').nullable()).optional().transform((v) => v ?? null);

const date = (label = 'Date') => z.preprocess(clean, z.string({ error: `${label} is required.` }).refine(isValidDate, `Enter a valid ${label.toLowerCase()}.`));
const optDate = (label = 'Date') => z.preprocess(emptyToNull, z.string().refine(isValidDate, `Enter a valid ${label.toLowerCase()}.`).nullable()).optional().transform((v) => v ?? null);
const optDateTime = (label = 'Date and time') => z.preprocess(emptyToNull, z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), `Enter a valid ${label.toLowerCase()}.`).nullable()).optional().transform((v) => v ?? null);

const id = z.coerce.number({ error: 'Invalid identifier.' }).int().positive('Invalid identifier.');
const bool = z.preprocess((v) => (v === 'true' || v === '1' || v === 'on' ? true : v === 'false' || v === '0' || v === '' ? false : v), z.boolean());
const tagList = (maxItems, maxLen, label = 'Item') => z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',') : v),
  z.array(z.preprocess(clean, z.string().max(maxLen, `${label} must be ${maxLen} characters or fewer.`)))
    .transform((arr) => [...new Set(arr.filter(Boolean))])
    .pipe(z.array(z.string()).max(maxItems, `Add at most ${maxItems} ${label.toLowerCase()}s.`)),
).optional().transform((v) => v ?? []);

function zodToHttp(error) {
  const fields = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (fields[key]) continue;
    const msg = /received undefined|received null/.test(issue.message) ? 'This field is required.' : issue.message;
    fields[key] = msg;
  }
  return new HttpError(422, 'Please correct the highlighted fields.', { code: 'VALIDATION_FAILED', fields });
}

/** Express middleware: validates req[source] and stores the parsed copy on req.valid[source]. */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) return next(zodToHttp(result.error));
    req.valid = req.valid || {};
    req.valid[source] = result.data;
    return next();
  };
}

function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw zodToHttp(result.error);
  return result.data;
}

module.exports = { z, clean, emptyToNull, text, optText, email, password, url, date, optDate, optDateTime, id, bool, tagList, validate, parse, zodToHttp, isHttpUrl, isValidDate, EMAIL_RE };
