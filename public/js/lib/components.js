import { html, raw, safeUrl } from './dom.js';
import { icon } from './icons.js';
import { LABELS, fmtDate, fmtShort, stipend, deadlineLabel, daysUntil, timeAgo, fmtDateTime, parseDate, plural } from './format.js';

export const logoMark = raw('<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6.5 20.5a9.5 9.5 0 0 1 19 0" fill="none" stroke="#D99A38" stroke-width="2.6" stroke-linecap="round"/><path d="M3 20.5h26" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M8.5 25.2h15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".45"/><circle cx="16" cy="20.5" r="2.5" fill="#D99A38"/></svg>');
export const logo = (href = '/', dark = false) => html`<a class="logo ${dark ? 'on-dark' : ''}" href="${href}" aria-label="HORIZON home">${logoMark}<span>HORIZON</span></a>`;

const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
export const orgAvatar = (org, size = '') => html`<span class="avatar org-logo c${(hash(org.name) % 5) + 1} ${size}" aria-hidden="true">${org.initials || String(org.name || '?').slice(0, 2).toUpperCase()}</span>`;
export const personAvatar = (name, size = '') => html`<span class="avatar ${size}" aria-hidden="true">${String(name || '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>`;

export const demoBadge = (text = 'Illustrative listing') => html`<span class="badge badge-demo" title="Demo data — not a real vacancy">${text}</span>`;
export const demoCorner = () => html`<span class="demo-corner" title="Demo data — not a real vacancy">Demo<span class="sr-only"> data — not a real vacancy</span></span>`;

/** One dismissible notice per screen when demonstration listings are on show. */
const DEMO_KEY = 'horizon.demoNoticeDismissed';
export const demoNoticeDismissed = () => { try { return sessionStorage.getItem(DEMO_KEY) === '1'; } catch { return false; } };
export function demoNotice() {
  if (demoNoticeDismissed()) return '';
  return html`<div class="alert alert-demo demo-notice mb-16" data-demo-notice>${icon('info')}<div class="grow">Listings shown are illustrative demonstration data — not real vacancies.</div>
    <button type="button" class="btn btn-ghost btn-icon btn-sm alert-close" data-dismiss-demo aria-label="Dismiss demo data notice">${icon('x', { size: 16 })}</button></div>`;
}
export function wireDemoNotice(root) {
  root.addEventListener('click', (e) => {
    if (!e.target.closest('[data-dismiss-demo]')) return;
    try { sessionStorage.setItem(DEMO_KEY, '1'); } catch { /* preference only */ }
    const n = root.querySelector('[data-demo-notice]');
    if (n) n.remove();
  });
}
export const verifiedOrg = () => html`<span class="badge badge-teal">${icon('shieldCheck')} Verified organisation</span>`;
export const stageBadge = (s) => html`<span class="badge stage stage-${s}">${LABELS.stage[s] || s}</span>`;
export const recruiterBadge = (s) => {
  const map = { submitted: 'badge-navy', under_review: 'badge-info', shortlisted: 'badge-teal', assessment: 'badge-warning', interview: 'badge-teal', offer: 'badge-success', not_selected: 'badge-error' };
  return html`<span class="badge ${map[s] || ''}">${LABELS.recruiterStatus[s] || s}</span>`;
};
export const docBadge = (s) => {
  const map = { auto_verified: 'badge-teal', verified: 'badge-success', flagged: 'badge-warning', changes_requested: 'badge-error', pending_review: 'badge-warning', approved: 'badge-success', rejected: 'badge-error', submitted: 'badge-info' };
  const ic = { verified: 'shieldCheck', auto_verified: 'checkCircle', approved: 'checkCircle', flagged: 'clock', pending_review: 'clock', rejected: 'xCircle', changes_requested: 'alertCircle' }[s];
  return html`<span class="badge ${map[s] || ''}">${ic ? icon(ic) : ''}${LABELS.doc[s] || s}</span>`;
};
export const userBadge = (s) => html`<span class="badge ${{ approved: 'badge-success', pending: 'badge-warning', rejected: 'badge-error', suspended: 'badge-error' }[s] || ''}">${LABELS.user[s] || s}</span>`;
export const listingBadge = (s) => html`<span class="badge ${{ published: 'badge-success', pending_review: 'badge-warning', draft: '', rejected: 'badge-error', archived: 'badge-outline' }[s] || ''}">${LABELS.listing[s] || s}</span>`;
export const priorityBadge = (p) => html`<span class="badge ${{ urgent: 'badge-error', high: 'badge-warning', normal: '' }[p] || ''}">${p === 'urgent' ? icon('zap') : ''}${LABELS.priority[p] || p}</span>`;
export const grievanceBadge = (status, label) => html`<span class="badge ${{ submitted: 'badge-info', acknowledged: 'badge-navy', under_review: 'badge-warning', awaiting_response: 'badge-gold', resolved: 'badge-success', rejected: 'badge-outline', closed: '' }[status] || ''}">${label || status}</span>`;
export const workModeLabel = (m) => LABELS.workMode[m] || m;

