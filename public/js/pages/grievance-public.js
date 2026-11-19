import { html, render, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { post } from '../lib/api.js';
import { mountSiteChrome } from '../lib/site.js';
import { getConfig, mountCaptcha } from '../lib/captcha.js';
import { toastError, withLoading } from '../lib/ui.js';
import { grievanceForm, wireGrievanceForm, grievanceView, wireGrievanceView, EXTERNAL_AVENUES } from '../shared/grievance-ui.js';

const left = $('[data-left]');
const right = $('[data-right]');
let cfg; let me;

async function init() {
  me = await mountSiteChrome();
  cfg = await getConfig();
  const g = cfg.grievance;
  render($('[data-process]'), [
    ['send', 'Immediately', 'Submit', 'You get a ticket number straight away. Guests also get a private tracking key.'],
    ['checkCircle', `Within ${g.ackHours} hours`, 'Acknowledge', 'A person from the grievance desk acknowledges your ticket and starts the review.'],
    ['scale', `Within ${g.resolveDays} days`, 'Resolve', `Both sides are heard before a decision. Urgent safety issues (fees, harassment) target ${g.urgentResolveHours} hours.`],
    ['arrowUpCircle', `Within ${g.appealDays} days`, 'Escalate or reopen', 'Escalate to the Grievance Officer if a deadline passes or you disagree with the decision.'],
  ].map(([ic, time, title, text]) => html`<div class="card p-step">${icon(ic, { size: 22 })}<div class="p-time mt-8">${time}</div><h3>${title}</h3><p>${text}</p></div>`));
  drawLeft();
  drawRight();
  if (window.location.hash === '#track') $('#t-ticket')?.focus();
}

function drawLeft() {
  const user = me && me.user;
  render(left, html`<div class="card card-pad"><h2>File a grievance</h2>
    ${user ? html`<p class="muted">You’re signed in as <strong>${user.fullName}</strong>, so this grievance will be linked to your account and you can follow it from your dashboard.</p>`
    : html`<p class="muted">No account needed. If you have one, <a href="/login?next=/grievance-redressal">sign in</a> so your ticket appears in your dashboard.</p>`}
    <div data-form-slot></div></div>`);
  render($('[data-form-slot]'), grievanceForm({ cfg, user }));
  const form = $('[data-grievance-form]');
  const wire = (captcha) => wireGrievanceForm(form, { user, captcha, onDone: (res) => done(res, user) });
  if (!user) mountCaptcha($('[data-g-captcha]')).then(wire); else wire(null);
}

function done(res, user) {
  render(left, html`<div class="card card-pad">
    <div class="status-art ok">${icon('checkCircle', { size: 30 })}</div>
    <h2>Grievance submitted</h2>
    <p class="muted">We’ve emailed you a confirmation. Acknowledgement is due by <strong>${new Date(`${res.ackDueAt.replace(' ', 'T')}Z`).toLocaleString('en-GB')}</strong>.</p>
    <div class="ticket-box"><div class="subtle">Ticket number</div><div class="mono">${res.ticketNo}</div>
      ${res.accessKey ? html`<div class="subtle mt-8">Tracking key — keep this private</div><div class="mono">${res.accessKey}</div><p class="small mt-8 mb-0">${icon('alertTriangle', { size: 14 })} Save this key now. You need it, with the ticket number, to follow or reply to your grievance.</p>` : ''}
    </div>
    <div class="row wrap mt-16">${user ? html`<a class="btn btn-primary" href="${user.role === 'recruiter' ? '/recruiter' : '/app'}/grievances/${res.id}">Open my ticket</a>` : html`<button class="btn btn-primary" data-track-now>Track it now</button>`}<button class="btn" data-again>File another</button></div>
  </div>`);
  left.querySelector('[data-again]').addEventListener('click', drawLeft);
  const tn = left.querySelector('[data-track-now]');
  if (tn) tn.addEventListener('click', () => { $('#t-ticket').value = res.ticketNo; $('#t-key').value = res.accessKey; $('[data-track]').requestSubmit(); });
}

function drawRight() {
  render(right, html`
    <form class="card card-pad" data-track novalidate><h2 class="h3-size" id="track">${icon('search')} Track a grievance</h2>
      <p class="small muted">Use the ticket number and tracking key from your confirmation.</p>
      <div class="field"><label class="label" for="t-ticket">Ticket number</label><input class="input mono" id="t-ticket" name="ticketNo" placeholder="GRV-2026-00012" data-validate="required|min:5"><p class="field-error" data-for="ticketNo"></p></div>
      <div class="field mt-8"><label class="label" for="t-key">Tracking key</label><input class="input mono" id="t-key" name="accessKey" placeholder="XXXX-XXXX-XXXX" data-validate="required|min:8"><p class="field-error" data-for="accessKey"></p></div>
      <button class="btn btn-primary btn-block mt-16" type="submit">View status</button>
      ${me && me.user ? html`<p class="subtle mt-8 mb-0">Signed in? Your tickets are in <a href="${me.user.role === 'recruiter' ? '/recruiter' : me.user.role === 'admin' ? '/admin' : '/app'}/grievances">your dashboard</a>.</p>` : ''}
    </form>
    <div class="card card-pad"><h2 class="h3-size">${icon('user')} Grievance Officer</h2><p class="mb-0"><strong>${cfg.grievance.officerName}</strong><br><a href="mailto:${cfg.grievance.officerEmail}">${cfg.grievance.officerEmail}</a></p>
      <p class="subtle mt-8 mb-0">Handles escalations (Level 2) and publishes the <a href="/transparency">transparency report</a>.</p></div>
    <div class="card card-pad"><h2 class="h3-size">Other avenues</h2>${EXTERNAL_AVENUES}</div>`);
  const form = $('[data-track]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { validateForm } = await import('../lib/validate.js');
    if (!validateForm(form)) return;
    const key = form.accessKey.value.trim().toUpperCase();
    await withLoading(form.querySelector('button'), async () => {
      try {
        const g = await post('/api/grievances/track', { ticketNo: form.ticketNo.value.trim().toUpperCase(), accessKey: key });
        showTicket(g, key);
      } catch (err) { const { applyServerErrors } = await import('../lib/validate.js'); if (!applyServerErrors(form, err.fields)) toastError(err); }
    });
  });
}

function showTicket(g, key) {
  const grid = left.parentElement;
  right.hidden = true;
  grid.style.gridTemplateColumns = '1fr';
  const draw = (data) => {
    render(left, html`<div class="row between"><h2 class="mb-0">Your grievance</h2><button class="btn btn-sm" data-back>${icon('arrowLeft')} Back</button></div>${grievanceView(data)}`);
    left.querySelector('[data-back]').addEventListener('click', () => { right.hidden = false; grid.style.gridTemplateColumns = ''; drawLeft(); });
    wireGrievanceView(left, data, { reload: draw, guestKey: key });
    left.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  draw(g);
}

init();
