import { html, render, on, debounce } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, put } from '../../lib/api.js';
import { userBadge, pagination, personAvatar, docBadge, checkList } from '../../lib/components.js';
import { empty, toast, toastError, confirmDialog, openModal, skeletonRows } from '../../lib/ui.js';
import { fmtDate, fmtDateTime, LABELS, bytes } from '../../lib/format.js';
import { pageHeader } from '../shared.js';

const METHOD = { email_domain: 'Institutional email domain', manual: 'Manual document review', seed: 'Demo seed' };

export default async function adminUsers(ctx) {
  const role = ctx.path.startsWith('/admin/recruiters') ? 'recruiter' : 'student';
  const plural = role === 'student' ? 'students' : 'recruiters';
  ctx.setTitle(`Manage ${plural}`);
  ctx.setCrumbs([{ label: `Manage ${role === 'student' ? 'Students' : 'Recruiters'}` }]);
  const state = { status: ctx.query.status || '', search: ctx.query.search || '', page: 1 };

  render(ctx.el, html`${pageHeader({
    title: `Manage ${plural}`,
    subtitle: role === 'student' ? 'Students are approved automatically when their email matches a verified INI domain; everyone else is reviewed manually.' : 'Recruiters can only be approved once their organisation is verified.',
    actions: html`<a class="btn" href="/admin/verifications?type=${role}">${icon('userCheck')} Verification requests</a>`,
  })}
    <div class="row wrap between mb-16 gap-3">
      <div class="segmented" role="tablist" data-tabs></div>
      <div class="input-icon" style="min-width:280px;flex:1;max-width:420px">${icon('search')}<input class="input" type="search" placeholder="Search name or email" value="${state.search}" data-search aria-label="Search ${plural}"></div>
    </div>
    <div data-list>${skeletonRows(6)}</div>`);

  const load = async () => {
    render(ctx.el.querySelector('[data-tabs]'), html`${[['', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['suspended', 'Suspended']].map(([v, l]) => html`<label><input type="radio" name="ustatus" value="${v}" ${state.status === v ? 'checked' : ''} data-status><span>${l}</span></label>`)}`);
    const data = await get(`/api/admin/${plural}`, { status: state.status || undefined, search: state.search || undefined, page: state.page });
    render(ctx.el.querySelector('[data-list]'), data.items.length ? html`<div class="table-wrap is-long"><table class="table"><thead><tr><th>Name</th><th class="hide-sm">${role === 'student' ? 'Institution' : 'Organisation'}</th><th>Status</th><th class="hide-sm">Verified via</th>${role === 'student' ? html`<th class="hide-sm">Apps</th>` : ''}<th class="hide-sm">Joined</th><th></th></tr></thead><tbody>
      ${data.items.map((u) => html`<tr>
        <td><div class="row gap-3">${personAvatar(u.fullName, 'sm')}<div><button class="link-btn cell-title" data-view="${u.id}">${u.fullName}</button><div class="cell-sub">${u.email}${u.emailVerified ? '' : ' · email not verified'}</div></div></div></td>
        <td class="hide-sm">${role === 'student' ? html`${u.institutionShort || u.institution}<div class="cell-sub">${u.programme || ''}${u.currentYear ? ` · Year ${u.currentYear}` : ''}</div>` : html`${u.organisation}${u.organisationVerified ? html` <span class="badge badge-teal">${icon('shieldCheck', { size: 12 })}</span>` : html` <span class="badge badge-warning">org unverified</span>`}<div class="cell-sub">${u.designation || ''}</div>`}</td>
        <td>${userBadge(u.status)}${u.statusReason ? html`<div class="cell-sub" style="max-width:220px">${u.statusReason}</div>` : ''}</td>
        <td class="hide-sm">${METHOD[u.verificationMethod] || html`<span class="subtle">—</span>`}</td>
        ${role === 'student' ? html`<td class="hide-sm">${u.applications}</td>` : ''}
        <td class="hide-sm subtle">${fmtDate(u.createdAt)}</td>
        <td><div class="actions">${actions(u)}</div></td></tr>`)}
    </tbody></table></div>${pagination(data)}`
      : html`<div class="card">${empty({ icon: 'users', title: `No ${plural} found`, text: state.search ? 'Try a different search.' : 'Nobody in this status.' })}</div>`);
  };

  const actions = (u) => html`
    ${u.status !== 'approved' ? html`<button class="btn btn-sm btn-success" data-set="approved" data-id="${u.id}" data-name="${u.fullName}">Approve</button>` : ''}
    ${u.status === 'pending' ? html`<button class="btn btn-sm" data-set="rejected" data-id="${u.id}" data-name="${u.fullName}">Reject</button>` : ''}
    ${u.status === 'approved' ? html`<button class="btn btn-sm btn-danger" data-set="suspended" data-id="${u.id}" data-name="${u.fullName}">Suspend</button>` : ''}
    <button class="btn btn-sm btn-icon" data-view="${u.id}" aria-label="View ${u.fullName}">${icon('eye', { size: 15 })}</button>`;

  async function setStatus(idv, status, name) {
    const needsReason = status === 'rejected' || status === 'suspended';
    const verb = { approved: 'Approve', rejected: 'Reject', suspended: 'Suspend' }[status];
    const r = await confirmDialog({
      title: `${verb} ${name}?`,
      message: status === 'approved' ? 'They will get full access to HORIZON.' : status === 'suspended' ? 'They are signed out immediately and cannot sign in again until reinstated.' : 'They will be told why and can submit new documents.',
      confirmText: verb, danger: needsReason,
      reason: needsReason ? { label: 'Reason (shown to the user)', required: true, min: 5 } : null,
    });
    if (!r) return;
    try { await put(`/api/admin/users/${idv}/status`, { status, reason: r.reason || null }); toast(`${name}: ${LABELS.user[status]}.`); load(); } catch (err) { toastError(err); }
  }

  async function view(idv) {
    const d = await get(`/api/admin/users/${idv}`);
    const u = d.user;
    const p = d.profile || {};
    openModal({
      title: u.fullName, drawer: true,
      description: `${u.email} · ${u.role === 'student' ? (u.institution ? u.institution.name : '') : (u.organisation ? u.organisation.name : '')}`,
      body: html`<div class="stack">
        <div class="row wrap gap-2">${userBadge(u.status)}${u.emailVerified ? html`<span class="badge badge-success">${icon('mail', { size: 12 })} Email verified</span>` : html`<span class="badge badge-warning">Email not verified</span>`}${u.verificationMethod ? html`<span class="badge">${METHOD[u.verificationMethod] || u.verificationMethod}</span>` : ''}</div>
        ${u.statusReason ? html`<div class="alert alert-warning">${icon('info')}<div>${u.statusReason}</div></div>` : ''}
        <div class="kv">
          <div>Joined</div><div>${fmtDateTime(u.createdAt)}</div>
          <div>Last sign-in</div><div>${d.lastLoginAt ? fmtDateTime(d.lastLoginAt) : 'Never'}</div>
          ${u.role === 'student' ? html`<div>Programme</div><div>${p.programme || '—'}</div><div>Year / graduation</div><div>${p.currentYear ? `Year ${p.currentYear}` : '—'}${p.graduationYear ? ` · ${p.graduationYear}` : ''}</div><div>Applications</div><div>${d.applications}</div>`
    : html`<div>Designation</div><div>${p.designation || '—'}</div><div>Organisation verified</div><div>${u.organisation && u.organisation.verified ? 'Yes' : 'No'}</div>`}
        </div>
        <h3>Documents</h3>
        ${d.documents.length ? d.documents.map((doc) => html`<div class="card card-pad" style="padding:14px"><div class="row between wrap"><div><div class="strong">${LABELS.doc[doc.kind] || { cv: 'CV', video: 'Video', id_proof: 'ID proof', org_proof: 'Organisation proof' }[doc.kind] || doc.kind}</div><div class="subtle">${doc.originalName} · ${bytes(doc.sizeBytes)} · ${fmtDate(doc.createdAt)}</div></div><div class="row gap-2">${docBadge(doc.status)}<a class="btn btn-sm" href="${doc.url}" target="_blank" rel="noopener">${icon('eye', { size: 14 })} Open</a></div></div>
          ${doc.report && doc.report.checks ? html`<details class="mt-8"><summary class="small strong" style="cursor:pointer">Validation report</summary><div class="mt-8">${checkList(doc.report.checks)}</div></details>` : ''}</div>`) : html`<p class="muted">No documents.</p>`}
        <h3>Verification history</h3>
        ${d.requests.length ? html`<ul class="mini-list">${d.requests.map((r) => html`<li><div class="grow"><div class="ml-title">${{ pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }[r.status]} · submitted ${fmtDate(r.createdAt)}</div><div class="ml-sub">${r.reviewedAt ? `Decided ${fmtDate(r.reviewedAt)}` : 'Awaiting review'}${r.userMessage ? ` — “${r.userMessage}”` : ''}</div>${r.internalNote ? html`<div class="ml-sub">Internal: ${r.internalNote}</div>` : ''}</div></li>`)}</ul>` : html`<p class="muted">No manual verification requests.</p>`}
      </div>`,
      footer: html`<button class="btn" data-close>Close</button>`,
    });
  }

  on(ctx.el, 'change', '[data-status]', (e, r) => { state.status = r.value; state.page = 1; load(); });
  on(ctx.el, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); });
  on(ctx.el, 'click', '[data-set]', (e, b) => setStatus(b.dataset.id, b.dataset.set, b.dataset.name));
  on(ctx.el, 'click', '[data-view]', (e, b) => view(b.dataset.view).catch(toastError));
  ctx.el.querySelector('[data-search]').addEventListener('input', debounce((e) => { state.search = e.target.value.trim(); state.page = 1; load(); }, 300));
  await load();
}
