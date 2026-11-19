import { html, render, $, $$, formToObject } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { post, setCsrf } from '../lib/api.js';
import { validateForm, liveValidate, applyServerErrors, passwordScore } from '../lib/validate.js';
import { mountCaptcha, getConfig } from '../lib/captcha.js';
import { withLoading } from '../lib/ui.js';
import { combobox } from '../lib/combobox.js';
import { mountAuthChrome, alertBox, passwordToggle, PROMISE_POINTS } from './auth-common.js';

const FREE = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'zoho.com', 'gmx.com', 'mail.com', 'yandex.com'];
const YEAR = new Date().getFullYear();
const params = new URLSearchParams(window.location.search);
let role = params.get('as') === 'recruiter' ? 'recruiter' : 'student';
let captcha = null;
let institutions = null;
const main = $('[data-main]');

mountAuthChrome({
  title: 'Verified on both sides — that’s the HORIZON difference.',
  text: 'Students are verified through their Institution of National Importance. Recruiters are verified through their organisation. Everyone else stays out.',
  points: PROMISE_POINTS,
  topRight: html`<span class="muted small">Already registered? <a href="/login">Sign in</a></span>`,
});

/** Labelled progress through sign-up: account, email, proof (proof only when it is needed). */
export const registerSteps = (n, labels = ['Create account', 'Confirm email', 'Verify enrolment']) => html`<ol class="verify-steps" aria-label="Sign-up progress">${labels.map((l, i) => html`<li class="vs ${i + 1 < n ? 'done' : i + 1 === n ? 'current' : ''}" ${i + 1 === n ? html`aria-current="step"` : ''}>${l}<span class="sr-only">${i + 1 < n ? ' (done)' : i + 1 === n ? ' (current step)' : ''}</span></li>`)}</ol>`;

const field = (name, label, control, help = '', opt = false) => html`<div class="field"><label class="label" for="${name}">${label}${opt ? html`<span class="opt">(optional)</span>` : ''}</label>${control}${help ? html`<p class="help">${help}</p>` : ''}<p class="field-error" data-for="${name}"></p></div>`;
const passwordFields = () => html`
  ${field('password', 'Password', html`<div class="password-wrap"><input class="input" id="password" name="password" type="password" autocomplete="new-password" data-validate="required|password"><button type="button" class="btn btn-ghost btn-sm pw-toggle" data-toggle-password aria-controls="password">Show</button></div>
    <div class="strength mt-8" aria-hidden="true"><span data-strength></span></div>`, '10+ characters with upper- and lower-case letters and a number. A symbol makes it stronger.')}
  ${field('confirmPassword', 'Confirm password', html`<input class="input" id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" data-validate="required|match:password">`)}`;
const consent = () => html`
  <div class="field"><label class="check"><input type="checkbox" name="acceptTerms" data-validate="required" data-msg-required="You must accept the Terms of Use and Privacy Policy."><span>I accept the <a href="/terms" target="_blank" rel="noopener">Terms of Use</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span></label><p class="field-error" data-for="acceptTerms"></p></div>
  <div class="field"><span class="label">Security check</span><div class="captcha-box" data-captcha></div><p class="field-error" id="err-captcha"></p></div>`;

