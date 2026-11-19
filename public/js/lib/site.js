/** Shared header and footer for public pages. */
import { html, render } from './dom.js';
import { icon } from './icons.js';
import { logo } from './components.js';
import { getConfig } from './captcha.js';

export async function mountSiteChrome({ dark = false } = {}) {
  const header = document.querySelector('[data-site-header]');
  const footer = document.querySelector('[data-site-footer]');
  let me = null;
  try { me = await (await fetch('/api/auth/me', { headers: { Accept: 'application/json' } })).json(); } catch { /* offline */ }
  const signedIn = me && me.user;
  const home = signedIn ? (me.next || '/app') : null;

  if (header) {
    header.className = `site-header ${dark ? 'on-dark' : 'light'}`;
    render(header, html`<div class="container site-nav">
      ${logo('/')}
      <nav class="site-links" aria-label="Main">
        <a href="/app/explore">Explore Opportunities</a>
        <a href="/#how">How It Works</a>
        <a href="/#institutions">Eligible Institutions</a>
        <a href="/#about">About</a>
        <a href="/grievance-redressal">Grievance Redressal</a>
      </nav>
      <div class="site-cta">
        ${signedIn
    ? html`<a class="btn btn-accent" href="${home}">${icon('layout')} <span class="xs-hide">Go to your </span>dashboard</a>`
    : html`<a class="btn btn-ghost" href="/login">Login</a><a class="btn btn-accent" href="/register">Join<span class="xs-hide"> HORIZON</span></a>`}
        <button class="btn btn-icon site-menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-nav" data-menu>${icon('menu')}</button>
      </div>
    </div>
    <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile">
      <a href="/app/explore">Explore Opportunities</a><a href="/#how">How It Works</a><a href="/#institutions">Eligible Institutions</a>
      <a href="/#about">About</a><a href="/grievance-redressal">Grievance Redressal</a>${signedIn ? '' : html`<a href="/login">Login</a>`}
    </nav>`);
    const btn = header.querySelector('[data-menu]');
    const nav = header.querySelector('.mobile-nav');
    // Mobile menu: focus moves into the menu, Tab stays inside it (with the toggle), Escape and links close it.
    const setOpen = (open, { focusToggle = false } = {}) => {
      nav.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      render(btn, icon(open ? 'x' : 'menu'));
      if (open) { const first = nav.querySelector('a'); if (first) first.focus(); } else if (focusToggle) btn.focus();
    };
    btn.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', (e) => {
      if (!nav.classList.contains('open')) return;
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false, { focusToggle: true }); return; }
      if (e.key === 'Tab') {
        const items = [btn, ...nav.querySelectorAll('a')];
        const i = items.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
        else if (i === -1) { e.preventDefault(); items[0].focus(); }
      }
    });
    window.matchMedia('(min-width: 1081px)').addEventListener('change', (m) => { if (m.matches) setOpen(false); });
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (footer) {
    const cfg = await getConfig().catch(() => null);
    const g = cfg ? cfg.grievance : {};
    footer.className = 'site-footer';
    render(footer, html`<div class="container">
      <div class="footer-grid">
        <div>
          ${logo('/', true)}
          <p class="mt-16 footer-blurb">Global opportunities. Verified Indian talent. An international internship platform exclusively for students of India’s Institutions of National Importance.</p>
        </div>
        <div><h2 class="footer-h">Platform</h2><ul>
          <li><a href="/app/explore">Explore opportunities</a></li><li><a href="/#how">How it works</a></li>
          <li><a href="/register?as=recruiter">Hire verified talent</a></li><li><a href="/app/destinations">Global destinations</a></li></ul></div>
        <div><h2 class="footer-h">Trust &amp; safety</h2><ul>
          <li><a href="/grievance-redressal">Grievance redressal</a></li><li><a href="/transparency">Transparency report</a></li>
          <li><a href="/terms">Terms of use</a></li><li><a href="/privacy">Privacy policy</a></li></ul></div>
        <div><h2 class="footer-h">Contact</h2><ul>
          <li>${g.officerName || 'Grievance Officer'}</li><li><a href="mailto:${g.officerEmail || ''}">${g.officerEmail || ''}</a></li>
          <li>General: <a href="mailto:hello@horizon.example">hello@horizon.example</a></li></ul></div>
      </div>
      <div class="fine"><span>© ${new Date().getFullYear()} HORIZON. HORIZON never charges students to apply.</span>
        <span>Listings labelled “Illustrative” are demonstration data, not real vacancies.</span></div>
    </div>`);
  }
  return me;
}
