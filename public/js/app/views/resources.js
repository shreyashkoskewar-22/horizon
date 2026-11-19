import { html, render } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { pageHeader } from '../shared.js';

const GUIDES = [
  {
    id: 'scams', icon: 'shieldCheck', title: 'Spot a fake internship in 60 seconds',
    intro: 'Most internship scams follow the same script. If you see any of these, stop and report it.',
    points: [
      'You’re asked to pay anything — registration, training, “security deposit”, laptop or ID-card fees. Genuine employers don’t charge candidates.',
      'A famous company recruits from a personal email address (Gmail, Outlook) or only over WhatsApp or Telegram.',
      'You get an offer without any interview, or are pressured to accept within hours.',
      'You’re asked early for bank details, OTPs, or Aadhaar/PAN copies “for verification”.',
      'The stipend is far above similar roles for very little work.',
    ],
    outro: html`On HORIZON, verified recruiters can’t charge fees and every listing is reviewed. If anyone contacts you claiming to be from a HORIZON organisation and asks for money, <a href="/app/grievances/new">raise an urgent grievance</a>. If you’ve lost money, report it at <a href="https://cybercrime.gov.in" target="_blank" rel="noopener noreferrer">cybercrime.gov.in</a> or call 1930.`,
  },
  {
    id: 'cv', icon: 'fileText', title: 'Build a CV that works internationally',
    intro: 'International recruiters scan quickly and often use screening software. Make every line easy to read and verify.',
    points: [
      'Keep it to one page for internships (two at most) and export a text-based PDF — never a scan or photo.',
      'Lead each bullet with an action and a result: “Built a forecasting model that cut stock-outs by 12% in a course project”.',
      'Use the same name as your verified HORIZON account and name your institution in full.',
      'Conventions on photos, date of birth and other personal details differ by country — follow the employer’s guidance and leave them out when unsure.',
      'State your expected graduation year; many programmes have eligibility windows.',
    ],
    outro: 'Upload your CV on My Profile to see HORIZON’s validation report and fix issues before recruiters see them.',
  },
  {
    id: 'video', icon: 'video', title: 'Record a 90-second video resume',
    intro: 'A short video lets recruiters meet you before an interview. Aim for clear, specific and warm.',
    points: [
      'Structure: who you are (10s) → two proof points with numbers (40s) → why this kind of role (25s) → a confident close (15s).',
      'Face a window or lamp, put the camera at eye level, and use earphones with a mic for clean audio.',
      'Write bullet prompts, not a script — reading sounds flat.',
      'Keep it under two minutes. Re-record once; don’t chase perfection.',
      'Videos are reviewed by HORIZON before any recruiter sees them, and shared only with organisations you apply to.',
    ],
    outro: 'You can record directly in your browser on My Profile.',
  },
  {
    id: 'cover', icon: 'edit', title: 'Write a cover note that gets read',
    intro: 'For HORIZON applications, 120–200 words is plenty.',
    points: [
      'Open with the specific team or project that interests you — not “I am writing to apply”.',
      'Give one concrete piece of evidence that you can do the work.',
      'Mention logistics that matter: availability dates and willingness to relocate.',
      'Close with a simple line: “I’d welcome the chance to discuss how I can contribute.”',
    ],
  },
  {
    id: 'interviews', icon: 'clock', title: 'Interview across time zones',
    intro: 'Most international first rounds are remote. Small details make a big difference.',
    points: [
      'Confirm the time in writing with both time zones, e.g. “10:30 IST / 13:00 SGT”.',
      'Test your connection, camera and the meeting tool 15 minutes early; keep a phone hotspot ready.',
      'Prepare three STAR stories (Situation, Task, Action, Result) you can adapt to most questions.',
      'Research the organisation’s recent work and prepare two thoughtful questions.',
      'Send a short thank-you note within 24 hours.',
    ],
  },
  {
    id: 'offers', icon: 'award', title: 'Evaluate an international offer',
    intro: 'Before you accept, make sure the offer works financially, legally and academically.',
    points: [
      'Compare the stipend with local rent, transport and insurance — not with Indian salaries.',
      'Ask who handles the visa or permit, who pays for it, and how long it takes.',
      'Check health insurance, accommodation support, working hours and leave.',
      'Confirm with your institution whether the internship needs approval or an agreement for academic credit.',
      'Get the offer in writing on official letterhead from the company’s own domain — and never pay to accept an offer.',
    ],
    outro: 'If the written offer differs from the HORIZON listing, raise a grievance under “Offer differs from the listing”.',
  },
];

export default async function resources(ctx) {
  ctx.setTitle('Career Resources');
  ctx.setCrumbs([{ label: 'Career Resources' }]);
  render(ctx.el, html`${pageHeader({ title: 'Career resources', subtitle: 'Practical guides for applying to international internships with confidence.' })}
    <div class="detail">
      <div class="stack gap-5">${GUIDES.map((g) => html`<section class="card card-pad prose" id="${g.id}">
        <div class="row gap-3"><span class="guide-icon" aria-hidden="true">${icon(g.icon, { size: 22 })}</span><h2 class="mb-0">${g.title}</h2></div>
        <p class="mt-16">${g.intro}</p><ul>${g.points.map((p) => html`<li>${p}</li>`)}</ul>${g.outro ? html`<p class="mb-0">${g.outro}</p>` : ''}</section>`)}</div>
      <aside class="aside-sticky"><nav class="card card-pad" aria-label="Guides"><h3>Guides</h3><ul class="facts">${GUIDES.map((g) => html`<li>${icon(g.icon)}<a href="#${g.id}">${g.title}</a></li>`)}</ul></nav>
        <div class="card card-pad"><h3>${icon('globe')} Country guides</h3><p class="small muted">Sectors, durations and official visa sources for each destination.</p><a class="btn btn-sm btn-block" href="/app/destinations">Open Global Destinations</a></div></aside>
    </div>`);
}
