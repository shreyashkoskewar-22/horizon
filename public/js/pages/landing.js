import { html, render, $, $$, debounce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { mountSiteChrome } from '../lib/site.js';
import { oppCard } from '../lib/components.js';
import { empty } from '../lib/ui.js';
import { countryCode } from '../lib/format.js';
import { getConfig } from '../lib/captcha.js';

// Same equirectangular projection as scripts/generate-world-map.js
const W = 1000; const LAT_TOP = 76; const LAT_BOTTOM = -56; const H = (W * (LAT_TOP - LAT_BOTTOM)) / 360;
const project = (lon, lat) => [((lon + 180) / 360) * W, ((LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM)) * H];
const ORIGIN = [77.2, 28.6];
const CITIES = [
  { name: 'London', ll: [-0.13, 51.5], anchor: 'end', dx: -7, dy: -4 },
  { name: 'Paris', ll: [2.35, 48.85] },
  { name: 'Amsterdam', ll: [4.9, 52.37] },
  { name: 'Berlin', ll: [13.4, 52.5], anchor: 'start', dx: 7, dy: -4 },
  { name: 'Zurich', ll: [8.54, 47.37] },
  { name: 'New York', ll: [-74, 40.7], anchor: 'end', dx: -7, dy: 4 },
  { name: 'Tokyo', ll: [139.7, 35.7], anchor: 'start', dx: 7, dy: 4 },
  { name: 'Seoul', ll: [127, 37.57] },
  { name: 'Singapore', ll: [103.8, 1.35], anchor: 'start', dx: 7, dy: 12 },
  { name: 'Sydney', ll: [151.2, -33.87], anchor: 'start', dx: 7, dy: 4 },
  { name: 'Dubai', ll: [55.3, 25.2], anchor: 'end', dx: -7, dy: 12 },
];

function drawArcs() {
  const svg = $('[data-arcs]');
  const [ox, oy] = project(...ORIGIN);
  const arcs = CITIES.map((c, i) => {
    const [x, y] = project(...c.ll);
    const mx = (ox + x) / 2; const my = (oy + y) / 2;
    const dist = Math.hypot(x - ox, y - oy);
    const lift = Math.min(dist * 0.32, 95);
    return html`<path class="arc" style="animation-delay:-${i * 1.3}s" d="M${ox.toFixed(1)} ${oy.toFixed(1)} Q${mx.toFixed(1)} ${(my - lift).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}"/>`;
  });
  const dots = CITIES.map((c, i) => {
    const [x, y] = project(...c.ll);
    return html`<circle class="city-pulse" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" style="animation-delay:${i * 0.25}s"/><circle class="city-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"/>
      ${c.anchor ? html`<text class="city-label" x="${(x + c.dx).toFixed(1)}" y="${(y + c.dy).toFixed(1)}" text-anchor="${c.anchor}">${c.name}</text>` : ''}`;
  });
  render(svg, html`<defs><linearGradient id="arcGrad" x1="0" x2="1"><stop offset="0" stop-color="#D99A38"/><stop offset="1" stop-color="#6FB3AC"/></linearGradient></defs>
    ${arcs}${dots}<circle class="city-pulse" cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="5"/><circle class="origin-dot" cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="3.6"/>
    <text class="city-label" x="${(ox + 8).toFixed(1)}" y="${(oy + 14).toFixed(1)}">India</text>`);
}

const PROBLEMS = [
  { problem: 'Unverifiable listings', title: 'Fake jobs and ghost postings', text: 'Scam listings and roles that were never meant to be filled waste weeks of effort — and some ask students for “registration” or “training” fees.', fix: 'Every listing is reviewed before it goes live, carries its source and a “last verified” date, and expires automatically after its deadline.' },
  { problem: 'Anonymous recruiters', title: 'You can’t tell who is on the other side', text: 'Anyone can claim to be a recruiter on open portals, including impersonators using real company names and personal email addresses.', fix: 'Recruiters verify their work email against the organisation’s domain and submit authorisation documents for human review.' },
  { problem: 'Application black holes', title: 'Applications that vanish', text: 'Most job seekers report being ghosted after interviews. Easy-apply floods leave recruiters unable to reply to anyone.', fix: 'Verified recruiters must respond within 14 days and give every rejected candidate a reason. Response rates are published on each organisation’s page.' },
  { problem: 'Unreliable resumes', title: 'Recruiters can’t trust what they read', text: 'Copied CVs, inflated claims and unreadable scans make screening slow and push recruiters towards brand-name shortcuts.', fix: 'Every CV passes automated checks — name, institution, readable text, no hidden scripts — and can earn a manually verified badge.' },
  { problem: 'Domestic-first portals', title: 'International roles are hard to filter', text: 'Visa sponsorship, stipend currency and eligibility for Indian students are rarely searchable on mainstream portals.', fix: 'Filter by country, visa sponsorship, compensation, duration and academic eligibility — with destination guides that link to official sources.' },
  { problem: 'Complaints go nowhere', title: 'No clear way to raise a problem', text: 'Grievances usually go to a generic inbox with no ticket, no timeline and no way to escalate.', fix: 'Every grievance gets a ticket, a 24-hour acknowledgement target, a 15-day resolution target, a visible timeline and escalation to a Grievance Officer.' },
];

const STEPS = {
  students: [
    ['shieldCheck', 'Verify your enrolment', 'Register with your institutional email. If your institute’s domain isn’t on file, upload your student ID for review.'],
    ['fileCheck', 'Build a validated profile', 'Upload your CV once — HORIZON checks it automatically. Add a short video resume so recruiters meet the real you.'],
    ['compass', 'Discover and apply', 'Filter international roles by country, visa, stipend and eligibility. Apply on HORIZON to verified recruiters, or track external applications.'],
    ['activity', 'Track every step', 'Every recruiter update lands on your board with a notification — no chasing by email, and raise a grievance with a ticket and timeline if anything goes wrong.'],
  ],
  recruiters: [
    ['building', 'Verify your organisation', 'Register with your work email. We match it to your organisation’s domain and review your authorisation documents.'],
    ['edit', 'Post reviewed listings', 'Publish roles with clear compensation, visa support and a no-fee pledge. Our team reviews each listing before it goes live.'],
    ['users', 'Meet verified talent', 'Every applicant is a verified INI student with a validated CV and, often, a moderated video resume.'],
    ['send', 'Close the loop', 'Update statuses and give every candidate an answer within 14 days. Your response rate is shown to students.'],
  ],
};

const BENEFITS = {
  students: ['One verified profile and validated CV for every application', 'Filters for visa sponsorship, stipend currency and eligibility', 'Kanban tracker that syncs automatically with recruiters', 'Explainable recommendations based on your preferences', 'Destination guides linked to official government sources', 'A grievance desk with tickets, deadlines and escalation'],
  recruiters: ['Applicants verified through institutional email or ID review', 'Automated CV validation that flags mismatched or copied CVs', 'Moderated video resumes alongside each application', 'A clear pipeline with status updates and private notes', 'A public response-rate badge that rewards good practice', 'A fair process: respond to grievances before any decision'],
};

const COMMITMENTS = [
  'HORIZON never charges students to apply, and removes any listing that asks for a fee.',
  'We never claim to submit applications for you on external listings — you apply through the employer’s own process and track it here.',
  'Your CV and video are shared only with organisations you apply to on HORIZON.',
  'Demo listings are always labelled “Illustrative” and are never presented as real vacancies.',
  'Visa information always links to official government sources and is not legal advice.',
];

/** Four measurable promises. Numbers come from the server configuration when it loads. */
function heroPromises(cfg) {
  const days = cfg ? cfg.recruiterResponseDays : 14;
  const ack = cfg ? cfg.grievance.ackHours : 24;
  render($('[data-hero-trust]'), [
    ['clock', `Replies within ${days} days`],
    ['ban', 'No-fee pledge on every listing'],
    ['fileCheck', 'CVs validated before recruiters see them'],
    ['scale', `Grievances acknowledged in ${ack} hours`],
  ].map(([ic, text]) => html`<li>${icon(ic)}<span>${text}</span></li>`));
}

/** A static, clearly labelled example of the application timeline and reply clock (no real data). */
function ndExample() {
  render($('[data-nd-example]'), html`<div class="nd-head"><div><div class="nd-title" id="nd-card-title">Data Analytics Intern · Example Organisation</div><div class="subtle small">Applied on HORIZON</div></div><span class="badge badge-demo">Illustrative example</span></div>
    <ol class="timeline nd-timeline">
      <li><span class="tl-dot filled"></span><div class="tl-head">Applied<span class="tl-time">9 Nov</span></div><div class="tl-body">Verified profile and validated CV sent to the organisation.</div></li>
      <li><span class="tl-dot"></span><div class="tl-head">Opened by the recruiter<span class="tl-time">11 Nov</span></div><div class="tl-body">Status moves to “Under review” on your tracker.</div></li>
      <li><span class="tl-dot dashed"></span><div class="tl-head">Reply due<span class="tl-time">23 Nov</span></div>
        <div class="respond-clock tone-teal mt-8"><div class="rc-line">${icon('shieldCheck', { size: 16 })}<span><strong>Reply due 23 Nov</strong> · 9 days left</span></div>
          <div class="rc-track" aria-hidden="true" style="--p:36%"><span class="rc-fill"></span><span class="rc-sun"></span></div><div class="rc-ends" aria-hidden="true"><span>Applied</span><span>Due</span></div></div></li>
      <li><span class="tl-dot success"></span><div class="tl-head">Interview scheduled<span class="tl-time">for 22 Nov</span></div><div class="tl-body">The reply arrived inside the window, so the clock stops.</div></li>
    </ol>`);
}

function swapIcons(root = document) {
  for (const el of $$('[data-ic]', root)) el.outerHTML = String(icon(el.dataset.ic));
}

async function load() {
  const res = await fetch('/api/public/landing', { headers: { Accept: 'application/json' } });
  const data = await res.json();
  const s = data.stats;
  const vals = [s.openListings, s.countries, s.verifiedInstitutions, s.verifiedOrganisations];
  $$('[data-live-stats] strong').forEach((el, i) => { el.textContent = vals[i]; });
  render($('[data-stats-note]'), html`${icon('info', { size: 15 })} Live counts from this HORIZON database${s.containsDemoData ? ' — the current listings are illustrative demo data, not real vacancies' : ''}.`);

  render($('[data-featured]'), data.featured.length
    ? data.featured.map((o) => oppCard({ ...o, summary: '', saved: false }, { saveable: false }))
    : empty({ compact: true, icon: 'compass', title: 'New listings are on their way', text: 'Reviewed opportunities appear here as soon as they are published.' }));
  render($('[data-destinations]'), data.destinations.map((d) => html`<a class="card interactive dest-card" href="/app/explore?country=${encodeURIComponent(d.country)}">
    <span class="flag">${countryCode(d.country)}</span><div><strong>${d.country}</strong><span>${d.count} open listing${d.count === 1 ? '' : 's'}</span></div></a>`));
  render($('[data-industries]'), data.industries.map((i) => html`<a class="industry-pill" href="/app/explore?industry=${encodeURIComponent(i.industry)}">${i.industry}<span class="n">${i.count}</span></a>`));
  const PLURAL = { IIT: 'IITs', IIM: 'IIMs', NIT: 'NITs & IIEST', IIIT: 'IIITs', IISER: 'IISERs', AIIMS: 'AIIMS', NIPER: 'NIPERs', NID: 'NIDs', SPA: 'SPAs', 'Central University': 'Central universities', 'Medical & Health': 'Medical & health institutes', 'Other INI': 'Other INIs' };
  render($('[data-categories]'), data.institutionCategories.map((c) => html`<div class="cat-tile"><strong>${c.count}</strong><span>${PLURAL[c.category] || c.category}</span></div>`));
}

function institutionChecker() {
  const input = $('#ini-check');
  const out = $('[data-ini-results]');
  let list = null;
  const run = debounce(async () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { render(out, ''); return; }
    if (!list) list = (await (await fetch('/api/public/institutions')).json()).items;
    const terms = q.split(/\s+/);
    const hits = list.filter((i) => terms.every((t) => `${i.name} ${i.shortName || ''} ${i.city || ''}`.toLowerCase().includes(t))).slice(0, 5);
    render(out, hits.length
      ? html`<ul class="check-list on-dark">${hits.map((i) => html`<li>${icon('checkCircle', { cls: 'pass' })}<div><div class="cl-label">${i.name}</div><div class="cl-detail">${i.category} · ${i.city || ''} · eligible${i.domains.length ? ` · auto-verifies @${i.domains[0]}` : ' · verified by student ID'}</div></div></li>`)}</ul>`
      : html`<p class="small ini-miss">${icon('alertCircle', { size: 15 })} Not on HORIZON’s list of Institutions of National Importance. Private, deemed and state universities are only eligible if Parliament has declared them INIs. Think your institution is missing? <a href="/grievance-redressal">Tell us</a>.</p>`);
  }, 200);
  input.addEventListener('input', run);
}

