import { html, render } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get } from '../../lib/api.js';
import { orgAvatar, oppCard, extLink, personAvatar } from '../../lib/components.js';
import { fmtDate } from '../../lib/format.js';
import { wireSaveButtons, reportLink } from '../shared.js';

export default async function organisation(ctx) {
  const o = await get(`/api/organisations/${ctx.params.id}`);
  ctx.setTitle(o.name);
  ctx.setCrumbs([{ label: ctx.role === 'admin' ? 'Organisations' : ctx.role === 'recruiter' ? 'Organisation' : 'Explore Internships', href: ctx.role === 'admin' ? '/admin/organisations' : ctx.role === 'recruiter' ? '/recruiter/organisation' : '/app/explore' }, { label: o.name }]);
  if (ctx.role === 'student') ctx.setActive('/app/explore');
  else if (ctx.role === 'admin') ctx.setActive('/admin/organisations');
  const rs = o.responseStats;
  render(ctx.el, html`
    ${o.isDemo ? html`<div class="alert alert-demo mb-16">${icon('info')}<div><strong>Fictional organisation.</strong> Created for the HORIZON demo; its listings are illustrative.</div></div>` : ''}
    <section class="card detail-hero mb-24">
      ${orgAvatar(o, 'lg')}
      <div class="grow">
        <div class="row wrap gap-2"><span class="badge">${o.type}</span></div>
        <h1 class="mt-8">${o.name}</h1>
        <div class="row wrap subtle gap-4">${o.headquarters ? html`<span>${icon('mapPin', { size: 15 })} ${o.headquarters}${o.country ? `, ${o.country}` : ''}</span>` : ''}${o.website ? extLink(o.website, new URL(o.website).hostname) : ''}${o.linkedinUrl ? extLink(o.linkedinUrl, 'LinkedIn') : ''}</div>
        ${o.description ? html`<p class="mt-16 mb-0 org-desc">${o.description}</p>` : ''}
      </div>
    </section>
    <div class="trust-tiles" aria-label="Trust summary">
      <div class="card trust-tile"><div class="tt-label">${icon(o.verified ? 'shieldCheck' : 'shield', { size: 16 })} Verification</div><div class="tt-value">${o.verified ? 'Verified' : 'Not yet verified'}</div><div class="tt-meta">${o.verified ? 'Documents reviewed by HORIZON' : 'Listings curated by HORIZON'}</div></div>
      <div class="card trust-tile"><div class="tt-label">${icon('calendar', { size: 16 })} Verified on</div><div class="tt-value">${o.verified && o.verifiedAt ? fmtDate(o.verifiedAt) : '—'}</div><div class="tt-meta">${o.emailDomain ? `Recruiters use @${o.emailDomain}` : 'No recruiter domain on file'}</div></div>
      <div class="card trust-tile"><div class="tt-label">${icon('activity', { size: 16 })} Response rate</div><div class="tt-value">${rs.enoughData ? `${rs.responseRate}%` : 'New on HORIZON'}</div><div class="tt-meta">${rs.enoughData ? `answered within ${rs.windowDays} days (${rs.sample} applications)` : 'Not enough applications yet'}</div></div>
      <div class="card trust-tile"><div class="tt-label">${icon('clock', { size: 16 })} Average first response</div><div class="tt-value">${rs.averageResponseDays != null ? `${rs.averageResponseDays} days` : '—'}</div><div class="tt-meta">Promise: within ${rs.windowDays} days</div></div>
    </div>
    <div class="detail">
      <div class="stack gap-6">
        ${o.recruiters.length ? html`<section><div class="section-title"><h2>Meet the recruiters</h2></div><div class="grid grid-2">${o.recruiters.map((r) => html`<div class="card card-pad">
          <div class="row">${personAvatar(r.name)}<div><div class="strong">${r.name}</div><div class="subtle">${r.designation} · ${icon('shieldCheck', { size: 13 })} verified</div></div></div>
          ${r.bio ? html`<p class="small muted mt-16">${r.bio}</p>` : ''}
          ${r.videoUrl ? html`<video controls preload="metadata" src="${r.videoUrl}" class="video-frame" aria-label="Introduction video from ${r.name}"></video>` : ''}</div>`)}</div></section>` : ''}
        <section><div class="section-title"><h2>Open opportunities</h2></div>
          ${o.listings.length ? html`<div class="opp-grid">${o.listings.map((l) => oppCard(l, { saveable: ctx.role === 'student', href: `${ctx.base}/${ctx.role === 'student' ? 'opportunities' : ctx.role === 'admin' ? 'internships' : 'opportunities'}/${l.id}` }))}</div>` : html`<p class="muted">No open listings right now.</p>`}</section>
      </div>
      <aside class="aside-sticky">
        <section class="card card-pad"><h3>${icon('activity')} Responsiveness on HORIZON</h3>
          ${rs.enoughData ? html`<div class="big-figure">${rs.responseRate}%</div><p class="small muted">of HORIZON applications received a first response within ${rs.windowDays} days (${rs.sample} applications).</p>`
    : html`<p class="small muted">Not enough applications yet to publish a response rate${rs.applications ? ` (${rs.applications} so far)` : ''}.</p>`}
          ${rs.averageResponseDays != null ? html`<div class="subtle">Average first response: <strong>${rs.averageResponseDays} days</strong></div>` : ''}
          <p class="subtle xs mt-16 mb-0">Verified recruiters commit to answering every applicant within ${rs.windowDays} days, including a reason when they decline.</p></section>
        <section class="card card-pad"><h3>${icon('shieldCheck')} Verification</h3><ul class="facts">
          <li>${icon('mail')}<div><div class="f-label">Recruiter email domain</div><div class="f-value">${o.emailDomain ? `@${o.emailDomain}` : '—'}</div></div></li>
          <li>${icon('fileCheck')}<div><div class="f-label">Documents reviewed</div><div class="f-value">${o.verified ? 'Yes, by HORIZON' : 'Pending'}</div></div></li></ul></section>
        ${ctx.role === 'student' ? html`<p class="subtle">Concern about this organisation? <a href="${reportLink(ctx.base, 'organisation', o.id, o.name)}">Report it</a>.</p>` : ''}
      </aside>
    </div>`);
  wireSaveButtons(ctx.el);
}
