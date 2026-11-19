import { html, render, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { get, post, upload, setCsrf } from '../lib/api.js';
import { fmtDateTime, bytes } from '../lib/format.js';
import { getConfig } from '../lib/captcha.js';
import { toast, withLoading } from '../lib/ui.js';
import { mountAuthChrome, alertBox, PROMISE_POINTS } from './auth-common.js';

const main = $('[data-main]');
let state = null;
let cfg = null;

mountAuthChrome({
  title: 'Verification keeps HORIZON trustworthy for everyone.',
  text: 'Students prove enrolment at an Institution of National Importance. Recruiters prove they represent a real organisation. It only takes a few minutes.',
  points: PROMISE_POINTS,
});

function steps(n) {
  const third = state && state.user && state.user.role === 'recruiter' ? 'Verify organisation' : 'Verify enrolment';
  const cur = Math.min(n + 1, 3); // 1 = confirm email, 2 = upload proof, 3 = proof under review
  return html`<ol class="verify-steps" aria-label="Sign-up progress">${['Create account', 'Confirm email', third].map((l, i) => html`<li class="vs ${i + 1 < cur ? 'done' : i + 1 === cur ? 'current' : ''}" ${i + 1 === cur ? html`aria-current="step"` : ''}>${l}<span class="sr-only">${i + 1 < cur ? ' (done)' : i + 1 === cur ? ' (current step)' : ''}</span></li>`)}</ol>`;
}

function signedInAs() {
  return html`<p class="subtle mt-24">Signed in as <strong>${state.user.email}</strong> · <button class="link-btn small" data-logout>Sign out</button> · <a href="/grievance-redressal">Need help?</a></p>`;
}

async function load() {
  const me = await get('/api/auth/me');
  if (!me.user) { window.location.assign('/login?next=/verify'); return; }
  setCsrf(me.csrfToken);
  state = me;
  cfg = cfg || await getConfig();
  if (me.next !== '/verify') { window.location.assign(me.next); return; }
  draw();
}

function draw() {
  const v = state.verification;
  const u = state.user;
  if (v.needsEmail) return drawEmail(u);
  if (v.pendingRequest) return drawPending(u, v);
  return drawProof(u, v);
}

function drawEmail(u) {
  render(main, html`${steps(1)}
    <div class="status-art info">${icon('mail', { size: 30 })}</div>
    <h1>Confirm your email</h1>
    <p class="lead">We sent a 6-digit code to <strong>${u.email}</strong>. It expires in 15 minutes.</p>
    <div data-alert></div>
    <form data-otp novalidate>
      <div class="field"><label class="label" for="code">Verification code</label>
        <input class="input input-otp" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-describedby="code-help"><p class="help" id="code-help">Six digits, from the email we just sent.</p>
        <p class="field-error" data-for="code"></p></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Verify email</button>
    </form>
    <div class="row between wrap mt-16"><span class="subtle">Didn’t get it? Check spam, or</span><button class="btn btn-sm" data-resend aria-describedby="resend-status">Resend code</button></div>
    <p class="help mt-8" id="resend-status" role="status" aria-live="polite"></p>
    ${cfg.devMailbox ? html`<div class="card card-pad mt-24 devmail" data-devmail>
      <div class="row between"><strong class="small">${icon('inbox', { size: 16 })} Development mailbox</strong><span class="badge badge-demo">Dev only</span></div>
      <p class="subtle mt-8 mb-8">No SMTP server is configured, so emails are shown here instead of being sent.</p><div data-devmail-body class="small"></div></div>` : ''}
    ${signedInAs()}`);
  const form = $('[data-otp]', main);
  const input = $('#code', main);
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); input.removeAttribute('aria-invalid'); $('.field-error', form).textContent = ''; });
  input.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(input.value)) { input.setAttribute('aria-invalid', 'true'); $('.field-error', form).textContent = 'Enter the 6-digit code from the email.'; return; }
    await withLoading(form.querySelector('button'), async () => {
      try {
        const data = await post('/api/auth/verify-email', { code: input.value });
        state = data;
        if (data.next !== '/verify') { toast('Email confirmed — you’re verified. Welcome to HORIZON.'); setTimeout(() => window.location.assign(data.next), 700); return; }
        toast('Email confirmed.');
        draw();
      } catch (err) {
        input.setAttribute('aria-invalid', 'true');
        $('.field-error', form).textContent = (err.fields && err.fields.code) || err.message;
      }
    });
  });
  const resend = $('[data-resend]', main);
  resend.addEventListener('click', async () => {
    await withLoading(resend, async () => {
      try { const r = await post('/api/auth/resend-code', {}); toast(r.message); refreshDevMail(); } catch (err) { render($('[data-alert]', main), alertBox('error', err.message)); }
    });
    // Cooldown indicator only; the server keeps its own limits.
    let n = 60;
    const status = $('#resend-status', main);
    resend.disabled = true;
    resend.textContent = `Resend in ${n}s`;
    if (status) status.textContent = 'A new code was requested. You can ask again in one minute.';
    const t = setInterval(() => { n -= 1; resend.textContent = n > 0 ? `Resend in ${n}s` : 'Resend code'; if (n <= 0) { clearInterval(t); resend.disabled = false; if (status) status.textContent = 'You can request another code now.'; } }, 1000);
  });
  refreshDevMail();
}

