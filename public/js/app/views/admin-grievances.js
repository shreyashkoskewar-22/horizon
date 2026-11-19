import { html, render, on, $, debounce, formToObject } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, put } from '../../lib/api.js';
import { grievanceBadge, priorityBadge, slaChip } from '../../lib/components.js';
import { empty, toast, toastError, withLoading, skeletonRows } from '../../lib/ui.js';
import { validateForm, liveValidate, applyServerErrors, showError } from '../../lib/validate.js';
import { fmtDateTime } from '../../lib/format.js';
import { grievanceHeader, grievanceTimeline } from '../../shared/grievance-ui.js';
import { pageHeader } from '../shared.js';

const STATUSES = [['submitted', 'Submitted'], ['acknowledged', 'Acknowledged'], ['under_review', 'Under review'], ['awaiting_response', 'Awaiting response'], ['resolved', 'Resolved'], ['rejected', 'Closed — not upheld'], ['closed', 'Closed']];

export default async function adminGrievances(ctx) {
  if (ctx.params.id) return detail(ctx);
  ctx.setTitle('Grievance desk');
  ctx.setCrumbs([{ label: 'Grievance Desk' }]);
  const state = { status: ctx.query.status || 'open', category: '', priority: '', q: '', overdue: ctx.query.overdue === '1' };

  render(ctx.el, html`${pageHeader({
    title: 'Grievance desk',
    subtitle: `Acknowledge within ${ctx.cfg.grievance.ackHours} hours, resolve within ${ctx.cfg.grievance.resolveDays} days (${ctx.cfg.grievance.urgentResolveHours} hours for urgent categories). Every action is logged and visible to the complainant unless marked internal.`,
    actions: html`<a class="btn" href="/transparency" data-external target="_blank" rel="noopener">${icon('barChart')} Public transparency report</a>`,
  })}
    <div class="row wrap mb-16 gap-3">
      <div class="input-icon" style="flex:1;min-width:220px;max-width:360px">${icon('search')}<input class="input" type="search" placeholder="Ticket number or subject" data-q aria-label="Search grievances"></div>
      <select class="select w-auto" data-f="status" aria-label="Status"><option value="open" selected>All open</option><option value="">All tickets</option>${STATUSES.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select>
      <select class="select w-auto" data-f="category" aria-label="Category"><option value="">All categories</option>${ctx.cfg.lists.grievanceCategories.map((c) => html`<option value="${c.value}">${c.label}</option>`)}</select>
      <select class="select w-auto" data-f="priority" aria-label="Priority"><option value="">Any priority</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option></select>
      <label class="switch"><input type="checkbox" data-overdue ${state.overdue ? 'checked' : ''}><span>Past SLA only</span></label>
    </div>
    <div data-list>${skeletonRows(6)}</div>`);

  const load = async () => {
    const { items } = await get('/api/admin/grievances', { status: state.status || undefined, category: state.category || undefined, priority: state.priority || undefined, q: state.q || undefined, overdue: state.overdue ? '1' : undefined });
    render($('[data-list]', ctx.el), items.length ? html`<div class="table-wrap is-long"><table class="table"><thead><tr><th>Ticket</th><th>Subject</th><th class="hide-sm">Complainant</th><th>Priority</th><th>Status</th><th class="hide-sm">SLA</th><th class="hide-sm">Assignee</th></tr></thead><tbody>
      ${items.map((g) => html`<tr><td class="mono nowrap"><a href="/admin/grievances/${g.id}">${g.ticketNo}</a>${g.level === 2 ? html`<div><span class="badge badge-navy">L2</span></div>` : ''}</td>
        <td><div class="cell-title">${g.subject}</div><div class="cell-sub">${g.categoryLabel} · ${g.against}${g.isDemo ? ' · demo' : ''}</div></td>
        <td class="hide-sm">${g.complainant}</td><td>${priorityBadge(g.priority)}</td><td>${grievanceBadge(g.status, g.statusLabel)}</td>
        <td class="hide-sm">${slaChip(g.sla)}</td><td class="hide-sm">${g.assignee || html`<span class="subtle">Unassigned</span>`}</td></tr>`)}
    </tbody></table></div>` : html`<div class="card">${empty({ icon: 'scale', title: 'No grievances match', text: 'Change the filters to see closed or other tickets.' })}</div>`);
  };
  on(ctx.el, 'change', '[data-f]', (e, s) => { state[s.dataset.f] = s.value; load(); });
  $('[data-overdue]', ctx.el).addEventListener('change', (e) => { state.overdue = e.target.checked; load(); });
  $('[data-q]', ctx.el).addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); load(); }, 300));
  await load();
  return undefined;
}

