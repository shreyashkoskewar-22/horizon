/** HORIZON application shell: role-based navigation, client-side router, notifications. */
import { html, render, $, $$, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, get, post, setCsrf } from '../lib/api.js';
import { logo, personAvatar } from '../lib/components.js';
import { toast, toastError, dropdown, errorState, spinner, empty } from '../lib/ui.js';
import { getConfig } from '../lib/captcha.js';
import { timeAgo, dayGroup } from '../lib/format.js';

/**
 * Navigation per role. Items are [href, icon, label]; null draws a separator and
 * { group: 'Label' } starts a labelled group (both are optional).
 */
const NAV = {
  student: {
    label: 'Student', base: '/app',
    items: [
      { group: 'Discover' }, ['/app', 'home', 'Overview'], ['/app/explore', 'compass', 'Explore Internships'], ['/app/saved', 'bookmark', 'Saved Opportunities'],
      { group: 'Track' }, ['/app/applications', 'columns', 'My Applications'],
      { group: 'Plan' }, ['/app/destinations', 'globe', 'Global Destinations'], ['/app/resources', 'book', 'Career Resources'],
      { group: 'Account' }, ['/app/profile', 'user', 'My Profile'], ['/app/grievances', 'scale', 'Grievance Desk'],
    ],
    // Phones: the five destinations students use most sit in a bottom bar; the drawer keeps the rest.
    bottom: [['/app', 'home', 'Overview'], ['/app/explore', 'compass', 'Explore'], ['/app/applications', 'columns', 'Applications'], ['/app/saved', 'bookmark', 'Saved'], ['/app/profile', 'user', 'Profile']],
  },
  recruiter: {
    label: 'Recruiter', base: '/recruiter',
    items: [
      ['/recruiter', 'home', 'Overview'], ['/recruiter/listings', 'briefcase', 'My Listings'], ['/recruiter/listings/new', 'plus', 'Post a Listing'],
      ['/recruiter/applicants', 'users', 'Applicants'], ['/recruiter/organisation', 'building', 'Organisation Profile'], ['/recruiter/profile', 'user', 'My Profile'],
      null, ['/recruiter/grievances', 'scale', 'Grievance Desk'],
    ],
  },
  admin: {
    label: 'Administrator', base: '/admin',
    items: [
      ['/admin', 'home', 'Overview'], ['/admin/internships', 'briefcase', 'Manage Internships'], ['/admin/internships/new', 'plus', 'Add Internship'],
      ['/admin/students', 'graduation', 'Manage Students'], ['/admin/recruiters', 'building', 'Manage Recruiters'], ['/admin/verifications', 'userCheck', 'Verification Requests'],
      ['/admin/institutions', 'shield', 'Manage Institutions'], ['/admin/organisations', 'layers', 'Organisations'], ['/admin/documents', 'fileCheck', 'Document Reviews'],
      ['/admin/resources', 'globe', 'Global Resources'], ['/admin/grievances', 'scale', 'Grievance Desk'], ['/admin/reports', 'barChart', 'Reports'], ['/admin/audit', 'history', 'Audit Log'],
    ],
  },
};

const v = (name) => () => import(`./views/${name}.js`);
const ROUTES = [
  ['/app', v('student-dashboard')], ['/app/explore', v('explore')], ['/app/opportunities/:id', v('opportunity')], ['/app/saved', v('saved')],
  ['/app/applications', v('applications')], ['/app/destinations', v('destinations')], ['/app/destinations/:slug', v('destinations')],
  ['/app/resources', v('resources')], ['/app/profile', v('profile')], ['/app/organisations/:id', v('organisation')],
  ['/app/grievances', v('grievances')], ['/app/grievances/new', v('grievances')], ['/app/grievances/:id', v('grievances')], ['/app/notifications', v('notifications')],

  ['/recruiter', v('recruiter-dashboard')], ['/recruiter/listings', v('recruiter-listings')], ['/recruiter/listings/new', v('listing-form')],
  ['/recruiter/listings/:id/edit', v('listing-form')], ['/recruiter/listings/:id/applicants', v('applicants')], ['/recruiter/applicants', v('applicants')],
  ['/recruiter/applications/:id', v('applicant-detail')], ['/recruiter/opportunities/:id', v('opportunity')], ['/recruiter/organisation', v('recruiter-org')],
  ['/recruiter/organisations/:id', v('organisation')], ['/recruiter/profile', v('profile')], ['/recruiter/grievances', v('grievances')],
  ['/recruiter/grievances/new', v('grievances')], ['/recruiter/grievances/:id', v('grievances')], ['/recruiter/notifications', v('notifications')],

  ['/admin', v('admin-overview')], ['/admin/internships', v('admin-internships')], ['/admin/internships/new', v('listing-form')],
  ['/admin/internships/:id/edit', v('listing-form')], ['/admin/internships/:id', v('opportunity')], ['/admin/students', v('admin-users')],
  ['/admin/recruiters', v('admin-users')], ['/admin/verifications', v('admin-verifications')], ['/admin/institutions', v('admin-institutions')],
  ['/admin/organisations', v('admin-organisations')], ['/admin/organisations/:id', v('organisation')], ['/admin/documents', v('admin-documents')],
  ['/admin/resources', v('admin-destinations')], ['/admin/resources/:slug', v('destinations')], ['/admin/grievances', v('admin-grievances')], ['/admin/grievances/:id', v('admin-grievances')],
  ['/admin/reports', v('admin-reports')], ['/admin/audit', v('admin-audit')], ['/admin/notifications', v('notifications')],
].map(([pattern, load]) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { pattern, re, keys, load };
});

