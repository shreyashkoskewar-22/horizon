import { html, render, on } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, del } from '../../lib/api.js';
import { listingBadge } from '../../lib/components.js';
import { empty, toast, toastError, confirmDialog } from '../../lib/ui.js';
import { fmtDate, stipend, deadlineLabel } from '../../lib/format.js';
import { pageHeader } from '../shared.js';

const TABS = [['', 'All'], ['published', 'Published'], ['pending_review', 'In review'], ['draft', 'Drafts'], ['rejected', 'Changes requested'], ['archived', 'Archived']];

export default async function recruiterListings(ctx) {
  ctx.setTitle('My Listings');
  ctx.setCrumbs([{ label: 'My Listings' }]);
  let status = ctx.query.status || '';
  const load = async () => {
    const { items } = await get('/api/recruiter/opportunities', status ? { status } : {});
    render(ctx.el, html`${pageHeader({ title: 'My listings', subtitle: 'Every listing is reviewed by HORIZON before students can see it.', actions: html`<a class="btn btn-accent" href="/recruiter/listings/new">${icon('plus')} Post a listing</a>` })}
      <div class="tabs" role="tablist">${TABS.map(([v, l]) => html`<button class="tab" role="tab" aria-selected="${String(status === v)}" data-tab="${v}">${l}</button>`)}</div>
      ${items.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Listing</th><th>Status</th><th class="hide-sm">Deadline</th><th class="hide-sm">Compensation</th><th>Applicants</th><th></th></tr></thead><tbody>
        ${items.map((o) => html`<tr><td><a class="cell-title" href="/recruiter/opportunities/${o.id}">${o.title}</a><div class="cell-sub">${o.city}, ${o.country} · ${o.applicationMode === 'horizon' ? 'Apply on HORIZON' : 'Employer site'}${o.isDemo ? ' · demo' : ''}</div>
          ${o.reviewNote ? html`<div class="small mt-8" style="color:var(--error)">${icon('alertCircle', { size: 13 })} ${o.reviewNote}</div>` : ''}</td>
          <td>${listingBadge(o.status)}</td><td class="hide-sm">${fmtDate(o.deadline)}<div class="cell-sub">${deadlineLabel(o.deadline)}</div></td><td class="hide-sm">${stipend(o)}</td>
          <td>${o.applicationMode === 'horizon' ? html`<a href="/recruiter/listings/${o.id}/applicants" class="strong">${o.applicants}</a>${o.awaiting ? html` <span class="badge badge-warning">${o.awaiting} new</span>` : ''}` : html`<span class="subtle">External</span>`}</td>
          <td><div class="actions"><a class="btn btn-sm" href="/recruiter/listings/${o.id}/edit">${icon('edit', { size: 15 })} Edit</a><button class="btn btn-sm btn-danger btn-icon" data-delete="${o.id}" aria-label="Delete ${o.title}">${icon('trash', { size: 15 })}</button></div></td></tr>`)}
      </tbody></table></div>` : html`<div class="card">${empty({ icon: 'briefcase', title: status ? 'Nothing here' : 'No listings yet', text: 'Post your first international internship. HORIZON reviews it before it goes live.', action: html`<a class="btn btn-primary" href="/recruiter/listings/new">Post a listing</a>` })}</div>`}`);
  };
  on(ctx.el, 'click', '[data-tab]', (e, b) => { status = b.dataset.tab; history.replaceState(null, '', status ? `?status=${status}` : ctx.path); load(); });
  on(ctx.el, 'click', '[data-delete]', async (e, b) => {
    if (!(await confirmDialog({ title: 'Delete this listing?', message: 'Listings with applicants are archived instead, so candidates keep their history.', confirmText: 'Delete', danger: true }))) return;
    try { const r = await del(`/api/opportunities/${b.dataset.delete}`); toast(r.message); load(); } catch (err) { toastError(err); }
  });
  await load();
}
