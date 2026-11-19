import { html, render, on } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, post } from '../../lib/api.js';
import { statCard, priorityBadge, grievanceBadge, slaChip } from '../../lib/components.js';
import { skeletonPage, toast, toastError, withLoading } from '../../lib/ui.js';
import { greeting, timeAgo } from '../../lib/format.js';

/** A queue count that reads at a glance: red only when something is waiting past its deadline. */
function queueTile({ label, iconName, value, href, meta, urgent = false }) {
  const tone = value ? (urgent ? 'attention' : '') : 'clear';
  return html`<a class="card interactive queue-tile ${tone}" href="${href}">
    <span class="qt-label">${icon(iconName, { size: 16 })} ${label}</span>
    <span class="qt-value">${value}</span>
    <span class="qt-meta">${value ? meta : html`${icon('checkCircle', { size: 13 })} Nothing waiting`}</span></a>`;
}

export default async function adminOverview(ctx) {
  ctx.setTitle('Admin overview');
  ctx.setCrumbs([{ label: 'Overview' }]);
  render(ctx.el, skeletonPage());
  const load = async () => {
    const d = await get('/api/admin/dashboard');
    const s = d.stats;
    render(ctx.el, html`
      <section class="welcome compact" aria-labelledby="hello-h">
        <img class="wl-map" src="/img/world-dots.svg" alt="" width="1000" height="367">
        <div class="wl-text"><h1 id="hello-h">${greeting()}.</h1><p>${ctx.user.fullName} · every decision in this console is written to the audit log.</p>
          <div class="wl-meta"><span class="badge">${icon('shield')} Administrator</span>${d.containsDemoData ? html`<span class="badge">Includes demo data</span>` : ''}</div></div>
      </section>
      ${d.containsDemoData ? html`<div class="alert alert-demo mb-16">${icon('info')}<div><strong>Illustrative demo data.</strong> This installation was seeded with fictional organisations, listings and grievances. Counts below describe this database only and are not platform statistics.</div></div>` : ''}
      ${s.expiredStillPublished ? html`<div class="alert alert-warning mb-16">${icon('clock')}<div class="grow"><div class="alert-title">${s.expiredStillPublished} published listing${s.expiredStillPublished > 1 ? 's are' : ' is'} past the deadline</div>Expired listings are hidden from students automatically. Archive them to tidy the console.</div><button class="btn btn-sm" data-archive>${icon('archive', { size: 15 })} Archive now</button></div>` : ''}
      <h2 class="label-caps mb-8">Queues</h2>
      <div class="queue-tiles">
        ${queueTile({ label: 'Verifications', iconName: 'userCheck', value: s.pendingVerifications, href: '/admin/verifications?status=pending', meta: 'awaiting a decision' })}
        ${queueTile({ label: 'Document reviews', iconName: 'fileCheck', value: s.documentsToReview, href: '/admin/documents', meta: 'CVs and videos to moderate' })}
        ${queueTile({ label: 'Grievances overdue', iconName: 'scale', value: s.overdueGrievances, href: '/admin/grievances?overdue=1', meta: `${s.openGrievances} open in total`, urgent: true })}
        ${queueTile({ label: 'Listings pending review', iconName: 'briefcase', value: s.listingsPendingReview, href: '/admin/internships?status=pending_review', meta: 'before they go live' })}
      </div>
      <div class="stats-grid cols-3">
        ${statCard({ label: 'Approved students', value: s.students.approved, iconName: 'graduation', href: '/admin/students', meta: `${s.students.pending} pending · ${s.students.suspended} suspended` })}
        ${statCard({ label: 'Approved recruiters', value: s.recruiters.approved, iconName: 'building', href: '/admin/recruiters', meta: `${s.recruiters.pending} pending` })}
        ${statCard({ label: 'Open listings', value: s.publishedListings, iconName: 'briefcase', href: '/admin/internships' })}
      </div>
      <div class="grid grid-3 gap-5 align-start">
        <section class="card"><div class="card-header"><h2>${icon('userCheck')} Verification queue</h2><a class="btn btn-sm" href="/admin/verifications">Open</a></div>
          ${d.queues.verifications.length ? html`<div class="card-body tight-y"><ul class="mini-list">${d.queues.verifications.map((v) => html`<li><a href="/admin/verifications?type=${v.request_type}"><div class="grow"><div class="ml-title">${v.full_name}</div><div class="ml-sub">${v.request_type === 'student' ? 'Student' : 'Recruiter'} · ${v.affiliation}</div></div><span class="subtle xs nowrap">${timeAgo(v.created_at)}</span></a></li>`)}</ul></div>`
    : html`<div class="card-body"><p class="muted mb-0">${icon('checkCircle', { size: 16 })} Nothing waiting.</p></div>`}</section>
        <section class="card"><div class="card-header"><h2>${icon('scale')} Grievances by deadline</h2><a class="btn btn-sm" href="/admin/grievances">Open</a></div>
          ${d.queues.grievances.length ? html`<div class="card-body tight-y"><ul class="mini-list">${d.queues.grievances.map((g) => html`<li><a href="/admin/grievances/${g.id}"><div class="grow"><div class="ml-title">${g.subject}</div><div class="ml-sub"><span class="mono">${g.ticketNo}</span> · ${g.statusLabel}</div><div class="row wrap mt-8 gap-2">${priorityBadge(g.priority)}${slaChip(g.sla)}</div></div></a></li>`)}</ul></div>`
    : html`<div class="card-body"><p class="muted mb-0">${icon('checkCircle', { size: 16 })} No open grievances.</p></div>`}</section>
        <section class="card"><div class="card-header"><h2>${icon('briefcase')} Listings awaiting review</h2><a class="btn btn-sm" href="/admin/internships?status=pending_review">Open</a></div>
          ${d.queues.listings.length ? html`<div class="card-body tight-y"><ul class="mini-list">${d.queues.listings.map((l) => html`<li><a href="/admin/internships/${l.id}"><div class="grow"><div class="ml-title">${l.title}</div><div class="ml-sub">${l.organisation} · updated ${timeAgo(l.updated_at)}</div></div></a></li>`)}</ul></div>`
    : html`<div class="card-body"><p class="muted mb-0">${icon('checkCircle', { size: 16 })} Review queue is empty.</p></div>`}</section>
      </div>
      <section class="card card-pad mt-24"><h3>Quick actions</h3><div class="row wrap mt-8 gap-3">
        <a class="btn" href="/admin/internships/new">${icon('plus')} Add internship</a><a class="btn" href="/admin/institutions">${icon('graduation')} Manage institutions</a>
        <a class="btn" href="/admin/organisations">${icon('building')} Organisations</a><a class="btn" href="/admin/resources">${icon('globe')} Global resources</a>
        <a class="btn" href="/admin/reports">${icon('barChart')} Reports</a><a class="btn" href="/admin/audit">${icon('history')} Audit log</a></div></section>`);
  };
  on(ctx.el, 'click', '[data-archive]', async (e, b) => {
    await withLoading(b, async () => { try { const r = await post('/api/admin/opportunities/archive-expired', {}); toast(r.message); await load(); } catch (err) { toastError(err); } });
  });
  await load();
}
