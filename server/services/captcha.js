'use strict';
/**
 * Cloudflare Turnstile verification — always performed on the server via Siteverify.
 * CAPTCHA_PROVIDER=dev-bypass is an isolated development fallback (refused in production):
 * the server accepts only one fixed development token, so the code path is still server-side.
 */
const crypto = require('node:crypto');
const config = require('../config');
const { HttpError } = require('../lib/util');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyCaptcha(token, remoteIp) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return { success: false, codes: ['missing-input-response'] };
  }
  if (config.captcha.provider === 'dev-bypass') {
    if (config.isProd) return { success: false, codes: ['dev-bypass-disabled'] };
    return token === config.captcha.devToken
      ? { success: true, mode: 'dev-bypass' }
      : { success: false, codes: ['invalid-input-response'], mode: 'dev-bypass' };
  }
  try {
    const body = new URLSearchParams({ secret: config.captcha.secretKey, response: token, idempotency_key: crypto.randomUUID() });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    return { success: data.success === true, codes: data['error-codes'] || [], mode: 'turnstile' };
  } catch (err) {
    return { success: false, codes: ['siteverify-unreachable'], mode: 'turnstile', error: err.message };
  }
}

async function requireCaptcha(token, remoteIp) {
  const result = await verifyCaptcha(token, remoteIp);
  if (result.success) return result;
  if (result.codes.includes('siteverify-unreachable')) {
    throw new HttpError(503, 'We could not reach the CAPTCHA service. Check your internet connection and try again.', { code: 'CAPTCHA_UNAVAILABLE', fields: { captchaToken: 'CAPTCHA service unreachable.' } });
  }
  throw new HttpError(400, 'CAPTCHA verification failed. Please complete the check again.', { code: 'CAPTCHA_FAILED', fields: { captchaToken: 'Please complete the CAPTCHA check.' } });
}

module.exports = { verifyCaptcha, requireCaptcha, SITEVERIFY_URL };
