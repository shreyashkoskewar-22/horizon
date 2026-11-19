import { html, raw, render, $$, on, formToObject } from './dom.js';
import { icon } from './icons.js';
import { validateForm, liveValidate, applyServerErrors } from './validate.js';

/* ----------------------------------------------------------------- Toasts */
let toastRoot = null;
export function toast(message, { type = 'success', title, timeout = 4800 } = {}) {
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.className = 'toasts';
    toastRoot.setAttribute('aria-live', 'polite');
    toastRoot.setAttribute('aria-atomic', 'false');
    document.body.appendChild(toastRoot);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  render(el, html`${icon(type === 'error' ? 'alertCircle' : type === 'info' ? 'info' : 'checkCircle', { size: 20 })}
    <div class="grow">${title ? html`<div class="toast-title">${title}</div>` : ''}<div>${message}</div></div>
    <button class="btn btn-ghost btn-icon btn-sm close" aria-label="Dismiss notification">${icon('x', { size: 16 })}</button>`);
  const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.close').addEventListener('click', close);
  toastRoot.appendChild(el);
  if (timeout) setTimeout(close, timeout);
  return close;
}
export const toastError = (err, fallback = 'Something went wrong. Please try again.') => toast((err && err.message) || fallback, { type: 'error', title: 'That did not work' });

/* ----------------------------------------------------------------- Modals */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function openModal({ title, description, body, footer, wide = false, drawer = false, onClose, dismissible = true } = {}) {
  const previous = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = `overlay ${drawer ? 'drawer-overlay' : ''}`;
  const titleId = `mt-${Math.random().toString(36).slice(2, 8)}`;
  render(overlay, html`<div class="${drawer ? 'drawer' : `modal ${wide ? 'wide' : ''}`}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
    <div class="modal-header"><div><h2 id="${titleId}">${title}</h2>${description ? html`<p>${description}</p>` : ''}</div>
      <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Close dialog">${icon('x')}</button></div>
    <div class="modal-body">${body || ''}</div>
    ${footer ? html`<div class="modal-footer">${footer}</div>` : ''}
  </div>`);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const dialog = overlay.firstElementChild;
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    overlay.remove();
    if (!document.querySelector('.overlay')) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (previous && previous.focus) previous.focus();
    if (onClose) onClose(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible) { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const items = $$(FOCUSABLE, dialog).filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && dismissible) close(); });
  on(dialog, 'click', '[data-close]', () => close());
  setTimeout(() => { const f = $$(FOCUSABLE, dialog.querySelector('.modal-body')).find((x) => x.offsetParent !== null) || dialog.querySelector('[data-close]'); if (f) f.focus(); }, 30);
  return { el: dialog, body: dialog.querySelector('.modal-body'), close };
}

/** Confirmation dialog. Resolves false, true, or { reason } when a reason is requested. */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false, reason = null } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      body: html`<p class="muted" style="margin-top:0">${message}</p>
        ${reason ? html`<div class="field"><label class="label" for="confirm-reason">${reason.label}${reason.required ? html`<span class="req">*</span>` : ''}</label>
          <textarea id="confirm-reason" class="textarea" rows="3" placeholder="${reason.placeholder || ''}"></textarea><p class="field-error" data-for="reason"></p></div>` : ''}`,
      footer: html`<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-ok>${confirmText}</button>`,
      onClose: (r) => resolve(r || false),
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => {
      if (reason) {
        const ta = m.el.querySelector('#confirm-reason');
        const v = ta.value.trim();
        const min = reason.min || (reason.required ? 5 : 0);
        if (v.length < min) { m.el.querySelector('.field-error').textContent = `Please write at least ${min} characters.`; ta.setAttribute('aria-invalid', 'true'); ta.focus(); return; }
        m.close({ reason: v });
      } else m.close(true);
    });
  });
}

/**
 * Generic form dialog: validates on the client, submits, shows server field errors inline,
 * and closes on success. onSubmit(values, form) should return a promise.
 */
