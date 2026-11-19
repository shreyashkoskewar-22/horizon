import { html, render, on } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, put } from '../../lib/api.js';
import { docBadge, checkList, personAvatar } from '../../lib/components.js';
import { empty, toast, toastError, confirmDialog, skeletonRows } from '../../lib/ui.js';
import { fmtDateTime, bytes } from '../../lib/format.js';
import { pageHeader } from '../shared.js';

export default async function adminDocuments(ctx) {
  ctx.setTitle('Document reviews');
  ctx.setCrumbs([{ label: 'Document Reviews' }]);
  const state = { kind: ctx.query.kind === 'video' ? 'video' : 'cv', all: false };

  render(ctx.el, html`${pageHeader({ title: 'Document reviews', subtitle: 'CVs that failed an authenticity check or asked for verification, and video resumes awaiting moderation. Nothing is visible to the other side until it passes.' })}
    <div class="row wrap between mb-16 gap-3"><div class="tabs mb-0" role="tablist" data-tabs></div>
      <label class="switch"><input type="checkbox" data-all><span>Show all current documents</span></label></div>
    <div data-list>${skeletonRows(4)}</div>`);

  const card = (d) => {
    const isCv = d.kind === 'cv';
    return html`<article class="card mb-16"><div class="card-header">
      <div class="row">${personAvatar(d.owner.name)}<div><div class="strong">${d.owner.name}</div><div class="subtle">${d.owner.role === 'student' ? 'Student' : 'Recruiter'} · ${d.owner.affiliation || ''} · ${d.owner.email}</div></div></div>
      <div class="row wrap gap-2">${docBadge(d.status)}${d.manualReviewRequested ? html`<span class="badge badge-info">Verification requested</span>` : ''}</div></div>
      <div class="card-body"><div class="grid grid-2 gap-6">
        <div>
          <div class="strong">${d.originalName}</div><div class="subtle">${bytes(d.sizeBytes)} · uploaded ${fmtDateTime(d.createdAt)}${d.meta && d.meta.pages ? ` · ${d.meta.pages} page(s)` : ''}${d.meta && d.meta.durationSeconds ? ` · ${Math.round(d.meta.durationSeconds)} s` : ''}</div>
          ${isCv ? html`<div class="row wrap mt-16 gap-2"><a class="btn btn-sm" href="${d.url}" target="_blank" rel="noopener">${icon('eye', { size: 15 })} Open PDF</a></div>`
    : html`<video class="mt-16" controls preload="metadata" src="${d.url}" class="video-frame"></video>`}
          ${d.reviewNote ? html`<p class="small mt-16"><strong>Last note:</strong> ${d.reviewNote}</p>` : ''}
        </div>
        <div>${isCv && d.report ? html`<h3>Validation report</h3><p class="small muted">${d.report.summary.passed} passed · ${d.report.summary.warnings} warnings · ${d.report.summary.failed} failed</p>${checkList(d.report.checks)}`
    : html`<h3>Moderation checklist</h3><ul class="check-list">
            <li>${icon('checkCircle', { cls: 'pass' })}<div class="cl-label">Format and length checked automatically${d.meta && d.meta.durationSeconds ? ` (${Math.round(d.meta.durationSeconds)} s)` : ''}</div></li>
            <li>${icon('alertCircle', { cls: 'warn' })}<div><div class="cl-label">The person matches the account</div><div class="cl-detail">Name and affiliation are stated, nothing contradicts verification.</div></div></li>
            <li>${icon('alertCircle', { cls: 'warn' })}<div><div class="cl-label">Professional content only</div><div class="cl-detail">No contact details for payment, no offensive or misleading content, no third parties without consent.</div></div></li></ul>`}</div>
      </div></div>
      <div class="card-body row wrap" style="border-top:1px solid var(--border);justify-content:flex-end;--gap:10px">
        ${isCv ? html`<button class="btn" data-decide="changes_requested" data-id="${d.id}">${icon('edit')} Request changes</button><button class="btn btn-success" data-decide="verified" data-id="${d.id}">${icon('shieldCheck')} Mark HORIZON-verified</button>`
    : html`<button class="btn" data-decide="rejected" data-id="${d.id}">${icon('xCircle')} Reject</button><button class="btn btn-success" data-decide="approved" data-id="${d.id}">${icon('checkCircle')} Approve</button>`}
      </div></article>`;
  };

  const load = async () => {
    render(ctx.el.querySelector('[data-tabs]'), html`<button class="tab" role="tab" aria-selected="${String(state.kind === 'cv')}" data-kind="cv">${icon('fileText', { size: 16 })} CVs</button><button class="tab" role="tab" aria-selected="${String(state.kind === 'video')}" data-kind="video">${icon('video', { size: 16 })} Video resumes</button>`);
    const { items } = await get('/api/admin/documents', { kind: state.kind, status: state.all ? 'all' : undefined });
    render(ctx.el.querySelector('[data-list]'), items.length ? html`${items.map(card)}` : html`<div class="card">${empty({ icon: 'fileCheck', title: 'Queue is clear', text: state.kind === 'cv' ? 'Flagged CVs and verification requests appear here.' : 'New video resumes appear here for moderation.' })}</div>`);
  };

  const labels = { verified: 'Mark this CV HORIZON-verified?', changes_requested: 'Request changes to this CV', approved: 'Approve this video?', rejected: 'Reject this video' };
  on(ctx.el, 'click', '[data-decide]', async (e, b) => {
    const decision = b.dataset.decide;
    const negative = ['changes_requested', 'rejected'].includes(decision);
    const r = await confirmDialog({
      title: labels[decision],
      message: negative ? 'The owner sees your note and can upload a replacement.' : decision === 'verified' ? 'Recruiters will see a “HORIZON-verified” badge on this CV.' : 'The video becomes visible where the owner has chosen to share it.',
      confirmText: negative ? 'Send note' : 'Confirm', danger: negative,
      reason: { label: negative ? 'What needs to change' : 'Note (optional)', required: negative, min: negative ? 10 : 0 },
    });
    if (!r) return;
    try { await put(`/api/admin/documents/${b.dataset.id}/review`, { decision, note: r.reason || null }); toast('Decision saved and the owner notified.'); load(); } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-kind]', (e, b) => { state.kind = b.dataset.kind; history.replaceState(null, '', `${ctx.path}?kind=${state.kind}`); load(); });
  ctx.el.querySelector('[data-all]').addEventListener('change', (e) => { state.all = e.target.checked; load(); });
  await load();
}
