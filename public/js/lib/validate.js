/**
 * Declarative client-side validation: <input data-validate="required|email|min:10">.
 * Messages appear beside the field. The server repeats every critical check.
 */
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isUrl = (v) => { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && !!u.hostname; } catch { return false; } };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
const other = (el, name) => el.form && el.form.elements[name];

const RULES = {
  required: (v, el) => {
    if (el.type === 'checkbox') return el.checked || el.dataset.msgRequired || 'Please confirm to continue.';
    if (el.type === 'file') return el.files.length > 0 || 'Choose a file.';
    if (el.type === 'radio') return !!(el.form && el.form.elements[el.name] && el.form.elements[el.name].value) || el.dataset.msgRequired || 'Choose an option.';
    if (el.dataset.json !== undefined) { try { return JSON.parse(v || '[]').length > 0 || 'Add at least one item.'; } catch { return 'Add at least one item.'; } }
    return String(v).trim() !== '' || el.dataset.msgRequired || 'This field is required.';
  },
  email: (v) => !v || EMAIL.test(v.trim()) || 'Enter a valid email address.',
  min: (v, el, n) => !v || v.trim().length >= Number(n) || `Use at least ${n} characters.`,
  max: (v, el, n) => !v || v.length <= Number(n) || `Use ${n} characters or fewer.`,
  password: (v) => !v || (v.length >= 10 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v)) || 'Use 10+ characters with upper- and lower-case letters and a number.',
  match: (v, el, name) => v === (other(el, name) || {}).value || 'Passwords do not match.',
  url: (v) => !v || isUrl(v.trim()) || 'Enter a valid link starting with https://',
  date: (v) => !v || isDate(v) || 'Enter a valid date.',
  future: (v) => !v || v >= today() || 'Choose today or a later date.',
  after: (v, el, name) => { const o = other(el, name); return !v || !o || !o.value || v >= o.value || 'Must be on or after the start date.'; },
  number: (v) => v === '' || !Number.isNaN(Number(v)) || 'Enter a number.',
  positive: (v) => v === '' || Number(v) > 0 || 'Must be greater than zero.',
  int: (v) => v === '' || Number.isInteger(Number(v)) || 'Use a whole number.',
  between: (v, el, arg) => { const [lo, hi] = arg.split('-').map(Number); return v === '' || (Number(v) >= lo && Number(v) <= hi) || `Enter a value between ${lo} and ${hi}.`; },
  filetype: (v, el, list) => !el.files || !el.files.length || list.split(',').some((ext) => el.files[0].name.toLowerCase().endsWith(`.${ext}`)) || `Allowed formats: ${list.toUpperCase().split(',').join(', ')}.`,
  maxsize: (v, el, mb) => !el.files || !el.files.length || el.files[0].size <= Number(mb) * 1048576 || `The maximum file size is ${mb} MB.`,
  digits: (v, el, n) => !v || new RegExp(`^\\d{${n}}$`).test(v) || `Enter the ${n}-digit code.`,
  personname: (v) => !v || /^[\p{L}][\p{L}\p{M}'.\- ]*$/u.test(v.trim()) || 'Use letters, spaces, apostrophes and hyphens only.',
  domain: (v) => !v || /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(v.trim()) || 'Enter a domain like example.com',
  /** requiredif:otherField=value — required only when another control has that value. */
  requiredif: (v, el, arg) => {
    const [name, want] = arg.split('=');
    const o = el.form && el.form.elements[name];
    if (!o) return true;
    const cur = o instanceof RadioNodeList ? o.value : o.type === 'checkbox' ? String(o.checked) : o.value;
    return cur !== want || String(v).trim() !== '' || 'This field is required.';
  },
};

