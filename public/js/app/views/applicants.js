import { html, render, on } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get } from '../../lib/api.js';
import { recruiterBadge, personAvatar, docBadge, replyChip } from '../../lib/components.js';
import { empty } from '../../lib/ui.js';
import { LABELS, RECRUITER_STATUSES, fmtDate, timeAgo } from '../../lib/format.js';
import { pageHeader } from '../shared.js';

export default async function applicants(ctx) {
  const oppId = ctx.params.id;
  let status = RECRUITER_STATUSES.includes(ctx.query.status) ? ctx.query.status : '';
  ctx.setTitle('Applicants');
  if (oppId) ctx.setActive('/recruiter/listings');

  const load = async () => {
    const data = oppId ? await get(`/api/recruiter/opportunities/${oppId}/applicants`) : await get('/api/recruiter/applicants');
    ctx.setCrumbs(oppId ? [{ label: 'My Listings', href: '/recruiter/listings' }, { label: data.opportunity.title, href: `/recruiter/opportunities/${oppId}` }, { label: 'Applicants' }] : [{ label: 'Applicants' }]);
    const all = data.items;
    const active = all.filter((a) => !a.withdrawn);
    const counts = Object.fromEntries(RECRUITER_STATUSES.map((s) => [s, active.filter((a) => a.recruiterStatus === s).length]));
    const rows = status ? all.filter((a) => a.recruiterStatus === status && !a.withdrawn) : all;
    const overdue = active.filter((a) => a.overdue).length;

    render(ctx.el, html`${pageHeader({
      title: oppId ? data.opportunity.title : 'Applicants',
      subtitle: oppId ? `HORIZON applicants for this listing · deadline ${fmtDate(data.opportunity.deadline)}` : 'Every candidate here is a verified INI student with a validated CV.',
      actions: oppId ? html`<a class="btn" href="/recruiter/opportunities/${oppId}">${icon('eye')} View listing</a>` : '',
    })}
      ${overdue ? html`<div class="alert alert-warning mb-16">${icon('clock')}<div>${overdue} candidate${overdue > 1 ? 's are' : ' is'} waiting for a first reply that is overdue — the ${ctx.cfg.recruiterResponseDays}-day window has passed.</div></div>` : ''}
      <div class="tabs" role="tablist" style="overflow-x:auto">
        <button class="tab" role="tab" aria-selected="${String(!status)}" data-status="">All <span class="count">${all.length}</span></button>
        ${RECRUITER_STATUSES.map((s) => html`<button class="tab" role="tab" aria-selected="${String(status === s)}" data-status="${s}">${LABELS.recruiterStatus[s]} <span class="count">${counts[s]}</span></button>`)}
      </div>
      ${rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Candidate</th>${oppId ? '' : html`<th class="hide-sm">Listing</th>`}<th>Status</th><th class="hide-sm">CV</th><th class="hide-sm">Applied</th><th></th></tr></thead><tbody>
        ${rows.map((a) => html`<tr>
          <td><div class="row gap-3">${personAvatar(a.student.name, 'sm')}<div><a class="cell-title" href="/recruiter/applications/${a.id}">${a.student.name}</a><div class="cell-sub">${a.student.institutionShort || a.student.institution} · ${a.student.programme || 'Programme not set'}${a.student.currentYear ? ` · Year ${a.student.currentYear}` : ''}</div></div></div></td>
          ${oppId ? '' : html`<td class="hide-sm">${a.opportunityTitle}</td>`}
          <td>${a.withdrawn ? html`<span class="badge">Withdrawn by candidate</span>` : recruiterBadge(a.recruiterStatus)}${!a.withdrawn && a.respondBy ? html`<div class="mt-8">${replyChip(a)}</div>` : ''}</td>
          <td class="hide-sm">${a.cv ? docBadge(a.cv.status) : html`<span class="subtle">—</span>`}${a.video ? html` <span class="badge badge-info">${icon('video', { size: 12 })} video</span>` : ''}</td>
          <td class="hide-sm subtle" title="${fmtDate(a.submittedAt)}">${timeAgo(a.submittedAt)}</td>
          <td><a class="btn btn-sm" href="/recruiter/applications/${a.id}">Review ${icon('chevronRight', { size: 15 })}</a></td></tr>`)}
      </tbody></table></div>`
    : html`<div class="card">${empty({ icon: 'users', title: status ? `No candidates marked “${LABELS.recruiterStatus[status]}”` : 'No applicants yet', text: status ? 'Try another status.' : 'Verified students who apply on HORIZON will appear here, newest first.' })}</div>`}`);
  };
  on(ctx.el, 'click', '[data-status]', (e, b) => {
    status = b.dataset.status;
    history.replaceState(null, '', status ? `${ctx.path}?status=${status}` : ctx.path);
    load();
  });
  await load();
}
