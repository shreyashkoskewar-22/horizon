/** Grievance form and ticket view shared by the public desk, student/recruiter app and admin console. */
import { html, render, $, $$, formToObject } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, upload } from '../lib/api.js';
import { fmtDateTime, hoursLabel, LABELS } from '../lib/format.js';
import { grievanceBadge, priorityBadge, timeline, slaChip } from '../lib/components.js';
import { toast, toastError, withLoading } from '../lib/ui.js';
import { validateForm, liveValidate, applyServerErrors } from '../lib/validate.js';

const field = (name, label, control, help = '') => html`<div class="field"><label class="label" for="g-${name}">${label}</label>${control}${help ? html`<p class="help">${help}</p>` : ''}<p class="field-error" data-for="${name}"></p></div>`;

export const EXTERNAL_AVENUES = html`<ul class="check-list">
  <li>${icon('alertTriangle', { cls: 'warn' })}<div><div class="cl-label">Lost money to a job or internship scam?</div><div class="cl-detail">Report it immediately on the National Cyber Crime Reporting Portal (<a href="https://cybercrime.gov.in" target="_blank" rel="noopener noreferrer">cybercrime.gov.in</a>) or call 1930, and tell us here as well.</div></div></li>
  <li>${icon('scale', { cls: 'pass' })}<div><div class="cl-label">Not satisfied after escalation?</div><div class="cl-detail">Where the IT Rules apply, decisions of an intermediary’s grievance officer can be appealed to the Grievance Appellate Committee (<a href="https://gac.gov.in" target="_blank" rel="noopener noreferrer">gac.gov.in</a>). This is general information, not legal advice.</div></div></li>
</ul>`;

export function grievanceForm({ cfg, user, prefill = {} }) {
  const cats = cfg.lists.grievanceCategories.filter((c) => (user && user.role === 'recruiter') || c.value !== 'candidate_conduct');
  return html`<form data-grievance-form novalidate class="stack gap-4">
    ${!user ? html`<div class="form-grid">
      ${field('guestName', 'Your name', html`<input class="input" id="g-guestName" name="guestName" autocomplete="name" data-validate="required|min:2|max:80">`)}
      ${field('guestEmail', 'Email for updates', html`<input class="input" id="g-guestEmail" name="guestEmail" type="email" autocomplete="email" data-validate="required|email">`)}
    </div>` : ''}
    <fieldset class="fieldset field"><legend class="label">What is this about?</legend>
      <div class="cat-picker">${cats.map((c, i) => html`<label class="cat-option"><input type="radio" name="category" value="${c.value}" ${prefill.category === c.value || (!prefill.category && i === -1) ? 'checked' : ''} ${i === 0 ? html`data-validate="required" data-msg-required="Choose a category."` : ''}><span>${c.label}${c.priority !== 'normal' ? html`<span class="prio">${priorityBadge(c.priority)}</span>` : ''}</span></label>`)}</div>
      <p class="field-error" data-for="category"></p>
    </fieldset>
    ${prefill.againstLabel ? html`<div class="alert alert-info">${icon('flag')}<div><div class="alert-title">Concerning</div>${prefill.againstLabel}</div></div>
      <input type="hidden" name="againstType" value="${prefill.againstType}"><input type="hidden" name="againstId" value="${prefill.againstId}">` : ''}
    ${field('subject', 'Subject', html`<input class="input" id="g-subject" name="subject" maxlength="120" data-validate="required|min:5|max:120" placeholder="A short summary" value="${prefill.subject || ''}">`)}
    ${field('description', 'What happened?', html`<textarea class="textarea" id="g-description" name="description" rows="6" maxlength="4000" data-validate="required|min:30|max:4000" placeholder="Include dates, names, links or amounts if relevant. Never share passwords or OTPs."></textarea>`, 'At least 30 characters. Plain language is perfect.')}
    ${field('evidence', 'Evidence (optional)', html`<input class="input input-file" id="g-evidence" name="evidence" type="file" accept=".pdf,.png,.jpg,.jpeg" data-validate="filetype:pdf,png,jpg,jpeg|maxsize:${cfg.uploads.proofMaxMb}">`, `Screenshot or PDF, up to ${cfg.uploads.proofMaxMb} MB. Stored privately.`)}
    ${prefill.againstType && prefill.againstType !== 'platform' ? html`<label class="switch"><input type="checkbox" name="isAnonymous"><span>Hide my identity from the organisation (the grievance desk can still see it)</span></label>` : ''}
    <div class="field"><label class="check"><input type="checkbox" name="declaration" data-validate="required" data-msg-required="Please confirm the information is accurate."><span>The information I’ve provided is accurate to the best of my knowledge.</span></label><p class="field-error" data-for="declaration"></p></div>
    ${!user ? html`<div class="field"><span class="label">Security check</span><div class="captcha-box" data-g-captcha></div><p class="field-error" data-g-captcha-err></p></div>` : ''}
    <div class="row wrap"><button class="btn btn-primary btn-lg" type="submit">${icon('send')} Submit grievance</button><span class="subtle">You’ll get a ticket number immediately.</span></div>
  </form>`;
}

