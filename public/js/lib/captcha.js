import { html, render } from './dom.js';
import { icon } from './icons.js';

let configPromise = null;
export const getConfig = () => configPromise || (configPromise = fetch('/api/config', { headers: { Accept: 'application/json' } }).then((r) => r.json()));

let scriptPromise = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile unavailable')));
      s.onerror = () => { scriptPromise = null; reject(new Error('Could not load the CAPTCHA. Check your internet connection.')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/**
 * Mounts Cloudflare Turnstile (or, only when the server runs CAPTCHA_PROVIDER=dev-bypass, a clearly
 * labelled development checkbox). Either way the token is verified on the server.
 */
export async function mountCaptcha(container, { onChange } = {}) {
  const cfg = await getConfig();
  let token = null;
  const set = (t) => { token = t; if (onChange) onChange(t); };
  if (cfg.captcha.provider === 'dev-bypass') {
    render(container, html`<label class="dev-captcha"><input type="checkbox" data-dev-captcha>
      <span><strong>I’m not a robot</strong><br><span class="dc-note">Development CAPTCHA · checked on the server · disabled in production</span></span></label>`);
    const cb = container.querySelector('[data-dev-captcha]');
    cb.addEventListener('change', () => set(cb.checked ? cfg.captcha.devToken : null));
    return { getToken: () => token, reset: () => { cb.checked = false; set(null); } };
  }
  try {
    const ts = await loadTurnstile();
    const id = ts.render(container, {
      sitekey: cfg.captcha.siteKey,
      theme: 'light',
      callback: (t) => set(t),
      'expired-callback': () => set(null),
      'error-callback': () => set(null),
    });
    return { getToken: () => token || ts.getResponse(id) || null, reset: () => { ts.reset(id); set(null); } };
  } catch (err) {
    render(container, html`<div class="alert alert-warning">${icon('alertTriangle')}<div>${err.message}</div></div>`);
    return { getToken: () => null, reset: () => {} };
  }
}
