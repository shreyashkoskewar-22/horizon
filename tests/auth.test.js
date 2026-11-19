'use strict';
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.setup);
after(h.teardown);

describe('public configuration', () => {
  test('exposes CAPTCHA settings but never secrets or demo credentials outside development', async () => {
    const res = await h.client().get('/api/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.captcha.provider, 'dev-bypass');
    assert.equal(res.body.demoAccounts, undefined);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('1x0000000000000000000000000000000AA'), 'secret key must not be exposed');
    assert.ok(!text.includes('Horizon!'), 'no passwords in config');
  });
});

describe('student registration', () => {
  test('registers, verifies the email code and is auto-approved by institutional domain', async () => {
    const c = h.client();
    const res = await c.post('/api/auth/register', h.studentPayload());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.user.status, 'pending');
    assert.equal(res.body.verification.needsEmail, true);
    assert.equal(res.body.next, '/verify');

    const blocked = await c.get('/api/opportunities');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'ACCOUNT_NOT_APPROVED');

    const code = await h.latestCode(c);
    const wrong = await c.post('/api/auth/verify-email', { code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 422);
    assert.match(wrong.body.error.fields.code, /attempt/);

    const ok = await c.post('/api/auth/verify-email', { code });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user.status, 'approved');
    assert.equal(ok.body.user.verificationMethod, 'email_domain');
    assert.equal(ok.body.home, '/app');
    assert.equal((await c.get('/api/opportunities')).status, 200);
  });

  test('a student without a verified institutional domain must upload proof for manual review', async () => {
    const c = h.client();
    const res = await c.post('/api/auth/register', h.studentPayload({
      email: 'ishaan.test@example.org', fullName: 'Ishaan Verma',
      institutionId: h.institutionId('All India Institute of Medical Sciences, New Delhi'), programme: 'MBBS',
    }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const verified = await c.post('/api/auth/verify-email', { code: await h.latestCode(c) });
    assert.equal(verified.body.user.status, 'pending');
    assert.equal(verified.body.verification.needsProof, true);

    const notPdf = await c.upload('/api/auth/verification-proof', 'document', Buffer.from('just text, not an id card'), 'id.pdf');
    assert.equal(notPdf.status, 422);
    const proof = await c.upload('/api/auth/verification-proof', 'document', h.cvPdf({ name: 'Ishaan Verma', institution: 'AIIMS New Delhi', graduationYear: h.YEAR + 3 }), 'student-id.pdf', { note: 'Student ID card attached.' });
    assert.equal(proof.status, 201, JSON.stringify(proof.body));
    assert.ok(proof.body.verification.pendingRequest);
    const again = await c.upload('/api/auth/verification-proof', 'document', h.cvPdf({ name: 'Ishaan Verma', institution: 'AIIMS', graduationYear: h.YEAR + 3 }), 'again.pdf');
    assert.equal(again.status, 409);
  });

  test('rejects invalid input with field-level errors', async () => {
    const c = h.client();
    const res = await c.post('/api/auth/register', h.studentPayload({ email: 'not-an-email', password: 'short', confirmPassword: 'different', acceptTerms: false }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    for (const f of ['email', 'password', 'acceptTerms']) assert.ok(res.body.error.fields[f], `expected an error for ${f}`);
  });

  test('rejects mismatched passwords', async () => {
    const res = await h.client().post('/api/auth/register', h.studentPayload({ email: 'mismatch@iitb.ac.in', confirmPassword: 'Another!Pass2026' }));
    assert.equal(res.status, 422);
    assert.ok(res.body.error.fields.confirmPassword);
  });

  test('rejects a duplicate email', async () => {
    const res = await h.client().post('/api/auth/register', h.studentPayload({ email: 'riya.demo@iimidr.ac.in', institutionId: h.institutionId('Indian Institute of Management Indore') }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });

  test('rejects an email domain that belongs to a different institution', async () => {
    const res = await h.client().post('/api/auth/register', h.studentPayload({ email: 'x.student@iitb.ac.in', institutionId: h.institutionId('Indian Institute of Technology Delhi') }));
    assert.equal(res.status, 422);
    assert.match(res.body.error.fields.email, /belongs to/);
  });

  test('rejects institutions that are not verified INIs', async () => {
    const unverified = h.db().get("SELECT id FROM institutions WHERE verification_status = 'unverified' LIMIT 1");
    assert.ok(unverified, 'seed includes an unverified institution');
    const res = await h.client().post('/api/auth/register', h.studentPayload({ email: 'y.student@example.org', institutionId: unverified.id }));
    assert.equal(res.status, 422);
    assert.ok(res.body.error.fields.institutionId);
  });

  test('requires a CAPTCHA token verified on the server', async () => {
    const missing = await h.client().post('/api/auth/register', h.studentPayload({ email: 'cap1@iitb.ac.in', captchaToken: undefined }));
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'CAPTCHA_FAILED');
    const forged = await h.client().post('/api/auth/register', h.studentPayload({ email: 'cap2@iitb.ac.in', captchaToken: 'fake-token' }));
    assert.equal(forged.status, 400);
    assert.equal(h.db().value("SELECT COUNT(*) FROM users WHERE email IN ('cap1@iitb.ac.in','cap2@iitb.ac.in')"), 0);
  });
});

describe('recruiter registration', () => {
  test('refuses personal email providers', async () => {
    const res = await h.client().post('/api/auth/register', {
      accountType: 'recruiter', fullName: 'Pat Recruiter', email: 'pat.recruiter@gmail.com', password: 'Hiring!Team2026', confirmPassword: 'Hiring!Team2026',
      acceptTerms: true, captchaToken: h.CAPTCHA, designation: 'Talent Lead', organisationMode: 'new', authorisedRepresentative: true,
      organisation: { name: 'Pat Analytics', website: 'https://patanalytics.example', orgType: 'Startup', country: 'Germany' },
    });
    assert.equal(res.status, 422);
    assert.match(res.body.error.fields.email, /work email/i);
  });

  test('a work-email recruiter for a new organisation stays pending until an administrator verifies both', async () => {
    const c = h.client();
    const res = await c.post('/api/auth/register', {
      accountType: 'recruiter', fullName: 'Lena Fischer', email: 'lena@nordlicht.example', password: 'Hiring!Team2026', confirmPassword: 'Hiring!Team2026',
      acceptTerms: true, captchaToken: h.CAPTCHA, designation: 'Head of Talent', organisationMode: 'new', authorisedRepresentative: true,
      organisation: { name: 'Nordlicht Robotics', website: 'https://www.nordlicht.example', orgType: 'Startup', country: 'Germany' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await c.post('/api/auth/verify-email', { code: await h.latestCode(c) });
    const me = await c.get('/api/auth/me');
    assert.equal(me.body.user.status, 'pending');
    assert.equal((await c.get('/api/recruiter/dashboard')).status, 403);
    const post = await c.post('/api/opportunities', h.listingPayload());
    assert.equal(post.status, 403);
  });
});

describe('sign-in and sessions', () => {
  test('wrong password is rejected with a generic message', async () => {
    const res = await h.client().post('/api/auth/login', { email: 'riya.demo@iimidr.ac.in', password: 'Wrong!Pass2026', captchaToken: h.CAPTCHA });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
    const unknown = await h.client().post('/api/auth/login', { email: 'nobody@example.org', password: 'Wrong!Pass2026', captchaToken: h.CAPTCHA });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.message, res.body.error.message);
  });

  test('login requires the CAPTCHA', async () => {
    const res = await h.client().post('/api/auth/login', { email: 'riya.demo@iimidr.ac.in', password: 'Horizon!Student2026' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'CAPTCHA_FAILED');
  });

  test('login, session and logout', async () => {
    const c = h.client();
    const res = await c.post('/api/auth/login', { email: 'riya.demo@iimidr.ac.in', password: 'Horizon!Student2026', captchaToken: h.CAPTCHA });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'student');
    assert.equal(res.body.home, '/app');
    const cookie = (res.headers['set-cookie'] || []).find((x) => x.startsWith('horizon.sid='));
    assert.ok(cookie, 'session cookie set');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.ok(!JSON.stringify(res.body).includes('password'), 'no password data in the response');
    assert.equal((await c.get('/api/auth/me')).body.user.email, 'riya.demo@iimidr.ac.in');
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    assert.equal((await c.get('/api/auth/me')).body.user, null);
    assert.equal((await c.get('/api/dashboard')).status, 401);
  });

  test('state-changing requests need a valid CSRF token and same origin', async () => {
    const c = h.client();
    await c.login('riya');
    const noToken = await c.agent.post('/api/saved/1').send({});
    assert.equal(noToken.status, 403);
    assert.equal(noToken.body.error.code, 'CSRF_INVALID');
    const crossSite = await c.agent.post('/api/saved/1').set('X-CSRF-Token', await c.token()).set('Origin', 'https://evil.example').send({});
    assert.equal(crossSite.status, 403);
  });

  test('locks an account after repeated failures', async () => {
    const c = h.client();
    for (let i = 0; i < 8; i += 1) await c.post('/api/auth/login', { email: 'sara.demo@nitt.edu', password: `Wrong!Pass${i}x`, captchaToken: h.CAPTCHA });
    const locked = await c.post('/api/auth/login', { email: 'sara.demo@nitt.edu', password: 'Horizon!Student2026', captchaToken: h.CAPTCHA });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED');
    h.db().run("UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE email = 'sara.demo@nitt.edu'");
  });

  test('a pending account cannot use protected features', async () => {
    const c = await h.as('kabir');
    for (const url of ['/api/opportunities', '/api/dashboard', '/api/applications', '/api/saved']) {
      const res = await c.get(url);
      assert.equal(res.status, 403, url);
      assert.equal(res.body.error.code, 'ACCOUNT_NOT_APPROVED');
    }
    const page = await c.get('/app');
    assert.equal(page.status, 302);
    assert.equal(page.headers.location, '/verify');
  });

  test('suspension ends existing sessions and blocks sign-in', async () => {
    const student = await h.as('arjun');
    const admin = await h.as('admin');
    const arjun = h.db().get("SELECT id FROM users WHERE email = 'arjun.demo@iitb.ac.in'");
    const noReason = await admin.put(`/api/admin/users/${arjun.id}/status`, { status: 'suspended' });
    assert.equal(noReason.status, 422);
    const res = await admin.put(`/api/admin/users/${arjun.id}/status`, { status: 'suspended', reason: 'Investigating a reported fee request.' });
    assert.equal(res.status, 200);
    assert.equal((await student.get('/api/dashboard')).status, 401);
    const login = await h.client().post('/api/auth/login', { email: 'arjun.demo@iitb.ac.in', password: 'Horizon!Student2026', captchaToken: h.CAPTCHA });
    assert.equal(login.status, 403);
    assert.equal(login.body.error.code, 'ACCOUNT_SUSPENDED');
    assert.equal((await admin.put(`/api/admin/users/${arjun.id}/status`, { status: 'approved' })).status, 200);
    assert.equal((await h.client().post('/api/auth/login', { email: 'arjun.demo@iitb.ac.in', password: 'Horizon!Student2026', captchaToken: h.CAPTCHA })).status, 200);
  });
});

describe('page protection', () => {
  test('anonymous visitors are sent to the login page', async () => {
    for (const p of ['/app', '/app/explore', '/recruiter', '/admin', '/admin/students']) {
      const res = await h.client().get(p);
      assert.equal(res.status, 302, p);
      assert.match(res.headers.location, /^\/login\?next=/);
    }
  });

  test('signed-in users cannot open another role’s workspace', async () => {
    const student = await h.as('riya');
    const toAdmin = await student.get('/admin/students');
    assert.equal(toAdmin.status, 302);
    assert.equal(toAdmin.headers.location, '/app');
    const recruiter = await h.as('mei');
    assert.equal((await recruiter.get('/app/explore')).headers.location, '/recruiter');
  });

  test('public pages load and raw HTML files are not directly reachable', async () => {
    const c = h.client();
    for (const p of ['/', '/login', '/register', '/grievance-redressal', '/transparency', '/terms', '/privacy']) assert.equal((await c.get(p)).status, 200, p);
    assert.equal((await c.get('/app.html')).status, 404);
    assert.equal((await c.get('/does-not-exist')).status, 404);
  });
});