const state = { me: null, cfg: null, cleanups: [], navSeq: 0, scroll: {} };
const navLinks = (nav) => nav.items.filter(Array.isArray);

function shell() {
  const user = state.me.user;
  const nav = NAV[user.role];
  const affiliation = user.institution ? (user.institution.shortName || user.institution.name) : user.organisation ? user.organisation.name : 'HORIZON';
  const navItem = (it) => {
    if (!it) return html`<div class="nav-sep" role="separator"></div>`;
    if (!Array.isArray(it)) return html`<div class="nav-group" aria-hidden="true">${it.group}</div>`;
    return html`<a class="nav-link" href="${it[0]}" data-nav="${it[0]}">${icon(it[1])}<span>${it[2]}</span></a>`;
  };
  render($('#app'), html`<div class="shell ${nav.bottom ? 'has-bottom-nav' : ''}">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <div class="sidebar-brand">${logo(nav.base, true)}</div>
      <div class="sidebar-role">${nav.label} workspace</div>
      <nav class="sidebar-nav" aria-label="${nav.label} workspace">${nav.items.map(navItem)}</nav>
      <div class="sidebar-footer">
        <div class="user-chip">${personAvatar(user.fullName, 'sm')}<div class="grow"><div class="uc-name truncate">${user.fullName}</div><div class="uc-meta truncate">${affiliation}</div></div></div>
        <button class="btn btn-sm logout" data-logout>${icon('logout', { size: 16 })} Logout</button>
      </div>
    </aside>
    <div class="sidebar-backdrop" data-backdrop></div>
    <div class="shell-main">
      <header class="topbar">
        <button class="btn btn-icon btn-ghost menu-toggle" data-menu aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button>
        <nav class="breadcrumbs" aria-label="Breadcrumb" data-crumbs></nav>
        <div class="crumb-mobile" data-crumb-mobile></div>
        <div class="topbar-actions">
          ${user.role !== 'admin' ? html`<a class="btn btn-sm btn-ghost hide-sm" href="${nav.base}/grievances/new">${icon('flag', { size: 16 })} Report an issue</a>` : ''}
          <div class="rel"><button class="btn btn-icon btn-ghost bell" data-bell aria-label="Notifications">${icon('bell')}<span class="bell-count" data-bell-count hidden></span></button></div>
          <div class="rel"><button class="btn btn-ghost usermenu-btn" data-usermenu aria-label="Account menu">${personAvatar(user.fullName, 'sm')}${icon('chevronDown', { size: 14 })}</button></div>
        </div>
      </header>
      <main id="view" class="view" tabindex="-1"></main>
      ${nav.bottom ? html`<nav class="bottom-nav" aria-label="Quick navigation">${nav.bottom.map((it) => html`<a href="${it[0]}" data-nav="${it[0]}">${icon(it[1], { size: 20 })}<span>${it[2]}</span></a>`)}</nav>` : ''}
    </div>
  </div>`);

  const sidebar = $('#sidebar');
  const backdrop = $('[data-backdrop]');
  const menuBtn = $('[data-menu]');
  const toggle = (open) => {
    sidebar.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) { const first = sidebar.querySelector('a, button'); if (first) setTimeout(() => first.focus(), 60); }
  };
  menuBtn.addEventListener('click', () => toggle(!sidebar.classList.contains('open')));
  backdrop.addEventListener('click', () => toggle(false));
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) toggle(false); });
  document.addEventListener('keydown', (e) => {
    if (!sidebar.classList.contains('open')) return;
    if (e.key === 'Escape') { toggle(false); menuBtn.focus(); return; }
    if (e.key === 'Tab') {
      const items = $$('a[href], button:not([disabled])', sidebar);
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  $$('[data-logout]').forEach((b) => b.addEventListener('click', logout));

  dropdown($('[data-usermenu]'), html`<div class="menu-head"><div class="strong">${user.fullName}</div><div class="subtle truncate">${user.email}</div></div>
    ${user.role !== 'admin' ? html`<a href="${nav.base}/profile">${icon('user', { size: 16 })} My profile</a>` : ''}
    <a href="${nav.base}/notifications">${icon('bell', { size: 16 })} Notifications</a>
    <a href="${nav.base}/grievances">${icon('scale', { size: 16 })} Grievance desk</a>
    <a href="/" data-external>${icon('globe', { size: 16 })} HORIZON home</a>
    <button data-logout-menu>${icon('logout', { size: 16 })} Sign out</button>`, {
    onOpen: (panel, close) => {
      panel.querySelector('[data-logout-menu]').addEventListener('click', logout);
      panel.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
    },
  });

  dropdown($('[data-bell]'), async () => {
    const data = await get('/api/notifications').catch(() => ({ items: [], unread: 0 }));
    let lastDay = null;
    const rows = data.items.slice(0, 12).map((n) => {
      const day = dayGroup(n.createdAt);
      const head = day !== lastDay ? html`<div class="notif-day">${day}</div>` : '';
      lastDay = day;
      return html`${head}<a class="notif-item ${n.read ? '' : 'unread'}" href="${n.link || `${nav.base}/notifications`}" data-nid="${n.id}">
        <span class="ni-dot ${n.read ? 'read' : ''}" aria-hidden="true"></span>
        <div class="grow"><div class="ni-title">${n.read ? '' : html`<span class="sr-only">Unread: </span>`}${n.title}</div>${n.body ? html`<div class="ni-body">${n.body}</div>` : ''}<div class="ni-time">${timeAgo(n.createdAt)}</div></div></a>`;
    });
    return html`<div class="np-head"><strong>Notifications</strong>${data.unread ? html`<button class="link-btn small" data-readall>Mark all read</button>` : ''}</div>
      ${data.items.length ? rows : html`<div class="empty compact"><p class="mb-0">You’re all caught up.</p></div>`}
      <a class="notif-item center small strong" href="${nav.base}/notifications">View all notifications</a>`;
  }, {
    className: 'notif-panel',
    onOpen: (panel, close) => {
      const ra = panel.querySelector('[data-readall]');
      if (ra) ra.addEventListener('click', async () => { await post('/api/notifications/read-all', {}); close(); refreshBell(); });
      panel.addEventListener('click', (e) => {
        const a = e.target.closest('[data-nid]');
        if (a) post(`/api/notifications/${a.dataset.nid}/read`, {}).then(refreshBell).catch(() => {});
        if (e.target.closest('a')) close();
      });
    },
  });
  refreshBell();
  setInterval(() => { if (document.visibilityState === 'visible') refreshBell(); }, 60000);
}

async function refreshBell() {
  try {
    const { unread } = await get('/api/notifications');
    const b = $('[data-bell-count]');
    b.hidden = !unread;
    b.textContent = unread > 9 ? '9+' : unread;
    $('[data-bell]').setAttribute('aria-label', unread ? `Notifications (${unread} unread)` : 'Notifications');
  } catch { /* ignore */ }
}

async function logout() {
  try { await post('/api/auth/logout', {}); } catch { /* ignore */ }
  window.location.assign('/login?signedout=1');
}

function setActive(path) {
  const nav = NAV[state.me.user.role];
  const candidates = navLinks(nav).map((i) => i[0]).filter((p) => path === p || (p !== nav.base && path.startsWith(`${p}/`)));
  // Pages outside the navigation (notifications, for example) mark nothing as current.
  const best = candidates.sort((a, b) => b.length - a.length)[0] || null;
  $$('[data-nav]').forEach((a) => (a.dataset.nav === best ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

/** Full trail on wider screens; on phones only a back link to the parent and the page title. */
function setCrumbs(items) {
  render($('[data-crumbs]'), html`${items.map((c, i) => html`${i ? html`<span class="sep" aria-hidden="true">${icon('chevronRight', { size: 14 })}</span>` : ''}${i === items.length - 1 ? html`<span aria-current="page">${c.label}</span>` : html`<a href="${c.href}">${c.label}</a>`}`)}`);
  const parent = items.length > 1 ? items[items.length - 2] : null;
  const current = items[items.length - 1];
  render($('[data-crumb-mobile]'), html`${parent && parent.href ? html`<a class="btn btn-icon btn-sm btn-ghost crumb-back" href="${parent.href}" aria-label="Back to ${parent.label}">${icon('arrowLeft', { size: 18 })}</a>` : ''}<span class="crumb-title">${current ? current.label : ''}</span>`);
}

const historyKey = () => (history.state && history.state.k) || null;
const newKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function navigate(path, { replace = false } = {}) {
  const k = historyKey();
  if (k) state.scroll[k] = window.scrollY;
  if (replace) history.replaceState({ k: k || newKey() }, '', path); else history.pushState({ k: newKey() }, '', path);
  route();
}

async function route({ restore = false } = {}) {
  const seq = (state.navSeq += 1);
  state.cleanups.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  const url = new URL(window.location.href);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const base = NAV[state.me.user.role].base;
  if (!path.startsWith(base)) { window.location.assign(base); return; }
  const match = ROUTES.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m && x.r.pattern.startsWith(base));
  const view = $('#view');
  const el = document.createElement('div');
  el.className = 'view-mount';
  view.replaceChildren(el);
  setActive(path);
  const savedY = restore ? state.scroll[historyKey()] : undefined;
  if (savedY === undefined) window.scrollTo(0, 0);
  if (!match) {
    setCrumbs([{ label: 'Not found' }]);
    render(el, empty({ icon: 'compass', title: 'Page not found', text: 'This page doesn’t exist in your workspace.', action: html`<a class="btn btn-primary" href="${base}">Back to overview</a>` }));
    return;
  }
  const params = Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m[i + 1])]));
  const ctx = {
    el, path, params, query: Object.fromEntries(url.searchParams), search: url.searchParams, url,
    user: state.me.user, role: state.me.user.role, base, cfg: state.cfg, pattern: match.r.pattern,
    setTitle: (t) => { document.title = `${t} — HORIZON`; },
    setCrumbs, navigate, refreshBell, setActive,
    onCleanup: (fn) => state.cleanups.push(fn),
    isCurrent: () => seq === state.navSeq,
  };
  render(el, spinner());
  try {
    const mod = await match.r.load();
    if (seq !== state.navSeq) return;
    await mod.default(ctx);
  } catch (err) {
    if (seq !== state.navSeq) return;
    console.error(err);
    render(el, errorState(err));
    on(el, 'click', '[data-action=retry]', () => route());
  }
  if (savedY !== undefined && seq === state.navSeq) requestAnimationFrame(() => window.scrollTo(0, savedY));
  view.focus({ preventScroll: true });
}

