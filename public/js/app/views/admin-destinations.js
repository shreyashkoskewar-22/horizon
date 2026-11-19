import { html, render, on, formToObject } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, post, put, del } from '../../lib/api.js';
import { extLink } from '../../lib/components.js';
import { empty, toast, toastError, confirmDialog, formModal, tagInput, skeletonRows } from '../../lib/ui.js';
import { fmtDate } from '../../lib/format.js';
import { pageHeader, field } from '../shared.js';

const toLines = (links) => (links || []).map((l) => `${l.label} | ${l.url}`).join('\n');
function fromLines(text, label) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const [a, b] = line.includes('|') ? line.split('|').map((x) => x.trim()) : [line, line];
    if (!/^https?:\/\//i.test(b)) throw new Error(`${label}, line ${i + 1}: write “Label | https://link”.`);
    return { label: a === b ? new URL(b).hostname : a, url: b };
  });
}

export default async function adminDestinations(ctx) {
  ctx.setTitle('Global resources');
  ctx.setCrumbs([{ label: 'Global Resources' }]);
  let items = [];

  render(ctx.el, html`${pageHeader({
    title: 'Global destination resources',
    subtitle: 'Country guides students see under Global Destinations. Every guide needs an official source link and a last-updated date.',
    actions: html`<button class="btn btn-primary" data-new>${icon('plus')} Add destination</button>`,
  })}
    <div class="alert alert-warning mb-16">${icon('alertTriangle')}<div><div class="alert-title">Visa and immigration content</div>Summarise only what an official government source says, link to it, and date it. Never present this as legal advice — students must confirm with the embassy or the employer. Review each guide at least every six months.</div></div>
    <div data-list>${skeletonRows(5)}</div>`);

  const load = async () => {
    ({ items } = await get('/api/admin/destinations'));
    const stale = (d) => (Date.now() - new Date(`${d.lastUpdated}T00:00:00`).getTime()) / 86400000 > 183;
    render(ctx.el.querySelector('[data-list]'), items.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Country</th><th class="hide-sm">Official links</th><th>Last updated</th><th>Visibility</th><th></th></tr></thead><tbody>
      ${items.map((d) => html`<tr><td><div class="cell-title">${d.country}</div><div class="cell-sub">${d.region || ''} · /${d.slug}</div></td>
        <td class="hide-sm">${d.visaResources.length + d.officialLinks.length} link${d.visaResources.length + d.officialLinks.length === 1 ? '' : 's'}<div class="cell-sub">${extLink(d.sourceUrl, 'Primary source')}</div></td>
        <td class="nowrap">${fmtDate(d.lastUpdated)}${stale(d) ? html`<div><span class="badge badge-warning">Review due</span></div>` : ''}</td>
        <td>${d.isPublished ? html`<span class="badge badge-success">Published</span>` : html`<span class="badge">Hidden</span>`}</td>
        <td><div class="actions">${d.isPublished ? html`<a class="btn btn-sm btn-icon" href="/admin/resources/${d.slug}" aria-label="Preview ${d.country}" title="Preview as a student">${icon('eye', { size: 15 })}</a>` : ''}
          <button class="btn btn-sm btn-icon" data-edit="${d.id}" aria-label="Edit ${d.country}">${icon('edit', { size: 15 })}</button>
          <button class="btn btn-sm btn-icon btn-danger" data-delete="${d.id}" aria-label="Delete ${d.country}">${icon('trash', { size: 15 })}</button></div></td></tr>`)}
    </tbody></table></div>` : html`<div class="card">${empty({ icon: 'globe', title: 'No destination guides yet', action: html`<button class="btn btn-primary" data-new>Add destination</button>` })}</div>`);
  };

  function edit(d = null) {
    const v = d || { isPublished: true, majorSectors: [], visaResources: [], officialLinks: [], lastUpdated: new Date().toISOString().slice(0, 10) };
    formModal({
      title: d ? `Edit ${d.country}` : 'Add a destination', wide: true, submitText: d ? 'Save guide' : 'Add guide',
      description: 'Write links one per line as “Label | https://link”.',
      fields: html`<div class="form-grid">
        ${field('country', 'Country', html`<input class="input" id="f-country" name="country" value="${v.country || ''}" data-validate="required|min:2|max:60">`)}
        ${field('region', 'Region', html`<input class="input" id="f-region" name="region" value="${v.region || ''}" maxlength="60" placeholder="e.g. Europe">`, { optional: true })}
        ${field('overview', 'Overview', html`<textarea class="textarea" id="f-overview" name="overview" rows="4" maxlength="3000" data-validate="required|min:30|max:3000">${v.overview || ''}</textarea>`, { span: true })}
        ${field('majorSectors', 'Major internship sectors', tagInput({ name: 'majorSectors', values: v.majorSectors, placeholder: 'e.g. Finance' }), { span: true })}
        ${field('commonDurations', 'Common internship durations', html`<input class="input" id="f-commonDurations" name="commonDurations" value="${v.commonDurations || ''}" maxlength="500">`, { optional: true, span: true })}
        ${field('workArrangements', 'Common work arrangements', html`<textarea class="textarea" id="f-workArrangements" name="workArrangements" rows="2" maxlength="3000">${v.workArrangements || ''}</textarea>`, { optional: true, span: true })}
        ${field('visaResources', 'Official visa & immigration links', html`<textarea class="textarea mono" id="f-visaResources" name="visaResources" rows="3" placeholder="Ministry of Manpower — Work Holiday Pass | https://www.mom.gov.sg/…">${toLines(v.visaResources)}</textarea>`, { span: true, help: 'Government sources only.' })}
        ${field('officialLinks', 'Other official resources', html`<textarea class="textarea mono" id="f-officialLinks" name="officialLinks" rows="3">${toLines(v.officialLinks)}</textarea>`, { optional: true, span: true })}
        ${field('relocationConsiderations', 'Relocation considerations', html`<textarea class="textarea" id="f-relocationConsiderations" name="relocationConsiderations" rows="3" maxlength="3000">${v.relocationConsiderations || ''}</textarea>`, { optional: true, span: true })}
        ${field('sourceUrl', 'Primary source link', html`<input class="input" type="url" id="f-sourceUrl" name="sourceUrl" value="${v.sourceUrl || ''}" data-validate="required|url">`, { help: 'The official page this summary is based on.' })}
        ${field('lastUpdated', 'Last checked against the source', html`<input class="input" type="date" id="f-lastUpdated" name="lastUpdated" value="${v.lastUpdated || ''}" data-validate="required|date">`)}
        <label class="switch"><input type="checkbox" name="isPublished" ${v.isPublished ? 'checked' : ''}><span>Published to students</span></label>
      </div>`,
      readValues: (form) => {
        const o = formToObject(form);
        o.visaResources = fromLines(o.visaResources, 'Visa links');
        o.officialLinks = fromLines(o.officialLinks, 'Other resources');
        return o;
      },
      onSubmit: async (vals) => {
        if (d) await put(`/api/admin/destinations/${d.id}`, vals); else await post('/api/admin/destinations', vals);
        toast('Destination guide saved.');
        load();
      },
    });
  }

  on(ctx.el, 'click', '[data-new]', () => edit());
  on(ctx.el, 'click', '[data-edit]', (e, b) => edit(items.find((d) => String(d.id) === b.dataset.edit)));
  on(ctx.el, 'click', '[data-delete]', async (e, b) => {
    if (!(await confirmDialog({ title: 'Delete this guide?', message: 'Students will no longer see it. Listings in this country are not affected.', confirmText: 'Delete', danger: true }))) return;
    try { await del(`/api/admin/destinations/${b.dataset.delete}`); toast('Guide deleted.'); load(); } catch (err) { toastError(err); }
  });
  await load();
}