function studentForm() {
  return html`<form data-form novalidate>
    <p class="form-section-title">About you</p>
    ${field('fullName', 'Full name', html`<input class="input" id="fullName" name="fullName" autocomplete="name" data-validate="required|min:2|max:100|personname" placeholder="As on your institute ID">`)}
    ${field('email', 'Institutional email address', html`<input class="input" id="email" name="email" type="email" autocomplete="email" data-validate="required|email" placeholder="you@institute.ac.in">`, '', false)}
    <div data-email-hint></div>
    ${passwordFields()}
    <p class="form-section-title">Your institution</p>
    ${field('institutionSearch', 'Institution', html`<div class="combo"><input class="input" id="institutionSearch" placeholder="Search Institutions of National Importance" data-validate="required" data-msg-required="Select your institution from the list."><input type="hidden" name="institutionId" data-field="institutionId"></div>`, 'Only institutions declared Institutions of National Importance are eligible.')}
    <div class="form-grid">
      <div class="span-2">${field('programme', 'Academic programme', html`<input class="input" id="programme" name="programme" data-validate="required|min:2|max:120" placeholder="e.g. B.Tech Computer Science, IPM, MBA">`)}</div>
      ${field('academicLevel', 'Level of study', html`<select class="select" id="academicLevel" name="academicLevel" data-validate="required"><option value="">Select</option><option value="undergraduate">Undergraduate / integrated</option><option value="postgraduate">Postgraduate</option><option value="doctoral">Doctoral</option></select>`)}
      ${field('currentYear', 'Current year of study', html`<select class="select" id="currentYear" name="currentYear" data-validate="required"><option value="">Select</option>${[1, 2, 3, 4, 5, 6].map((y) => html`<option value="${y}">Year ${y}</option>`)}</select>`)}
      ${field('graduationYear', 'Expected graduation year', html`<select class="select" id="graduationYear" name="graduationYear" data-validate="required"><option value="">Select</option>${Array.from({ length: 8 }, (_, i) => YEAR + i).map((y) => html`<option value="${y}">${y}</option>`)}</select>`)}
    </div>
    ${consent()}
    <button class="btn btn-primary btn-lg btn-block" type="submit">Create student account</button>
  </form>`;
}

function recruiterForm(orgTypes) {
  return html`<form data-form novalidate>
    <div class="alert alert-info">${icon('info')}<div>Use your <strong>work email</strong>. Personal providers such as Gmail or Outlook can’t be verified. After confirming your email you’ll upload an authorisation letter or company registration document for review.</div></div>
    <p class="form-section-title">About you</p>
    ${field('fullName', 'Full name', html`<input class="input" id="fullName" name="fullName" autocomplete="name" data-validate="required|min:2|max:100|personname">`)}
    ${field('email', 'Work email address', html`<input class="input" id="email" name="email" type="email" autocomplete="email" data-validate="required|email" placeholder="you@company.com">`)}
    <div data-email-hint></div>
    ${field('designation', 'Designation', html`<input class="input" id="designation" name="designation" data-validate="required|min:2|max:100" placeholder="e.g. Campus Recruiting Manager">`)}
    ${passwordFields()}
    <p class="form-section-title">Your organisation</p>
    <div class="segmented" role="radiogroup" aria-label="Organisation">
      <label><input type="radio" name="organisationMode" value="existing" checked><span>Already on HORIZON</span></label>
      <label><input type="radio" name="organisationMode" value="new"><span>Register a new organisation</span></label>
    </div>
    <div data-org-existing>${field('orgSearch', 'Organisation', html`<div class="combo"><input class="input" id="orgSearch" placeholder="Search verified organisations" data-validate="requiredif:organisationMode=existing" data-msg-required="Select your organisation."><input type="hidden" name="organisationId" data-field="organisationId"></div>`)}</div>
    <div data-org-new hidden>
      <div class="form-grid">
        <div class="span-2">${field('organisation.name', 'Organisation name', html`<input class="input" id="organisation.name" name="organisation.name" data-validate="required|min:2|max:120">`)}</div>
        <div class="span-2">${field('organisation.website', 'Official website', html`<input class="input" id="organisation.website" name="organisation.website" type="url" placeholder="https://www.company.com" data-validate="required|url">`, 'We match your email domain to this website.')}</div>
        ${field('organisation.orgType', 'Organisation type', html`<select class="select" id="organisation.orgType" name="organisation.orgType" data-validate="required"><option value="">Select</option>${orgTypes.map((t) => html`<option>${t}</option>`)}</select>`)}
        ${field('organisation.country', 'Country', html`<input class="input" id="organisation.country" name="organisation.country" data-validate="required|min:2|max:60" placeholder="e.g. Singapore">`)}
        ${field('organisation.headquarters', 'Headquarters city', html`<input class="input" id="organisation.headquarters" name="organisation.headquarters" data-validate="max:100">`, '', true)}
        ${field('organisation.linkedinUrl', 'LinkedIn page', html`<input class="input" id="organisation.linkedinUrl" name="organisation.linkedinUrl" type="url" data-validate="url" placeholder="https://www.linkedin.com/company/…">`, '', true)}
      </div>
    </div>
    <div class="field"><label class="check"><input type="checkbox" name="authorisedRepresentative" data-validate="required" data-msg-required="Confirm that you are authorised to recruit for this organisation."><span>I am authorised to recruit on behalf of this organisation, and I will never ask candidates to pay any fee.</span></label><p class="field-error" data-for="authorisedRepresentative"></p></div>
    ${consent()}
    <button class="btn btn-primary btn-lg btn-block" type="submit">Create recruiter account</button>
  </form>`;
}

