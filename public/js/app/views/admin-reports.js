import { html, render, on } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get } from '../../lib/api.js';
import { bars, statCard } from '../../lib/components.js';
import { skeletonPage } from '../../lib/ui.js';
import { LABELS, fmtDateTime } from '../../lib/format.js';
import { pageHeader } from '../shared.js';

const cap = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default async function adminReports(ctx) {
  ctx.setTitle('Reports');
  ctx.setCrumbs([{ label: 'Reports' }]);
  render(ctx.el, skeletonPage());
  const r = await get('/api/admin/reports');
  const a = r.applications;
  const responseRate = a.horizonSubmitted ? Math.round((a.horizonResponded / a.horizonSubmitted) * 100) : null;
  const g = r.grievances;
  const panel = (title, rows, opts) => html`<section class="card card-pad"><h3>${title}</h3>${rows.length && rows.some((x) => x.value) ? bars(rows, opts) : html`<p class="muted mb-0">No data yet.</p>`}</section>`;

  render(ctx.el, html`${pageHeader({ title: 'Reports', subtitle: `Generated ${fmtDateTime(r.generatedAt)} from this database.`, actions: html`<button class="btn" data-print>${icon('download')} Print / save as PDF</button>` })}
    ${r.containsDemoData ? html`<div class="alert alert-demo mb-24">${icon('info')}<div><strong>Illustrative demo data.</strong> These figures are computed from the seeded demo records in this installation. They are not real platform statistics and must not be published as such.</div></div>` : ''}
    <div class="stats-grid">
      ${statCard({ label: 'Students', value: r.students.total, iconName: 'graduation' })}
      ${statCard({ label: 'Recruiters', value: r.recruiters.total, iconName: 'building', meta: `${r.recruiters.verifiedOrganisations} verified organisations` })}
      ${statCard({ label: 'Active internships', value: r.internships.active, iconName: 'briefcase', meta: r.internships.paidShare != null ? `${r.internships.paidShare}% paid` : '' })}
      ${statCard({ label: 'Applications tracked', value: a.total, iconName: 'columns', meta: `${a.savedOpportunities} saved listings` })}
      ${statCard({ label: 'HORIZON response rate', value: responseRate != null ? `${responseRate}%` : '—', iconName: 'activity', meta: a.averageResponseDays != null ? `avg ${a.averageResponseDays} days to first response` : 'No responses yet' })}
    </div>
    <div class="grid grid-2 gap-5">
      ${panel('Students by institution', r.students.byInstitution)}
      ${panel('Students by verification method', r.students.byMethod.map((x) => ({ ...x, label: { email_domain: 'Institutional email domain', manual: 'Manual review', seed: 'Demo seed' }[x.label] || cap(x.label) })))}
      ${panel('Students by account status', r.students.byStatus.map((x) => ({ ...x, label: LABELS.user[x.label] || x.label })))}
      ${panel('Recruiters by account status', r.recruiters.byStatus.map((x) => ({ ...x, label: LABELS.user[x.label] || x.label })))}
      ${panel('Open internships by country', r.internships.byCountry, { color: 'var(--teal)' })}
      ${panel('Open internships by industry', r.internships.byIndustry, { color: 'var(--teal)' })}
      ${panel('Listings by status', r.internships.byStatus.map((x) => ({ ...x, label: LABELS.listing[x.label] || x.label })))}
      ${panel('How students apply', r.internships.byMode, { color: 'var(--gold)' })}
      ${panel('Applications by stage', a.byStage.map((x) => ({ ...x, label: LABELS.stage[x.label] || x.label })), { color: 'var(--gold)' })}
      ${panel('CVs by validation status', r.documents.cvs.map((x) => ({ ...x, label: LABELS.doc[x.label] || x.label })))}
      ${panel('Video resumes by moderation status', r.documents.videos.map((x) => ({ ...x, label: LABELS.doc[x.label] || x.label })))}
      ${panel('Verification requests', r.verifications.byStatus.map((x) => ({ ...x, label: cap(x.label) })))}
    </div>
    <section class="card card-pad mt-24"><div class="row between wrap"><h3 class="mb-0">${icon('scale')} Grievance redressal</h3><a class="btn btn-sm" href="/transparency" data-external target="_blank" rel="noopener">Public report</a></div>
      <div class="kv mt-16">
        <div>Received</div><div>${g.received}</div><div>Resolved or closed</div><div>${g.resolved}</div><div>Open</div><div>${g.open}</div>
        <div>Acknowledged within ${ctx.cfg.grievance.ackHours} h</div><div>${g.acknowledgedWithinTarget != null ? `${g.acknowledgedWithinTarget}%` : '—'}</div>
        <div>Resolved within target</div><div>${g.resolvedWithinTarget != null ? `${g.resolvedWithinTarget}%` : '—'}</div>
        <div>Median hours to acknowledge</div><div>${g.medianAckHours != null ? g.medianAckHours : '—'}</div>
        <div>Median days to resolve</div><div>${g.medianResolutionDays != null ? g.medianResolutionDays : '—'}</div>
        <div>Escalated to Level 2</div><div>${g.escalated}</div>
        <div>Average satisfaction</div><div>${g.averageSatisfaction != null ? `${g.averageSatisfaction} / 5` : '—'}</div>
        <div>Listings removed · accounts suspended</div><div>${g.listingsRemoved} · ${g.accountsSuspended}</div>
      </div>
      ${r.verifications.averageReviewHours != null ? html`<p class="subtle mt-16 mb-0">Average manual verification turnaround: <strong>${r.verifications.averageReviewHours} hours</strong>.</p>` : ''}</section>`);
  on(ctx.el, 'click', '[data-print]', () => window.print());
}