export function wireGrievanceForm(form, { user, captcha, onDone }) {
  liveValidate(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = validateForm(form);
    let token = null;
    if (!user) {
      token = captcha && captcha.getToken();
      $('[data-g-captcha-err]', form).textContent = token ? '' : 'Please complete the security check.';
      if (!token) return;
    }
    if (!ok) return;
    const values = formToObject(form);
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null && v !== '') fd.append(k, typeof v === 'boolean' ? String(v) : v);
    const file = form.querySelector('input[type=file]').files[0];
    if (file) fd.append('evidence', file);
    if (token) fd.append('captchaToken', token);
    await withLoading(form.querySelector('button[type=submit]'), async () => {
      try {
        const res = await upload('/api/grievances', fd);
        toast(`Ticket ${res.ticketNo} created.`, { title: 'Grievance submitted' });
        onDone(res);
      } catch (err) {
        if (captcha) captcha.reset();
        if (!applyServerErrors(form, err.fields)) toastError(err);
      }
    });
  });
}

const EVENT_TITLES = {
  submitted: 'Grievance submitted', receipt: 'Receipt confirmed', acknowledged: 'Acknowledged by the grievance desk', message: 'Message',
  internal_note: 'Internal note — visible only to the grievance desk', response_requested: 'Response requested from the organisation',
  respondent_reply: 'The organisation responded', escalated: 'Escalated to the Grievance Officer', feedback: 'Feedback on the decision',
  reopened: 'Reopened by the complainant', priority_changed: 'Priority changed', assigned: 'Assigned',
};
const STATUS = { submitted: 'Submitted', acknowledged: 'Acknowledged', under_review: 'Under review', awaiting_response: 'Awaiting response', resolved: 'Resolved', rejected: 'Closed — not upheld', closed: 'Closed' };

export function grievanceTimeline(g) {
  return timeline(g.events.map((e) => ({
    title: html`${e.type === 'status_changed' ? `Status changed to “${STATUS[e.toStatus] || e.toStatus}”` : EVENT_TITLES[e.type] || e.type} <span class="subtle">· ${e.actor}</span>`,
    at: e.createdAt,
    body: e.type === 'priority_changed' ? `${LABELS.priority[e.fromStatus] || e.fromStatus} → ${LABELS.priority[e.toStatus] || e.toStatus}` : e.message,
    internal: e.visibility === 'internal',
    tone: e.type === 'escalated' || e.type === 'reopened' ? 'gold' : e.toStatus === 'resolved' || e.toStatus === 'closed' ? 'success' : e.actorRole === 'system' ? 'muted' : '',
  })));
}