async function draw() {
  const cfg = await getConfig().catch(() => ({}));
  const orgTypes = (cfg && cfg.lists && cfg.lists.orgTypes) || ['Corporate', 'Startup', 'NGO', 'Research Institute', 'Financial Services', 'Technology', 'Consulting'];
  render(main, html`${registerSteps(1)}<h1>Join HORIZON</h1><p class="lead">Create your account. Verification takes a few minutes for most students.</p>
    <div class="role-tabs" role="tablist" aria-label="Account type">
      <button class="role-tab" role="tab" type="button" aria-selected="${String(role === 'student')}" data-role="student">${icon('graduation', { size: 22 })}<div><strong>I’m a student</strong><span>At an Institution of National Importance</span></div></button>
      <button class="role-tab" role="tab" type="button" aria-selected="${String(role === 'recruiter')}" data-role="recruiter">${icon('building', { size: 22 })}<div><strong>I’m a recruiter</strong><span>Hiring international interns</span></div></button>
    </div>
    <div data-alert></div>
    ${role === 'student' ? studentForm() : recruiterForm(orgTypes)}`);
  $$('[data-role]', main).forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const targetRole = b.dataset.role;
    if (targetRole && targetRole !== role) {
      role = targetRole;
      history.replaceState(null, '', role === 'recruiter' ? '?as=recruiter' : '/register');
      draw();
    }
  }));
  const form = $('[data-form]', main);
  liveValidate(form);
  passwordToggle($('[data-toggle-password]', form), $('#password', form));
  const pw = $('#password', form);
  pw.addEventListener('input', () => {
    const s = passwordScore(pw.value);
    const bar = $('[data-strength]', form);
    bar.style.width = `${(s / 4) * 100}%`;
    bar.style.background = ['var(--error)', 'var(--error)', 'var(--warning)', 'var(--teal)', 'var(--success)'][s];
  });
  captcha = await mountCaptcha($('[data-captcha]', form));
  if (role === 'student') wireStudent(form); else wireRecruiter(form);
  form.addEventListener('submit', (e) => submit(e, form));
}

async function wireStudent(form) {
  if (!institutions) institutions = (await (await fetch('/api/public/institutions')).json()).items;
  const hidden = form.querySelector('[name=institutionId]');
  const input = $('#institutionSearch', form);
  combobox({
    input, hidden,
    search: async (q) => {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      return institutions.filter((i) => terms.every((t) => `${i.name} ${i.shortName || ''} ${i.city || ''}`.toLowerCase().includes(t)))
        .slice(0, 40).map((i) => ({ value: i.id, label: i.name, sub: i.shortName || i.category }));
    },
    onSelect: () => { input.dispatchEvent(new Event('input')); hint(form); },
    emptyText: 'Not found. Only Institutions of National Importance are eligible.',
  });
  input.addEventListener('input', () => {
    const err = $('#err-institutionSearch', form);
    if (err) err.textContent = '';
    input.removeAttribute('aria-invalid');
  });
  $('#email', form).addEventListener('input', () => hint(form));
}

function hint(form) {
  const email = $('#email', form).value.trim().toLowerCase();
  const box = $('[data-email-hint]', form);
  const domain = email.includes('@') ? email.split('@')[1] : '';
  if (!domain || !domain.includes('.')) return render(box, '');
  if (role === 'recruiter') {
    return render(box, FREE.includes(domain) ? html`<p class="field-error">${icon('alertCircle', { size: 14 })} Personal email providers can’t be verified for recruiters — use your work email.</p>` : '');
  }
  const owner = (institutions || []).find((i) => i.domains.some((d) => domain === d || domain.endsWith(`.${d}`)));
  const selected = Number(form.querySelector('[name=institutionId]').value);
  if (owner && selected && owner.id !== selected) return render(box, html`<p class="field-error">${icon('alertCircle', { size: 14 })} This email belongs to ${owner.name}. Select that institution or use your own institute email.</p>`);
  if (owner) return render(box, html`<p class="help text-success">${icon('checkCircle', { size: 14 })} Recognised ${owner.shortName || owner.name} domain — you’ll be verified automatically once you confirm your email.</p>`);
  return render(box, html`<p class="help">${icon('info', { size: 14 })} We don’t have a verified domain for this email yet. After confirming it, you’ll upload your student ID for a quick manual review.</p>`);
}