function errorNode(el) {
  const field = el.closest('.field') || el.parentElement;
  let node = field.querySelector(`.field-error[data-for="${el.name}"]`) || field.querySelector('.field-error');
  if (!node) {
    node = document.createElement('p');
    node.className = 'field-error';
    node.dataset.for = el.name;
    field.appendChild(node);
  }
  if (!node.id) node.id = `err-${el.name || Math.random().toString(36).slice(2)}`.replace(/[^\w-]/g, '-');
  return node;
}

export function showError(el, message) {
  const node = errorNode(el);
  node.textContent = message;
  el.setAttribute('aria-invalid', 'true');
  const ids = new Set((el.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
  ids.add(node.id);
  el.setAttribute('aria-describedby', [...ids].join(' '));
}
export function clearError(el) {
  el.removeAttribute('aria-invalid');
  const field = el.closest('.field');
  const node = field && (field.querySelector(`.field-error[data-for="${el.name}"]`) || field.querySelector('.field-error'));
  if (node) node.textContent = '';
}

export function validateField(el) {
  const spec = el.dataset.validate;
  if (!spec) return true;
  const v = el.value ?? '';
  for (const rule of spec.split('|')) {
    const idx = rule.indexOf(':');
    const name = idx === -1 ? rule : rule.slice(0, idx);
    const arg = idx === -1 ? undefined : rule.slice(idx + 1);
    const fn = RULES[name];
    if (!fn) continue;
    const r = fn(v, el, arg);
    if (r !== true) { showError(el, r); return false; }
  }
  clearError(el);
  return true;
}

export function validateForm(form) {
  let first = null;
  for (const el of form.querySelectorAll('[data-validate]')) {
    if (el.disabled || el.closest('[hidden]')) continue;
    if (!validateField(el) && !first) first = el;
  }
  if (first) {
    const target = first.type === 'hidden' ? first.closest('.field')?.querySelector('input:not([type=hidden])') || first : first;
    target.focus?.();
    return false;
  }
  return true;
}

export function liveValidate(form) {
  form.setAttribute('novalidate', '');
  // Inline validation on blur: once a field has been typed in (even if emptied again), or when it already shows an error.
  form.addEventListener('blur', (e) => { const t = e.target; if (t.dataset && t.dataset.validate && (t.value || t.dataset.touched || t.getAttribute('aria-invalid'))) validateField(t); }, true);
  form.addEventListener('input', (e) => { const t = e.target; if (t.dataset) t.dataset.touched = '1'; if (t.getAttribute && t.getAttribute('aria-invalid') === 'true') validateField(t); });
  // Help text is announced with its field.
  for (const help of form.querySelectorAll('.field .help')) {
    const control = help.closest('.field').querySelector('input:not([type=hidden]), select, textarea');
    if (!control) continue;
    if (!help.id) help.id = `help-${control.id || control.name || Math.random().toString(36).slice(2)}`.replace(/[^\w-]/g, '-');
    const ids = new Set((control.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
    ids.add(help.id);
    control.setAttribute('aria-describedby', [...ids].join(' '));
  }
  form.addEventListener('change', (e) => { const t = e.target; if (t.type === 'checkbox' || t.type === 'file' || t.tagName === 'SELECT') { if (t.dataset.validate) validateField(t); } });
}

/** Applies server-side field errors ({ "organisation.name": "..." }) to matching controls. */
export function applyServerErrors(form, fields = {}) {
  let first = null;
  for (const [name, message] of Object.entries(fields || {})) {
    if (!message) continue;
    const el = form.querySelector(`[name="${CSS.escape(name)}"]`) || form.querySelector(`[data-field="${CSS.escape(name)}"]`);
    if (el) { showError(el, message); first = first || el; }
  }
  if (first) first.focus?.();
  return !!first;
}

export function passwordScore(p) {
  let s = 0;
  if (!p) return 0;
  if (p.length >= 10) s += 1;
  if (p.length >= 14) s += 1;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s += 1;
  if (/\d/.test(p)) s += 1;
  if (/[^A-Za-z0-9]/.test(p)) s += 1;
  return Math.min(4, s - (p.length < 10 ? 1 : 0));
}