function interceptLinks() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank' || a.hasAttribute('download') || a.dataset.external !== undefined) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    // In-page anchors (#id) scroll to and focus their target without a history entry or re-render.
    if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) {
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (target) {
        e.preventDefault();
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        target.focus({ preventScroll: true });
      }
      return;
    }
    const base = NAV[state.me.user.role].base;
    if (!url.pathname.startsWith(base) || url.pathname.startsWith('/api/')) return;
    e.preventDefault();
    if (url.pathname + url.search !== window.location.pathname + window.location.search) navigate(url.pathname + url.search + url.hash);
  });
  // Back/forward restores the scroll position the reader left; new navigation starts at the top.
  window.addEventListener('popstate', () => route({ restore: true }));
}

async function boot() {
  api.onUnauthorized = () => window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  api.onNotApproved = () => window.location.assign('/verify');
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (!historyKey()) history.replaceState({ k: newKey() }, '', window.location.href);
  try {
    const [me, cfg] = await Promise.all([get('/api/auth/me'), getConfig()]);
    if (!me.user) { api.onUnauthorized(); return; }
    if (me.next === '/verify') { window.location.assign('/verify'); return; }
    setCsrf(me.csrfToken);
    state.me = me;
    state.cfg = cfg;
    shell();
    interceptLinks();
    await route();
  } catch (err) {
    render($('#app'), html`<main class="view" id="view">${errorState(err)}</main>`);
    on($('#app'), 'click', '[data-action=retry]', () => window.location.reload());
    toastError(err);
  }
}

export { toast };
boot();
