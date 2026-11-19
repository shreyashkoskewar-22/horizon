'use strict';
/**
 * Central configuration. Values come from environment variables (optionally loaded
 * from a .env file at the project root). Development defaults keep the app
 * demonstrable without any external credentials; production refuses unsafe values.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const envFile = process.env.HORIZON_ENV_FILE || path.join(ROOT, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(envFile); } catch (err) { console.warn(`[config] Could not load ${envFile}: ${err.message}`); }
}

const env = process.env;
const NODE_ENV = env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

// Official Cloudflare Turnstile test credentials (always pass). Safe to publish; never valid in production.
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

const isVercel = Boolean(env.VERCEL || env.VERCEL_ENV || env.AWS_LAMBDA_FUNCTION_NAME);
const dataDir = env.DATA_DIR ? path.resolve(ROOT, env.DATA_DIR) : (isVercel ? '/tmp/data' : path.resolve(ROOT, 'data'));

function developmentSecret() {
  const file = path.join(dataDir, '.dev-session-secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* create below */ }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const port = int(env.PORT, 3000);
const captchaProvider = (env.CAPTCHA_PROVIDER || 'turnstile').toLowerCase();

const config = {
  root: ROOT,
  env: NODE_ENV,
  isProd,
  isTest,
  port,
  host: env.HOST || '127.0.0.1',
  appUrl: (env.APP_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
  dataDir,
  databaseFile: env.DATABASE_FILE ? path.resolve(ROOT, env.DATABASE_FILE) : path.join(dataDir, 'horizon.db'),
  storageDir: env.STORAGE_DIR ? path.resolve(ROOT, env.STORAGE_DIR) : (isVercel ? '/tmp/storage' : path.resolve(ROOT, 'storage')),
  publicDir: path.join(ROOT, 'public'),
  sessionSecret: env.SESSION_SECRET || (isProd && !isVercel ? '' : developmentSecret()),
  sessionMaxAgeHours: int(env.SESSION_MAX_AGE_HOURS, 8),
  bcryptRounds: int(env.BCRYPT_ROUNDS, isTest ? 4 : 12),
  captcha: {
    provider: captchaProvider, // 'turnstile' | 'dev-bypass'
    siteKey: env.TURNSTILE_SITE_KEY || TURNSTILE_TEST_SITE_KEY,
    secretKey: env.TURNSTILE_SECRET_KEY || TURNSTILE_TEST_SECRET_KEY,
    devToken: 'horizon-dev-captcha-pass',
    testKeys: { siteKey: TURNSTILE_TEST_SITE_KEY, secretKey: TURNSTILE_TEST_SECRET_KEY },
  },
  mail: {
    host: env.SMTP_HOST || '',
    port: int(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'HORIZON <no-reply@horizon.example>',
    devMailbox: bool(env.DEV_MAILBOX, !isProd),
  },
  seed: {
    onStart: bool(env.SEED_ON_START, !isProd && !isTest),
    adminEmail: env.SEED_ADMIN_EMAIL || 'admin@horizon.example',
    adminPassword: env.SEED_ADMIN_PASSWORD || 'Horizon!Admin2026',
    studentEmail: env.SEED_STUDENT_EMAIL || 'riya.demo@iimidr.ac.in',
    studentPassword: env.SEED_STUDENT_PASSWORD || 'Horizon!Student2026',
    pendingStudentEmail: env.SEED_PENDING_STUDENT_EMAIL || 'kabir.pending@example.org',
    pendingStudentPassword: env.SEED_PENDING_STUDENT_PASSWORD || 'Horizon!Pending2026',
    recruiterEmail: env.SEED_RECRUITER_EMAIL || 'talent@meridianarc.example',
    recruiterPassword: env.SEED_RECRUITER_PASSWORD || 'Horizon!Recruiter2026',
    pendingRecruiterEmail: env.SEED_PENDING_RECRUITER_EMAIL || 'daniel@harbourline.example',
    pendingRecruiterPassword: env.SEED_PENDING_RECRUITER_PASSWORD || 'Horizon!Pending2026',
  },
  uploads: {
    cvMaxMb: int(env.MAX_CV_MB, 5),
    proofMaxMb: int(env.MAX_PROOF_MB, 5),
    videoMaxMb: int(env.MAX_VIDEO_MB, 50),
    videoMaxSeconds: int(env.MAX_VIDEO_SECONDS, 120),
  },
  grievance: {
    officerName: env.GRIEVANCE_OFFICER_NAME || 'Grievance Officer (demo placeholder)',
    officerEmail: env.GRIEVANCE_OFFICER_EMAIL || 'grievance@horizon.example',
    ackHours: int(env.GRIEVANCE_ACK_HOURS, 24),
    resolveDays: int(env.GRIEVANCE_RESOLVE_DAYS, 15),
    urgentResolveHours: int(env.GRIEVANCE_URGENT_RESOLVE_HOURS, 72),
    appealDays: int(env.GRIEVANCE_APPEAL_DAYS, 30),
    reopenDays: int(env.GRIEVANCE_REOPEN_DAYS, 7),
    respondentDays: int(env.GRIEVANCE_RESPONDENT_DAYS, 5),
  },
  recruiterResponseDays: int(env.RECRUITER_RESPONSE_DAYS, 14),
  rateLimits: {
    disabled: bool(env.RATE_LIMIT_DISABLED, false),
    loginMax: int(env.LOGIN_RATE_LIMIT, 10),
    registerMax: int(env.REGISTER_RATE_LIMIT, 8),
    apiMax: int(env.API_RATE_LIMIT, 600),
  },
};

config.captcha.usingTestKeys = config.captcha.secretKey === TURNSTILE_TEST_SECRET_KEY;

function assertProductionSafety() {
  const problems = [];
  if (!config.sessionSecret || config.sessionSecret.length < 32) problems.push('SESSION_SECRET must be set to a random value of at least 32 characters.');
  if (config.captcha.provider !== 'turnstile') problems.push('CAPTCHA_PROVIDER must be "turnstile" in production.');
  if (config.captcha.usingTestKeys) problems.push('Real Cloudflare Turnstile keys (TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY) are required in production.');
  if (config.seed.onStart) problems.push('SEED_ON_START must be false in production.');
  if (config.mail.devMailbox) problems.push('DEV_MAILBOX must be false in production.');
  if (problems.length) throw new Error(`Unsafe production configuration:\n - ${problems.join('\n - ')}`);
}
if (isProd) assertProductionSafety();
if (!['turnstile', 'dev-bypass'].includes(captchaProvider)) throw new Error('CAPTCHA_PROVIDER must be "turnstile" or "dev-bypass".');

module.exports = config;
