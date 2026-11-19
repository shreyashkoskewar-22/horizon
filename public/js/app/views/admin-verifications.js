import { html, render, on } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, put } from '../../lib/api.js';
import { checkList, personAvatar, extLink } from '../../lib/components.js';
import { empty, toast, formModal, skeletonRows } from '../../lib/ui.js';
import { fmtDateTime, timeAgo } from '../../lib/format.js';
import { pageHeader, field } from '../shared.js';

export default async function adminVerifications(ctx) {
  ctx.setTitle('Verification requests');
  ctx.setCrumbs([{ label: 'Verification Requests' }]);
  const state = { status: ctx.query.status || 'pending', type: ctx.query.type || '' };
  let items = [];

  render(ctx.el, html`${pageHeader({ title: 'Verification requests', subtitle: 'Both sides are verified: students against an official INI list and their institution, recruiters against their organisation’s domain and registration.' })}
    <div class="row wrap between mb-16 gap-3"><div class="tabs mb-0" role="tablist" data-tabs></div><div class="segmented" data-types></div></div>
    <div data-list>${skeletonRows(4)}</div>`);

  const card = (v) => html`<article class="card mb-16">
    <div class="card-header"><div class="row">${personAvatar(v.user.name)}<div><h2 class="mb-0" style="font-size:1.05rem">${v.user.name}</h2><div class="subtle">${v.user.email} · ${v.type === 'student' ? 'Student' : `Recruiter${v.user.designation ? ` · ${v.user.designation}` : ''}`}</div></div></div>
      <div class="row wrap gap-2">${v.user.emailVerified ? html`<span class="badge badge-success">${icon('mail', { size: 12 })} Email verified</span>` : html`<span class="badge badge-warning">Email not verified</span>`}<span class="badge" title="${fmtDateTime(v.createdAt)}">${timeAgo(v.createdAt)}</span></div></div>
    <div class="card-body"><div class="grid grid-2 gap-6">
      <div>
        ${v.institution ? html`<h3>Institution</h3><div class="kv"><div>Name</div><div>${v.institution.name}</div><div>Recognition</div><div>${v.institution.recognition || '—'}</div><div>Programme</div><div>${v.institution.programme || '—'}</div><div>Year</div><div>${v.institution.currentYear ? `Year ${v.institution.currentYear}` : '—'}${v.institution.graduationYear ? ` · graduating ${v.institution.graduationYear}` : ''}</div></div>` : ''}
        ${v.organisation ? html`<h3>Organisation</h3><div class="kv"><div>Name</div><div><a href="/admin/organisations/${v.organisation.id}">${v.organisation.name}</a></div><div>Type</div><div>${v.organisation.type}</div><div>Website</div><div>${v.organisation.website ? extLink(v.organisation.website, new URL(v.organisation.website).hostname) : '—'}</div><div>Email domain</div><div>@${v.organisation.emailDomain || '—'}</div><div>Status</div><div>${v.organisation.status === 'verified' ? html`<span class="badge badge-teal">Verified</span>` : html`<span class="badge badge-warning">Not yet verified</span>`}</div>${v.registrationNumber ? html`<div>Registration no.</div><div class="mono">${v.registrationNumber}</div>` : ''}</div>` : ''}
        ${v.note ? html`<h3 class="mt-16">Applicant’s note</h3><p class="pre small">${v.note}</p>` : ''}
        ${v.document ? html`<a class="btn btn-sm mt-8" href="${v.document.url}" target="_blank" rel="noopener">${icon('fileText', { size: 15 })} Open ${v.type === 'student' ? 'student ID' : 'organisation proof'} (${v.document.mimeType === 'application/pdf' ? 'PDF' : 'image'})</a>` : html`<p class="subtle">No document attached.</p>`}
      </div>
      <div><h3>Automatic checks</h3>${checkList(v.autoChecks.map((c) => ({ ...c, result: c.ok ? 'pass' : 'warn' })))}
        <p class="subtle xs">Amber items need a manual look; they don’t block approval on their own.</p></div>
    </div></div>
    ${v.status === 'pending' ? html`<div class="card-body row wrap" style="border-top:1px solid var(--border);justify-content:flex-end;--gap:10px">
      <button class="btn" data-decide="reject" data-id="${v.id}">${icon('xCircle')} Reject</button><button class="btn btn-success" data-decide="approve" data-id="${v.id}">${icon('checkCircle')} Approve</button></div>`
    : html`<div class="card-body" style="border-top:1px solid var(--border)"><div class="small"><strong>${v.status === 'approved' ? 'Approved' : 'Rejected'}</strong> ${v.reviewedAt ? `on ${fmtDateTime(v.reviewedAt)}` : ''}${v.reviewer ? ` by ${v.reviewer}` : ''}.${v.userMessage ? html` Message to user: “${v.userMessage}”` : ''}${v.internalNote ? html`<div class="subtle">Internal note: ${v.internalNote}</div>` : ''}</div></div>`}
  </article>`;

  const load = async () => {
    render(ctx.el.querySelector('[data-tabs]'), html`${[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([v, l]) => html`<button class="tab" role="tab" aria-selected="${String(state.status === v)}" data-tab="${v}">${l}</button>`)}`);
    render(ctx.el.querySelector('[data-types]'), html`${[['', 'All'], ['student', 'Students'], ['recruiter', 'Recruiters']].map(([v, l]) => html`<label><input type="radio" name="vtype" value="${v}" ${state.type === v ? 'checked' : ''} data-type><span>${l}</span></label>`)}`);
    history.replaceState(null, '', `${ctx.path}?${new URLSearchParams(Object.entries(state).filter(([, v]) => v)).toString()}`);
    ({ items } = await get('/api/admin/verifications', { status: state.status, type: state.type || undefined }));
    render(ctx.el.querySelector('[data-list]'), items.length ? html`${items.map(card)}` : html`<div class="card">${empty({ icon: 'userCheck', title: state.status === 'pending' ? 'No pending requests' : 'Nothing here yet', text: state.status === 'pending' ? 'New requests appear when a student’s email domain doesn’t match a verified INI domain, or when a recruiter signs up.' : '' })}</div>`);
  };

  function decide(idv, decision) {
    const v = items.find((x) => String(x.id) === String(idv));
    const isRecruiter = v.type === 'recruiter';
    const orgUnverified = isRecruiter && v.organisation && v.organisation.status !== 'verified';
    formModal({
      title: `${decision === 'approve' ? 'Approve' : 'Reject'} ${v.user.name}`,
      description: decision === 'approve' ? 'The user is notified and gets full access.' : 'Tell the user exactly what to resubmit. They can upload a new document from their verification page.',
      submitText: decision === 'approve' ? 'Approve' : 'Reject',
      fields: html`
        ${decision === 'approve' && orgUnverified ? html`<div class="alert alert-warning">${icon('building')}<div>${v.organisation.name} is not verified yet. Recruiters can only be approved for verified organisations.</div></div>
          <div class="field"><label class="check"><input type="checkbox" name="verifyOrganisation" checked><span>Also verify <strong>${v.organisation.name}</strong> (domain, website and registration checked)</span></label><p class="field-error" data-for="verifyOrganisation"></p></div>
          ${field('registrationNumber', 'Registration number', html`<input class="input" id="f-registrationNumber" name="registrationNumber" maxlength="60" value="${v.registrationNumber || ''}">`, { optional: true })}` : ''}
        ${field('userMessage', 'Message to the user', html`<textarea class="textarea" id="f-userMessage" name="userMessage" rows="3" maxlength="500" ${decision === 'reject' ? html`data-validate="required|min:10"` : ''} placeholder="${decision === 'reject' ? 'e.g. The ID card image is cropped — please upload a photo showing the name and validity date.' : 'Optional welcome note'}"></textarea>`, { optional: decision === 'approve' })}
        ${field('internalNote', 'Internal note', html`<textarea class="textarea" id="f-internalNote" name="internalNote" rows="2" maxlength="1000" placeholder="Visible to administrators only"></textarea>`, { optional: true })}`,
      onSubmit: async (vals) => {
        await put(`/api/admin/verifications/${v.id}`, { decision, userMessage: vals.userMessage || null, internalNote: vals.internalNote || null, verifyOrganisation: !!vals.verifyOrganisation, registrationNumber: vals.registrationNumber || null });
        toast(decision === 'approve' ? `${v.user.name} approved.` : `${v.user.name} rejected — they have been told what to fix.`);
        load();
      },
    });
  }

  on(ctx.el, 'click', '[data-tab]', (e, b) => { state.status = b.dataset.tab; load(); });
  on(ctx.el, 'change', '[data-type]', (e, r) => { state.type = r.value; load(); });
  on(ctx.el, 'click', '[data-decide]', (e, b) => decide(b.dataset.id, b.dataset.decide));
  await load();
}
