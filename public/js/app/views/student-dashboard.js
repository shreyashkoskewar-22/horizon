import { html, render } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get } from '../../lib/api.js';
import { oppCard, statCard, dateChip, docBadge, respondClock, demoNotice, wireDemoNotice } from '../../lib/components.js';
import { skeletonDashboard, empty } from '../../lib/ui.js';
import { greeting, LABELS, fmtDateTime, fmtShort, countryCode, daysUntil, relativeDay, plural } from '../../lib/format.js';
import { wireSaveButtons } from '../shared.js';

const ACTION_ICON = { interview_soon: 'calendar', interview_upcoming: 'calendar', reply_overdue: 'alertTriangle', deadline_soon: 'clock', personal_deadline: 'flag', profile_blocker: 'fileText' };
const ACTION_LABEL = { interview_soon: 'Prepare', interview_upcoming: 'Prepare', reply_overdue: 'Review', deadline_soon: 'View listing', personal_deadline: 'Open', profile_blocker: 'Go to profile' };
const stageLabel = (s) => LABELS.stage[s].replace(' Application', '').replace(' Received', '').replace('Online ', '');

function dueText(a) {
  if (!a.dueAt) return '';
  if (a.type === 'reply_overdue') return `Was due ${fmtShort(a.dueAt)}`;
  const when = relativeDay(a.dueAt);
  const time = a.dueAt.includes('T') && a.type.startsWith('interview') ? fmtDateTime(a.dueAt) : fmtShort(a.dueAt);
  return `${when[0].toUpperCase()}${when.slice(1)} · ${time}`;
}

function nextUp(actions) {
  if (!actions.length) {
    return html`<section class="card next-up" aria-labelledby="next-h"><div class="card-header"><h2 id="next-h">${icon('target', { size: 20 })} Next up</h2></div>
      ${empty({ compact: true, icon: 'checkCircle', title: 'You’re all caught up.', text: 'Nothing needs your attention right now. Explore new opportunities.', action: html`<a class="btn btn-primary btn-sm" href="/app/explore">Explore opportunities</a>` })}</section>`;
  }
  return html`<section class="card next-up" aria-labelledby="next-h">
    <div class="card-header"><h2 id="next-h">${icon('target', { size: 20 })} Next up</h2><span class="subtle small">${plural(actions.length, 'thing')} to do, most urgent first</span></div>
    <ol class="next-list">${actions.map((a) => {
    const soon = a.dueAt && daysUntil(a.dueAt) != null && daysUntil(a.dueAt) <= 2;
    return html`<li class="next-item p-${a.priority}">
      <span class="ni-ic" aria-hidden="true">${icon(ACTION_ICON[a.type] || 'arrowRight', { size: 18 })}</span>
      <div class="ni-title">${a.title}</div>
      <div class="ni-sub"><span>${a.subtitle}</span>${a.dueAt ? html`<span class="ni-due ${soon || a.type === 'reply_overdue' ? 'soon' : ''}">${dueText(a)}</span>` : ''}</div>
      <a class="btn btn-sm ni-act" href="${a.href}" aria-label="${ACTION_LABEL[a.type] || 'Open'}: ${a.title}">${ACTION_LABEL[a.type] || 'Open'}</a>
    </li>`;
  })}</ol></section>`;
}

function replyStrip(r) {
  if (!r) return '';
  const n = r.next;
  return html`<section class="card reply-strip" aria-labelledby="reply-h">
    <div><div class="rs-title" id="reply-h">${r.count > 1 ? `${r.count} HORIZON applications waiting for a reply` : 'Waiting for a reply'}${r.overdue ? html` · <span class="text-error">${r.overdue} overdue</span>` : ''}</div>
      <div class="rs-app">${n.title} <span class="muted">· ${n.organisation}</span></div>
      ${respondClock({ ...n, channel: 'horizon' }, { windowDays: r.windowDays })}</div>
    <a class="btn btn-sm" href="/app/applications?open=${n.id}">${icon('columns', { size: 16 })} My applications</a>
  </section>`;
}