async function refreshDevMail() {
  const body = $('[data-devmail-body]', main);
  if (!body) return;
  try {
    const { messages } = await get('/api/auth/dev-mailbox');
    const latest = messages[0];
    const code = latest && (latest.subject.match(/\b\d{6}\b/) || [])[0];
    render(body, latest ? html`<div><strong>${latest.subject}</strong></div><div class="subtle">${fmtDateTime(latest.created_at)}</div>${code ? html`<button class="btn btn-sm mt-8" data-fill="${code}">Use code ${code}</button>` : ''}` : html`<span class="subtle">No messages yet.</span>`);
    const fill = body.querySelector('[data-fill]');
    if (fill) fill.addEventListener('click', () => { $('#code', main).value = fill.dataset.fill; $('#code', main).focus(); });
  } catch { render(body, html`<span class="subtle">Mailbox unavailable.</span>`); }
}

function drawProof(u, v) {
  const isStudent = u.role === 'student';
  const rejected = v.lastDecision && v.lastDecision.status === 'rejected';
  render(main, html`${steps(2)}
    <div class="status-art ${rejected ? 'bad' : 'wait'}">${icon(rejected ? 'alertCircle' : 'fileCheck', { size: 30 })}</div>
    <h1>${rejected ? 'Please resubmit your proof' : isStudent ? 'Verify your enrolment' : 'Verify your organisation'}</h1>
    ${rejected ? alertBox('error', v.lastDecision.message || 'Your previous submission could not be verified.', 'Reason from the verification team') : ''}
    <p class="lead">${isStudent
    ? html`Your email is confirmed, but we don’t have a verified email domain for <strong>${u.institution ? u.institution.name : 'your institution'}</strong>. Upload your student ID card or a bonafide certificate so our team can confirm your enrolment.`
    : html`Your work email is confirmed. Upload an <strong>authorisation letter on company letterhead</strong> or a <strong>company registration certificate</strong> for <strong>${u.organisation ? u.organisation.name : 'your organisation'}</strong>.`}</p>
    <div data-alert></div>
    <form data-proof novalidate class="stack">
      <div class="field">
        <span class="label">Proof document</span>
        <label class="dropzone" data-drop tabindex="0">
          ${icon('upload', { size: 26 })}
          <div class="strong mt-8" data-drop-label>Choose a file or drag it here</div>
          <div class="subtle">PDF, JPG or PNG · up to ${cfg.uploads.proofMaxMb} MB</div>
          <input type="file" name="document" accept=".pdf,.png,.jpg,.jpeg" hidden data-validate="required|filetype:pdf,png,jpg,jpeg|maxsize:${cfg.uploads.proofMaxMb}">
        </label>
        <p class="field-error" data-for="document"></p>
      </div>
      ${!isStudent ? html`<div class="field"><label class="label" for="registrationNumber">Company registration number <span class="opt">(recommended)</span></label><input class="input" id="registrationNumber" name="registrationNumber" maxlength="60" placeholder="e.g. CIN, EIN or Companies House number"><p class="field-error" data-for="registrationNumber"></p></div>` : ''}
      <div class="field"><label class="label" for="note">Note for the reviewer <span class="opt">(optional)</span></label><textarea class="textarea" id="note" name="note" maxlength="1000" rows="3" placeholder="${isStudent ? 'e.g. My institute email is on a different domain' : 'Anything that helps us verify your organisation'}"></textarea></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Submit for review</button>
    </form>
    <p class="subtle mt-16">${icon('lock', { size: 14 })} Stored privately. Only the HORIZON verification team can open this file.</p>
    ${signedInAs()}`);
  const form = $('[data-proof]', main);
  const fileInput = form.querySelector('input[type=file]');
  const drop = $('[data-drop]', form);
  const label = $('[data-drop-label]', form);
  const pick = () => { if (fileInput.files[0]) { label.textContent = `${fileInput.files[0].name} · ${bytes(fileInput.files[0].size)}`; $('[data-for=document]', form).textContent = ''; } };
  fileInput.addEventListener('change', pick);
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) { fileInput.files = e.dataTransfer.files; pick(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { validateForm } = await import('../lib/validate.js');
    if (!validateForm(form)) return;
    const fd = new FormData();
    fd.append('document', fileInput.files[0]);
    if (form.note.value.trim()) fd.append('note', form.note.value.trim());
    if (form.registrationNumber && form.registrationNumber.value.trim()) fd.append('registrationNumber', form.registrationNumber.value.trim());
    await withLoading(form.querySelector('button[type=submit]'), async () => {
      try {
        state = await upload('/api/auth/verification-proof', fd);
        toast('Submitted for review.');
        draw();
      } catch (err) {
        const msg = (err.fields && (err.fields.document || err.fields.note)) || err.message;
        render($('[data-alert]', main), alertBox('error', msg));
      }
    });
  });
}

