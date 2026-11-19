import { html, render, on, debounce } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, post, put, patch, del } from '../../lib/api.js';
import { listingBadge, pagination, orgAvatar } from '../../lib/components.js';
import { empty, toast, toastError, confirmDialog, withLoading, skeletonRows } from '../../lib/ui.js';
import { fmtDate, deadlineLabel } from '../../lib/format.js';
import { pageHeader } from '../shared.js';

const TABS = [['', 'All'], ['pending_review', 'In review'], ['published', 'Published'], ['expired', 'Expired'], ['draft', 'Drafts'], ['rejected', 'Changes requested'], ['archived', 'Archived']];

export async function reviewListing(o, { onDone } = {}) {
  const r = await confirmDialog({
    title: `Review “${o.title}”`,
    message: 'Publish if the listing is genuine, complete and free of any fee request. To send it back, explain exactly what must change — the recruiter sees your note.',
    confirmText: 'Send back with note', danger: true,
    reason: { label: 'Note to the recruiter', required: true, min: 10, placeholder: 'e.g. Add the monthly stipend amount and confirm the application link points to your careers site.' },
  });
  if (!r) return;
  try { await put(`/api/admin/opportunities/${o.id}/review`, { decision: 'reject', note: r.reason }); toast('Sent back to the recruiter.'); if (onDone) onDone(); } catch (err) { toastError(err); }
}

