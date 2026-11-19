import { html, render, safeUrl } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get } from '../../lib/api.js';
import { oppCard, extLink } from '../../lib/components.js';
import { fmtDate, countryCode, plural } from '../../lib/format.js';
import { pageHeader, wireSaveButtons } from '../shared.js';

/** "Last updated" and "Official source" as quiet chips on every guide. */
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const guideMeta = (d, { link = false } = {}) => html`<span class="chip chip-quiet">${icon('calendar', { size: 13 })} Last updated ${fmtDate(d.lastUpdated)}</span>${d.sourceUrl ? (link ? html`<a class="chip chip-quiet" href="${safeUrl(d.sourceUrl)}" target="_blank" rel="noopener noreferrer">${icon('externalLink', { size: 13 })} Official source: ${host(d.sourceUrl)}</a>` : html`<span class="chip chip-quiet">${icon('shieldCheck', { size: 13 })} Official source: ${host(d.sourceUrl)}</span>`) : ''}`;

const DISCLAIMER = html`<div class="alert alert-warning">${icon('info')}<div><div class="alert-title">General information, not legal advice</div>Visa and work-authorisation rules change and depend on your nationality, the role and its duration. Always confirm requirements on the official government sources linked here and with your employer before making plans.</div></div>`;

export default async function destinations(ctx) {
  if (ctx.params.slug) return detail(ctx);
  ctx.setTitle('Global Destinations');
  ctx.setCrumbs([{ label: 'Global Destinations' }]);
  const { items } = await get('/api/destinations');
  render(ctx.el, html`${pageHeader({ title: 'Global destinations', subtitle: 'Understand internship markets before you apply — sectors, typical durations and official visa resources.' })}
    <h2 class="sr-only">Destination guides</h2><div class="opp-grid">${items.map((d) => html`<a class="card interactive card-pad dest-guide" href="/app/destinations/${d.slug}">
      <div class="row"><span class="avatar org-logo">${countryCode(d.country)}</span><div class="grow"><h3 class="mb-0">${d.country}</h3><div class="subtle">${d.region}</div></div><span class="badge badge-teal">${plural(d.openListings, 'open listing')}</span></div>
      <p class="muted small mb-0 clamp-3">${d.overview}</p>
      <div class="chips">${d.majorSectors.slice(0, 4).map((s) => html`<span class="chip">${s}</span>`)}</div>
      <div class="guide-meta">${guideMeta(d)}</div></a>`)}</div>
    <div class="mt-24">${DISCLAIMER}</div>`);
  return undefined;
}

async function detail(ctx) {
  const d = await get(`/api/destinations/${encodeURIComponent(ctx.params.slug)}`);
  const isAdmin = ctx.role === 'admin';
  const exploreUrl = isAdmin ? `/admin/internships?q=${encodeURIComponent(d.country)}` : `/app/explore?country=${encodeURIComponent(d.country)}`;
  ctx.setTitle(d.country);
  if (isAdmin) ctx.setActive('/admin/resources');
  ctx.setCrumbs([{ label: isAdmin ? 'Global Resources' : 'Global Destinations', href: isAdmin ? '/admin/resources' : '/app/destinations' }, { label: d.country }]);
  const links = (arr) => html`<ul class="facts">${arr.map((l) => html`<li>${icon('link')}<div>${extLink(l.url, l.label)}<div class="subtle xs">${new URL(l.url).hostname}</div></div></li>`)}</ul>`;
  render(ctx.el, html`
    <section class="welcome"><img class="wl-map" src="/img/world-dots.svg" alt="" width="1000" height="367"><div class="wl-text"><span class="badge">${d.region}</span><h1 class="mt-8">${d.country}</h1><p>${plural(d.openListings, 'open listing')} on HORIZON</p><div class="guide-meta on-dark mt-8">${guideMeta(d, { link: true })}</div></div>
      <div class="wl-actions"><a class="btn btn-accent" href="${exploreUrl}">${icon('compass')} Browse ${d.country} internships</a></div></section>
    ${isAdmin ? html`<div class="alert alert-info mb-16">${icon('eye')}<div>Preview — this is how students see the guide. <a href="/admin/resources">Back to Global Resources</a></div></div>` : ''}
    <div class="detail">
      <div class="stack gap-5">
        <section class="card card-pad prose"><h2>Overview</h2><p>${d.overview}</p>
          <h3>Major internship sectors</h3><div class="chips">${d.majorSectors.map((s) => html`<span class="chip">${s}</span>`)}</div>
          ${d.commonDurations ? html`<h3>Common internship durations</h3><p>${d.commonDurations}</p>` : ''}
          ${d.workArrangements ? html`<h3>International student work arrangements</h3><p class="pre">${d.workArrangements}</p>` : ''}
          ${d.relocationConsiderations ? html`<h3>Relocation considerations</h3><p class="pre">${d.relocationConsiderations}</p>` : ''}</section>
        ${DISCLAIMER}
        <section><div class="section-title"><h2>Open internships in ${d.country}</h2><a href="${exploreUrl}">View all</a></div>
          ${d.listings.length ? html`<div class="opp-grid">${d.listings.map((o) => oppCard(o, isAdmin ? { saveable: false, href: `/admin/internships/${o.id}` } : {}))}</div>` : html`<p class="muted">No open listings right now.</p>`}</section>
      </div>
      <aside class="aside-sticky">
        <section class="card card-pad"><h3>${icon('passport')} Visa &amp; work authorisation</h3>${links(d.visaResources)}</section>
        ${d.officialLinks.length ? html`<section class="card card-pad"><h3>${icon('building')} Official information</h3>${links(d.officialLinks)}</section>` : ''}
        <section class="card card-pad small"><div class="subtle">Official source</div>${extLink(d.sourceUrl, new URL(d.sourceUrl).hostname)}<div class="subtle mt-8">Last updated by HORIZON: <strong>${fmtDate(d.lastUpdated)}</strong></div></section>
      </aside>
    </div>`);
  wireSaveButtons(ctx.el);
}
