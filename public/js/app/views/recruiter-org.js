import { html, render, $, formToObject } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, put } from '../../lib/api.js';
import { orgAvatar } from '../../lib/components.js';
import { toast, toastError, withLoading } from '../../lib/ui.js';
import { validateForm, liveValidate, applyServerErrors } from '../../lib/validate.js';
import { fmtDate } from '../../lib/format.js';
import { pageHeader, field } from '../shared.js';

export default async function recruiterOrg(ctx) {
  ctx.setTitle('Organisation profile');
  ctx.setCrumbs([{ label: 'Organisation Profile' }]);
  const o = await get('/api/recruiter/organisation');
  const verified = o.verificationStatus === 'verified';
  render(ctx.el, html`${pageHeader({
    title: 'Organisation profile',
    subtitle: 'Shown to students on your listings and organisation page.',
    actions: html`<a class="btn" href="/recruiter/organisations/${o.id}">${icon('eye')} Preview public page</a>`,
  })}
  <div class="detail">
    <form class="card" data-form novalidate>
      <div class="card-header"><div class="row">${orgAvatar(o)}<div><h2 class="mb-0">${o.name}</h2><div class="subtle">${o.type}</div></div></div>
        ${verified ? html`<span class="badge badge-teal">${icon('shieldCheck')} Verified ${o.verifiedAt ? fmtDate(o.verifiedAt) : ''}</span>` : html`<span class="badge badge-warning">Verification pending</span>`}</div>
      <div class="card-body"><div class="form-grid">
        ${field('name', 'Legal name', html`<input class="input" id="f-name" value="${o.name}" disabled>`, { help: 'Verified identity details can only be changed through the grievance desk.' })}
        ${field('emailDomain', 'Recruiter email domain', html`<input class="input" id="f-emailDomain" value="@${o.emailDomain}" disabled>`)}
        ${field('website', 'Official website', html`<input class="input" type="url" id="f-website" name="website" value="${o.website || ''}" ${verified ? 'disabled' : ''} data-validate="url">`, { help: verified ? 'Locked after verification.' : '' })}
        ${field('linkedinUrl', 'LinkedIn page', html`<input class="input" type="url" id="f-linkedinUrl" name="linkedinUrl" value="${o.linkedinUrl || ''}" data-validate="url">`, { optional: true })}
        ${field('headquarters', 'Headquarters city', html`<input class="input" id="f-headquarters" name="headquarters" value="${o.headquarters || ''}" data-validate="max:100">`, { optional: true })}
        ${field('country', 'Country', html`<input class="input" id="f-country" name="country" value="${o.country || ''}" data-validate="required|min:2|max:60">`)}
        ${field('description', 'About the organisation', html`<textarea class="textarea" id="f-description" name="description" rows="6" maxlength="3000" data-validate="max:3000" placeholder="What you do, where interns sit, and what they learn.">${o.description || ''}</textarea>`, { span: true })}
      </div></div>
      <div class="card-body" style="border-top:1px solid var(--border);display:flex;justify-content:flex-end"><button class="btn btn-primary" type="submit">${icon('check')} Save changes</button></div>
    </form>
    <aside class="aside-sticky"><section class="card card-pad"><h3>${icon('shieldCheck')} Why verification matters</h3>
      <p class="small muted">Students only see “Apply on HORIZON” on listings from verified organisations. Verification checks your email domain against your official website and reviews a registration document.</p>
      ${o.registrationNumber ? html`<div class="subtle small">Registration no. on file: <strong>${o.registrationNumber}</strong></div>` : ''}
      ${o.isDemo ? html`<div class="alert alert-demo mt-16">${icon('info')}<div>This is a fictional demo organisation.</div></div>` : ''}</section></aside>
  </div>`);
  const form = $('[data-form]', ctx.el);
  liveValidate(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(form)) return;
    const v = formToObject(form);
    if (verified) v.website = o.website;
    await withLoading(form.querySelector('[type=submit]'), async () => {
      try { await put('/api/recruiter/organisation', v); toast('Organisation profile saved.'); } catch (err) { if (!applyServerErrors(form, err.fields)) toastError(err); }
    });
  });
}
