import { html, render, on, debounce, formToObject } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, post, put, del } from '../../lib/api.js';
import { pagination, extLink } from '../../lib/components.js';
import { empty, toast, toastError, confirmDialog, formModal, tagInput, skeletonRows } from '../../lib/ui.js';
import { fmtDate } from '../../lib/format.js';
import { pageHeader, field } from '../shared.js';

export default async function adminInstitutions(ctx) {
  ctx.setTitle('Manage institutions');
  ctx.setCrumbs([{ label: 'Manage Institutions' }]);
  const state = { search: '', category: '', status: '', page: 1 };
  let items = [];

  render(ctx.el, html`${pageHeader({
    title: 'Eligible institutions',
    subtitle: 'Only institutions verified against an official source (the Ministry of Education’s INI list) can admit students. Verified email domains enable automatic student approval.',
    actions: html`<button class="btn btn-primary" data-new>${icon('plus')} Add institution</button>`,
  })}
    <div class="alert alert-info mb-16">${icon('info')}<div>Seeded from the Ministry of Education list of Institutions of National Importance (retrieved 18 Nov 2026). Before going live, re-check each record against the <a href="https://www.education.gov.in/en/node/198" target="_blank" rel="noopener">official list</a> and confirm each email domain with the institution.</div></div>
    <div class="row wrap mb-16 gap-3">
      <div class="input-icon" style="flex:1;min-width:240px;max-width:420px">${icon('search')}<input class="input" type="search" placeholder="Search name, short name or city" data-search aria-label="Search institutions"></div>
      <select class="select w-auto" data-category aria-label="Category"><option value="">All categories</option>${ctx.cfg.lists.institutionCategories.map((c) => html`<option>${c}</option>`)}</select>
      <select class="select w-auto" data-filter-status aria-label="Status"><option value="">Any status</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="inactive">Inactive</option></select>
    </div>
    <div data-list>${skeletonRows(8)}</div>`);

  const load = async () => {
    const data = await get('/api/admin/institutions', { search: state.search || undefined, category: state.category || undefined, status: state.status || undefined, page: state.page });
    items = data.items;
    render(ctx.el.querySelector('[data-list]'), items.length ? html`<p class="subtle mb-8">${data.total} institution${data.total === 1 ? '' : 's'}</p><div class="table-wrap is-long"><table class="table"><thead><tr><th>Institution</th><th class="hide-sm">Category</th><th class="hide-sm">Email domains</th><th>Status</th><th class="hide-sm">Students</th><th></th></tr></thead><tbody>
      ${items.map((i) => html`<tr ${i.isActive ? '' : html`style="opacity:.6"`}>
        <td><div class="cell-title">${i.name}</div><div class="cell-sub">${i.shortName ? `${i.shortName} · ` : ''}${[i.city, i.state].filter(Boolean).join(', ')}${i.officialWebsite ? html` · ${extLink(i.officialWebsite, 'website')}` : ''}</div></td>
        <td class="hide-sm">${i.category}</td>
        <td class="hide-sm">${i.domains.length ? html`<div class="row wrap gap-1">${i.domains.map((d) => html`<span class="tag ${d.isVerified ? '' : 'muted'}" title="${d.isVerified ? 'Verified — auto-approves students' : 'Unverified — not used for auto-approval'}">${d.isVerified ? icon('check', { size: 12 }) : ''}${d.domain}</span>`)}</div>` : html`<span class="subtle">None — manual review</span>`}</td>
        <td>${i.verificationStatus === 'verified' ? html`<span class="badge badge-success">${icon('shieldCheck', { size: 12 })} Verified</span>` : html`<span class="badge badge-warning">Unverified</span>`}${i.isActive ? '' : html` <span class="badge">Inactive</span>`}${i.verifiedAt ? html`<div class="cell-sub">${fmtDate(i.verifiedAt)}</div>` : ''}</td>
        <td class="hide-sm">${i.studentCount}</td>
        <td><div class="actions"><button class="btn btn-sm btn-icon" data-edit="${i.id}" aria-label="Edit ${i.name}">${icon('edit', { size: 15 })}</button>
          ${i.isActive ? html`<button class="btn btn-sm btn-icon btn-danger" data-deactivate="${i.id}" aria-label="Deactivate ${i.name}" title="Deactivate">${icon('ban', { size: 15 })}</button>` : html`<button class="btn btn-sm" data-reactivate="${i.id}">Reactivate</button>`}</div></td></tr>`)}
    </tbody></table></div>${pagination(data)}` : html`<div class="card">${empty({ icon: 'graduation', title: 'No institutions match', text: 'Adjust the filters or add an institution.' })}</div>`);
  };

  const payload = (i, overrides = {}) => ({
    name: i.name, shortName: i.shortName, category: i.category, city: i.city, state: i.state, officialWebsite: i.officialWebsite,
    recognitionReference: i.recognitionReference, recognitionSourceUrl: i.recognitionSourceUrl, verificationStatus: i.verificationStatus,
    verificationNote: i.verificationNote, isActive: i.isActive, domains: i.domains.map((d) => ({ domain: d.domain, isVerified: d.isVerified })), ...overrides,
  });

  function edit(i = null) {
    const v = i || { category: 'Other INI', verificationStatus: 'unverified', isActive: true, domains: [] };
    formModal({
      title: i ? `Edit ${i.shortName || i.name}` : 'Add an institution', wide: true,
      description: 'Mark an institution verified only after you have checked it against an official government source. Add that source link below.',
      submitText: i ? 'Save changes' : 'Add institution',
      fields: html`<div class="form-grid">
        ${field('name', 'Official name', html`<input class="input" id="f-name" name="name" value="${v.name || ''}" data-validate="required|min:3|max:200">`, { span: true })}
        ${field('shortName', 'Short name', html`<input class="input" id="f-shortName" name="shortName" value="${v.shortName || ''}" maxlength="60">`, { optional: true })}
        ${field('category', 'Category', html`<select class="select" id="f-category" name="category">${ctx.cfg.lists.institutionCategories.map((c) => html`<option ${v.category === c ? 'selected' : ''}>${c}</option>`)}</select>`)}
        ${field('city', 'City', html`<input class="input" id="f-city" name="city" value="${v.city || ''}" maxlength="80">`, { optional: true })}
        ${field('state', 'State / UT', html`<input class="input" id="f-state" name="state" value="${v.state || ''}" maxlength="80">`, { optional: true })}
        ${field('officialWebsite', 'Official website', html`<input class="input" type="url" id="f-officialWebsite" name="officialWebsite" value="${v.officialWebsite || ''}" data-validate="url">`, { optional: true, span: true })}
        ${field('recognitionReference', 'Recognition reference', html`<input class="input" id="f-recognitionReference" name="recognitionReference" value="${v.recognitionReference || ''}" data-validate="required|min:3|max:300" placeholder="e.g. Institutes of Technology Act, 1961 — MoE INI list">`, { span: true })}
        ${field('recognitionSourceUrl', 'Official source link', html`<input class="input" type="url" id="f-recognitionSourceUrl" name="recognitionSourceUrl" value="${v.recognitionSourceUrl || ''}" data-validate="url|requiredif:verificationStatus=verified" placeholder="https://www.education.gov.in/…">`, { span: true, help: 'Required to mark the institution verified.' })}
        ${field('verificationStatus', 'Verification status', html`<select class="select" id="f-verificationStatus" name="verificationStatus"><option value="unverified" ${v.verificationStatus !== 'verified' ? 'selected' : ''}>Unverified — students cannot register</option><option value="verified" ${v.verificationStatus === 'verified' ? 'selected' : ''}>Verified INI</option></select>`)}
        <div class="field" style="align-self:end"><label class="switch"><input type="checkbox" name="isActive" ${v.isActive ? 'checked' : ''}><span>Active (accepting registrations)</span></label></div>
        ${field('verificationNote', 'Verification note', html`<textarea class="textarea" id="f-verificationNote" name="verificationNote" rows="2" maxlength="500">${v.verificationNote || ''}</textarea>`, { optional: true, span: true })}
        ${field('verifiedDomains', 'Verified student email domains', tagInput({ name: 'verifiedDomains', values: v.domains.filter((d) => d.isVerified).map((d) => d.domain), placeholder: 'e.g. iitb.ac.in' }), { span: true, help: 'Confirmed with the institution. Students with these emails are approved automatically after email OTP. Subdomains match too.' })}
        ${field('otherDomains', 'Unverified domains (manual review only)', tagInput({ name: 'otherDomains', values: v.domains.filter((d) => !d.isVerified).map((d) => d.domain), placeholder: 'e.g. alumni.example.ac.in' }), { span: true, optional: true })}
      </div>`,
      readValues: (form) => {
        const o = formToObject(form);
        o.domains = [...(o.verifiedDomains || []).map((d) => ({ domain: d.toLowerCase(), isVerified: true })), ...(o.otherDomains || []).map((d) => ({ domain: d.toLowerCase(), isVerified: false }))];
        const bad = o.domains.find((d) => !/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d.domain));
        if (bad) throw new Error(`“${bad.domain}” is not a valid domain. Use a form like iitb.ac.in (no @ or https://).`);
        delete o.verifiedDomains; delete o.otherDomains;
        return o;
      },
      onSubmit: async (vals) => {
        if (i) await put(`/api/admin/institutions/${i.id}`, vals); else await post('/api/admin/institutions', vals);
        toast(i ? 'Institution updated.' : 'Institution added.');
        load();
      },
    });
  }

  on(ctx.el, 'click', '[data-new]', () => edit());
  on(ctx.el, 'click', '[data-edit]', (e, b) => edit(items.find((i) => String(i.id) === b.dataset.edit)));
  on(ctx.el, 'click', '[data-deactivate]', async (e, b) => {
    if (!(await confirmDialog({ title: 'Deactivate this institution?', message: 'New registrations are blocked. Existing students keep their accounts and history. You can reactivate it any time.', confirmText: 'Deactivate', danger: true }))) return;
    try { await del(`/api/admin/institutions/${b.dataset.deactivate}`); toast('Institution deactivated.'); load(); } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-reactivate]', async (e, b) => {
    const i = items.find((x) => String(x.id) === b.dataset.reactivate);
    try { await put(`/api/admin/institutions/${i.id}`, payload(i, { isActive: true })); toast('Institution reactivated.'); load(); } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); });
  ctx.el.querySelector('[data-search]').addEventListener('input', debounce((e) => { state.search = e.target.value.trim(); state.page = 1; load(); }, 300));
  ctx.el.querySelector('[data-category]').addEventListener('change', (e) => { state.category = e.target.value; state.page = 1; load(); });
  ctx.el.querySelector('[data-filter-status]').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; load(); });
  await load();
}