export default async function adminInternships(ctx) {
  ctx.setTitle('Manage internships');
  ctx.setCrumbs([{ label: 'Manage Internships' }]);
  const state = { status: ctx.query.status || '', q: ctx.query.q || '', page: Number(ctx.query.page) || 1 };
  render(ctx.el, html`${pageHeader({
    title: 'Manage internships',
    subtitle: 'Review recruiter submissions, curate verified external listings and keep deadlines current.',
    actions: html`<button class="btn" data-archive>${icon('archive')} Archive expired</button><a class="btn btn-primary" href="/admin/internships/new">${icon('plus')} Add internship</a>`,
  })}
    <div class="tabs" role="tablist" data-tabs></div>
    <div class="input-icon mb-16" style="max-width:520px">${icon('search')}<input class="input" type="search" placeholder="Search title, organisation or country" value="${state.q}" data-q aria-label="Search listings"></div>
    <div data-list>${skeletonRows(6)}</div>`);

  const sync = () => {
    const qs = new URLSearchParams(Object.entries({ status: state.status, q: state.q, page: state.page > 1 ? state.page : '' }).filter(([, v]) => v)).toString();
    history.replaceState(null, '', qs ? `${ctx.path}?${qs}` : ctx.path);
  };
  const load = async () => {
    sync();
    render(ctx.el.querySelector('[data-tabs]'), html`${TABS.map(([v, l]) => html`<button class="tab" role="tab" aria-selected="${String(state.status === v)}" data-tab="${v}">${l}</button>`)}`);
    const data = await get('/api/admin/opportunities', { status: state.status || undefined, q: state.q || undefined, page: state.page });
    render(ctx.el.querySelector('[data-list]'), data.items.length ? html`<p class="subtle mb-8">${data.total} listing${data.total === 1 ? '' : 's'}</p><div class="table-wrap is-long"><table class="table"><thead><tr>
      <th>Listing</th><th>Status</th><th class="hide-sm">Deadline</th><th class="hide-sm">Featured</th><th class="hide-sm">Verified</th><th class="hide-sm">Apps</th><th></th></tr></thead><tbody>
      ${data.items.map((o) => html`<tr>
        <td><div class="row start gap-3">${orgAvatar(o.organisation, 'sm')}<div><a class="cell-title" href="/admin/internships/${o.id}">${o.title}</a>
          <div class="cell-sub">${o.organisation.name}${o.organisation.verified ? ' ✓' : ''} · ${o.city}, ${o.country} · ${o.applicationMode === 'horizon' ? 'Apply on HORIZON' : 'External'}${o.isDemo ? ' · demo' : ''}</div>
          <div class="cell-sub show-sm">Deadline ${fmtDate(o.deadline)} · ${o.applications} application${o.applications === 1 ? '' : 's'}${o.isFeatured ? ' · featured' : ''}${o.isVerified ? ' · verified' : ''}</div>
          ${o.reviewNote ? html`<div class="small mt-8 text-error">${o.reviewNote}</div>` : ''}</div></div></td>
        <td>${listingBadge(o.status)}${o.expired && o.status === 'published' ? html`<div class="mt-8"><span class="badge badge-error">Expired</span></div>` : ''}</td>
        <td class="hide-sm nowrap">${fmtDate(o.deadline)}<div class="cell-sub">${deadlineLabel(o.deadline)}</div></td>
        <td class="hide-sm"><label class="switch" title="Featured"><input type="checkbox" data-flag="isFeatured" data-id="${o.id}" ${o.isFeatured ? 'checked' : ''} aria-label="Featured"><span></span></label></td>
        <td class="hide-sm"><label class="switch" title="Verified against source"><input type="checkbox" data-flag="isVerified" data-id="${o.id}" ${o.isVerified ? 'checked' : ''} aria-label="Verified"><span></span></label></td>
        <td class="hide-sm">${o.applications}</td>
        <td><div class="actions">
          ${o.status === 'pending_review' ? html`<button class="btn btn-sm btn-success" data-publish="${o.id}">${icon('check', { size: 15 })} Publish</button><button class="btn btn-sm" data-reject="${o.id}" data-title="${o.title}">Send back</button>` : ''}
          <a class="btn btn-sm btn-icon" href="/admin/internships/${o.id}/edit" aria-label="Edit ${o.title}">${icon('edit', { size: 15 })}</a>
          ${o.status === 'published' ? html`<button class="btn btn-sm btn-icon" data-archive-one="${o.id}" aria-label="Archive ${o.title}" title="Archive">${icon('archive', { size: 15 })}</button>` : ''}
          <button class="btn btn-sm btn-danger btn-icon" data-delete="${o.id}" aria-label="Delete ${o.title}">${icon('trash', { size: 15 })}</button></div></td></tr>`)}
    </tbody></table></div>${pagination(data)}`
      : html`<div class="card">${empty({ icon: 'briefcase', title: 'No listings match', text: state.q ? 'Try a different search.' : 'Nothing in this status right now.' })}</div>`);
  };

  on(ctx.el, 'click', '[data-tab]', (e, b) => { state.status = b.dataset.tab; state.page = 1; load(); });
  on(ctx.el, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); window.scrollTo(0, 0); });
  ctx.el.querySelector('[data-q]').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }, 300));
  on(ctx.el, 'change', '[data-flag]', async (e, input) => {
    try { await patch(`/api/admin/opportunities/${input.dataset.id}/flags`, { [input.dataset.flag]: input.checked }); toast(input.dataset.flag === 'isFeatured' ? (input.checked ? 'Featured on the home page.' : 'Removed from featured.') : (input.checked ? 'Marked as verified today.' : 'Verification badge removed.')); } catch (err) { input.checked = !input.checked; toastError(err); }
  });
  on(ctx.el, 'click', '[data-publish]', async (e, b) => withLoading(b, async () => { try { await put(`/api/admin/opportunities/${b.dataset.publish}/review`, { decision: 'publish' }); toast('Published. The recruiter has been notified.'); load(); } catch (err) { toastError(err); } }));
  on(ctx.el, 'click', '[data-reject]', (e, b) => reviewListing({ id: b.dataset.reject, title: b.dataset.title }, { onDone: load }));
  on(ctx.el, 'click', '[data-archive-one]', async (e, b) => {
    if (!(await confirmDialog({ title: 'Archive this listing?', message: 'Students will no longer see it. Existing applications keep their history.', confirmText: 'Archive' }))) return;
    try { await patch(`/api/admin/opportunities/${b.dataset.archiveOne}/flags`, { status: 'archived' }); toast('Archived.'); load(); } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-delete]', async (e, b) => {
    if (!(await confirmDialog({ title: 'Delete this listing?', message: 'Listings with applications are archived instead of deleted so students keep their records.', confirmText: 'Delete', danger: true }))) return;
    try { const r = await del(`/api/opportunities/${b.dataset.delete}`); toast(r.message); load(); } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-archive]', async (e, b) => withLoading(b, async () => { try { const r = await post('/api/admin/opportunities/archive-expired', {}); toast(r.message); load(); } catch (err) { toastError(err); } }));
  await load();
}