function steps(audience) {
  render($('[data-steps]'), STEPS[audience].map(([ic, title, text]) => html`<div class="card step"><div class="step-icon">${icon(ic, { size: 22 })}</div><h3>${title}</h3><p>${text}</p></div>`));
}

async function init() {
  mountSiteChrome({ dark: true });
  swapIcons();
  drawArcs();
  heroPromises();
  ndExample();
  render($('[data-problems]'), PROBLEMS.map((p) => html`<article class="card problem-card"><div class="pc-problem">${p.problem}</div><h3>${p.title}</h3><p>${p.text}</p><div class="pc-fix">${icon('checkCircle', { size: 20 })}<span><strong>The HORIZON fix:</strong> ${p.fix}</span></div></article>`));
  steps('students');
  $$('input[name=audience]').forEach((r) => r.addEventListener('change', () => steps(r.value)));
  render($('[data-benefits]'), html`
    <div class="card benefit-col"><h3>${icon('graduation', { size: 22 })} For students</h3><ul>${BENEFITS.students.map((b) => html`<li>${icon('check')}${b}</li>`)}</ul><a class="btn btn-primary mt-24" href="/register">Create a student account</a></div>
    <div class="card benefit-col"><h3>${icon('building', { size: 22 })} For recruiters</h3><ul>${BENEFITS.recruiters.map((b) => html`<li>${icon('check')}${b}</li>`)}</ul><a class="btn mt-24" href="/register?as=recruiter">Register your organisation</a></div>`);
  render($('[data-commitments]'), COMMITMENTS.map((c) => html`<li>${icon('checkCircle', { cls: 'pass' })}<div class="cl-detail text-body">${c}</div></li>`));
  const cfg = await getConfig().catch(() => null);
  if (cfg) {
    const g = cfg.grievance;
    heroPromises(cfg);
    render($('[data-grievance-commitments]'), [
      ['clock', `${g.ackHours} hours`, 'to acknowledge every grievance'],
      ['target', `${g.resolveDays} days`, `resolution target (${g.urgentResolveHours} hours for urgent safety issues)`],
      ['arrowUpCircle', 'Escalation', `to the Grievance Officer, plus a ${g.appealDays}-day appeal window`],
    ].map(([ic, big, small]) => html`<div class="row card card-pad gap-4 commit-tile"><span class="step-icon">${icon(ic, { size: 20 })}</span><div><strong>${big}</strong><div class="muted small">${small}</div></div></div>`));
  }
  institutionChecker();
  load().catch(() => render($('[data-featured]'), html`<p class="muted">Live data is unavailable right now.</p>`));
}

init();