export function formModal({ title, description, fields, submitText = 'Save', wide = false, drawer = false, onSubmit, extraFooter = '', readValues }) {
  const m = openModal({
    title, description, wide, drawer,
    body: html`<form class="stack" novalidate>${fields}<button type="submit" hidden></button></form>`,
    footer: html`${extraFooter}<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn btn-primary" data-submit>${submitText}</button>`,
  });
  const form = m.el.querySelector('form');
  liveValidate(form);
  mountTagInputs(form);
  const submit = async () => {
    if (!validateForm(form)) return;
    const btn = m.el.querySelector('[data-submit]');
    try {
      btn.classList.add('is-loading'); btn.disabled = true;
      await onSubmit(readValues ? readValues(form) : formToObject(form), form, m);
      m.close(true);
    } catch (err) {
      if (!applyServerErrors(form, err.fields)) toastError(err);
      else toast(err.message, { type: 'error' });
    } finally { btn.classList.remove('is-loading'); btn.disabled = false; }
  };
  m.el.querySelector('[data-submit]').addEventListener('click', submit);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  return m;
}

export async function withLoading(btn, fn) {
  if (!btn) return fn();
  btn.classList.add('is-loading');
  btn.disabled = true;
  try { return await fn(); } finally { btn.classList.remove('is-loading'); btn.disabled = false; }
}

/* ----------------------------------------------------- Loading & empty states */
export const spinner = (label = 'Loading') => html`<div class="loading-block"><div class="spinner" role="status" aria-label="${label}"></div></div>`;

/** The horizon mark used as a quiet illustration: an arc rising over a line. Static, trusted markup. */
const HORIZON_ART = raw('<svg class="horizon-art" viewBox="0 0 112 64" aria-hidden="true" focusable="false"><path d="M22 50a34 34 0 0 1 68 0" fill="none" stroke="#D99A38" stroke-width="2" stroke-linecap="round" opacity=".75"/><path d="M6 50h100" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".35"/><path d="M30 58h52" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".15"/></svg>');
export const horizonArt = (name, cls = '') => html`<div class="empty-art ${cls}">${HORIZON_ART}${name ? icon(name, { size: 20 }) : ''}</div>`;

/** Branded loading state: the logo mark with a gently rising sun. */
export const brandLoader = (label = 'Loading HORIZON', full = false) => html`<div class="brand-loader ${full ? 'full' : ''}" role="status" aria-live="polite">
  ${raw('<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6.5 20.5a9.5 9.5 0 0 1 19 0" fill="none" stroke="#D99A38" stroke-width="2.6" stroke-linecap="round"/><path d="M3 20.5h26" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M8.5 25.2h15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".45"/><circle class="bl-sun" cx="16" cy="16" r="2.5" fill="#D99A38"/></svg>')}
  <span class="bl-label">${label}</span></div>`;

const skCard = () => html`<div class="card card-pad opp-card sk"><div class="row"><div class="skeleton sk-avatar"></div><div class="grow"><div class="skeleton sk-line sk-w40"></div><div class="skeleton sk-title"></div></div></div><div class="skeleton sk-line mt-16"></div><div class="skeleton sk-line sk-w80"></div><div class="skeleton sk-line mt-16 sk-w55"></div></div>`;
export const skeletonCards = (n = 6) => html`<div class="opp-grid" aria-hidden="true">${Array.from({ length: n }, skCard)}</div>`;
export const skeletonRows = (n = 5) => html`<div class="card card-pad" aria-hidden="true">${Array.from({ length: n }, () => html`<div class="row sk-row"><div class="skeleton sk-avatar"></div><div class="grow"><div class="skeleton sk-line sk-w50"></div><div class="skeleton sk-line sk-w30"></div></div></div>`)}</div>`;
export const skeletonPage = () => html`<div aria-hidden="true"><div class="skeleton sk-greeting"></div><div class="stat-row">${Array.from({ length: 4 }, () => html`<div class="skeleton sk-tile"></div>`)}</div>${skeletonCards(3)}</div>`;
/** Mirrors the student dashboard: greeting, Next up, stat tiles, two-column body. */
export const skeletonDashboard = () => html`<div aria-hidden="true"><div class="skeleton sk-greeting"></div><div class="skeleton sk-next"></div>
  <div class="stat-row">${Array.from({ length: 4 }, () => html`<div class="skeleton sk-tile"></div>`)}</div>
  <div class="dash-grid"><div class="opp-grid">${skCard()}${skCard()}</div><div class="skeleton sk-aside"></div></div></div>`;
