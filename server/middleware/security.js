'use strict';
const crypto = require('node:crypto');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const config = require('../config');
const { HttpError, safeEqual } = require('../lib/util');

function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
        frameSrc: ["'self'", 'https://challenges.cloudflare.com'],
        connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

/** Synchronizer-token CSRF protection: the token lives in the server-side session. */
function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('base64url');
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* invalid origin */ }
    if (host !== req.get('host')) return next(new HttpError(403, 'Cross-site request blocked.', { code: 'CSRF_INVALID' }));
  }
  const sent = req.get('x-csrf-token');
  const expected = req.session && req.session.csrfToken;
  if (!sent || !expected || !safeEqual(sent, expected)) {
    return next(new HttpError(403, 'Your session has expired or this request could not be verified. Refresh the page and try again.', { code: 'CSRF_INVALID' }));
  }
  return next();
}

function limiter({ windowMs, limit, message }) {
  if (config.rateLimits.disabled) return (req, res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, next) => next(new HttpError(429, message, { code: 'RATE_LIMITED' })),
  });
}

const limiters = {
  api: limiter({ windowMs: 15 * 60 * 1000, limit: config.rateLimits.apiMax, message: 'Too many requests. Please slow down and try again shortly.' }),
  login: limiter({ windowMs: 15 * 60 * 1000, limit: config.rateLimits.loginMax, message: 'Too many sign-in attempts from this network. Please wait 15 minutes and try again.' }),
  register: limiter({ windowMs: 60 * 60 * 1000, limit: config.rateLimits.registerMax, message: 'Too many registration attempts from this network. Please try again later.' }),
  otp: limiter({ windowMs: 15 * 60 * 1000, limit: 12, message: 'Too many verification attempts. Please wait a few minutes.' }),
  resend: limiter({ windowMs: 15 * 60 * 1000, limit: 4, message: 'You have requested several codes. Please wait 15 minutes before requesting another.' }),
  grievance: limiter({ windowMs: 60 * 60 * 1000, limit: 12, message: 'Too many grievance submissions from this network. Please try again later.' }),
  track: limiter({ windowMs: 15 * 60 * 1000, limit: 30, message: 'Too many tracking attempts. Please wait a few minutes.' }),
  upload: limiter({ windowMs: 60 * 60 * 1000, limit: 40, message: 'Too many uploads. Please try again later.' }),
};

module.exports = { securityHeaders, csrfToken, csrfProtection, limiters };