function drawPending(u, v) {
  render(main, html`${steps(3)}
    <div class="status-art wait">${icon('clock', { size: 30 })}</div>
    <h1>Your verification is under review</h1>
    <p class="lead">Thanks, ${u.firstName}. We received your ${u.role === 'student' ? 'student ID' : 'organisation documents'} on ${fmtDateTime(v.pendingRequest.createdAt)}. You’ll get an in-app notification and an email when a decision is made.</p>
    <div class="card card-pad">
      <h3 class="label-caps">What we check</h3>
      <ul class="check-list mt-8">${(u.role === 'student'
    ? ['Your name matches the ID document', `The document is from ${u.institution ? u.institution.name : 'your institution'}`, 'Your enrolment is current for the stated programme and year']
    : ['Your work email domain matches the organisation', 'The authorisation or registration document is genuine', 'The organisation is a real, operating entity']).map((t) => html`<li>${icon('checkCircle', { cls: 'pass' })}<span class="cl-detail" style="color:var(--text);font-size:.9rem">${t}</span></li>`)}</ul>
    </div>
    <div class="row wrap mt-24"><button class="btn" data-refresh>${icon('refresh')} Check status</button><a class="btn btn-ghost" href="/grievance-redressal">Raise a concern</a></div>
    ${signedInAs()}`);
  $('[data-refresh]', main).addEventListener('click', load);
}

main.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-logout]')) return;
  await post('/api/auth/logout', {});
  window.location.assign('/login?signedout=1');
});

load().catch((err) => render(main, alertBox('error', err.message, 'Something went wrong')));
// Keep the status fresh while waiting for a decision.
setInterval(() => { if (state && state.verification && state.verification.pendingRequest && document.visibilityState === 'visible') load().catch(() => {}); }, 30000);
