import { html, render, on, debounce, $ } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get } from '../../lib/api.js';
import { pagination } from '../../lib/components.js';
import { empty, skeletonRows } from '../../lib/ui.js';
import { fmtDateTime } from '../../lib/format.js';
import { pageHeader } from '../shared.js';

const ENTITY_LINKS = { opportunity: (id) => `/admin/internships/${id}`, grievance: (id) => `/admin/grievances/${id}`, organisation: (id) => `/admin/organisations/${id}` };
const fmtDetails = (d) => {
  if (!d || typeof d !== 'object') return '';
  return Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
};

export default async function adminAudit(ctx) {
  ctx.setTitle('Audit log');
  ctx.setCrumbs([{ label: 'Audit Log' }]);
  const state = { action: '', entityType: '', page: 1 };
  render(ctx.el, html`${pageHeader({ title: 'Audit log', subtitle: 'Sign-ins, verification decisions, listing reviews, document decisions and grievance actions. Entries cannot be edited or deleted from the console.' })}
    <div class="row wrap mb-16 gap-3">
      <div class="input-icon" style="flex:1;min-width:220px;max-width:360px">${icon('search')}<input class="input" type="search" placeholder="Filter by action, e.g. verification" data-action aria-label="Filter by action"></div>
      <select class="select w-auto" data-entity aria-label="Entity type"><option value="">All entities</option>${['user', 'opportunity', 'application', 'document', 'grievance', 'institution', 'organisation', 'destination'].map((t) => html`<option>${t}</option>`)}</select>
    </div><div data-list>${skeletonRows(8)}</div>`);
  const load = async () => {
    const data = await get('/api/admin/audit', { action: state.action || undefined, entityType: state.entityType || undefined, page: state.page });
    render($('[data-list]', ctx.el), data.items.length ? html`<p class="subtle mb-8">${data.total} entries</p><div class="table-wrap is-long"><table class="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th class="hide-sm">Entity</th><th class="hide-sm">Details</th><th class="hide-sm">IP</th></tr></thead><tbody>
      ${data.items.map((e) => html`<tr><td class="nowrap subtle">${fmtDateTime(e.createdAt)}</td><td>${e.actor || '—'}<div class="cell-sub">${e.actorRole || ''}</div></td>
        <td><span class="mono small">${e.action}</span></td>
        <td class="hide-sm">${e.entityType ? (ENTITY_LINKS[e.entityType] && e.entityId ? html`<a href="${ENTITY_LINKS[e.entityType](e.entityId)}">${e.entityType} #${e.entityId}</a>` : `${e.entityType}${e.entityId ? ` #${e.entityId}` : ''}`) : '—'}</td>
        <td class="hide-sm small" style="max-width:340px">${fmtDetails(e.details)}</td><td class="hide-sm mono xs">${e.ip || ''}</td></tr>`)}
    </tbody></table></div>${pagination(data)}` : html`<div class="card">${empty({ icon: 'history', title: 'No entries match' })}</div>`);
  };
  $('[data-action]', ctx.el).addEventListener('input', debounce((e) => { state.action = e.target.value.trim(); state.page = 1; load(); }, 300));
  $('[data-entity]', ctx.el).addEventListener('change', (e) => { state.entityType = e.target.value; state.page = 1; load(); });
  on(ctx.el, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); window.scrollTo(0, 0); });
  await load();
}