function wireRecruiter(form) {
  const toggle = () => {
    const mode = form.querySelector('[name=organisationMode]:checked').value;
    $('[data-org-existing]', form).hidden = mode !== 'existing';
    $('[data-org-new]', form).hidden = mode !== 'new';
  };
  $$('[name=organisationMode]', form).forEach((r) => r.addEventListener('change', toggle));
  combobox({
    input: $('#orgSearch', form), hidden: form.querySelector('[name=organisationId]'),
    search: async (q) => (await (await fetch(`/api/public/organisations?q=${encodeURIComponent(q)}`)).json()).items.map((o) => ({ value: o.id, label: o.name, sub: `@${o.emailDomain}` })),
    onSelect: () => $('#orgSearch', form).dispatchEvent(new Event('input')),
    emptyText: 'Not found — choose “Register a new organisation”.',
  });
  $('#email', form).addEventListener('input', () => hint(form));
}

async function submit(e, form) {
  e.preventDefault();
  const alertEl = $('[data-alert]', main);
  render(alertEl, '');
  const ok = validateForm(form);
  const token = captcha && captcha.getToken();
  $('#err-captcha', form).textContent = token ? '' : 'Please complete the security check.';
  if (!ok || !token) return;
  const values = formToObject(form);
  const typedInst = ($('#institutionSearch', form)?.value || '').trim().toLowerCase();
  delete values.institutionSearch; delete values.orgSearch;
  const body = { ...values, accountType: role, captchaToken: token };
  if (role === 'student') {
    let instId = Number(body.institutionId);
    if ((!instId || isNaN(instId) || instId <= 0) && typedInst && institutions) {
      const match = institutions.find((i) => i.name.toLowerCase() === typedInst)
        || institutions.find((i) => (i.shortName && i.shortName.toLowerCase() === typedInst))
        || institutions.find((i) => i.name.toLowerCase().includes(typedInst) || typedInst.includes(i.name.toLowerCase()));
      if (match) {
        instId = match.id;
        const hiddenInst = form.querySelector('[name=institutionId]');
        if (hiddenInst) hiddenInst.value = match.id;
        const inputInst = $('#institutionSearch', form);
        if (inputInst) inputInst.value = match.name;
      }
    }
    if (!instId || isNaN(instId) || instId <= 0) {
      const errEl = $('#err-institutionSearch', form);
      if (errEl) errEl.textContent = 'Please select your institution from the approved list.';
      const inputInst = $('#institutionSearch', form);
      if (inputInst) { inputInst.setAttribute('aria-invalid', 'true'); inputInst.focus(); }
      return;
    }
    body.institutionId = instId;
    body.currentYear = Number(body.currentYear);
    body.graduationYear = Number(body.graduationYear);
  }
  else {
    if (body.organisationMode === 'existing') { body.organisationId = Number(body.organisationId); delete body.organisation; }
    else delete body.organisationId;
  }
  await withLoading(form.querySelector('button[type=submit]'), async () => {
    try {
      const data = await post('/api/auth/register', body);
      setCsrf(data.csrfToken);
      window.location.assign('/verify');
    } catch (err) {
      if (captcha) captcha.reset();
      const fields = { ...err.fields };
      if (fields.institutionId) fields.institutionSearch = fields.institutionId;
      if (fields.organisationId) fields.orgSearch = fields.organisationId;
      if (fields.captchaToken) $('#err-captcha', form).textContent = fields.captchaToken;
      if (!applyServerErrors(form, fields)) render(alertEl, alertBox('error', err.message, 'We couldn’t create your account'));
    }
  });
}

draw();