async function detail(ctx) {
  let g = await get(`/api/admin/grievances/${ctx.params.id}`);
  ctx.setActive('/admin/grievances');

  function draw() {
    ctx.setTitle(g.ticketNo);
    ctx.setCrumbs([{ label: 'Grievance Desk', href: '/admin/grievances' }, { label: g.ticketNo }]);
    const c = g.complainant;
    const open = !['resolved', 'rejected', 'closed'].includes(g.status);
    render(ctx.el, html`<div class="detail">
      <div class="stack">
        ${grievanceHeader(g)}
        <div class="card card-pad"><h3>Description</h3><p class="pre mb-0">${g.description}</p>
          ${g.evidence ? html`<p class="mt-16 mb-0"><a class="btn btn-sm" href="${g.evidence.url}" target="_blank" rel="noopener">${icon('fileText')} Evidence: ${g.evidence.name}</a></p>` : ''}</div>
        ${g.resolutionSummary ? html`<div class="alert ${g.status === 'rejected' ? 'alert-warning' : 'alert-success'}">${icon('checkCircle')}<div><div class="alert-title">Decision shared with the complainant</div>${g.resolutionSummary}</div></div>` : ''}
        ${g.satisfaction ? html`<div class="card card-pad"><h3>Complainant feedback</h3><p class="mb-0">${'★'.repeat(g.satisfaction.rating)}${'☆'.repeat(5 - g.satisfaction.rating)} ${g.satisfaction.comment ? html`— ${g.satisfaction.comment}` : ''}</p></div>` : ''}
        <div class="card card-pad"><h3 class="mb-16">Full timeline <span class="subtle small">(internal notes are shaded)</span></h3>${grievanceTimeline(g)}</div>
      </div>
      <aside class="aside-sticky">
        <section class="card card-pad"><h3>${icon('user')} Complainant</h3><div class="kv">
          <div>Name</div><div>${c.name}${g.isAnonymous ? html` <span class="badge">Anonymous to respondent</span>` : ''}</div>
          <div>Role</div><div>${c.role === 'guest' ? 'Guest (not signed in)' : c.role}</div>
          ${c.email ? html`<div>Email</div><div class="truncate"><a href="mailto:${c.email}">${c.email}</a></div>` : ''}
          ${c.institution || c.organisation ? html`<div>Affiliation</div><div>${c.institution || c.organisation}</div>` : ''}
          <div>Against</div><div>${g.against.label}${g.against.type === 'opportunity' ? html` · <a href="/admin/internships/${g.against.id}">listing</a>` : g.against.type === 'organisation' ? html` · <a href="/admin/organisations/${g.against.id}">organisation</a>` : ''}</div>
          <div>Assignee</div><div>${g.assignee ? g.assignee.name : 'Unassigned'}</div>
          ${g.responseDueAt ? html`<div>Respondent due</div><div>${fmtDateTime(g.responseDueAt)}</div>` : ''}
        </div></section>
        <form class="card" data-action novalidate>
          <div class="card-header"><h2>Take action</h2></div>
          <div class="card-body stack gap-4">
            <div class="field"><label class="label" for="a-status">Status</label><select class="select" id="a-status" name="status">${STATUSES.map(([v, l]) => html`<option value="${v}" ${g.status === v ? 'selected' : ''} ${v === 'awaiting_response' && !g.hasRespondent ? 'disabled' : ''}>${l}</option>`)}</select><p class="field-error" data-for="status"></p></div>
            <div class="field" data-summary hidden><label class="label" for="a-summary">Resolution summary <span class="req">*</span></label><textarea class="textarea" id="a-summary" name="resolutionSummary" rows="4" maxlength="3000" placeholder="What was decided and what action was taken. Shared with the complainant${g.sharedWithRespondent ? ' and the organisation' : ''}."></textarea><p class="field-error" data-for="resolutionSummary"></p></div>
            <div class="field"><label class="label" for="a-message">Message</label><textarea class="textarea" id="a-message" name="message" rows="3" maxlength="3000" placeholder="Update for the complainant"></textarea><p class="field-error" data-for="message"></p></div>
            ${g.sharedWithRespondent ? html`<fieldset class="field"><legend class="label">Who sees the message?</legend><div class="segmented"><label><input type="radio" name="audience" value="complainant" checked><span>Complainant only</span></label><label><input type="radio" name="audience" value="parties"><span>Complainant + organisation</span></label></div></fieldset>` : ''}
            <div class="field"><label class="label" for="a-note">Internal note <span class="opt">(desk only)</span></label><textarea class="textarea" id="a-note" name="internalNote" rows="2" maxlength="3000"></textarea></div>
            <div class="field"><label class="label" for="a-priority">Priority</label><select class="select" id="a-priority" name="priority">${['urgent', 'high', 'normal'].map((p) => html`<option value="${p}" ${g.priority === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`)}</select></div>
            ${!g.assignee ? html`<label class="check"><input type="checkbox" name="assignToMe" checked><span>Assign to me</span></label>` : ''}
            ${g.hasRespondent && !g.sharedWithRespondent && open ? html`<label class="check"><input type="checkbox" name="requestResponse"><span>Share with the organisation and request their response (${ctx.cfg.grievance.respondentDays} days)</span></label>` : ''}
            <button class="btn btn-primary btn-block" type="submit">${icon('send')} Save &amp; notify</button>
          </div>
        </form>
        <p class="subtle xs">Complainants can escalate to Level 2 if a deadline passes or within ${ctx.cfg.grievance.appealDays} days of a decision. Guests receive updates by email.</p>
      </aside></div>`);

    const form = $('[data-action]', ctx.el);
    liveValidate(form);
    const syncSummary = () => { $('[data-summary]', form).hidden = !['resolved', 'rejected'].includes(form.status.value); };
    form.status.addEventListener('change', syncSummary);
    syncSummary();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(form)) return;
      const v = formToObject(form);
      if (['resolved', 'rejected'].includes(v.status) && v.status !== g.status && (v.resolutionSummary || '').trim().length < 10) { showError(form.resolutionSummary, 'Explain the outcome and any action taken (at least 10 characters).'); form.resolutionSummary.focus(); return; }
      const body = {
        status: v.status !== g.status ? v.status : undefined,
        message: v.message || null, internalNote: v.internalNote || null, audience: v.audience || 'complainant',
        priority: v.priority !== g.priority ? v.priority : undefined, assignToMe: !!v.assignToMe, requestResponse: !!v.requestResponse,
        resolutionSummary: v.resolutionSummary || null,
      };
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try { g = await put(`/api/admin/grievances/${g.id}`, body); toast('Grievance updated.'); draw(); window.scrollTo(0, 0); } catch (err) { if (!applyServerErrors(form, err.fields)) toastError(err); }
      });
    });
  }
  draw();
}
