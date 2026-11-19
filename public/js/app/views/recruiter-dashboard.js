import { html, render } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get } from '../../lib/api.js';
import { statCard, recruiterBadge, personAvatar, replyChip } from '../../lib/components.js';
import { skeletonPage, empty } from '../../lib/ui.js';
import { greeting, LABELS, timeAgo } from '../../lib/format.js';

export default async function recruiterDashboard(ctx) {
  ctx.setTitle('Overview');
  ctx.setCrumbs([{ label: 'Overview' }]);
  render(ctx.el, skeletonPage());
  const d = await get('/api/recruiter/dashboard');
  const rs = d.responseStats;
  const max = Math.max(1, ...d.pipeline.map((p) => p.count));
  const due = d.repliesDue || [];
  render(ctx.el, html`
    <section class="welcome compact" aria-labelledby="hello-h">
      <img class="wl-map" src="/img/world-dots.svg" alt="" width="1000" height="367">
      <div class="wl-text"><h1 id="hello-h">${greeting()}, ${ctx.user.firstName}.</h1><p>${d.organisation.name} · ${d.organisation.type}</p>
        <div class="wl-meta"><span class="badge">${icon('shieldCheck')} Verified recruiter</span>${d.organisation.verified ? html`<span class="badge">${icon('building')} Verified organisation</span>` : ''}${d.organisation.isDemo ? html`<span class="badge">Demo organisation</span>` : ''}</div></div>
      <div class="wl-actions"><a class="btn btn-accent" href="/recruiter/listings/new">${icon('plus')} Post a listing</a></div>
    </section>
    ${d.grievancesAwaiting ? html`<div class="alert alert-warning mb-16">${icon('scale')}<div><div class="alert-title">Response requested on ${d.grievancesAwaiting} grievance${d.grievancesAwaiting > 1 ? 's' : ''}</div>The grievance desk will consider your side before deciding. <a href="/recruiter/grievances">Respond now</a>.</div></div>` : ''}
    <section class="card replies-due mb-24" aria-labelledby="due-h">
      <div class="card-header"><h2 id="due-h">${icon('clock', { size: 20 })} Replies due</h2>
        <span class="subtle small">${due.length ? `Oldest first · every applicant gets a first reply within ${d.responseWindowDays} days` : `You promise a first reply within ${d.responseWindowDays} days`}</span></div>
      ${due.length ? html`<ul class="due-list">${due.map((a) => html`<li class="due-item ${a.overdue ? 'is-overdue' : ''}">
          ${personAvatar(a.student.name, 'sm')}
          <div class="grow"><div class="ml-title">${a.student.name} <span class="muted">· ${a.student.institutionShort || a.student.institution}</span></div><div class="ml-sub">${a.opportunityTitle} · applied ${timeAgo(a.submittedAt)}</div></div>
          ${replyChip(a)}
          <a class="btn btn-sm ${a.overdue ? 'btn-primary' : ''}" href="/recruiter/applications/${a.id}">Open applicant<span class="sr-only">: ${a.student.name}</span></a></li>`)}</ul>`
    : empty({ compact: true, icon: 'checkCircle', title: 'No replies due', text: 'Every applicant has had a first response. New applications appear here with their reply deadline.' })}
    </section>
    <div class="stats-grid">
      ${statCard({ label: 'Active listings', value: d.stats.activeListings, iconName: 'briefcase', href: '/recruiter/listings', meta: `${d.stats.pendingReview} in review · ${d.stats.drafts} drafts` })}
      ${statCard({ label: 'Total applicants', value: d.stats.totalApplicants, iconName: 'users', href: '/recruiter/applicants' })}
      ${statCard({ label: 'Awaiting first response', value: d.stats.awaitingResponse, iconName: 'inbox', href: '/recruiter/applicants?status=submitted', accent: d.stats.awaitingResponse > 0 })}
      ${statCard({ label: 'Interviews', value: d.stats.interviews, iconName: 'calendar' })}
      ${statCard({ label: 'Offers', value: d.stats.offers, iconName: 'award' })}
    </div>
    <div class="dash-grid">
      <section class="card"><div class="card-header"><h2>Recent applicants</h2><a class="btn btn-sm" href="/recruiter/applicants">All applicants</a></div>
        ${d.recentApplicants.length ? html`<div class="table-wrap flush"><table class="table"><thead><tr><th>Candidate</th><th class="hide-sm">Listing</th><th>Status</th><th class="hide-sm">Applied</th></tr></thead><tbody>
          ${d.recentApplicants.map((a) => html`<tr><td><a class="row gap-3 no-underline" href="/recruiter/applications/${a.id}">${personAvatar(a.student.name, 'sm')}<div><div class="cell-title">${a.student.name}</div><div class="cell-sub">${a.student.institutionShort || a.student.institution} · ${a.student.programme}</div></div></a></td>
            <td class="hide-sm">${a.opportunityTitle}</td><td>${a.withdrawn ? html`<span class="badge">Withdrawn</span>` : recruiterBadge(a.recruiterStatus)}${a.respondBy ? html`<div class="mt-8">${replyChip(a)}</div>` : ''}</td><td class="hide-sm subtle">${timeAgo(a.submittedAt)}</td></tr>`)}</tbody></table></div>`
    : empty({ icon: 'users', title: 'No applicants yet', text: 'Listings that accept HORIZON applications collect verified applicants here.' })}</section>
      <div class="stack gap-5">
        <section class="card card-pad"><h3>${icon('activity')} Your public response rate</h3>
          ${rs.enoughData ? html`<div class="big-figure">${rs.responseRate}%</div><p class="small muted mb-0">of applications answered within ${rs.windowDays} days · shown to students on your listings.</p>`
    : html`<p class="small muted">Published once at least three applications are past the ${rs.windowDays}-day window (${rs.applications} so far).</p>`}
          ${rs.averageResponseDays != null ? html`<p class="subtle mt-8 mb-0">Average first response: <strong>${rs.averageResponseDays} days</strong></p>` : ''}</section>
        <section class="card card-pad"><h3>Pipeline</h3><div class="bars mt-16">${d.pipeline.map((p) => html`<div class="bar-row"><span class="bar-label">${LABELS.recruiterStatus[p.status]}</span><span class="bar"><span style="width:${p.count ? Math.max(4, (p.count / max) * 100) : 0}%"></span></span><span class="bar-val">${p.count}</span></div>`)}</div></section>
        <section class="card card-pad"><h3>${icon('shieldCheck')} Your commitments</h3><ul class="check-list mt-8">
          <li>${icon('checkCircle', { cls: 'pass' })}<span class="cl-detail text-body">Respond to every applicant within ${d.responseWindowDays} days.</span></li>
          <li>${icon('checkCircle', { cls: 'pass' })}<span class="cl-detail text-body">Give a short reason to candidates you don’t select.</span></li>
          <li>${icon('checkCircle', { cls: 'pass' })}<span class="cl-detail text-body">Never ask candidates to pay any fee.</span></li></ul></section>
      </div>
    </div>`);
}
