import { html, render, $, formToObject } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, put } from '../../lib/api.js';
import { recruiterBadge, personAvatar, docBadge, checkList, timeline, extLink } from '../../lib/components.js';
import { toast, toastError, withLoading } from '../../lib/ui.js';
import { validateForm, liveValidate, applyServerErrors, showError } from '../../lib/validate.js';
import { LABELS, RECRUITER_STATUSES, fmtDate, fmtDateTime, fmtShort } from '../../lib/format.js';
import { toLocalInput, fromLocalInput } from '../shared.js';

const HINTS = {
  under_review: 'Lets the candidate know a person has opened their application.',
  shortlisted: 'The candidate is told they are on your shortlist.',
  assessment: 'Use the message to explain the assessment and its deadline.',
  interview: 'Add the date and time. The candidate sees it on their tracker.',
  offer: 'Share next steps. Formal offer letters should still come from your own systems.',
  not_selected: 'Required: a short, respectful reason or suggestion. Every HORIZON applicant receives closure.',
};

export default async function applicantDetail(ctx) {
  ctx.setActive('/recruiter/applicants');
  let a = await get(`/api/recruiter/applications/${ctx.params.id}`);

  function draw() {
    const p = a.profile || {};
    ctx.setTitle(a.student.name);
    ctx.setCrumbs([{ label: 'Applicants', href: '/recruiter/applicants' }, { label: a.opportunityTitle, href: `/recruiter/listings/${a.opportunityId}/applicants` }, { label: a.student.name }]);
    const events = a.events.map((e) => ({
      title: e.type === 'submitted' ? 'Application submitted'
        : e.type === 'withdrawn' ? 'Candidate withdrew'
          : e.type === 'recruiter_status' ? `Status: ${LABELS.recruiterStatus[e.to] || e.to}`
            : e.type === 'recruiter_message' ? 'Message sent to candidate' : e.type.replace(/_/g, ' '),
      at: e.createdAt, body: e.message, tone: e.to === 'not_selected' ? 'error' : e.to === 'offer' ? 'success' : '',
    }));

    render(ctx.el, html`
      <section class="card detail-hero mb-24">
        ${personAvatar(a.student.name, 'lg')}
        <div class="grow">
          <div class="row wrap gap-2"><span class="badge badge-success">${icon('shieldCheck')} Verified INI student</span>${a.cv ? docBadge(a.cv.status) : ''}${a.withdrawn ? html`<span class="badge">Withdrawn</span>` : recruiterBadge(a.recruiterStatus)}</div>
          <h1 class="mt-8">${a.student.name}</h1>
          <p class="muted mb-0">${a.student.institution} · ${a.student.programme || ''}${a.student.currentYear ? ` · Year ${a.student.currentYear}` : ''}${a.student.graduationYear ? ` · Class of ${a.student.graduationYear}` : ''}</p>
          <p class="subtle mt-8 mb-0">Applied to <a href="/recruiter/opportunities/${a.opportunityId}">${a.opportunityTitle}</a> on ${fmtDateTime(a.submittedAt)}${a.firstResponseAt ? ` · first response ${fmtDate(a.firstResponseAt)}` : ''}</p>
        </div>
        <div class="row wrap">${a.cv ? html`<a class="btn" href="${a.cv.url}" target="_blank" rel="noopener">${icon('fileText')} Open CV</a>` : ''}</div>
      </section>
      ${!a.withdrawn && a.respondBy ? html`<div class="alert ${a.overdue ? 'alert-error' : 'alert-info'} mb-16">${icon(a.overdue ? 'alertTriangle' : 'clock')}<div><div class="alert-title">${a.overdue ? `Reply overdue by ${a.daysToRespond ? Math.abs(a.daysToRespond) : 1} day${Math.abs(a.daysToRespond) === 1 ? '' : 's'}` : `Reply due ${fmtShort(a.respondBy)}`}</div>Your listing promises every applicant a first response within ${ctx.cfg.recruiterResponseDays} days. The candidate sees the same deadline on their tracker.</div></div>` : ''}
      <div class="detail">
        <div class="stack gap-5">
          ${a.coverNote ? html`<section class="card card-pad"><h2>Cover note</h2><div class="prose"><p style="white-space:pre-line">${a.coverNote}</p></div></section>` : ''}
          ${a.video ? html`<section class="card card-pad"><h2>${icon('video')} Video resume</h2><video controls preload="metadata" src="${a.video.url}" style="width:100%;max-width:720px;border-radius:14px;background:#0C1B2C;aspect-ratio:16/9"></video><p class="subtle xs mt-8 mb-0">Moderated by HORIZON. Shared because the candidate chose to include it with this application.</p></section>` : ''}
          <section class="card card-pad"><h2>Profile</h2>
            ${p.bio ? html`<p>${p.bio}</p>` : ''}
            <div class="kv">
              <div>Level of study</div><div>${LABELS.level[p.academicLevel] || '—'}</div>
              <div>Specialisation</div><div>${p.specialisation || '—'}</div>
              <div>Skills</div><div>${(p.skills || []).length ? html`<div class="row wrap gap-2">${p.skills.map((s) => html`<span class="tag">${s}</span>`)}</div>` : '—'}</div>
              <div>Academic interests</div><div>${(p.academicInterests || []).join(', ') || '—'}</div>
              <div>Languages</div><div>${(p.languages || []).join(', ') || '—'}</div>
              <div>Links</div><div class="row wrap gap-4">${p.linkedinUrl ? extLink(p.linkedinUrl, 'LinkedIn') : ''}${p.portfolioUrl ? extLink(p.portfolioUrl, 'Portfolio') : ''}${p.githubUrl ? extLink(p.githubUrl, 'GitHub') : ''}${!p.linkedinUrl && !p.portfolioUrl && !p.githubUrl ? '—' : ''}</div>
            </div>
            ${p.experience ? html`<h3 class="mt-24">Experience</h3><div class="prose"><p style="white-space:pre-line">${p.experience}</p></div>` : ''}
          </section>
          ${a.cvReport && a.cvReport.report ? html`<section class="card card-pad"><div class="row between"><h2 class="mb-0">${icon('fileCheck')} CV validation</h2>${docBadge(a.cvReport.status)}</div>
            <p class="small muted">Checked automatically when uploaded${a.cvReport.status === 'verified' ? ' and verified by a HORIZON reviewer' : ''}. Checks cover file safety, readability, and whether the name, institution and graduation year match the verified account.</p>
            ${checkList(a.cvReport.report.checks)}</section>` : ''}
          <section class="card card-pad"><h2>${icon('history')} History</h2>${timeline(events)}</section>
        </div>
        <aside class="aside-sticky">
          <section class="card" data-decision>
            <div class="card-header"><h2>Update candidate</h2></div>
            <div class="card-body">
            ${a.withdrawn ? html`<div class="alert alert-info">${icon('info')}<div>The candidate withdrew this application. No further updates are possible.</div></div>` : html`
              <form class="stack" novalidate data-form>
                <div class="field"><label class="label" for="f-recruiterStatus">Status</label>
                  <select class="select" id="f-recruiterStatus" name="recruiterStatus">${RECRUITER_STATUSES.map((s) => html`<option value="${s}" ${s === a.recruiterStatus ? 'selected' : ''}>${LABELS.recruiterStatus[s]}</option>`)}</select>
                  <p class="help" data-hint>${HINTS[a.recruiterStatus] || ''}</p></div>
                <div class="field" data-interview ${a.recruiterStatus === 'interview' ? '' : 'hidden'}><label class="label" for="f-interviewAt">Interview date &amp; time <span class="req">*</span></label>
                  <input class="input" type="datetime-local" id="f-interviewAt" name="interviewAt" value="${toLocalInput(a.interviewAt)}" data-validate="requiredif:recruiterStatus=interview"><p class="field-error" data-for="interviewAt"></p></div>
                <div class="field"><label class="label" for="f-message">Message to candidate <span class="opt" data-msg-opt>(optional)</span></label>
                  <textarea class="textarea" id="f-message" name="message" rows="4" maxlength="2000" data-validate="requiredif:recruiterStatus=not_selected|max:2000" placeholder="Visible to the candidate"></textarea><p class="field-error" data-for="message"></p>
                  ${a.recruiterMessage ? html`<p class="help">Last message: “${a.recruiterMessage}”</p>` : ''}</div>
                <div class="field"><label class="label" for="f-recruiterNotes">Private notes <span class="opt">(only your organisation)</span></label>
                  <textarea class="textarea" id="f-recruiterNotes" name="recruiterNotes" rows="3" maxlength="4000">${a.recruiterNotes || ''}</textarea></div>
                <button class="btn btn-primary btn-block" type="submit">${icon('send')} Save &amp; notify candidate</button>
              </form>`}
            </div>
          </section>
          <section class="card card-pad"><h3>${icon('lock')} Fair-process reminders</h3><ul class="check-list mt-8">
            <li>${icon('checkCircle', { cls: 'pass' })}<span class="cl-detail text-body">Never ask the candidate to pay any fee or deposit.</span></li>
            <li>${icon('checkCircle', { cls: 'pass' })}<span class="cl-detail text-body">Use the candidate’s documents only for this application.</span></li>
            <li>${icon('checkCircle', { cls: 'pass' })}<span class="cl-detail text-body">Decline with a reason — it is shared with the candidate.</span></li></ul>
            <p class="subtle xs mt-16 mb-0">Concern about this candidate’s conduct? <a href="/recruiter/grievances/new?againstType=user&againstId=${a.student.id}&category=candidate_conduct&label=${encodeURIComponent(a.student.name)}">Report it to the grievance desk</a>.</p></section>
        </aside>
      </div>`);

    const form = $('[data-form]', ctx.el);
    if (!form) return;
    liveValidate(form);
    const sync = () => {
      const s = form.recruiterStatus.value;
      $('[data-interview]', form).hidden = s !== 'interview';
      $('[data-hint]', form).textContent = HINTS[s] || '';
      $('[data-msg-opt]', form).textContent = s === 'not_selected' ? '(required)' : '(optional)';
    };
    form.recruiterStatus.addEventListener('change', sync);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(form)) return;
      const v = formToObject(form);
      if (v.recruiterStatus === 'not_selected' && (v.message || '').trim().length < 20) { showError(form.message, 'Write at least 20 characters so the candidate understands the decision.'); form.message.focus(); return; }
      const body = { recruiterStatus: v.recruiterStatus, message: v.message || null, recruiterNotes: v.recruiterNotes || null, interviewAt: v.recruiterStatus === 'interview' ? fromLocalInput(v.interviewAt) : null };
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try {
          await put(`/api/recruiter/applications/${a.id}`, body);
          toast('Saved. The candidate has been notified.');
          a = await get(`/api/recruiter/applications/${a.id}`);
          draw();
        } catch (err) { if (!applyServerErrors(form, err.fields)) toastError(err); }
      });
    });
  }
  draw();
}
