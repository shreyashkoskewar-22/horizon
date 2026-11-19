import { html, render, $, $$, on, safeUrl, formToObject } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, put, del } from '../../lib/api.js';
import { stageBadge, recruiterBadge, timeline, respondClock } from '../../lib/components.js';
import { toast, toastError, openModal, confirmDialog, withLoading, empty, skeletonRows, spinner } from '../../lib/ui.js';
import { validateForm, liveValidate, applyServerErrors } from '../../lib/validate.js';
import { LABELS, STAGES, fmtDate, fmtDateTime, fmtShort, deadlineLabel, relativeDay } from '../../lib/format.js';
import { pageHeader, field, stageOptions, toLocalInput, fromLocalInput, trackModal } from '../shared.js';

const OPEN_STAGES = STAGES.filter((s) => !['rejected', 'withdrawn'].includes(s));
const CLOSED_STAGES = ['rejected', 'withdrawn'];
const MOBILE_DEFAULT = ['interview', 'assessment', 'applied', 'preparing', 'interested'];
const CLOCK_STAGES = ['applied', 'assessment', 'interview'];
const shortStage = (s) => LABELS.stage[s].replace(' Application', '').replace(' Received', '').replace('Online ', '');

export default async function applications(ctx) {
  ctx.setTitle('My Applications');
  ctx.setCrumbs([{ label: 'My Applications' }]);
  let view = (() => { try { return localStorage.getItem('horizon.appView') || 'board'; } catch { return 'board'; } })();
  let data = { items: [], counts: {} };
  let selected = STAGES.includes(ctx.query.stage) ? ctx.query.stage : null;
  const mq = window.matchMedia('(max-width: 760px)');
  let closedOpen = CLOSED_STAGES.includes(selected);

  render(ctx.el, html`${pageHeader({
    title: 'My applications',
    subtitle: html`<span class="hide-sm">Drag cards between stages, or use “Move to” on each card. </span><span class="show-sm-inline">Choose a stage to see its applications. </span>HORIZON applications update automatically when the recruiter responds.`,
    actions: html`<div class="segmented" role="radiogroup" aria-label="View"><label><input type="radio" name="view" value="board" ${view === 'board' ? 'checked' : ''}><span>${icon('columns', { size: 15 })} <span class="hide-sm">Board</span><span class="show-sm-inline">By stage</span></span></label><label><input type="radio" name="view" value="list" ${view === 'list' ? 'checked' : ''}><span>${icon('list', { size: 15 })} List</span></label></div>
      <button class="btn btn-primary" data-add>${icon('plus')} Add application</button>`,
  })}<h2 class="sr-only">Applications by stage</h2><div data-summary></div><div data-body>${skeletonRows(4)}</div>`);

  const body = $('[data-body]', ctx.el);
  const byId = (id) => data.items.find((a) => String(a.id) === String(id));
  const count = (s) => data.counts[s] || 0;

  function setStageParam(stage) {
    const url = new URL(window.location.href);
    if (stage) url.searchParams.set('stage', stage); else url.searchParams.delete('stage');
    history.replaceState(history.state, '', `${url.pathname}${url.search}`);
  }

  function card(a) {
    const locked = a.channel === 'horizon';
    const showClock = locked && CLOCK_STAGES.includes(a.stage) && (a.respondBy || a.firstResponseAt);
    return html`<article class="kcard" data-card="${a.id}" draggable="${String(!locked)}" tabindex="0" aria-label="${a.title} at ${a.organisation}, ${LABELS.stage[a.stage]}">
      <div class="kc-title">${a.title}</div>
      <div class="kc-org">${a.organisation} · ${a.city}</div>
      ${locked ? html`<div class="kc-tags"><span class="badge badge-navy" title="Synced with the recruiter on HORIZON">${icon('send', { size: 12 })} Applied on HORIZON</span></div>` : ''}
      ${a.interviewAt && a.stage === 'interview' ? html`<div class="kc-interview">${icon('calendar', { size: 15 })}<span><strong>Interview ${relativeDay(a.interviewAt)}</strong> · ${fmtDateTime(a.interviewAt)}</span></div>` : ''}
      ${showClock ? respondClock(a, { base: ctx.base, compact: true, windowDays: ctx.cfg.recruiterResponseDays }) : locked && a.recruiterStatus ? html`<div>${recruiterBadge(a.recruiterStatus)}</div>` : ''}
      <div class="kc-meta">
        ${a.personalDeadline ? html`<span>${icon('flag', { size: 13 })}Due ${fmtShort(a.personalDeadline)}</span>` : ''}
        ${['interested', 'preparing'].includes(a.stage) && a.deadline ? html`<span>${icon('clock', { size: 13 })}${deadlineLabel(a.deadline)}</span>` : ''}
        ${a.appliedOn && !['interested', 'preparing'].includes(a.stage) ? html`<span>${icon('send', { size: 13 })}Applied ${fmtShort(a.appliedOn)}</span>` : ''}
      </div>
      ${a.nextAction ? html`<div class="kc-next">${icon('arrowRight', { size: 13 })} ${a.nextAction}</div>` : ''}
      <div class="kc-foot">
        <label class="sr-only" for="mv-${a.id}">Move ${a.title} to</label>
        <select class="select" id="mv-${a.id}" data-move="${a.id}" ${locked && a.stage === 'withdrawn' ? 'disabled' : ''}>${locked
    ? html`<option value="${a.stage}" selected>${LABELS.stage[a.stage]}</option>${a.stage !== 'withdrawn' ? html`<option value="withdrawn">Withdraw application</option>` : ''}`
    : stageOptions(a.stage)}</select>
        <button class="btn btn-ghost btn-icon btn-sm" data-open="${a.id}" aria-label="Open details for ${a.title}">${icon('chevronRight', { size: 16 })}</button>
      </div>
    </article>`;
  }

  const column = (s, items) => html`<section class="column" data-column="${s}" id="col-${s}" tabindex="-1" aria-labelledby="colh-${s}">
    <div class="column-head"><h3 id="colh-${s}">${stageBadge(s)}<span class="sr-only">, ${items.length} ${items.length === 1 ? 'application' : 'applications'}</span></h3></div>
    ${items.length ? items.map(card) : html`<div class="column-empty">Drop cards here</div>`}</section>`;

  function drawSummary() {
    const el = $('[data-summary]', ctx.el);
    if (mq.matches && view === 'board') {
      // Phones: the summary strip becomes the stage selector.
      render(el, html`<div class="stage-pills" role="tablist" aria-label="Application stages">${STAGES.map((s) => html`<button type="button" role="tab" class="stage-pill" id="tab-${s}" data-pick="${s}" aria-selected="${String(s === selected)}" aria-controls="stage-panel" tabindex="${s === selected ? '0' : '-1'}">${shortStage(s)} <span class="sp-count">${count(s)}</span></button>`)}</div>`);
      const cur = $(`#tab-${selected}`, el);
      if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
      return;
    }
    render(el, html`<div class="card card-pad mb-24 summary-card"><div class="pipeline">${STAGES.map((s) => html`<button type="button" class="pl-step" data-jump="${s}" aria-label="${LABELS.stage[s]}: ${count(s)}. ${view === 'board' ? 'Show column' : 'Filter list'}" aria-pressed="${String(view === 'list' && selected === s)}"><div class="pl-count">${count(s)}</div><div class="pl-label">${shortStage(s)}</div></button>`)}</div></div>`);
  }

  function draw() {
    if (!selected || (mq.matches && view === 'board' && !STAGES.includes(selected))) selected = null;
    if (mq.matches && view === 'board' && !selected) selected = MOBILE_DEFAULT.find((s) => count(s)) || STAGES.find((s) => count(s)) || 'interested';
    drawSummary();
    if (!data.items.length) {
      render(body, empty({ icon: 'columns', title: 'Your board is empty', text: 'Track opportunities you’re interested in, applying to, or interviewing for — all in one place.', action: html`<a class="btn btn-primary" href="/app/explore">Find opportunities</a>` }));
      return;
    }
    if (view === 'board' && mq.matches) {
      const items = data.items.filter((a) => a.stage === selected);
      render(body, html`<div class="stage-panel" role="tabpanel" id="stage-panel" aria-labelledby="tab-${selected}" tabindex="0">
        ${items.length ? html`<div class="stack gap-3">${items.map(card)}</div>`
    : empty({ compact: true, icon: 'columns', title: `Nothing in ${shortStage(selected)}`, text: 'Move a card here with “Move to”, or add an application.' })}</div>`);
      return;
    }
    if (view === 'board') {
      const closedCount = CLOSED_STAGES.reduce((n, s) => n + count(s), 0);
      render(body, html`<div class="board ${closedOpen ? 'closed-open' : ''}">
        ${OPEN_STAGES.map((s) => column(s, data.items.filter((a) => a.stage === s)))}
        <section class="column closed-col" id="col-closed" tabindex="-1" aria-label="Closed applications">
          <div class="column-head"><button type="button" class="btn btn-sm btn-ghost closed-toggle" data-closed-toggle aria-expanded="${String(closedOpen)}" aria-controls="closed-body">${icon(closedOpen ? 'chevronLeft' : 'chevronRight', { size: 16 })} Closed (${closedCount})</button></div>
          <div id="closed-body" class="closed-body">${CLOSED_STAGES.map((s) => {
    const items = data.items.filter((a) => a.stage === s);
    return html`<div class="closed-group" data-column="${s}" id="col-${s}" tabindex="-1"><div class="closed-head">${stageBadge(s)} <span class="count">${items.length}</span></div>
              ${closedOpen ? (items.length ? items.map(card) : html`<div class="column-empty">Drop cards here</div>`) : ''}</div>`;
  })}</div>
        </section></div>`);
    } else {
      const rows = selected ? data.items.filter((a) => a.stage === selected) : data.items;
      render(body, html`${selected ? html`<div class="row wrap gap-2 mb-16"><span class="chip">Stage: ${LABELS.stage[selected]}<button type="button" data-clear-stage aria-label="Show all stages">${icon('x', { size: 13 })}</button></span></div>` : ''}
        <div class="table-wrap"><table class="table"><thead><tr><th>Opportunity</th><th>Stage</th><th class="hide-sm">Applied</th><th class="hide-sm">Next action</th><th class="hide-sm">Deadline</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${rows.map((a) => html`<tr><td><div class="cell-title">${a.title}</div><div class="cell-sub">${a.organisation} · ${a.country}${a.channel === 'horizon' ? ' · via HORIZON' : ''}</div>
            <div class="cell-sub show-sm">${a.appliedOn ? `Applied ${fmtShort(a.appliedOn)}` : 'Not applied yet'}${a.personalDeadline ? ` · due ${fmtShort(a.personalDeadline)}` : ''}${a.nextAction ? ` · Next: ${a.nextAction}` : ''}</div></td>
          <td>${stageBadge(a.stage)}${a.channel === 'horizon' && a.recruiterStatus ? html`<div class="mt-8">${recruiterBadge(a.recruiterStatus)}</div>` : ''}${a.channel === 'horizon' && (a.respondBy || a.firstResponseAt) && CLOCK_STAGES.includes(a.stage) ? html`<div class="mt-8">${respondClock(a, { base: ctx.base, compact: true, windowDays: ctx.cfg.recruiterResponseDays })}</div>` : ''}</td>
          <td class="hide-sm">${a.appliedOn ? fmtDate(a.appliedOn) : '—'}</td>
          <td class="hide-sm">${a.nextAction || '—'}</td><td class="hide-sm">${a.personalDeadline ? fmtDate(a.personalDeadline) : '—'}</td>
          <td><div class="actions"><button class="btn btn-sm" data-open="${a.id}">Details<span class="sr-only"> for ${a.title}</span></button></div></td></tr>`)}
      </tbody></table></div>`);
    }
  }

  async function load() {
    data = await get('/api/applications');
    draw();
  }

  async function move(id, stage) {
    const a = byId(id);
    if (!a || a.stage === stage) return;
    if (stage === 'withdrawn' && a.channel === 'horizon') {
      const ok = await confirmDialog({ title: 'Withdraw this application?', message: `${a.organisation} will be told you withdrew. This can’t be undone.`, confirmText: 'Withdraw', danger: true });
      if (!ok) { draw(); return; }
    }
    const prev = a.stage;
    a.stage = stage;
    data.counts[prev] -= 1; data.counts[stage] = (data.counts[stage] || 0) + 1;
    draw();
    try {
      Object.assign(a, await put(`/api/applications/${id}`, { stage }));
      toast(`Moved to ${LABELS.stage[stage]}.`);
      draw();
    } catch (err) {
      a.stage = prev; data.counts[stage] -= 1; data.counts[prev] += 1; draw();
      toastError(err);
    }
  }

  function pick(stage, { focus = false } = {}) {
    selected = stage;
    setStageParam(stage);
    draw();
    if (focus) { const t = $(`#tab-${stage}`, ctx.el); if (t) t.focus(); }
  }

  // Drag and drop (keyboard users use the "Move to" select)
  let dragId = null;
  on(ctx.el, 'dragstart', '[data-card]', (e, el) => { dragId = el.dataset.card; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
  on(ctx.el, 'dragend', '[data-card]', (e, el) => { el.classList.remove('dragging'); $$('.drop-target', ctx.el).forEach((c) => c.classList.remove('drop-target')); });
  on(ctx.el, 'dragover', '[data-column]', (e, col) => { if (!dragId) return; e.preventDefault(); col.classList.add('drop-target'); });
  on(ctx.el, 'dragleave', '[data-column]', (e, col) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop-target'); });
  on(ctx.el, 'drop', '[data-column]', (e, col) => { e.preventDefault(); col.classList.remove('drop-target'); const id = e.dataTransfer.getData('text/plain') || dragId; dragId = null; if (id) move(id, col.dataset.column); });
  on(ctx.el, 'change', '[data-move]', (e, sel) => move(sel.dataset.move, sel.value));
  on(ctx.el, 'click', '[data-card]', (e, el) => { if (!e.target.closest('select, button, a')) openDetail(el.dataset.card); });
  on(ctx.el, 'keydown', '[data-card]', (e, el) => { if (e.key === 'Enter' && e.target === el) openDetail(el.dataset.card); });
  on(ctx.el, 'click', '[data-open]', (e, b) => openDetail(b.dataset.open));
  on(ctx.el, 'click', '[data-add]', () => trackModal(null, { onDone: load }));
  on(ctx.el, 'click', '[data-closed-toggle]', () => { closedOpen = !closedOpen; draw(); const t = $('[data-closed-toggle]', ctx.el); if (t) t.focus(); });
  on(ctx.el, 'click', '[data-clear-stage]', () => { selected = null; setStageParam(null); draw(); });
  on(ctx.el, 'click', '[data-pick]', (e, b) => pick(b.dataset.pick));
  on(ctx.el, 'keydown', '[role=tab]', (e, b) => {
    const i = STAGES.indexOf(b.dataset.pick);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: STAGES.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    pick(STAGES[(next + STAGES.length) % STAGES.length], { focus: true });
  });
  // Summary tiles: show the column on the board, or filter the list.
  on(ctx.el, 'click', '[data-jump]', (e, b) => {
    const s = b.dataset.jump;
    if (view === 'list') { selected = selected === s ? null : s; setStageParam(selected); draw(); return; }
    setStageParam(s);
    if (CLOSED_STAGES.includes(s) && !closedOpen) { closedOpen = true; draw(); }
    const col = $(`#col-${s}`, ctx.el);
    if (col) { col.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'center' }); col.focus({ preventScroll: true }); }
  });
  $$('input[name=view]', ctx.el).forEach((r) => r.addEventListener('change', () => { view = r.value; try { localStorage.setItem('horizon.appView', view); } catch { /* preference only */ } draw(); }));
  const onMq = () => draw();
  mq.addEventListener('change', onMq);
  ctx.onCleanup(() => mq.removeEventListener('change', onMq));

  async function openDetail(id) {
    const m = openModal({ title: 'Application details', drawer: true, body: spinner('Loading application') });
    m.el.classList.add('sheet-sm');
    let a;
    try { a = await get(`/api/applications/${id}`); } catch (err) { m.close(); toastError(err); return; }
    const locked = a.channel === 'horizon';
    render(m.body, html`
      <div class="stack gap-5">
        <div><div class="row wrap gap-2">${stageBadge(a.stage)}${locked ? html`<span class="badge badge-navy">${icon('send', { size: 12 })} Applied on HORIZON</span>` : html`<span class="badge">Self-tracked</span>`}${a.opportunityStatus === 'archived' ? html`<span class="badge badge-outline">Listing archived</span>` : ''}</div>
          <h3 class="mt-8 mb-0 drawer-title">${a.title}</h3><div class="muted">${a.organisation} · ${a.city}, ${a.country}</div>
          <div class="row wrap mt-8 gap-2"><a class="btn btn-sm" href="/app/opportunities/${a.opportunityId}">${icon('eye', { size: 15 })} View listing</a>${!locked && a.applicationUrl ? html`<a class="btn btn-sm" href="${safeUrl(a.applicationUrl)}" target="_blank" rel="noopener noreferrer">${icon('externalLink', { size: 15 })} Employer site</a>` : ''}</div></div>
        ${locked ? respondClock(a, { base: ctx.base, windowDays: ctx.cfg.recruiterResponseDays }) : ''}
        ${locked && a.recruiterMessage ? html`<div class="alert alert-info">${icon('message')}<div><div class="alert-title">Latest message from ${a.organisation}</div>${a.recruiterMessage}</div></div>` : ''}
        ${a.interviewAt && a.stage === 'interview' ? html`<div class="kc-interview lg">${icon('calendar', { size: 16 })}<span><strong>Interview ${relativeDay(a.interviewAt)}</strong> · ${fmtDateTime(a.interviewAt)}</span></div>` : ''}
        <section aria-labelledby="hist-h"><h3 class="label-caps" id="hist-h">${icon('history', { size: 15 })} Application history</h3>
          ${timeline(a.events.slice().reverse().map((ev) => ({
    title: ev.type === 'stage_changed' || ev.type === 'withdrawn' ? `${ev.actor === 'You' ? 'You' : ev.actor} moved it to ${LABELS.stage[ev.to] || ev.to}` : ev.type === 'recruiter_status' ? `${ev.actor}: ${LABELS.recruiterStatus[ev.to] || ev.to}` : ev.type === 'submitted' ? 'Submitted on HORIZON' : ev.type === 'created' ? 'Added to tracker' : ev.type === 'notes_updated' ? 'Notes updated' : ev.type === 'dates_updated' ? 'Dates updated' : ev.type === 'next_action' ? `Next action: ${ev.to || '—'}` : ev.type,
    at: ev.createdAt, body: ev.type === 'dates_updated' || ev.type === 'notes_updated' || ev.type === 'created' ? '' : ev.message, tone: ev.actorRole === 'recruiter' ? 'gold' : '',
  })))}</section>
        <form class="stack" data-edit novalidate aria-labelledby="notes-h">
          <h3 class="label-caps" id="notes-h">${icon('edit', { size: 15 })} Dates and notes</h3>
          <div class="form-grid">
            ${field('stage', 'Stage', html`<select class="select" id="f-stage" name="stage" ${locked && a.stage === 'withdrawn' ? 'disabled' : ''}>${locked ? html`<option value="${a.stage}">${LABELS.stage[a.stage]}</option>${a.stage !== 'withdrawn' ? html`<option value="withdrawn">Withdraw application</option>` : ''}` : stageOptions(a.stage)}</select>`, { help: locked ? 'Updated by the recruiter for HORIZON applications.' : '' })}
            ${field('appliedOn', 'Application date', html`<input class="input" type="date" id="f-appliedOn" name="appliedOn" value="${a.appliedOn || ''}" data-validate="date" ${locked ? 'readonly' : ''}>`)}
            ${field('interviewAt', 'Interview date & time', html`<input class="input" type="datetime-local" id="f-interviewAt" name="interviewAt" value="${toLocalInput(a.interviewAt)}">`)}
            ${field('personalDeadline', 'Personal deadline', html`<input class="input" type="date" id="f-personalDeadline" name="personalDeadline" value="${a.personalDeadline || ''}" data-validate="date">`)}
            ${field('nextAction', 'Next action', html`<input class="input" id="f-nextAction" name="nextAction" maxlength="200" value="${a.nextAction || ''}" data-validate="max:200">`, { span: true })}
            ${field('notes', 'Notes', html`<textarea class="textarea" id="f-notes" name="notes" rows="4" maxlength="4000" data-validate="max:4000">${a.notes || ''}</textarea>`, { span: true, help: 'Private — never shared with recruiters.' })}
          </div>
        </form>
        ${a.coverNote ? html`<div class="card card-pad sunken"><div class="subtle">Your cover note</div><p class="pre mb-0 small">${a.coverNote}</p></div>` : ''}
      </div>`);
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    render(footer, html`${!locked ? html`<button class="btn btn-danger push-left" data-del>${icon('trash')} Delete</button>` : ''}<button class="btn" data-close>Close</button><button class="btn btn-primary" data-save>Save changes</button>`);
    m.el.appendChild(footer);
    const form = $('[data-edit]', m.el);
    liveValidate(form);
    footer.querySelector('[data-close]').addEventListener('click', () => m.close());
    footer.querySelector('[data-save]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!validateForm(form)) return;
      const v = formToObject(form);
      const bodyData = { nextAction: v.nextAction || null, notes: v.notes || null, personalDeadline: v.personalDeadline || null, interviewAt: fromLocalInput(v.interviewAt) };
      if (!locked) bodyData.appliedOn = v.appliedOn || null;
      if (v.stage && v.stage !== a.stage) {
        if (v.stage === 'withdrawn' && locked && !(await confirmDialog({ title: 'Withdraw this application?', message: `${a.organisation} will be told you withdrew.`, confirmText: 'Withdraw', danger: true }))) return;
        bodyData.stage = v.stage;
      }
      await withLoading(btn, async () => {
        try { await put(`/api/applications/${a.id}`, bodyData); toast('Application updated.'); m.close(); load(); } catch (err) { if (!applyServerErrors(form, err.fields)) toastError(err); }
      });
    });
    const delBtn = footer.querySelector('[data-del]');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Delete this application?', message: 'It will be removed from your tracker along with its history. This cannot be undone.', confirmText: 'Delete', danger: true }))) return;
      try { await del(`/api/applications/${a.id}`); toast('Application deleted.'); m.close(); load(); } catch (err) { toastError(err); }
    });
  }

  await load();
  if (selected && view === 'board' && !mq.matches) { const col = $(`#col-${selected}`, ctx.el); if (col) col.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  if (ctx.query.open) openDetail(ctx.query.open);
}