export function slaChip(sla) {
  if (!sla) return '';
  if (!sla.open) return html`<span class="badge badge-success">${icon('check')} Decided</span>`;
  if (sla.ackOverdue) return html`<span class="badge badge-error">${icon('alertTriangle')} Acknowledgement overdue</span>`;
  if (sla.resolutionOverdue) return html`<span class="badge badge-error">${icon('alertTriangle')} Past resolution target</span>`;
  const h = sla.hoursToResolution;
  return html`<span class="badge ${h <= 48 ? 'badge-warning' : 'badge-teal'}">${icon('clock')} ${h >= 48 ? `${Math.round(h / 24)} days` : `${h} h`} to target</span>`;
}

/**
 * Internship card used in discovery, dashboards and the landing page.
 * Rules: four facts in the meta row; at most two badges (tracked stage > Apply on HORIZON);
 * listing verification is a quiet text marker; demo data is a corner label, never a pill.
 */
export function oppCard(o, { saveable = true, href = `/app/opportunities/${o.id}`, showStage = true, reasons = null } = {}) {
  const days = daysUntil(o.deadline);
  const badges = [
    showStage && o.applicationStage ? stageBadge(o.applicationStage) : null,
    o.applicationMode === 'horizon' ? html`<span class="badge badge-navy">${icon('send')} Apply on HORIZON</span>` : null,
  ].filter(Boolean).slice(0, 2);
  const why = reasons && reasons.length ? `${reasons.slice(0, 2).join(' · ')}${reasons.length > 2 ? ` +${reasons.length - 2} more` : ''}` : '';
  return html`<article class="card interactive opp-card" data-id="${o.id}">
    ${o.isDemo ? demoCorner() : ''}
    <div class="oc-top">
      ${orgAvatar(o.organisation)}
      <div class="grow">
        <div class="oc-org"><span class="truncate">${o.organisation.name}</span>${o.organisation.verified ? icon('shieldCheck', { size: 14, label: 'Verified organisation' }) : ''}</div>
        <h3><a href="${href}" data-link>${o.title}</a></h3>
      </div>
      ${saveable ? html`<button class="btn btn-sm btn-icon oc-save save-btn" data-save="${o.id}" aria-pressed="${o.saved ? 'true' : 'false'}" aria-label="${o.saved ? 'Remove from saved' : 'Save opportunity'}" title="${o.saved ? 'Saved' : 'Save'}">${icon('bookmark', { size: 16 })}</button>` : ''}
    </div>
    <div class="oc-meta">
      <span>${icon('mapPin')}${o.city}, ${o.country}</span>
      <span>${icon('clock')}${o.durationWeeks} weeks</span>
      <span>${icon('layers')}${workModeLabel(o.workMode)}</span>
      <span>${icon('passport')}${LABELS.visa[o.visaSponsorship]}</span>
    </div>
    ${o.isVerified ? html`<div class="oc-trust"><span class="badge badge-quiet">Verified${o.lastVerifiedAt ? ` · ${fmtShort(o.lastVerifiedAt)}` : ''}</span>${o.responseRate != null ? html`<span class="badge badge-quiet no-dot">Replies within 14 days: ${o.responseRate}%</span>` : ''}</div>` : ''}
    ${o.summary ? html`<p class="oc-summary">${o.summary}</p>` : ''}
    ${badges.length ? html`<div class="chips">${badges}</div>` : ''}
    ${why ? html`<p class="oc-why">${icon('sparkles', { size: 14 })}<span><span class="sr-only">Why recommended: </span>Matches: ${why}</span></p>` : ''}
    <div class="oc-foot">
      <span class="oc-pay">${stipend(o)}</span>
      <span class="oc-deadline ${days != null && days <= 14 ? 'soon' : ''}">${days != null && days <= 14 ? icon('clock', { size: 13 }) : ''}${deadlineLabel(o.deadline)}</span>
    </div>
  </article>`;
}

/**
 * The accountability clock. Shows the recruiter's reply promise for a HORIZON application:
 * replied, waiting (teal; amber in the last three days) or overdue (with a route to the grievance desk).
 * Expects camelCase fields from the API: channel, respondBy, daysToRespond, responseOverdue,
 * firstResponseAt, submittedAt, opportunityId, organisation, title.
 */
