/**
 * Safe HTML templating. Every interpolated value is escaped unless it was produced by
 * html`` itself or explicitly wrapped with raw(). This is the main XSS defence in the UI.
 */
export class Safe {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
}
export const raw = (s) => new Safe(s ?? '');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (v) => String(v).replace(/[&<>"'`]/g, (c) => ESC[c]);

function part(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += part(values[i]) + strings[i + 1];
  return new Safe(out);
}

export function render(el, tpl) {
  el.innerHTML = tpl instanceof Safe || Array.isArray(tpl) ? part(tpl) : esc(tpl ?? '');
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegated event listener. */
export function on(root, type, selector, handler, opts) {
  const listener = (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  };
  root.addEventListener(type, listener, opts);
  return () => root.removeEventListener(type, listener, opts);
}

/** Only http(s) links are ever rendered into href attributes. */
export function safeUrl(u) {
  if (!u) return '#';
  try {
    const x = new URL(u, window.location.origin);
    return ['http:', 'https:'].includes(x.protocol) ? x.href : '#';
  } catch { return '#'; }
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  keys.slice(0, -1).forEach((k) => { cur[k] = cur[k] && typeof cur[k] === 'object' ? cur[k] : {}; cur = cur[k]; });
  cur[keys[keys.length - 1]] = value;
}

/**
 * Serialises a form into a plain object: checkboxes → booleans (or arrays with data-group),
 * number inputs → numbers/null, data-json inputs → parsed JSON, dotted names → nested objects.
 */
export function formToObject(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled || ['file', 'submit', 'button', 'reset'].includes(el.type)) continue;
    if (el.closest('[hidden]')) continue;
    const name = el.name;
    if (el.dataset.json !== undefined) {
      let v = [];
      try { v = JSON.parse(el.value || '[]'); } catch { v = []; }
      setPath(out, name, v);
      continue;
    }
    if (el.type === 'checkbox') {
      if (el.dataset.group !== undefined) {
        const cur = name.split('.').reduce((o, k) => (o ? o[k] : undefined), out) || [];
        if (el.checked) cur.push(el.dataset.num !== undefined ? Number(el.value) : el.value);
        setPath(out, name, cur);
      } else setPath(out, name, el.checked);
      continue;
    }
    if (el.type === 'radio') {
      if (el.checked) setPath(out, name, el.value === 'true' ? true : el.value === 'false' ? false : el.value);
      continue;
    }
    if (el.type === 'number') { setPath(out, name, el.value === '' ? null : Number(el.value)); continue; }
    if (el.tagName === 'SELECT' && el.multiple) { setPath(out, name, [...el.selectedOptions].map((o) => o.value)); continue; }
    setPath(out, name, el.value);
  }
  return out;
}

export const debounce = (fn, ms = 300) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

export const uid = (() => { let n = 0; return (p = 'h') => `${p}-${(n += 1)}`; })();
