import { html, render, $, $$, formToObject } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, post, put } from '../../lib/api.js';
import { toast, tagInput, mountTagInputs, withLoading } from '../../lib/ui.js';
import { validateForm, liveValidate, applyServerErrors } from '../../lib/validate.js';
import { pageHeader, field } from '../shared.js';

const COUNTRIES = ['Australia', 'Canada', 'France', 'Germany', 'Hong Kong', 'India', 'Ireland', 'Japan', 'Netherlands', 'New Zealand', 'Singapore', 'South Korea', 'Sweden', 'Switzerland', 'United Arab Emirates', 'United Kingdom', 'United States'];

export default async function listingForm(ctx) {
  const isAdmin = ctx.role === 'admin';
  const editing = !!ctx.params.id;
  const listBase = isAdmin ? '/admin/internships' : '/recruiter/listings';
  ctx.setTitle(editing ? 'Edit listing' : isAdmin ? 'Add internship' : 'Post a listing');
  const [o, orgs] = await Promise.all([
    editing ? get(`/api/opportunities/${ctx.params.id}`) : Promise.resolve(null),
    isAdmin ? get('/api/admin/organisations', { pageSize: 200 }).then((r) => r.items) : Promise.resolve([]),
  ]);
  ctx.setCrumbs([{ label: isAdmin ? 'Manage Internships' : 'My Listings', href: listBase }, { label: editing ? `Edit: ${o.title}` : isAdmin ? 'Add internship' : 'Post a listing' }]);
  if (editing) ctx.setActive(listBase);
  const v = o || { academicLevel: 'any', eligibleYears: [], workMode: 'onsite', isPaid: true, visaSponsorship: 'case_by_case', applicationMode: isAdmin ? 'external' : 'horizon', skills: [], stipend: null };
  const sel = (a, b) => (a === b ? 'selected' : '');
  const orgVerified = isAdmin ? null : ctx.user.organisation.verified;

  render(ctx.el, html`${pageHeader({
    title: editing ? 'Edit listing' : isAdmin ? 'Add an internship listing' : 'Post a listing',
    subtitle: isAdmin ? 'Admin-curated listings should come from a genuine source. Add the source link and the date you verified it.' : 'Listings are reviewed by HORIZON before they go live. Edits to a live listing are re-reviewed.',
  })}
  ${!isAdmin && editing && o.status === 'published' ? html`<div class="alert alert-warning mb-16">${icon('info')}<div>This listing is live. Saving changes sends it back for a quick review, and it’s hidden from students until approved.</div></div>` : ''}
  ${editing && o.reviewNote ? html`<div class="alert alert-error mb-16">${icon('alertCircle')}<div><div class="alert-title">Reviewer’s note</div>${o.reviewNote}</div></div>` : ''}
  <form class="stack gap-5" data-listing novalidate>
    <section class="card"><div class="card-header"><h2>${icon('briefcase')} The role</h2></div><div class="card-body"><div class="form-grid">
      ${isAdmin ? field('organisationId', 'Organisation', html`<select class="select" id="f-organisationId" name="organisationId" data-validate="required"><option value="">Select an organisation</option>${orgs.map((g) => html`<option value="${g.id}" ${o && o.organisation.id === g.id ? 'selected' : ''}>${g.name}${g.verificationStatus === 'verified' ? ' ✓' : ''}</option>`)}</select>`, { span: true, help: html`Missing? <a href="/admin/organisations">Add the organisation first</a>. ✓ = verified organisation.` }) : ''}
      ${field('title', 'Internship title', html`<input class="input" id="f-title" name="title" value="${v.title || ''}" maxlength="120" data-validate="required|min:5|max:120" placeholder="e.g. Strategy Consulting Summer Intern">`, { span: true })}
      ${field('industry', 'Industry', html`<select class="select" id="f-industry" name="industry" data-validate="required"><option value="">Select</option>${ctx.cfg.lists.industries.map((i) => html`<option ${sel(v.industry, i)}>${i}</option>`)}</select>`)}
      ${field('workMode', 'Work arrangement', html`<select class="select" id="f-workMode" name="workMode"><option value="onsite" ${sel(v.workMode, 'onsite')}>On-site</option><option value="hybrid" ${sel(v.workMode, 'hybrid')}>Hybrid</option><option value="remote" ${sel(v.workMode, 'remote')}>Remote</option></select>`)}
      ${field('summary', 'Short description', html`<textarea class="textarea" id="f-summary" name="summary" rows="2" maxlength="280" data-validate="required|min:20|max:280" placeholder="One or two sentences shown on listing cards">${v.summary || ''}</textarea>`, { span: true })}
      ${field('description', 'Full description', html`<textarea class="textarea" id="f-description" name="description" rows="7" maxlength="8000" data-validate="required|min:50|max:8000">${v.description || ''}</textarea>`, { span: true })}
      ${field('responsibilities', 'Responsibilities', html`<textarea class="textarea" id="f-responsibilities" name="responsibilities" rows="4" maxlength="4000" data-validate="max:4000" placeholder="One per line">${v.responsibilities || ''}</textarea>`, { span: true, optional: true })}
      ${field('skills', 'Required skills', tagInput({ name: 'skills', values: v.skills || [], placeholder: 'Add a skill and press Enter' }), { span: true })}
    </div></div></section>

    <section class="card"><div class="card-header"><h2>${icon('graduation')} Eligibility</h2></div><div class="card-body"><div class="form-grid">
      ${field('academicLevel', 'Level of study', html`<select class="select" id="f-academicLevel" name="academicLevel"><option value="any" ${sel(v.academicLevel, 'any')}>Any level</option><option value="undergraduate" ${sel(v.academicLevel, 'undergraduate')}>Undergraduate</option><option value="postgraduate" ${sel(v.academicLevel, 'postgraduate')}>Postgraduate</option><option value="doctoral" ${sel(v.academicLevel, 'doctoral')}>Doctoral</option></select>`)}
      <fieldset class="fieldset field"><legend class="label">Open to years of study <span class="opt">(none = all)</span></legend><div class="row wrap gap-4">${[1, 2, 3, 4, 5, 6].map((y) => html`<label class="check"><input type="checkbox" name="eligibleYears" data-group data-num value="${y}" ${(v.eligibleYears || []).includes(y) ? 'checked' : ''}><span>Year ${y}</span></label>`)}</div></fieldset>
      ${field('eligibility', 'Eligibility criteria', html`<textarea class="textarea" id="f-eligibility" name="eligibility" rows="3" maxlength="2000" data-validate="max:2000">${v.eligibility || ''}</textarea>`, { optional: true })}
      ${field('academicRequirements', 'Academic requirements', html`<textarea class="textarea" id="f-academicRequirements" name="academicRequirements" rows="3" maxlength="2000" data-validate="max:2000">${v.academicRequirements || ''}</textarea>`, { optional: true })}
      ${field('requiredDocuments', 'Required documents', html`<input class="input" id="f-requiredDocuments" name="requiredDocuments" maxlength="1000" value="${v.requiredDocuments || ''}" data-validate="max:1000" placeholder="e.g. CV and cover note">`, { span: true, optional: true })}
    </div></div></section>

    <section class="card"><div class="card-header"><h2>${icon('mapPin')} Location &amp; dates</h2></div><div class="card-body"><div class="form-grid">
      ${field('country', 'Country', html`<input class="input" id="f-country" name="country" list="countries" value="${v.country || ''}" data-validate="required|min:2|max:60"><datalist id="countries">${COUNTRIES.map((c) => html`<option value="${c}"></option>`)}</datalist>`)}
      ${field('city', 'City', html`<input class="input" id="f-city" name="city" value="${v.city || ''}" data-validate="required|max:80">`)}
      ${field('durationWeeks', 'Duration (weeks)', html`<input class="input" type="number" min="1" max="104" step="1" id="f-durationWeeks" name="durationWeeks" value="${v.durationWeeks || ''}" data-validate="required|int|between:1-104">`)}
      ${field('applicationDeadline', 'Application deadline', html`<input class="input" type="date" id="f-applicationDeadline" name="applicationDeadline" value="${v.deadline || ''}" data-validate="required|date${editing ? '' : '|future'}">`)}
      ${field('startDate', 'Start date', html`<input class="input" type="date" id="f-startDate" name="startDate" value="${v.startDate || ''}" data-validate="date">`, { optional: true })}
      ${field('endDate', 'End date', html`<input class="input" type="date" id="f-endDate" name="endDate" value="${v.endDate || ''}" data-validate="date|after:startDate">`, { optional: true })}
    </div></div></section>

    <section class="card"><div class="card-header"><h2>${icon('banknote')} Compensation &amp; support</h2></div><div class="card-body"><div class="form-grid">
      <fieldset class="fieldset field span-2"><legend class="label">Is the internship paid?</legend><div class="segmented"><label><input type="radio" name="isPaid" value="true" ${v.isPaid ? 'checked' : ''}><span>Paid</span></label><label><input type="radio" name="isPaid" value="false" ${!v.isPaid ? 'checked' : ''}><span>Unpaid</span></label></div></fieldset>
      <div data-paid class="span-2 form-grid" ${v.isPaid ? '' : 'hidden'}>
        ${field('stipendAmount', 'Monthly stipend', html`<input class="input" type="number" min="1" step="any" id="f-stipendAmount" name="stipendAmount" value="${v.stipend ? v.stipend.amount : ''}" data-validate="requiredif:isPaid=true|number|positive">`)}
        ${field('stipendCurrency', 'Currency', html`<select class="select" id="f-stipendCurrency" name="stipendCurrency" data-validate="requiredif:isPaid=true"><option value="">Select</option>${ctx.cfg.lists.currencies.map((c) => html`<option ${v.stipend && v.stipend.currency === c ? 'selected' : ''}>${c}</option>`)}</select>`)}
      </div>
      ${field('visaSponsorship', 'Visa sponsorship', html`<select class="select" id="f-visaSponsorship" name="visaSponsorship"><option value="yes" ${sel(v.visaSponsorship, 'yes')}>Yes — sponsorship offered</option><option value="case_by_case" ${sel(v.visaSponsorship, 'case_by_case')}>Case by case</option><option value="not_required" ${sel(v.visaSponsorship, 'not_required')}>Not required (remote)</option><option value="no" ${sel(v.visaSponsorship, 'no')}>No sponsorship</option></select>`)}
      ${field('visaDetails', 'Visa details', html`<input class="input" id="f-visaDetails" name="visaDetails" maxlength="1000" value="${v.visaDetails || ''}" data-validate="max:1000" placeholder="What the employer does, without promising outcomes">`, { optional: true })}
      ${field('relocationSupport', 'Relocation support', html`<input class="input" id="f-relocationSupport" name="relocationSupport" maxlength="500" value="${v.relocationSupport || ''}" data-validate="max:500">`, { optional: true })}
      ${field('accommodationSupport', 'Accommodation support', html`<input class="input" id="f-accommodationSupport" name="accommodationSupport" maxlength="500" value="${v.accommodationSupport || ''}" data-validate="max:500">`, { optional: true })}
    </div></div></section>

    <section class="card"><div class="card-header"><h2>${icon('send')} Applications</h2></div><div class="card-body stack">
      <fieldset class="fieldset field"><legend class="label">How do students apply?</legend><div class="segmented">
        <label><input type="radio" name="applicationMode" value="horizon" ${v.applicationMode === 'horizon' ? 'checked' : ''} ${orgVerified === false ? 'disabled' : ''}><span>On HORIZON (verified profile)</span></label>
        <label><input type="radio" name="applicationMode" value="external" ${v.applicationMode === 'external' ? 'checked' : ''}><span>On the employer’s website</span></label></div>
        <p class="help mt-8">HORIZON applications are only available to verified organisations, which commit to responding within ${ctx.cfg.recruiterResponseDays} days.</p><p class="field-error" data-for="applicationMode"></p></fieldset>
      <div data-external ${v.applicationMode === 'external' ? '' : 'hidden'}>${field('applicationUrl', 'Official application link', html`<input class="input" type="url" id="f-applicationUrl" name="applicationUrl" value="${v.applicationUrl || ''}" data-validate="requiredif:applicationMode=external|url" placeholder="https://careers.example.com/…">`)}</div>
    </div></section>

    ${isAdmin ? html`<section class="card"><div class="card-header"><h2>${icon('shieldCheck')} Source &amp; verification</h2></div><div class="card-body"><div class="form-grid">
      ${field('sourceName', 'Original listing source', html`<input class="input" id="f-sourceName" name="sourceName" maxlength="120" value="${v.sourceName || ''}" data-validate="max:120" placeholder="e.g. Company careers page">`)}
      ${field('sourceUrl', 'Source link', html`<input class="input" type="url" id="f-sourceUrl" name="sourceUrl" value="${v.sourceUrl || ''}" data-validate="url">`)}
      ${field('lastVerifiedAt', 'Last verified on', html`<input class="input" type="date" id="f-lastVerifiedAt" name="lastVerifiedAt" value="${v.lastVerifiedAt || ''}" data-validate="date">`, { help: 'Defaults to today.' })}
      ${field('status', 'Publication status', html`<select class="select" id="f-status" name="status">${['published', 'pending_review', 'draft', 'rejected', 'archived'].map((s) => html`<option value="${s}" ${sel(o ? o.status : 'published', s)}>${{ published: 'Published', pending_review: 'In review', draft: 'Draft', rejected: 'Changes requested', archived: 'Archived' }[s]}</option>`)}</select>`)}
      <label class="switch"><input type="checkbox" name="isFeatured" ${v.isFeatured ? 'checked' : ''}><span>Featured on the home page</span></label>
      <label class="switch"><input type="checkbox" name="isVerified" ${v.isVerified ? 'checked' : ''}><span>Listing details verified against the source</span></label>
    </div></div></section>` : ''}

    <section class="card card-pad">
      <div class="field"><label class="check"><input type="checkbox" name="noFeeConfirmed" ${o && o.noFeeConfirmed ? 'checked' : ''} data-validate="required" data-msg-required="Confirm that applicants will never be charged a fee."><span><strong>No-fee pledge:</strong> applicants will never be asked to pay any registration, training, deposit, equipment or other fee at any stage.</span></label><p class="field-error" data-for="noFeeConfirmed"></p></div>
    </section>

    <div class="row wrap" style="justify-content:flex-end;--gap:10px">
      <a class="btn" href="${listBase}">Cancel</a>
      ${isAdmin ? html`<button class="btn btn-primary btn-lg" type="submit" data-intent="admin">${icon('check')} ${editing ? 'Save changes' : 'Create listing'}</button>`
    : html`${!editing || o.status !== 'published' ? html`<button class="btn btn-lg" type="submit" data-intent="draft">Save draft</button>` : ''}<button class="btn btn-accent btn-lg" type="submit" data-intent="review">${icon('send')} Submit for review</button>`}
    </div>
  </form>`);

  const form = $('[data-listing]', ctx.el);
  liveValidate(form);
  mountTagInputs(form);
  $$('input[name=isPaid]', form).forEach((r) => r.addEventListener('change', () => { $('[data-paid]', form).hidden = form.isPaid.value !== 'true'; }));
  $$('input[name=applicationMode]', form).forEach((r) => r.addEventListener('change', () => { $('[data-external]', form).hidden = form.applicationMode.value !== 'external'; }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const intent = (e.submitter && e.submitter.dataset.intent) || 'review';
    if (!validateForm(form)) return;
    const values = formToObject(form);
    const body = {
      ...values,
      organisationId: values.organisationId ? Number(values.organisationId) : undefined,
      durationWeeks: Number(values.durationWeeks),
      stipendAmount: values.isPaid ? Number(values.stipendAmount) : null,
      stipendCurrency: values.isPaid ? values.stipendCurrency : null,
      eligibleYears: values.eligibleYears || [],
      applicationUrl: values.applicationMode === 'external' ? values.applicationUrl : (values.applicationUrl || null),
    };
    if (!isAdmin) body.status = intent === 'draft' ? 'draft' : 'pending_review';
    await withLoading(e.submitter, async () => {
      try {
        const saved = editing ? await put(`/api/opportunities/${o.id}`, body) : await post('/api/opportunities', body);
        toast(isAdmin ? 'Listing saved.' : intent === 'draft' ? 'Draft saved.' : 'Submitted for review — you’ll be notified when it’s live.');
        ctx.navigate(isAdmin ? `/admin/internships/${saved.id}` : '/recruiter/listings');
      } catch (err) {
        if (!applyServerErrors(form, err.fields)) { const { toastError } = await import('../../lib/ui.js'); toastError(err); }
      }
    });
  });
}