function profileBar(c) {
  if (c.percent >= 100) return '';
  const next = c.missing.slice(0, 1).join('');
  return html`<section class="card profile-bar" aria-label="Profile strength">
    <span class="pb-label">Profile strength <span class="strong">${c.percent}%</span></span>
    <div class="progress gold" role="progressbar" aria-valuenow="${c.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Profile ${c.percent}% complete"><span style="width:${c.percent}%"></span></div>
    <span class="pb-next truncate">${next ? `Next: ${next}` : ''}</span>
    <a class="btn btn-sm pb-btn" href="/app/profile" aria-label="Complete your profile${next ? ` — next: ${next}` : ''}"><span class="pb-btn-text">Complete profile</span>${icon('arrowRight', { size: 16 })}</a>
  </section>`;
}

export default async function dashboard(ctx) {
  ctx.setTitle('Overview');
  ctx.setCrumbs([{ label: 'Overview' }]);
  render(ctx.el, skeletonDashboard());
  const d = await get('/api/dashboard');
  const sourceLabel = { saved: 'Saved', 'application deadline': 'Application deadline', 'personal deadline': 'Your deadline', interview: 'Interview' };
  const open = d.stats.totalOpportunities;
  render(ctx.el, html`
    ${d.containsDemoData ? demoNotice() : ''}
    <section class="welcome compact" aria-labelledby="hello-h">
      <img class="wl-map" src="/img/world-dots.svg" alt="" width="1000" height="367">
      <div class="wl-text">
        <h1 id="hello-h">${greeting()}, ${d.user.firstName}.</h1>
        <p>${d.user.programme} · ${d.user.institution}</p>
        <div class="wl-meta"><span class="badge">${icon('shieldCheck')} Verified INI student</span><span class="badge">Year ${d.user.currentYear} · Class of ${d.user.graduationYear}</span></div>
      </div>
      <div class="wl-actions"><a class="btn btn-accent" href="/app/explore">${icon('compass')} ${open ? `Explore ${open} open internships` : 'Explore internships'}</a></div>
    </section>

    ${nextUp(d.nextActions || [])}
    ${replyStrip(d.awaitingReply)}
    ${profileBar(d.profile.completion)}

    <div class="stat-row">
      ${statCard({ label: 'Saved', value: d.stats.saved, iconName: 'bookmark', href: '/app/saved' })}
      ${statCard({ label: 'Applied', value: d.stats.applicationsSubmitted, iconName: 'send', href: '/app/applications' })}
      ${statCard({ label: 'Interviews', value: d.stats.interviews, iconName: 'users', href: '/app/applications?stage=interview' })}
      ${statCard({ label: 'Offers', value: d.stats.offers, iconName: 'award', href: '/app/applications?stage=offer' })}
    </div>

    <div class="dash-grid dash-flow">
      <div class="dash-col">
        <section class="d-rec" aria-labelledby="rec-h">
          <div class="section-title"><h2 id="rec-h">${icon('sparkles')} Recommended for you</h2><a href="/app/profile">Tune preferences</a></div>
          ${d.recommended.length ? html`<div class="opp-grid">${d.recommended.map((o) => oppCard(o, { reasons: o.reasons }))}</div>`
    : html`<div class="card">${empty({ icon: 'sparkles', title: 'Tell us what you’re looking for', text: 'Add preferred countries, industries and skills to your profile to get recommendations.', action: html`<a class="btn btn-primary" href="/app/profile">Update profile</a>` })}</div>`}
        </section>
        <section class="card d-prog" aria-labelledby="prog-h">
          <div class="card-header"><h2 id="prog-h">Application progress</h2><a class="btn btn-sm" href="/app/applications">Open board</a></div>
          <div class="card-body"><div class="pipeline">${d.progress.map((p) => html`<a class="pl-step" href="/app/applications?stage=${p.stage}" aria-label="${LABELS.stage[p.stage]}: ${p.count}"><div class="pl-count">${p.count}</div><div class="pl-label">${stageLabel(p.stage)}</div></a>`)}</div></div>
        </section>
        <section class="d-recent" aria-labelledby="recent-h">
          <div class="section-title"><h2 id="recent-h">Recently added</h2><a href="/app/explore?sort=recent">View all</a></div>
          ${d.recent.length ? html`<div class="opp-grid">${d.recent.map((o) => oppCard(o))}</div>` : html`<div class="card">${empty({ compact: true, icon: 'compass', title: 'No new listings this week', text: 'New internships appear here as soon as they are reviewed.' })}</div>`}
        </section>
      </div>
      <div class="dash-col">
        <section class="card d-dl" aria-labelledby="dl-h">
          <div class="card-header"><h2 id="dl-h">${icon('calendar')} Upcoming deadlines</h2></div>
          ${d.deadlines.length ? html`<div class="card-body tight-y"><ul class="mini-list">${d.deadlines.map((x) => html`<li>${dateChip(x.date)}<div class="grow"><a class="ml-title" href="${x.applicationId ? `/app/applications?open=${x.applicationId}` : `/app/opportunities/${x.id}`}">${x.title}</a><div class="ml-sub">${x.org} · ${sourceLabel[x.source] || x.source}${x.source === 'interview' ? ` · ${fmtDateTime(x.date)}` : ''}</div></div></li>`)}</ul></div>`
    : empty({ compact: true, icon: 'calendar', text: 'Nothing due soon. Save or track opportunities to see their deadlines here.' })}
        </section>
        <section class="card d-saved" aria-labelledby="sv-h">
          <div class="card-header"><h2 id="sv-h">${icon('bookmark')} Saved opportunities</h2><a class="small strong" href="/app/saved">All saved</a></div>
          ${d.saved.length ? html`<div class="card-body tight-y"><ul class="mini-list">${d.saved.map((o) => html`<li><span class="avatar sm org-logo" aria-hidden="true">${o.organisation.initials}</span><div class="grow"><a class="ml-title" href="/app/opportunities/${o.id}">${o.title}</a><div class="ml-sub">${o.organisation.name} · closes ${fmtShort(o.deadline)}</div></div></li>`)}</ul></div>`
    : empty({ compact: true, icon: 'bookmark', text: 'Use the bookmark on any listing to keep it here.', action: html`<a class="btn btn-sm" href="/app/explore">Find listings</a>` })}
        </section>
        <section class="card d-dest" aria-labelledby="ds-h">
          <div class="card-header"><h2 id="ds-h">${icon('globe')} Explore destinations</h2><a class="small strong" href="/app/destinations">Guides</a></div>
          <div class="card-body"><div class="dest-tiles">${d.destinations.map((x) => html`<a class="dest-tile" href="${x.slug ? `/app/destinations/${x.slug}` : `/app/explore?country=${encodeURIComponent(x.country)}`}"><strong>${x.country}</strong><span>${countryCode(x.country)} · ${x.count} open</span></a>`)}</div></div>
        </section>
        <section class="card d-docs" aria-labelledby="docs-h">
          <div class="card-header"><h2 id="docs-h">${icon('fileText')} Your documents</h2></div>
          <div class="card-body tight-y">
            <div class="doc-row"><span>${icon('fileText')} CV</span>${d.profile.cvStatus ? docBadge(d.profile.cvStatus) : html`<a class="small strong" href="/app/profile">Upload</a>`}</div>
            <div class="doc-row"><span>${icon('video')} Video resume</span>${d.profile.videoStatus ? docBadge(d.profile.videoStatus) : html`<a class="small strong" href="/app/profile">Add</a>`}</div>
          </div>
        </section>
      </div>
    </div>`);
  wireSaveButtons(ctx.el);
  wireDemoNotice(ctx.el);
}