export function grievanceHeader(g) {
  return html`<div class="card card-pad g-head">
    <div class="g-top">
      <div><div class="label-caps">Ticket</div><div class="g-ticket mono">${g.ticketNo}</div></div>
      <div><div class="label-caps">Current stage</div><div class="row wrap gap-2 mt-8">${grievanceBadge(g.status, g.statusLabel)}<span class="badge badge-navy">${g.levelLabel}</span></div></div>
      <div class="g-flags row wrap gap-2">${priorityBadge(g.priority)}${g.isDemo ? html`<span class="badge badge-demo">Demo data</span>` : ''}</div>
    </div>
    <h2 class="g-subject">${g.subject}</h2>
    <div class="row wrap subtle gap-4"><span>${g.categoryLabel}</span><span>${icon('flag', { size: 14 })} ${g.against.label}</span><span>${icon('calendar', { size: 14 })} Filed ${fmtDateTime(g.createdAt)}</span></div>
    <div class="grid grid-2 mt-16 gap-3">
      <div class="card sla-tile sunken"><div class="subtle">Acknowledgement</div><div class="strong">${g.acknowledgedAt ? html`${icon('checkCircle', { size: 15 })} ${fmtDateTime(g.acknowledgedAt)}` : html`Due by ${fmtDateTime(g.sla.ackDueAt)}`}</div>${g.sla.ackOverdue ? html`<span class="badge badge-error mt-8">Overdue</span>` : ''}</div>
      <div class="card sla-tile sunken"><div class="subtle">Resolution target</div><div class="strong">${g.resolvedAt ? html`${icon('checkCircle', { size: 15 })} Decided ${fmtDateTime(g.resolvedAt)}` : fmtDateTime(g.sla.resolutionDueAt)}</div>${g.sla.open ? html`<div class="mt-8">${slaChip(g.sla)}</div>` : ''}</div>
    </div>
  </div>`;
}

