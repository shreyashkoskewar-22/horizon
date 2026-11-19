import { html, render, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { logo } from '../lib/components.js';

export function mountAuthChrome({ title, text, points, topRight }) {
  const aside = $('[data-auth-aside]');
  if (aside) {
    render(aside, html`${logo('/', true)}
      <img class="aside-map" src="/img/world-dots.svg" alt="">
      <h2>${title}</h2><p>${text}</p>
      <ul>${points.map((p) => html`<li>${icon('checkCircle')}<span>${p}</span></li>`)}</ul>
      <p class="xs aside-tagline">Global opportunities. Verified Indian talent.</p>`);
  }
  const top = $('[data-auth-top]');
  if (top) render(top, html`<span class="hide-lg">${logo('/')}</span>${topRight || ''}`);
}

export function alertBox(type, message, title) {
  const ic = { error: 'alertCircle', success: 'checkCircle', info: 'info', warning: 'alertTriangle' }[type];
  return html`<div class="alert alert-${type} mb-16" role="${type === 'error' ? 'alert' : 'status'}">${icon(ic)}<div>${title ? html`<div class="alert-title">${title}</div>` : ''}${message}</div></div>`;
}

export function safeNext(next, fallback) {
  return next && /^\/(?!\/)[\w\-/?=&%.#]*$/.test(next) ? next : fallback;
}

/** The promise every auth page repeats: the same three commitments as the landing page. */
export const PROMISE_POINTS = [
  'Verified on both sides: students through their institution, recruiters through their organisation',
  'Replies within 14 days from verified recruiters, with a reason if you are not selected',
  'A grievance desk with a ticket, a timeline and published deadlines',
];

/** Show/hide password: an icon button with a stable label and a pressed state. */
export function passwordToggle(button, input) {
  if (!button || !input) return;
  const paint = (shown) => {
    render(button, html`${icon(shown ? 'eyeOff' : 'eye', { size: 18 })}<span class="pw-text">${shown ? 'Hide' : 'Show'}</span>`);
    button.setAttribute('aria-pressed', String(shown));
    button.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
  };
  button.setAttribute('type', 'button');
  paint(false);
  button.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    paint(show);
  });
}
