/** Helpers shared by application views. */
import { html, $, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { post, del, get } from '../lib/api.js';
import { toast, toastError, formModal, openModal, withLoading } from '../lib/ui.js';
import { LABELS, STAGES, parseDate } from '../lib/format.js';
import { combobox } from '../lib/combobox.js';
import { docBadge, grievanceLink } from '../lib/components.js';

export const pageHeader = ({ title, subtitle = '', actions = '' }) => html`<div class="page-header"><div><h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>${actions ? html`<div class="page-actions">${actions}</div>` : ''}</div>`;

export const field = (name, label, control, { help = '', optional = false, span = false } = {}) => html`<div class="field ${span ? 'span-2' : ''}"><label class="label" for="f-${name}">${label}${optional ? html`<span class="opt">(optional)</span>` : ''}</label>${control}${help ? html`<p class="help">${help}</p>` : ''}<p class="field-error" data-for="${name}"></p></div>`;

/** Toggle saved state on any [data-save] button inside root. */
export function wireSaveButtons(root, { onChange } = {}) {
  on(root, 'click', '[data-save]', async (e, btn) => {
    e.preventDefault();
    e.stopPropagation();
    const id = btn.dataset.save;
    const saved = btn.getAttribute('aria-pressed') === 'true';
    btn.disabled = true;
    try {
      if (saved) await del(`/api/saved/${id}`); else await post(`/api/saved/${id}`, {});
      btn.setAttribute('aria-pressed', String(!saved));
      btn.setAttribute('aria-label', saved ? 'Save opportunity' : 'Remove from saved');
      const label = btn.querySelector('[data-save-label]');
      if (label) label.textContent = saved ? 'Save' : 'Saved';
      toast(saved ? 'Removed from saved opportunities.' : 'Saved — find it under Saved Opportunities.', { type: saved ? 'info' : 'success' });
      if (onChange) onChange(id, !saved);
    } catch (err) { toastError(err); } finally { btn.disabled = false; }
  });
}

export const toLocalInput = (s) => {
  const d = parseDate(s);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

export const stageOptions = (current, { allowed = STAGES } = {}) => STAGES.map((s) => html`<option value="${s}" ${s === current ? 'selected' : ''} ${allowed.includes(s) ? '' : 'disabled'}>${LABELS.stage[s]}</option>`);

/** "Track application" dialog for a known opportunity, or with a search picker when opp is null. */
export function trackModal(opp, { onDone } = {}) {
  const m = formModal({
    title: opp ? 'Track this application' : 'Add an application',
    description: opp ? html`${opp.title} · ${opp.organisation.name}` : 'Track an opportunity from HORIZON on your board.',
    fields: html`
      ${opp ? html`<input type="hidden" name="opportunityId" value="${opp.id}">` : field('opp', 'Opportunity', html`<div class="combo"><input class="input" id="f-opp" placeholder="Search open listings by title or organisation" data-validate="required" data-msg-required="Choose an opportunity."><input type="hidden" name="opportunityId"></div>`)}
      <div class="form-grid">
        ${field('stage', 'Stage', html`<select class="select" id="f-stage" name="stage">${stageOptions('interested', { allowed: STAGES.filter((s) => s !== 'withdrawn') })}</select>`)}
        ${field('appliedOn', 'Application date', html`<input class="input" type="date" id="f-appliedOn" name="appliedOn" data-validate="date">`, { optional: true })}
        ${field('personalDeadline', 'Personal deadline', html`<input class="input" type="date" id="f-personalDeadline" name="personalDeadline" data-validate="date">`, { optional: true })}
        ${field('nextAction', 'Next action', html`<input class="input" id="f-nextAction" name="nextAction" maxlength="200" data-validate="max:200" placeholder="e.g. Ask a senior for a referral">`, { optional: true })}
        ${field('notes', 'Notes', html`<textarea class="textarea" id="f-notes" name="notes" rows="3" maxlength="4000" data-validate="max:4000"></textarea>`, { optional: true, span: true })}
      </div>
      ${opp && opp.applicationMode === 'external' ? html`<p class="subtle">${icon('info', { size: 14 })} You apply on the employer’s website; HORIZON keeps your progress in one place.</p>` : ''}`,
    submitText: 'Add to tracker',
    onSubmit: async (values) => {
      const body = { ...values, opportunityId: Number(values.opportunityId) };
      ['appliedOn', 'personalDeadline', 'nextAction', 'notes'].forEach((k) => { if (!body[k]) body[k] = null; });
      delete body.opp;
      const app = await post('/api/applications', body);
      toast('Added to your application tracker.');
      if (onDone) onDone(app);
    },
  });
  if (!opp) {
    combobox({
      input: $('#f-opp', m.el), hidden: m.el.querySelector('[name=opportunityId]'), minChars: 0,
      search: async (q) => (await get('/api/opportunities', { q, pageSize: 8 })).items.map((o) => ({ value: o.id, label: o.title, sub: o.organisation.name })),
    });
  }
  return m;
}

/** Apply-on-HORIZON dialog with readiness checks, cover note and explicit consent. */
export function applyModal(opp, readiness, { onDone } = {}) {
  const cvOk = readiness.cvReady;
  const videoOk = readiness.videoReady;
  const m = openModal({
    title: 'Apply with your HORIZON profile',
    description: html`${opp.title} · ${opp.organisation.name}`,
    body: html`<form class="stack" data-apply novalidate>
      <div class="card card-pad sunken">
        <ul class="check-list">
          <li>${icon(cvOk ? 'checkCircle' : 'xCircle', { cls: cvOk ? 'pass' : 'fail' })}<div><div class="cl-label">Validated CV ${readiness.cvStatus ? docBadge(readiness.cvStatus) : ''}</div><div class="cl-detail">${cvOk ? 'Your current CV will be shared.' : html`Upload a CV that passes validation on <a href="/app/profile">My Profile</a>.`}</div></div></li>
          <li>${icon(videoOk ? 'checkCircle' : 'info', { cls: videoOk ? 'pass' : 'warn' })}<div><div class="cl-label">Video resume ${readiness.videoStatus ? docBadge(readiness.videoStatus) : html`<span class="badge">Optional</span>`}</div><div class="cl-detail">${videoOk ? 'You can include your approved video.' : 'Optional. Videos are shared only after moderation.'}</div></div></li>
          <li>${icon('shieldCheck', { cls: 'pass' })}<div><div class="cl-label">Verified profile</div><div class="cl-detail">Your institution, programme and profile details are included.</div></div></li>
        </ul>
      </div>
      <div class="field"><label class="label" for="cover">Cover note <span class="opt">(recommended)</span></label>
        <textarea class="textarea" id="cover" name="coverNote" rows="5" maxlength="2000" data-validate="max:2000" placeholder="Two or three sentences on why this role, and one piece of evidence you can do it."></textarea>
        <div class="char-count" data-count>0 / 2000</div><p class="field-error" data-for="coverNote"></p></div>
      <label class="switch"><input type="checkbox" name="includeVideo" ${videoOk ? '' : 'disabled'}><span>Include my video resume</span></label>
      <div class="field"><label class="check"><input type="checkbox" name="consent" data-validate="required" data-msg-required="Please confirm to continue."><span>I agree to share my profile, CV${videoOk ? ' and (if selected) video resume' : ''} with ${opp.organisation.name} for this application.</span></label><p class="field-error" data-for="consent"></p></div>
      <p class="subtle mb-0">${icon('clock', { size: 14 })} Verified recruiters respond within 14 days. Status updates appear on your application board.</p>
    </form>`,
    footer: html`<button class="btn" data-close>Cancel</button><button class="btn btn-accent" data-submit ${cvOk ? '' : 'disabled'}>${icon('send')} Submit application</button>`,
  });
  const form = $('[data-apply]', m.el);
  const ta = form.coverNote;
  ta.addEventListener('input', () => { $('[data-count]', form).textContent = `${ta.value.length} / 2000`; });
  $('[data-submit]', m.el).addEventListener('click', async (e) => {
    const btn = e.currentTarget; // capture before any await: currentTarget is cleared after dispatch
    const { validateForm, applyServerErrors } = await import('../lib/validate.js');
    if (!validateForm(form)) return;
    await withLoading(btn, async () => {
      try {
        const res = await post(`/api/opportunities/${opp.id}/apply`, { coverNote: ta.value.trim() || null, includeVideo: form.includeVideo.checked, consent: form.consent.checked });
        toast(res.message, { title: 'Application sent' });
        m.close(true);
        if (onDone) onDone(res);
      } catch (err) { if (!applyServerErrors(form, err.fields)) toastError(err); }
    });
  });
  return m;
}

export function reportLink(base, type, id, label, category = '') {
  return grievanceLink(base, type, id, label, category);
}
