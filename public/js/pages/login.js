import { html, render, $, formToObject } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { post, setCsrf } from '../lib/api.js';
import { validateForm, liveValidate, applyServerErrors } from '../lib/validate.js';
import { mountCaptcha, getConfig } from '../lib/captcha.js';
import { withLoading } from '../lib/ui.js';
import { mountAuthChrome, alertBox, safeNext, passwordToggle, PROMISE_POINTS } from './auth-common.js';

mountAuthChrome({
  title: 'Real internships. Real replies.',
  text: 'HORIZON is the international internship platform for students of India’s Institutions of National Importance — and nothing you send disappears.',
  points: PROMISE_POINTS,
  topRight: html`<span class="muted small">No account? <a href="/register">Join HORIZON</a></span>`,
});

const form = $('[data-login-form]');
const alertEl = $('[data-alert]');
liveValidate(form);
passwordToggle($('[data-toggle-password]'), $('#password'));
const params = new URLSearchParams(window.location.search);
if (params.get('signedout')) render(alertEl, alertBox('success', 'You have been signed out securely.'));
if (params.get('next')) render(alertEl, alertBox('info', 'Please sign in to continue.'));

let captcha;
mountCaptcha($('[data-captcha]')).then((c) => { captcha = c; });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  render(alertEl, '');
  const ok = validateForm(form);
  const token = captcha && captcha.getToken();
  $('#err-captcha').textContent = token ? '' : 'Please complete the security check.';
  if (!ok || !token) return;
  const btn = form.querySelector('button[type=submit]');
  await withLoading(btn, async () => {
    try {
      const data = await post('/api/auth/login', { ...formToObject(form), captchaToken: token });
      setCsrf(data.csrfToken);
      window.location.assign(data.next === '/verify' ? '/verify' : safeNext(params.get('next'), data.next));
    } catch (err) {
      if (captcha) captcha.reset();
      if (err.code === 'CAPTCHA_FAILED' || err.code === 'CAPTCHA_UNAVAILABLE') { $('#err-captcha').textContent = err.message; return; }
      if (!applyServerErrors(form, err.fields)) render(alertEl, alertBox('error', err.message, err.code === 'ACCOUNT_SUSPENDED' ? 'Account suspended' : 'Sign-in failed'));
    }
  });
});

getConfig().then((cfg) => {
  if (!cfg.demoAccounts) return;
  render($('[data-demo]'), html`<div class="card card-pad mt-24 sunken">
    <div class="row between"><strong class="small">${icon('key', { size: 16 })} Demo accounts</strong><span class="badge badge-demo">Development only</span></div>
    <p class="subtle mt-8">Fill in a seeded account to explore each role. These accounts do not exist in production.</p>
    <div class="row wrap gap-2">${cfg.demoAccounts.map((a, i) => html`<button type="button" class="btn btn-sm" data-demo-i="${i}">${a.role}</button>`)}</div></div>`);
  $('[data-demo]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-demo-i]');
    if (!b) return;
    const a = cfg.demoAccounts[Number(b.dataset.demoI)];
    $('#email').value = a.email;
    $('#password').value = a.password;
    $('#email').dispatchEvent(new Event('input'));
  });
});