/** Ticket view with composer, escalation and feedback controls for the complainant or respondent. */
export function grievanceView(g) {
  const p = g.permissions;
  return html`<div class="detail">
    <div class="stack">
      ${grievanceHeader(g)}
      <div class="card card-pad"><h3>Description</h3><p class="pre mb-0">${g.description}</p>
        ${g.evidence ? html`<p class="mt-16 mb-0">${g.evidence.url ? html`<a class="btn btn-sm" href="${g.evidence.url}" target="_blank" rel="noopener">${icon('fileText')} ${g.evidence.name}</a>` : html`<span class="subtle">${icon('fileText', { size: 15 })} Evidence received: ${g.evidence.name} (visible to the grievance desk)</span>`}</p>` : ''}</div>
      ${g.resolutionSummary ? html`<div class="alert ${g.status === 'rejected' ? 'alert-warning' : 'alert-success'}">${icon(g.status === 'rejected' ? 'info' : 'checkCircle')}<div><div class="alert-title">Decision</div>${g.resolutionSummary}</div></div>` : ''}
      <div class="card card-pad"><h3 class="mb-16">Timeline</h3>${grievanceTimeline(g)}</div>
      ${p.message ? html`<form class="card card-pad" data-g-message novalidate><label class="label" for="g-msg">${g.scope === 'respondent' ? 'Your response to the grievance desk and complainant' : 'Add a message or more information'}</label>
        <textarea class="textarea mt-8" id="g-msg" name="message" rows="3" maxlength="3000" data-validate="required|min:2"></textarea><p class="field-error" data-for="message"></p>
        <div class="row between mt-8"><span class="subtle">${g.scope === 'respondent' ? 'Visible to the grievance desk and the complainant.' : 'Visible to you and the grievance desk.'}</span><button class="btn btn-primary" type="submit">${icon('send')} Send</button></div></form>` : ''}
    </div>
    <aside class="aside-sticky">
      ${g.scope === 'respondent' ? html`<div class="alert alert-warning">${icon('scale')}<div><div class="alert-title">Your right to respond</div>The grievance desk will consider your response before deciding. ${g.responseDueAt ? `Please respond by ${fmtDateTime(g.responseDueAt)}.` : ''}${g.isAnonymous ? ' The complainant chose to stay anonymous.' : ''}</div></div>` : ''}
      ${p.escalate ? html`<div class="card card-pad"><h3>${icon('arrowUpCircle')} Escalate</h3><p class="small muted">${g.sla.open ? 'The resolution deadline has passed. You can escalate to the Grievance Officer.' : 'Unhappy with the decision? Escalate to the Grievance Officer within the appeal window.'}</p><button class="btn btn-accent btn-block" data-g-escalate>Escalate to Level 2</button></div>` : ''}
      ${p.feedback || p.reopen ? html`<form class="card card-pad" data-g-feedback novalidate><h3>How did we do?</h3>
        <div class="stars mt-8" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${icon('star', { size: 26 })}</button>`)}</div>
        <input type="hidden" name="rating"><p class="field-error" data-for="rating"></p>
        <textarea class="textarea mt-8" name="comment" rows="2" maxlength="1000" placeholder="Optional comment"></textarea>
        <div class="row wrap mt-8"><button class="btn btn-primary" type="submit" data-g-close>Submit &amp; close ticket</button>${p.reopen ? html`<button class="btn" type="button" data-g-reopen>Reopen instead</button>` : ''}</div></form>` : ''}
      ${g.satisfaction ? html`<div class="card card-pad"><h3>Your feedback</h3><p class="mb-0">${'★'.repeat(g.satisfaction.rating)}${'☆'.repeat(5 - g.satisfaction.rating)} ${g.satisfaction.comment ? html`— ${g.satisfaction.comment}` : ''}</p></div>` : ''}
      <div class="card card-pad"><h3>Other avenues</h3>${EXTERNAL_AVENUES}</div>
    </aside>
  </div>`;
}

export function wireGrievanceView(root, g, { reload, guestKey }) {
  const headers = guestKey ? { 'X-Grievance-Key': guestKey } : {};
  const call = (path, body) => api(`/api/grievances/${g.id}${path}`, { method: 'POST', body, headers });
  const msgForm = $('[data-g-message]', root);
  if (msgForm) {
    liveValidate(msgForm);
    msgForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(msgForm)) return;
      await withLoading(msgForm.querySelector('button'), async () => {
        try { reload(await call('/messages', { message: msgForm.message.value.trim() })); toast('Message sent.'); } catch (err) { if (!applyServerErrors(msgForm, err.fields)) toastError(err); }
      });
    });
  }
  const esc = $('[data-g-escalate]', root);
  if (esc) {
    esc.addEventListener('click', async () => {
      const { confirmDialog } = await import('../lib/ui.js');
      const r = await confirmDialog({ title: 'Escalate to the Grievance Officer', message: 'Tell the Grievance Officer why the issue needs a second look. A new resolution window starts today.', confirmText: 'Escalate', reason: { label: 'Reason for escalation', required: true, min: 10 } });
      if (!r) return;
      try { reload(await call('/escalate', { reason: r.reason })); toast('Escalated to Level 2.'); } catch (err) { toastError(err); }
    });
  }
  const fb = $('[data-g-feedback]', root);
  if (fb) {
    let rating = 0;
    const stars = $$('[data-star]', fb);
    const paint = () => stars.forEach((s) => s.classList.toggle('on', Number(s.dataset.star) <= rating));
    stars.forEach((s) => s.addEventListener('click', () => { rating = Number(s.dataset.star); fb.rating.value = rating; paint(); $('[data-for=rating]', fb).textContent = ''; }));
    const send = async (reopen) => {
      if (!reopen && !rating) { $('[data-for=rating]', fb).textContent = 'Choose a rating from 1 to 5.'; return; }
      try { reload(await call('/feedback', { rating: rating || 1, comment: fb.comment.value.trim() || null, reopen })); toast(reopen ? 'Grievance reopened.' : 'Thank you for your feedback.'); } catch (err) { toastError(err); }
    };
    fb.addEventListener('submit', (e) => { e.preventDefault(); send(false); });
    const ro = $('[data-g-reopen]', fb);
    if (ro) ro.addEventListener('click', () => { if (!fb.comment.value.trim()) { fb.comment.placeholder = 'Tell us why you are reopening (required)'; fb.comment.focus(); return; } send(true); });
  }
}

export function grievanceList(items, { base }) {
  return html`<div class="table-wrap"><table class="table"><thead><tr><th>Ticket</th><th>Subject</th><th class="hide-sm">Category</th><th>Status</th><th class="hide-sm">Target</th><th class="hide-sm">Updated</th></tr></thead><tbody>
    ${items.map((g) => html`<tr><td class="mono nowrap"><a href="${base}/${g.id}" data-link>${g.ticketNo}</a></td><td><div class="cell-title">${g.subject}</div><div class="cell-sub">${g.against}</div><div class="cell-sub show-sm">${g.categoryLabel} · updated ${fmtDateTime(g.updatedAt)}</div>${g.sla && g.sla.open ? html`<div class="show-sm mt-8">${slaChip(g.sla)}</div>` : ''}</td>
      <td class="hide-sm">${g.categoryLabel}</td><td>${grievanceBadge(g.status, g.statusLabel)}</td><td class="hide-sm">${slaChip(g.sla)}</td><td class="hide-sm subtle">${fmtDateTime(g.updatedAt)}</td></tr>`)}
  </tbody></table></div>`;
}
export { hoursLabel };
