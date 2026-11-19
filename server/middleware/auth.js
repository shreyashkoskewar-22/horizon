'use strict';
/** Session → user loading and server-side authorisation guards. */
const { getDb } = require('../db');
const { HttpError } = require('../lib/util');

const USER_SQL = `
  SELECT u.*, i.name AS institution_name, i.short_name AS institution_short,
         o.name AS organisation_name, o.verification_status AS organisation_status
  FROM users u
  LEFT JOIN institutions i ON i.id = u.institution_id
  LEFT JOIN organisations o ON o.id = u.organisation_id
  WHERE u.id = ?`;

function loadUser(req, res, next) {
  const id = req.session && req.session.userId;
  if (!id) return next();
  const user = getDb().get(USER_SQL, [id]);
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

module.exports = { loadUser, requireAuth, requireRole, requireApproved, allow, USER_SQL };