export function respondClock(a, { base = '/app', compact = false, windowDays = 14 } = {}) {
  if (!a || a.channel !== 'horizon') return '';
  if (a.firstResponseAt) {
    return html`<div class="respond-clock tone-success ${compact ? 'compact' : ''}"><div class="rc-line">${icon('checkCircle', { size: 16 })}<span><strong>Replied ${fmtShort(a.firstResponseAt)}</strong></span></div></div>`;
  }
  if (!a.respondBy) return '';
  const left = a.daysToRespond;
  const due = fmtShort(a.respondBy);
  const start = parseDate(a.submittedAt) || new Date(parseDate(a.respondBy).getTime() - windowDays * 86400000);
  const span = parseDate(a.respondBy).getTime() - start.getTime();
  const elapsed = Math.min(1, Math.max(0, (Date.now() - start.getTime()) / (span || 1)));
  const pct = `${Math.round(elapsed * 100)}%`;
  const elapsedDays = Math.min(windowDays, Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000)));
  if (a.responseOverdue) {
    const n = Math.abs(left);
    const label = `${a.organisation || 'Organisation'} — ${a.title || 'application'}`;
    return html`<div class="respond-clock tone-error ${compact ? 'compact' : ''}">
      <div class="rc-line">${icon('alertTriangle', { size: 16 })}<span><strong>Reply overdue by ${plural(n, 'day')}</strong>${compact ? '' : html` · was due ${due}`}</span></div>
      <div class="rc-track" aria-hidden="true" style="--p:100%"><span class="rc-fill"></span><span class="rc-sun"></span></div>
      <a class="rc-action" href="${reportHref(base, a, label)}">Raise this with HORIZON ${icon('arrowRight', { size: 14 })}</a>
    </div>`;
  }
  const tone = left <= 3 ? 'tone-warning' : 'tone-teal';
  const leftText = left === 0 ? 'due today' : `${plural(left, 'day')} left`;
  return html`<div class="respond-clock ${tone} ${compact ? 'compact' : ''}">
    <div class="rc-line">${icon(left <= 3 ? 'clock' : 'shieldCheck', { size: 16 })}<span><strong>Reply due ${due}</strong> · ${leftText}</span></div>
    <div class="rc-track" aria-hidden="true" style="--p:${pct}"><span class="rc-fill"></span><span class="rc-sun"></span></div>
    ${compact ? '' : html`<div class="rc-ends" aria-hidden="true"><span>Applied</span><span>Due</span></div>`}
    <span class="sr-only">${elapsedDays} of ${windowDays} days of the reply window have passed.</span>
  </div>`;
}
/** Link to the grievance form with the subject (and optionally the category) pre-selected. */
export function grievanceLink(base, type, id, label, category = '') {
  return `${base}/grievances/new?againstType=${type}&againstId=${id}${category ? `&category=${encodeURIComponent(category)}` : ''}&label=${encodeURIComponent(label)}`;
}
const reportHref = (base, a, label) => grievanceLink(base, 'opportunity', a.opportunityId, label, 'no_response');

/** Recruiter-side wording of the same clock, for dense lists. */
export function replyChip(a) {
  if (!a || a.withdrawn || !a.respondBy) return '';
  if (a.overdue) return html`<span class="badge badge-error">${icon('alertTriangle')} Overdue by ${plural(Math.abs(a.daysToRespond), 'day')}</span>`;
  return html`<span class="badge ${a.daysToRespond <= 3 ? 'badge-warning' : 'badge-outline'}">${icon('clock')} Reply due ${fmtShort(a.respondBy)}</span>`;
}

/**
 * Trust strip for a listing: is it real, who is behind it, what happens next. Each item links to
 * the full Trust & transparency panel (or the organisation page).
 */
