'use strict';
/**
 * Test harness. Each test file runs in its own process (node --test), so each gets a fresh
 * temporary database and storage folder seeded with the demo data. Environment variables are
 * set before any server module is loaded, because configuration is read once at start-up.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'horizon-test-'));
const defaults = {
  NODE_ENV: 'test',
  HORIZON_ENV_FILE: path.join(tmp, 'no-such.env'), // never read a developer's .env during tests
  DATA_DIR: tmp,
  DATABASE_FILE: path.join(tmp, 'test.db'),
  STORAGE_DIR: path.join(tmp, 'storage'),
  CAPTCHA_PROVIDER: 'dev-bypass',
  SESSION_SECRET: 'horizon-test-session-secret-0123456789abcdef',
  DEV_MAILBOX: 'true',
  RATE_LIMIT_DISABLED: process.env.HORIZON_TEST_RATE_LIMITS === 'on' ? 'false' : 'true',
  SMTP_HOST: '', // never send real mail from tests
};
Object.assign(process.env, defaults);

const request = require('supertest');
const { createApp } = require('../server/app');
const { getDb, closeDb } = require('../server/db');
const { seed } = require('../server/db/seed');
const { makeCvPdf } = require('../server/lib/simple-pdf');

const CAPTCHA = 'horizon-dev-captcha-pass';
const ACCOUNTS = {
  admin: ['admin@horizon.example', 'Horizon!Admin2026'],
  riya: ['riya.demo@iimidr.ac.in', 'Horizon!Student2026'],
  arjun: ['arjun.demo@iitb.ac.in', 'Horizon!Student2026'],
  sara: ['sara.demo@nitt.edu', 'Horizon!Student2026'],
  kabir: ['kabir.pending@example.org', 'Horizon!Pending2026'],
  mei: ['talent@meridianarc.example', 'Horizon!Recruiter2026'],
  eleanor: ['eleanor.hughes@northbankridge.example', 'Horizon!Recruiter2026'],
  jonas: ['jonas@kestrelwave.example', 'Horizon!Recruiter2026'],
  daniel: ['daniel@harbourline.example', 'Horizon!Pending2026'],
};

let app;
async function setup() {
  if (app) return app;
  app = createApp();
  await seed(getDb(), { log: () => {} });
  return app;
}

function teardown() {
  try { closeDb(); } catch { /* already closed */ }
  fs.rmSync(tmp, { recursive: true, force: true });
}

/** A browser-like client: keeps cookies and sends the CSRF token on every state-changing call. */
class Client {
  constructor() { this.agent = request.agent(app); this.csrf = null; }

  async token() {
    if (!this.csrf) this.csrf = (await this.agent.get('/api/auth/csrf')).body.csrfToken;
    return this.csrf;
  }

  get(url, query = {}) { return this.agent.get(url).query(query); }

  async send(method, url, body, headers = {}) {
    const token = await this.token(); // fetch first: the agent attaches cookies when a request is created
    const res = await this.agent[method](url).set('X-CSRF-Token', token).set(headers).send(body);
    if (res.body && res.body.csrfToken) this.csrf = res.body.csrfToken;
    return res;
  }

  post(url, body = {}, headers) { return this.send('post', url, body, headers); }
  put(url, body = {}, headers) { return this.send('put', url, body, headers); }
  patch(url, body = {}, headers) { return this.send('patch', url, body, headers); }
  del(url, body = {}, headers) { return this.send('delete', url, body, headers); }

  async upload(url, field, buffer, filename, fields = {}) {
    const token = await this.token();
    let req = this.agent.post(url).set('X-CSRF-Token', token).attach(field, buffer, filename);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, String(v));
    return req;
  }

  async login(who, password) {
    const [email, pw] = ACCOUNTS[who] || [who, password];
    const res = await this.post('/api/auth/login', { email, password: pw, captchaToken: CAPTCHA });
    if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }
}

const client = () => new Client();
async function as(who) { const c = new Client(); await c.login(who); return c; }

const db = () => getDb();
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const YEAR = new Date().getUTCFullYear();

function institutionId(name) {
  const row = db().get('SELECT id FROM institutions WHERE name = ?', [name]);
  if (!row) throw new Error(`No institution ${name}`);
  return row.id;
}

function studentPayload(overrides = {}) {
  return {
    accountType: 'student',
    fullName: 'Meera Pillai',
    email: 'meera.test@iitb.ac.in',
    password: 'Bright!Future2026',
    confirmPassword: 'Bright!Future2026',
    acceptTerms: true,
    captchaToken: CAPTCHA,
    institutionId: institutionId('Indian Institute of Technology Bombay'),
    programme: 'B.Tech, Computer Science and Engineering',
    academicLevel: 'undergraduate',
    currentYear: 2,
    graduationYear: YEAR + 2,
    ...overrides,
  };
}

function listingPayload(overrides = {}) {
  return {
    title: 'Data Strategy Summer Intern',
    summary: 'Help a regional team turn operational data into decisions for expansion planning.',
    description: 'You will work with the analytics team on market sizing, dashboards and a final recommendation to leadership. Mentorship and weekly feedback included.',
    industry: 'Data Analytics',
    country: 'Singapore',
    city: 'Singapore',
    workMode: 'hybrid',
    durationWeeks: 10,
    isPaid: true,
    stipendAmount: 2000,
    stipendCurrency: 'SGD',
    visaSponsorship: 'case_by_case',
    applicationDeadline: inDays(30),
    applicationMode: 'external',
    applicationUrl: 'https://example.com/careers/data-strategy',
    skills: ['SQL', 'Excel'],
    noFeeConfirmed: true,
    ...overrides,
  };
}

/** Reads the six-digit code from the development outbox for the signed-in user. */
async function latestCode(c) {
  const res = await c.get('/api/auth/dev-mailbox');
  const subject = (res.body.messages || [])[0]?.subject || '';
  const m = subject.match(/^(\d{6})/);
  if (!m) throw new Error(`No verification code in outbox: ${JSON.stringify(res.body)}`);
  return m[1];
}

const cvPdf = (opts) => makeCvPdf({ email: 'student@example.org', programme: 'B.Tech', ...opts });

module.exports = { setup, teardown, client, as, db, today, inDays, YEAR, CAPTCHA, ACCOUNTS, institutionId, studentPayload, listingPayload, latestCode, cvPdf };
