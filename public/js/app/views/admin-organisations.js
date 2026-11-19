import { html, render, on, debounce } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, post, put } from '../../lib/api.js';
import { pagination, orgAvatar, extLink } from '../../lib/components.js';
import { empty, toast, toastError, confirmDialog, formModal, skeletonRows } from '../../lib/ui.js';
import { fmtDate, LABELS } from '../../lib/format.js';
import { pageHeader, field } from '../shared.js';

export default async function adminOrganisations(ctx) {
  ctx.setTitle('Organisations');
  ctx.setCrumbs([{ label: 'Organisations' }]);
  const state = { search: '', status: '', page: 1 };
  let items = [];

  render(ctx.el, html`${pageHeader({
    title: 'Organisations',
    subtitle: 'Verify an organisation only after matching its email domain to its official website and checking a registration document. Recruiters from unverified organisations cannot be approved.',
    actions: html`<button class="btn btn-primary" data-new>${icon('plus')} Add organisation</button>`,
  })}
    <div class="row wrap mb-16 gap-3">
      <div class="input-icon" style="flex:1;min-width:240px;max-width:420px">${icon('search')}<input class="input" type="search" placeholder="Search organisations" data-search aria-label="Search organisations"></div>
      <select class="select w-auto" data-filter aria-label="Verification status"><option value="">Any status</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="rejected">Rejected</option></select>
    </div>
    <div data-list>${skeletonRows(6)}</div>`);

  const load = async () => {
    const data = await get('/api/admin/organisations', { search: state.search || undefined, status: state.status || undefined, page: state.page });
    items = data.items;
    render(ctx.el.querySelector('[data-list]'), items.length ? html`<div class="table-wrap is-long"><table class="table"><thead><tr><th>Organisation</th><th class="hide-sm">Email domain</th><th>Status</th><th class="hide-sm">Recruiters</th><th class="hide-sm">Listings</th><th></th></tr></thead><tbody>
      ${items.map((o) => html`<tr>
        <td><div class="row gap-3">${orgAvatar(o, 'sm')}<div><a class="cell-title" href="/admin/organisations/${o.id}">${o.name}</a><div class="cell-sub">${o.orgType} · ${o.headquarters ? `${o.headquarters}, ` : ''}${o.country}${o.isDemo ? ' · fictional demo' : ''}</div></div></div></td>
        <td class="hide-sm">${o.emailDomain ? html`<span class="mono">@${o.emailDomain}</span>` : '—'}${o.website ? html`<div class="cell-sub">${extLink(o.website, new URL(o.website).hostname)}</div>` : ''}</td>
        <td>${o.verificationStatus === 'verified' ? html`<span class="badge badge-teal">${icon('shieldCheck', { size: 12 })} Verified</span><div class="cell-sub">${fmtDate(o.verifiedAt)}</div>` : html`<span class="badge ${o.verificationStatus === 'rejected' ? 'badge-error' : 'badge-warning'}">${LABELS.orgStatus[o.verificationStatus]}</span>`}</td>
        <td class="hide-sm">${o.recruiters}</td><td class="hide-sm">${o.listings}</td>
        <td><div class="actions">${o.verificationStatus !== 'verified' ? html`<button class="btn btn-sm btn-success" data-verify="${o.id}">Verify</button>` : ''}<button class="btn btn-sm btn-icon" data-edit="${o.id}" aria-label="Edit ${o.name}">${icon('edit', { size: 15 })}</button></div></td></tr>`)}
    </tbody></table></div>${pagination(data)}` : html`<div class="card">${empty({ icon: 'building', title: 'No organisations match' })}</div>`);
  };

  const payload = (o, overrides = {}) => ({ name: o.name, orgType: o.orgType, website: o.website, emailDomain: o.emailDomain, country: o.country, headquarters: o.headquarters, description: o.description, linkedinUrl: o.linkedinUrl, registrationNumber: o.registrationNumber, verificationStatus: o.verificationStatus, ...overrides });

  function edit(o = null) {
    const v = o || { orgType: ctx.cfg.lists.orgTypes[0], verificationStatus: 'unverified' };
    formModal({
      title: o ? `Edit ${o.name}` : 'Add an organisation', wide: true,
      description: 'Organisations added here can be linked to admin-curated listings. Mark verified only after checking an official source.',
      submitText: o ? 'Save changes' : 'Add organisation',
      fields: html`<div class="form-grid">
        ${field('name', 'Organisation name', html`<input class="input" id="f-name" name="name" value="${v.name || ''}" data-validate="required|min:2|max:120">`, { span: true })}
        ${field('orgType', 'Type', html`<select class="select" id="f-orgType" name="orgType">${ctx.cfg.lists.orgTypes.map((t) => html`<option ${v.orgType === t ? 'selected' : ''}>${t}</option>`)}</select>`)}
        ${field('verificationStatus', 'Verification', html`<select class="select" id="f-verificationStatus" name="verificationStatus">${['unverified', 'verified', 'rejected'].map((s) => html`<option value="${s}" ${v.verificationStatus === s ? 'selected' : ''}>${LABELS.orgStatus[s]}</option>`)}</select>`)}
        ${field('website', 'Official website', html`<input class="input" type="url" id="f-website" name="website" value="${v.website || ''}" data-validate="url">`, { optional: true })}
        ${field('emailDomain', 'Recruiter email domain', html`<input class="input" id="f-emailDomain" name="emailDomain" value="${v.emailDomain || ''}" data-validate="domain" placeholder="example.com">`, { optional: true })}
        ${field('country', 'Country', html`<input class="input" id="f-country" name="country" value="${v.country || ''}" data-validate="required|min:2|max:60">`)}
        ${field('headquarters', 'Headquarters city', html`<input class="input" id="f-headquarters" name="headquarters" value="${v.headquarters || ''}" maxlength="100">`, { optional: true })}
        ${field('registrationNumber', 'Registration number', html`<input class="input" id="f-registrationNumber" name="registrationNumber" value="${v.registrationNumber || ''}" maxlength="60">`, { optional: true })}
        ${field('linkedinUrl', 'LinkedIn page', html`<input class="input" type="url" id="f-linkedinUrl" name="linkedinUrl" value="${v.linkedinUrl || ''}" data-validate="url">`, { optional: true })}
        ${field('description', 'Description', html`<textarea class="textarea" id="f-description" name="description" rows="4" maxlength="3000">${v.description || ''}</textarea>`, { optional: true, span: true })}
      </div>`,
      onSubmit: async (vals) => {
        if (o) await put(`/api/admin/organisations/${o.id}`, vals); else await post('/api/admin/organisations', vals);
        toast(o ? 'Organisation updated.' : 'Organisation added.');
        load();
      },
    });
  }

  on(ctx.el, 'click', '[data-new]', () => edit());
  on(ctx.el, 'click', '[data-edit]', (e, b) => edit(items.find((o) => String(o.id) === b.dataset.edit)));
  on(ctx.el, 'click', '[data-verify]', async (e, b) => {
    const o = items.find((x) => String(x.id) === b.dataset.verify);
    if (!(await confirmDialog({ title: `Verify ${o.name}?`, message: `Confirm you have matched @${o.emailDomain || '—'} to ${o.website || 'the official website'} and reviewed a registration document. Recruiters from this organisation can then be approved and accept applications on HORIZON.`, confirmText: 'Verify organisation' }))) return;
    try { await put(`/api/admin/organisations/${o.id}`, payload(o, { verificationStatus: 'verified' })); toast(`${o.name} is verified.`); load(); } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); });
  ctx.el.querySelector('[data-search]').addEventListener('input', debounce((e) => { state.search = e.target.value.trim(); state.page = 1; load(); }, 300));
  ctx.el.querySelector('[data-filter]').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; load(); });
  await load();
}