export function trustStrip(o, { orgHref, panelId = 'trust-panel' } = {}) {
  const rs = o.responseStats;
  const item = (ok, ic, text, href) => html`<a class="ts-item ${ok ? 'ok' : 'pending'}" href="${href}">${icon(ic, { size: 16 })}<span>${text}</span></a>`;
  return html`<div class="trust-strip" role="list" aria-label="Trust summary">
    <span role="listitem">${item(o.organisation.verified, o.organisation.verified ? 'shieldCheck' : 'shield', o.organisation.verified ? `Organisation verified${o.organisation.verifiedAt ? ` · ${fmtDate(o.organisation.verifiedAt, { day: undefined })}` : ''}` : 'Organisation not yet verified', orgHref)}</span>
    <span role="listitem">${item(!!o.lastVerifiedAt, 'fileCheck', o.lastVerifiedAt ? `Listing verified ${fmtShort(o.lastVerifiedAt)}` : 'Listing awaiting review', `#${panelId}`)}</span>
    <span role="listitem">${item(o.noFeeConfirmed, 'ban', o.noFeeConfirmed ? 'No fees, ever' : 'Fee pledge not confirmed', `#${panelId}`)}</span>
    <span role="listitem">${rs ? item(rs.enoughData, 'activity', rs.enoughData ? `${rs.responseRate}% replied within ${rs.windowDays} days` : 'New on HORIZON', `#${panelId}`)
    : item(!!o.sourceUrl, 'externalLink', o.sourceUrl ? 'Official source linked' : 'Apply on the employer’s site', `#${panelId}`)}</span>
  </div>`;
}

export function statCard({ label, value, iconName, meta = '', accent = false, href }) {
  const inner = html`<div class="stat-label">${iconName ? icon(iconName) : ''}${label}</div><div class="stat-value">${value}</div>${meta ? html`<div class="stat-meta">${meta}</div>` : ''}`;
  return href ? html`<a class="card stat-card interactive ${accent ? 'accent' : ''}" href="${href}" data-link>${inner}</a>` : html`<div class="card stat-card ${accent ? 'accent' : ''}">${inner}</div>`;
}

/** "5 passed · 1 suggestion · 1 failed" line for a validation report. */
export function checkSummary(summary) {
  if (!summary) return '';
  return html`<div class="check-summary"><span class="cs-pass">${icon('checkCircle', { size: 15 })} ${summary.passed} passed</span>${summary.warnings ? html`<span class="cs-warn">${plural(summary.warnings, 'suggestion')}</span>` : ''}${summary.failed ? html`<span class="cs-fail">${summary.failed} failed</span>` : ''}</div>`;
}

export function checkList(checks = []) {
  const ic = { pass: 'checkCircle', warn: 'alertCircle', fail: 'xCircle' };
  return html`<ul class="check-list">${checks.map((c) => html`<li>${icon(ic[c.result] || (c.ok ? 'checkCircle' : 'xCircle'), { cls: c.result || (c.ok ? 'pass' : 'fail'), size: 18 })}
    <div><div class="cl-label">${c.label}</div>${c.detail ? html`<div class="cl-detail">${c.detail}</div>` : ''}</div></li>`)}</ul>`;
}

export function timeline(items) {
  return html`<ol class="timeline">${items.map((it) => html`<li class="${it.internal ? 'internal' : ''}">
    <span class="tl-dot ${it.tone || ''}"></span>
    <div class="tl-head">${it.title}<span class="tl-time" title="${fmtDateTime(it.at)}">${timeAgo(it.at)}</span></div>
    ${it.body ? html`<div class="tl-body">${it.body}</div>` : ''}
  </li>`)}</ol>`;
}

export function pagination({ page, totalPages }) {
  if (!totalPages || totalPages <= 1) return '';
  const pages = [];
  for (let p = 1; p <= totalPages; p += 1) if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
  const out = [];
  pages.forEach((p, i) => { if (i && p - pages[i - 1] > 1) out.push(html`<span class="subtle">…</span>`); out.push(html`<button class="btn btn-sm" data-page="${p}" ${p === page ? html`aria-current="page"` : ''}>${p}</button>`); });
  return html`<nav class="pagination" aria-label="Pagination">
    <button class="btn btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevronLeft')}</button>
    ${out}
    <button class="btn btn-sm" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} aria-label="Next page">${icon('chevronRight')}</button>
  </nav>`;
}

export function bars(rows, { color = 'var(--navy-2)', labelFn = (r) => r.label } = {}) {
  if (!rows || !rows.length) return html`<p class="subtle">No data yet.</p>`;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return html`<div class="bars">${rows.map((r) => html`<div class="bar-row"><span class="bar-label" title="${labelFn(r)}">${labelFn(r)}</span>
    <span class="bar" role="img" aria-label="${labelFn(r)}: ${r.value}"><span style="width:${r.value ? Math.max(3, (r.value / max) * 100) : 0}%;background:${color}"></span></span><span class="bar-val">${r.value}</span></div>`)}</div>`;
}

export function dateChip(d) {
  const date = parseDate(d);
  if (!date) return '';
  return html`<div class="date-chip" aria-hidden="true"><div class="dc-m">${date.toLocaleDateString('en-GB', { month: 'short' })}</div><div class="dc-d">${date.getDate()}</div></div>`;
}

export const extLink = (url, label, cls = '') => html`<a class="${cls}" href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label} ${icon('externalLink', { size: 14 })}</a>`;
export { fmtDate, fmtShort };