/** Mirrors the opportunity detail page: hero card, aside facts. */
export const skeletonDetail = () => html`<div class="detail" aria-hidden="true"><div class="skeleton sk-hero"></div><div class="skeleton sk-aside"></div></div>`;

export function empty({ icon: name = 'compass', title, text, action = '', compact = false }) {
  return html`<div class="empty ${compact ? 'compact' : ''}">${horizonArt(name)}${title ? html`<h3>${title}</h3>` : ''}${text ? html`<p>${text}</p>` : ''}${action}</div>`;
}
export function errorState(err) {
  return html`<div class="empty" role="alert">${horizonArt('alertTriangle', 'error')}
    <h3>We couldn’t load this</h3><p>${(err && err.message) || 'Something went wrong.'}</p><button class="btn btn-primary" data-action="retry">${icon('refresh')} Retry</button></div>`;
}

/* --------------------------------------------------------------- Tag input */
export function tagInput({ name, values = [], placeholder = 'Type and press Enter', suggestions = [], max = 25, id, validate = '' }) {
  const listId = suggestions.length ? `${name}-suggestions-${Math.random().toString(36).slice(2, 6)}` : '';
  return html`<div class="tag-input" data-tag-input data-max="${max}">
    ${values.map((v) => html`<span class="tag" data-value="${v}">${v}<button type="button" aria-label="Remove ${v}">${icon('x', { size: 12 })}</button></span>`)}
    <input type="text" ${id ? html`id="${id}"` : ''} placeholder="${placeholder}" ${listId ? html`list="${listId}"` : ''} aria-label="${placeholder}" autocomplete="off">
    <input type="hidden" name="${name}" data-json value="${JSON.stringify(values)}" ${validate ? html`data-validate="${validate}"` : ''}>
    ${listId ? html`<datalist id="${listId}">${suggestions.map((s) => html`<option value="${s}"></option>`)}</datalist>` : ''}
  </div>`;
}

export function mountTagInputs(root) {
  for (const box of $$('[data-tag-input]', root)) {
    if (box.dataset.mounted) continue;
    box.dataset.mounted = '1';
    const input = box.querySelector('input[type=text]');
    const hidden = box.querySelector('input[type=hidden]');
    const max = Number(box.dataset.max) || 25;
    const values = () => $$('.tag', box).map((t) => t.dataset.value);
    const sync = () => { hidden.value = JSON.stringify(values()); hidden.dispatchEvent(new Event('change', { bubbles: true })); };
    const add = (raw) => {
      const v = raw.trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!v || values().some((x) => x.toLowerCase() === v.toLowerCase()) || values().length >= max) return;
      const span = document.createElement('span');
      span.className = 'tag';
      span.dataset.value = v;
      render(span, html`${v}<button type="button" aria-label="Remove ${v}">${icon('x', { size: 12 })}</button>`);
      box.insertBefore(span, input);
      sync();
    };
    input.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) { e.preventDefault(); add(input.value); input.value = ''; }
      else if (e.key === 'Enter') e.preventDefault();
      else if (e.key === 'Backspace' && !input.value) { const last = $$('.tag', box).pop(); if (last) { last.remove(); sync(); } }
    });
    input.addEventListener('change', () => { if (input.value.trim()) { add(input.value); input.value = ''; } });
    input.addEventListener('blur', () => { if (input.value.trim()) { add(input.value); input.value = ''; } });
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('.tag button');
      if (btn) { btn.parentElement.remove(); sync(); input.focus(); } else if (e.target === box) input.focus();
    });
  }
}

/* -------------------------------------------------------------- Dropdowns */
export function dropdown(trigger, panelHtml, { onOpen, className = '' } = {}) {
  let panel = null;
  const close = () => { if (panel) { panel.remove(); panel = null; trigger.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc); } };
  const outside = (e) => { if (panel && !panel.contains(e.target) && !trigger.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') { close(); trigger.focus(); } };
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', async () => {
    if (panel) return close();
    panel = document.createElement('div');
    panel.className = `menu ${className}`;
    render(panel, typeof panelHtml === 'function' ? await panelHtml() : panelHtml);
    trigger.parentElement.appendChild(panel);
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    if (onOpen) onOpen(panel, close);
  });
  return { close };
}
