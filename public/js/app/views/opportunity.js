import { html, render, $, on, safeUrl } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, post, del, patch, put } from '../../lib/api.js';
import { orgAvatar, listingBadge, extLink, trustStrip, respondClock } from '../../lib/components.js';
import { toast, toastError, confirmDialog, skeletonDetail } from '../../lib/ui.js';
import { LABELS, fmtDate, fmtShort, stipend, usdApprox, daysLeft, daysUntil, deadlineLabel, weeks } from '../../lib/format.js';
import { trackModal, applyModal, reportLink } from '../shared.js';

const list = (text) => (text ? html`<ul>${text.split('\n').filter(Boolean).map((l) => html`<li>${l.replace(/^[-•]\s*/, '')}</li>`)}</ul>` : '');

export default async function opportunity(ctx) {
  render(ctx.el, skeletonDetail());
  const o = await get(`/api/opportunities/${ctx.params.id}`);
  ctx.setTitle(o.title);
  const crumbs = { student: [{ label: 'Explore Internships', href: '/app/explore' }], recruiter: [{ label: 'My Listings', href: '/recruiter/listings' }], admin: [{ label: 'Manage Internships', href: '/admin/internships' }] }[ctx.role];
  ctx.setCrumbs([...crumbs, { label: o.title }]);
  ctx.setActive(crumbs[0].href);
  const orgHref = `${ctx.base}/organisations/${o.organisation.id}`;
  const days = daysUntil(o.deadline);
  const isStudent = ctx.role === 'student';
  const a = isStudent ? o.application : null;
  const appliedOnHorizon = !!a && a.channel === 'horizon';

  // One primary action (apply), one secondary (save), one tertiary (track / open in tracker).
  const primaryAction = (extra = '') => {
    if (!isStudent) return '';
    if (o.applicationMode === 'horizon' && o.isOpen && !appliedOnHorizon) return html`<button class="btn btn-accent btn-lg ${extra}" data-apply>${icon('send')} Apply with HORIZON profile</button>`;
    if (o.applicationMode === 'external' && o.applicationUrl && o.isOpen) return html`<a class="btn btn-accent btn-lg ${extra}" href="${safeUrl(o.applicationUrl)}" target="_blank" rel="noopener noreferrer">Apply on employer site ${icon('externalLink', { size: 16 })}<span class="sr-only"> (opens in a new tab)</span></a>`;
    return '';
  };
  const studentActions = () => html`
      ${primaryAction()}
      <button class="btn btn-lg save-btn" data-save-detail aria-pressed="${String(!!o.saved)}">${icon('bookmark')}<span data-save-label>${o.saved ? 'Saved' : 'Save'}</span></button>
      ${a ? html`<a class="btn btn-lg btn-ghost" href="/app/applications?open=${a.id}">${icon('columns')} In tracker: ${LABELS.stage[a.stage]}</a>` : html`<button class="btn btn-lg btn-ghost" data-track>${icon('plus')} Track application</button>`}`;
  const recruiterActions = () => html`
    <a class="btn btn-primary" href="/recruiter/listings/${o.id}/edit">${icon('edit')} Edit listing</a>
    ${o.applicationMode === 'horizon' ? html`<a class="btn" href="/recruiter/listings/${o.id}/applicants">${icon('users')} Applicants (${o.applicantCount})</a>` : ''}`;
  const adminActions = () => html`
    <a class="btn btn-primary" href="/admin/internships/${o.id}/edit">${icon('edit')} Edit</a>
    ${o.status === 'pending_review' ? html`<button class="btn btn-success" data-review="publish">${icon('check')} Approve &amp; publish</button><button class="btn btn-danger" data-review="reject">Request changes</button>` : ''}
    <button class="btn" data-flag="isFeatured" data-value="${String(!o.isFeatured)}">${icon('star')} ${o.isFeatured ? 'Unfeature' : 'Feature'}</button>
    <button class="btn" data-flag="isVerified" data-value="${String(!o.isVerified)}">${icon('shieldCheck')} ${o.isVerified ? 'Remove verified mark' : 'Mark verified'}</button>
    ${o.status !== 'archived' ? html`<button class="btn" data-archive>${icon('archive')} Archive</button>` : ''}
    <button class="btn btn-danger" data-delete>${icon('trash')} Delete</button>`;

  const appliedNote = () => {
    if (!appliedOnHorizon) return '';
    const clockApp = { ...a, opportunityId: o.id, organisation: o.organisation.name, title: o.title };
    const sentence = a.firstResponseAt ? `${o.organisation.name} replied on ${fmtDate(a.firstResponseAt)}.`
      : a.respondBy ? (a.responseOverdue ? `The reply was due ${fmtShort(a.respondBy)}.` : `Reply due ${fmtShort(a.respondBy)}.`) : '';
    return html`<div class="alert ${a.responseOverdue ? 'alert-warning' : 'alert-success'} mt-16 applied-note">${icon(a.responseOverdue ? 'alertTriangle' : 'checkCircle')}<div class="grow">
      <div>You applied on HORIZON${a.appliedOn ? ` on ${fmtDate(a.appliedOn)}` : ''}. ${sentence} Track updates on <a href="/app/applications?open=${a.id}">My Applications</a>.</div>
      ${a.stage !== 'withdrawn' ? html`<div class="mt-8">${respondClock(clockApp, { base: ctx.base, windowDays: ctx.cfg.recruiterResponseDays })}</div>` : ''}</div></div>`;
  };

  const showSteps = isStudent && o.applicationMode === 'horizon';
  const windowDays = ctx.cfg.recruiterResponseDays;
  render(ctx.el, html`
    ${o.isDemo ? html`<div class="alert alert-demo mb-16">${icon('info')}<div><strong>Illustrative listing.</strong> This opportunity and organisation are fictional demonstration data — not a real vacancy.</div></div>` : ''}
    ${!isStudent && o.status !== 'published' ? html`<div class="alert alert-warning mb-16">${icon('alertTriangle')}<div>Status: ${listingBadge(o.status)} ${o.reviewNote ? html`<div class="mt-8"><strong>Review note:</strong> ${o.reviewNote}</div>` : ''}</div></div>` : ''}
    ${isStudent && !o.isOpen ? html`<div class="alert alert-warning mb-16">${icon('clock')}<div>Applications for this opportunity have closed. It stays visible because it is in your tracker.</div></div>` : ''}
    <div class="opp-detail ${isStudent && primaryAction() ? 'has-action-bar' : ''}">
      <section class="card detail-hero od-hero" aria-labelledby="opp-title">
        ${orgAvatar(o.organisation, 'lg')}
        <div class="grow">
          <a class="dh-org" href="${orgHref}">${o.organisation.name}${o.organisation.verified ? icon('shieldCheck', { size: 15, label: 'Verified organisation' }) : ''}</a>
          <h1 id="opp-title" class="dh-title" title="${o.title}">${o.title}</h1>
          <div class="chips">
            <span class="chip">${icon('mapPin', { size: 15 })} ${o.city}, ${o.country}</span><span class="chip">${icon('briefcase', { size: 15 })} ${o.industry}</span>
            <span class="chip">${icon('layers', { size: 15 })} ${LABELS.workMode[o.workMode]}</span>${!isStudent && o.isFeatured ? html`<span class="badge badge-gold">${icon('star')} Featured</span>` : ''}
          </div>
          ${trustStrip(o, { orgHref })}
          <p class="dh-summary">${o.summary}</p>
          <div class="detail-actions" data-primary-actions>${isStudent ? studentActions() : ctx.role === 'recruiter' ? recruiterActions() : adminActions()}</div>
          ${isStudent && o.applicationMode === 'external' ? html`<p class="subtle mt-16 mb-0">${icon('info', { size: 14 })} You apply through the employer’s official process. HORIZON doesn’t submit applications on your behalf — use “Track application” to follow your progress here.</p>` : ''}
          ${appliedNote()}
        </div>
      </section>
      <aside class="od-aside aside-sticky" aria-label="Key facts and trust">
        <section class="card card-pad" aria-labelledby="facts-h">
          <h2 class="sr-only" id="facts-h">Key facts</h2>
          <ul class="facts">
            <li>${icon('calendar')}<div><div class="f-label">Application deadline</div><div class="f-value">${fmtDate(o.deadline)} <span class="badge ${days != null && days <= 7 ? 'badge-warning' : ''}">${daysLeft(o.deadline)}</span></div></div></li>
            <li>${icon('banknote')}<div><div class="f-label">Compensation</div><div class="f-value">${stipend(o)}</div>${o.stipend ? html`<div class="subtle">${usdApprox(o.stipend.usdMonthly)}</div>` : ''}</div></li>
            <li>${icon('clock')}<div><div class="f-label">Duration</div><div class="f-value">${weeks(o.durationWeeks)}</div>${o.startDate ? html`<div class="subtle">${fmtDate(o.startDate)} – ${fmtDate(o.endDate)}</div>` : ''}</div></li>
            <li>${icon('mapPin')}<div><div class="f-label">Location</div><div class="f-value">${o.city}, ${o.country} · ${LABELS.workMode[o.workMode]}</div></div></li>
            <li>${icon('passport')}<div><div class="f-label">Visa sponsorship</div><div class="f-value">${LABELS.visaLong[o.visaSponsorship]}</div>${o.visaDetails ? html`<div class="subtle">${o.visaDetails}</div>` : ''}</div></li>
            ${o.relocationSupport ? html`<li>${icon('globe')}<div><div class="f-label">Relocation support</div><div class="f-value">${o.relocationSupport}</div></div></li>` : ''}
            ${o.accommodationSupport ? html`<li>${icon('home')}<div><div class="f-label">Accommodation</div><div class="f-value">${o.accommodationSupport}</div></div></li>` : ''}
            <li>${icon('send')}<div><div class="f-label">How to apply</div><div class="f-value">${o.applicationMode === 'horizon' ? 'On HORIZON with your verified profile' : html`Employer’s official site ${o.applicationUrl ? extLink(o.applicationUrl, 'Open') : ''}`}</div></div></li>
          </ul>
        </section>
        <section class="card card-pad" id="trust-panel" aria-labelledby="trust-h">
          <h2 class="h3-size" id="trust-h">${icon('shieldCheck')} Trust &amp; transparency</h2>
          <ul class="facts">
            <li>${icon('building')}<div><div class="f-label">Organisation</div><div class="f-value">${o.organisation.verified ? `Verified by HORIZON${o.organisation.verifiedAt ? ` on ${fmtDate(o.organisation.verifiedAt)}` : ''}` : 'Not yet verified — listing curated by HORIZON'}</div></div></li>
            <li>${icon('fileCheck')}<div><div class="f-label">Original listing source</div><div class="f-value">${o.sourceUrl ? extLink(o.sourceUrl, o.sourceName || 'Source') : (o.sourceName || '—')}</div></div></li>
            <li>${icon('check')}<div><div class="f-label">Last verified</div><div class="f-value">${o.lastVerifiedAt ? fmtDate(o.lastVerifiedAt) : 'Awaiting review'}</div></div></li>
            <li>${icon('ban')}<div><div class="f-label">Fees</div><div class="f-value">${o.noFeeConfirmed ? 'Employer confirmed: no fees, ever' : 'Not confirmed'}</div></div></li>
            ${o.responseStats ? html`<li>${icon('activity')}<div><div class="f-label">Recruiter responsiveness</div><div class="f-value">${o.responseStats.enoughData ? `${o.responseStats.responseRate}% answered within ${o.responseStats.windowDays} days` : 'New on HORIZON — not enough data yet'}</div>${o.responseStats.averageResponseDays != null ? html`<div class="subtle">Average first response: ${o.responseStats.averageResponseDays} days</div>` : ''}</div></li>` : ''}
          </ul>
          <a class="btn btn-sm btn-block mt-8" href="${orgHref}">${icon('building', { size: 16 })} View organisation profile</a>
        </section>
      </aside>
      <div class="od-body stack gap-5">
        ${showSteps ? html`<section class="card card-pad" aria-labelledby="next-steps-h">
          <h2 class="h3-size" id="next-steps-h">What happens after you apply</h2>
          <ol class="timeline mt-16">
            <li><span class="tl-dot filled"></span><div class="tl-head">Application sent</div><div class="tl-body">Your verified profile and validated CV go to ${o.organisation.name}. You get a copy on your tracker.</div></li>
            <li><span class="tl-dot dashed"></span><div class="tl-head">Recruiter replies within ${windowDays} days</div><div class="tl-body">The reply deadline is shown on your tracker. If it passes, you can raise it with HORIZON.</div></li>
            <li><span class="tl-dot"></span><div class="tl-head">Decision, with a written reason if declined</div><div class="tl-body">Every candidate hears back. Declines on HORIZON always include a short reason.</div></li>
          </ol></section>` : ''}
        <section class="card card-pad prose" aria-labelledby="about-h">
          <h2 id="about-h">About the internship</h2><p class="pre">${o.description}</p>
          ${o.responsibilities ? html`<h3>Responsibilities</h3>${list(o.responsibilities)}` : ''}
          ${o.skills.length ? html`<h3>Required skills</h3><div class="chips">${o.skills.map((s) => html`<span class="chip">${s}</span>`)}</div>` : ''}
          ${o.eligibility ? html`<h3>Eligibility criteria</h3><p class="pre">${o.eligibility}</p>` : ''}
          <h3>Academic requirements</h3><p class="pre">${o.academicRequirements || 'No specific requirements stated.'}<br><span class="subtle">Level: ${LABELS.level[o.academicLevel]}${o.eligibleYears.length ? ` · Open to year ${o.eligibleYears.join(', ')}` : ' · All years'}</span></p>
          ${o.requiredDocuments ? html`<h3>Required documents</h3><p class="pre">${o.requiredDocuments}</p>` : ''}
        </section>
        ${isStudent ? html`<p class="subtle">Something wrong with this listing — a fee request, wrong details, or a suspicious contact? <a href="${reportLink(ctx.base, 'opportunity', o.id, `${o.organisation.name} — ${o.title}`)}">Report this listing</a>.</p>` : ''}
      </div>
    </div>
    ${isStudent && primaryAction() ? html`<div class="action-bar" data-action-bar hidden>
      <div class="ab-text"><strong class="truncate">${o.title}</strong><span class="subtle">${deadlineLabel(o.deadline)}</span></div>
      ${primaryAction('ab-btn')}</div>` : ''}`);

  // Phones: keep the primary action reachable once the in-page button scrolls away.
  const bar = $('[data-action-bar]', ctx.el);
  const inPage = $('[data-primary-actions] .btn-accent', ctx.el);
  if (bar && inPage && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(([entry]) => { bar.hidden = entry.isIntersecting || entry.boundingClientRect.top > window.innerHeight; }, { threshold: 0 });
    io.observe(inPage);
    ctx.onCleanup(() => io.disconnect());
  }

  const reload = () => ctx.navigate(ctx.path, { replace: true });
  on(ctx.el, 'click', '[data-apply]', () => applyModal(o, o.applyReadiness, { onDone: reload }));
  on(ctx.el, 'click', '[data-track]', () => trackModal(o, { onDone: reload }));
  on(ctx.el, 'click', '[data-save-detail]', async (e, b) => {
    const saved = b.getAttribute('aria-pressed') === 'true';
    try {
      if (saved) await del(`/api/saved/${o.id}`); else await post(`/api/saved/${o.id}`, {});
      b.setAttribute('aria-pressed', String(!saved));
      $('[data-save-label]', b).textContent = saved ? 'Save' : 'Saved';
      toast(saved ? 'Removed from saved.' : 'Saved.', { type: saved ? 'info' : 'success' });
    } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-flag]', async (e, b) => {
    try { await patch(`/api/admin/opportunities/${o.id}/flags`, { [b.dataset.flag]: b.dataset.value === 'true' }); toast('Listing updated.'); reload(); } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-review]', async (e, b) => {
    const publish = b.dataset.review === 'publish';
    const r = await confirmDialog(publish ? { title: 'Publish this listing?', message: 'It will become visible to verified students immediately.', confirmText: 'Publish' }
      : { title: 'Request changes', message: 'The recruiter will see your note and can resubmit.', confirmText: 'Send back', danger: true, reason: { label: 'What needs to change?', required: true, min: 10 } });
    if (!r) return;
    try { await put(`/api/admin/opportunities/${o.id}/review`, { decision: publish ? 'publish' : 'reject', note: r.reason || null }); toast(publish ? 'Listing published.' : 'Sent back to the recruiter.'); reload(); } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-archive]', async () => {
    if (!(await confirmDialog({ title: 'Archive this listing?', message: 'It will be hidden from students. Application histories are preserved.', confirmText: 'Archive' }))) return;
    try { await patch(`/api/admin/opportunities/${o.id}/flags`, { status: 'archived' }); toast('Listing archived.'); reload(); } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-delete]', async () => {
    if (!(await confirmDialog({ title: 'Delete this listing?', message: 'Listings with applications are archived instead so no history is lost. This cannot be undone.', confirmText: 'Delete', danger: true }))) return;
    try { const r = await del(`/api/opportunities/${o.id}`); toast(r.message); ctx.navigate('/admin/internships'); } catch (err) { toastError(err); }
  });
}
