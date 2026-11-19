'use strict';
/** Session → user loading and server-side authorisation guards. */
const config = require('../config');
const { getDb } = require('../db');
const { HttpError, hmac, safeEqual, nowSql } = require('../lib/util');

const USER_SQL = `
  SELECT u.*, i.name AS institution_name, i.short_name AS institution_short,
         o.name AS organisation_name, o.verification_status AS organisation_status
  FROM users u
  LEFT JOIN institutions i ON i.id = u.institution_id
  LEFT JOIN organisations o ON o.id = u.organisation_id
  WHERE u.id = ?`;

function getCookie(req, name) {
  const header = req.get('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function signUserToken(user, secret) {
  const data = Buffer.from(JSON.stringify(user)).toString('base64url');
  const sig = hmac(secret, data);
  return `${data}.${sig}`;
}

function verifyUserToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = hmac(secret, data);
  if (!safeEqual(sig, expectedSig)) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function setUserCookie(res, user) {
  if (!res || typeof res.cookie !== 'function' || !user) return;
  try {
    const db = getDb();
    let studentProfile = null;
    let recruiterProfile = null;
    if (user.role === 'student') {
      studentProfile = db.get('SELECT programme, academic_level, current_year, graduation_year FROM student_profiles WHERE user_id = ?', [user.id]);
    } else if (user.role === 'recruiter') {
      recruiterProfile = db.get('SELECT designation FROM recruiter_profiles WHERE user_id = ?', [user.id]);
    }
    const payload = {
      id: user.id,
      role: user.role,
      full_name: user.full_name,
      email: user.email,
      password_hash: user.password_hash,
      status: user.status,
      status_reason: user.status_reason || null,
      email_verified_at: user.email_verified_at || null,
      verification_method: user.verification_method || null,
      institution_id: user.institution_id || null,
      organisation_id: user.organisation_id || null,
      created_at: user.created_at || nowSql(),
      updated_at: user.updated_at || nowSql(),
      studentProfile,
      recruiterProfile,
    };
    const token = signUserToken(payload, config.sessionSecret);
    res.cookie('horizon.usr', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: config.sessionMaxAgeHours * 3600 * 1000,
      path: '/',
    });
  } catch (err) {
    console.error('[setUserCookie error]', err.message);
  }
}

function restoreUserFromPayload(db, p) {
  db.run(
    `INSERT OR REPLACE INTO users (id, role, full_name, email, password_hash, status, status_reason, email_verified_at, verification_method, institution_id, organisation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.id, p.role, p.full_name, p.email, p.password_hash, p.status, p.status_reason || null, p.email_verified_at || null, p.verification_method || null, p.institution_id || null, p.organisation_id || null, p.created_at || nowSql(), p.updated_at || nowSql()]
  );
  if (p.role === 'student' && p.studentProfile) {
    db.run(
      `INSERT OR REPLACE INTO student_profiles (user_id, programme, academic_level, current_year, graduation_year)
       VALUES (?, ?, ?, ?, ?)`,
      [p.id, p.studentProfile.programme, p.studentProfile.academic_level, p.studentProfile.current_year, p.studentProfile.graduation_year]
    );
  } else if (p.role === 'recruiter' && p.recruiterProfile) {
    db.run(
      `INSERT OR REPLACE INTO recruiter_profiles (user_id, designation) VALUES (?, ?)`,
      [p.id, p.recruiterProfile.designation]
    );
  }
}

function loadUser(req, res, next) {
  const db = getDb();
  let id = req.session && req.session.userId;

  const usrCookie = getCookie(req, 'horizon.usr');
  const payload = usrCookie ? verifyUserToken(usrCookie, config.sessionSecret) : null;

  if (!id && payload && payload.id) {
    id = payload.id;
    if (req.session) req.session.userId = id;
  }

  if (!id) return next();

  let user = db.get(USER_SQL, [id]);

  if (!user && payload && payload.id === id) {
    try {
      restoreUserFromPayload(db, payload);
      user = db.get(USER_SQL, [id]);
    } catch (e) {
      console.error('[restore user error]', e.message);
    }
  }

  if (!user) { delete req.session.userId; return next(); }
  if (user.status === 'suspended') {
    delete req.session.userId;
    req.accountSuspended = true;
    return next();
  }
  req.user = user;
  return next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.accountSuspended) return next(new HttpError(401, 'This account has been suspended. Contact the grievance desk if you believe this is a mistake.', { code: 'ACCOUNT_SUSPENDED' }));
  return next(new HttpError(401, 'Please sign in to continue.', { code: 'AUTH_REQUIRED' }));
}

const requireRole = (...roles) => (req, res, next) => (roles.includes(req.user.role)
  ? next()
  : next(new HttpError(403, 'You do not have permission to access this.', { code: 'FORBIDDEN' })));

function requireApproved(req, res, next) {
  const u = req.user;
  if (u.status === 'approved' && (u.email_verified_at || u.role === 'admin')) return next();
  return next(new HttpError(403, 'Your account needs to be verified before you can use this feature.', { code: 'ACCOUNT_NOT_APPROVED' }));
}

/** Convenience: authenticated + one of roles + verified/approved account. */
const allow = (...roles) => [requireAuth, requireRole(...roles), requireApproved];

module.exports = { loadUser, requireAuth, requireRole, requireApproved, allow, USER_SQL, setUserCookie };
