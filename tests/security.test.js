'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

// This file runs with rate limiting ON (other files disable it to stay fast).
process.env.HORIZON_TEST_RATE_LIMITS = 'on';
process.env.LOGIN_RATE_LIMIT = '5';
const h = require('./helpers');

before(h.setup);
after(h.teardown);

describe('rate limiting', () => {
  test('blocks repeated sign-in attempts from one client', async () => {
    const c = h.client();
    const statuses = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await c.post('/api/auth/login', { email: 'nobody@example.org', password: 'Wrong!Pass2026', captchaToken: h.CAPTCHA });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.equal(statuses[5], 429);
    const blocked = await c.post('/api/auth/login', { email: 'riya.demo@iimidr.ac.in', password: 'Horizon!Student2026', captchaToken: h.CAPTCHA });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.ratelimit || blocked.headers['ratelimit-policy'] || blocked.headers['retry-after']);
  });
});

describe('HTTP hardening', () => {
  test('sends security headers and hides the framework', async () => {
    const res = await h.client().get('/');
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
    assert.match(res.headers['content-security-policy'], /challenges\.cloudflare\.com/);
    assert.match(res.headers['content-security-policy'], /object-src 'none'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['x-frame-options'] || /frame-ancestors/.test(res.headers['content-security-policy']));
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('API responses are not cached and errors do not leak internals', async () => {
    const res = await h.client().get('/api/opportunities/abc');
    assert.equal(res.status, 401);
    assert.match(res.headers['cache-control'], /no-store/);
    const bad = await h.client().agent.post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    assert.ok([400, 403].includes(bad.status));
    assert.ok(!JSON.stringify(bad.body).includes('/home/'), 'no file paths in errors');
  });

  test('private storage is never served statically', async () => {
    for (const p of ['/storage/', '/data/horizon.db', '/server/config.js', '/.env', '/package.json']) {
      assert.equal((await h.client().get(p)).status, 404, p);
    }
  });

  test('production configuration refuses unsafe settings', () => {
    const { execFileSync } = require('node:child_process');
    const run = (env) => {
      try {
        execFileSync(process.execPath, ['-e', "require('./server/config')"], { cwd: require('node:path').join(__dirname, '..'), env: { PATH: process.env.PATH, HORIZON_ENV_FILE: '/nonexistent', ...env }, stdio: 'pipe' });
        return '';
      } catch (err) { return String(err.stderr); }
    };
    const testKeys = run({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), SEED_ON_START: 'false', DEV_MAILBOX: 'false' });
    assert.match(testKeys, /Turnstile keys/);
    const bypass = run({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), CAPTCHA_PROVIDER: 'dev-bypass', TURNSTILE_SITE_KEY: 'real-site', TURNSTILE_SECRET_KEY: 'real-secret', SEED_ON_START: 'false', DEV_MAILBOX: 'false' });
    assert.match(bypass, /CAPTCHA_PROVIDER must be "turnstile"/);
    const weak = run({ NODE_ENV: 'production', SESSION_SECRET: 'short', TURNSTILE_SITE_KEY: 'real-site', TURNSTILE_SECRET_KEY: 'real-secret', SEED_ON_START: 'false', DEV_MAILBOX: 'false' });
    assert.match(weak, /SESSION_SECRET/);
    const ok = run({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), TURNSTILE_SITE_KEY: 'real-site', TURNSTILE_SECRET_KEY: 'real-secret', SEED_ON_START: 'false', DEV_MAILBOX: 'false' });
    assert.equal(ok, '');
  });

  test('the seed script refuses to run in production', () => {
    const { execFileSync } = require('node:child_process');
    let out = '';
    try {
      execFileSync(process.execPath, ['server/db/seed.js'], {
        cwd: require('node:path').join(__dirname, '..'),
        env: { PATH: process.env.PATH, HORIZON_ENV_FILE: '/nonexistent', NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), TURNSTILE_SITE_KEY: 'real-site', TURNSTILE_SECRET_KEY: 'real-secret', SEED_ON_START: 'false', DEV_MAILBOX: 'false', DATABASE_FILE: require('node:path').join(require('node:os').tmpdir(), 'horizon-prod-seed-test.db') },
        stdio: 'pipe',
      });
    } catch (err) { out = String(err.stderr) + String(err.stdout); }
    assert.match(out, /production/i);
  });
});
