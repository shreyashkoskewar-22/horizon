import { html, render, $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { mountSiteChrome } from '../lib/site.js';
import { statCard, bars } from '../lib/components.js';
import { fmtDateTime } from '../lib/format.js';

mountSiteChrome();

async function load() {
  const r = await (await fetch('/api/public/grievance-report', { headers: { Accept: 'application/json' } })).json();
  const t = r.totals;
  const pct = (v) => (v == null ? '—' : `${v}%`);
  const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  render($('[data-report]'), html`
    ${r.containsDemoData ? html`<div class="alert alert-demo mb-24">${icon('info')}<div><div class="alert-title">Contains demonstration data</div>This report is generated from the demo database, so the figures illustrate how the report works rather than real-world performance.</div></div>` : ''}
    <div class="stats-grid">
      ${statCard({ label: 'Grievances received', value: t.received, iconName: 'inbox' })}
      ${statCard({ label: 'Currently open', value: t.open, iconName: 'clock' })}
      ${statCard({ label: 'Resolved', value: t.resolved, iconName: 'checkCircle' })}
      ${statCard({ label: 'Acknowledged on time', value: pct(t.acknowledgedWithinTarget), iconName: 'target', meta: `Target: ${r.commitments.ackHours} hours`, accent: true })}
      ${statCard({ label: 'Resolved on time', value: pct(t.resolvedWithinTarget), iconName: 'target', meta: `Target: ${r.commitments.resolveDays} days`, accent: true })}
    </div>
    <div class="grid grid-3">
      ${statCard({ label: 'Median time to acknowledge', value: t.medianAckHours == null ? '—' : `${t.medianAckHours} h`, iconName: 'clock' })}
      ${statCard({ label: 'Median time to resolve', value: t.medianResolutionDays == null ? '—' : `${t.medianResolutionDays} days`, iconName: 'calendar' })}
      ${statCard({ label: 'Average satisfaction', value: t.averageSatisfaction == null ? '—' : `${t.averageSatisfaction} / 5`, iconName: 'star' })}
      ${statCard({ label: 'Escalated to Level 2', value: t.escalated, iconName: 'arrowUpCircle' })}
      ${statCard({ label: 'Listings removed', value: t.listingsRemoved, iconName: 'archive', meta: 'Archived or rejected after review' })}
      ${statCard({ label: 'Accounts suspended', value: t.accountsSuspended, iconName: 'ban' })}
    </div>
    <div class="grid grid-2 mt-24">
      <div class="card card-pad"><h2 class="h3-size mb-16">By category</h2>${bars(r.byCategory.map((c) => ({ label: c.label, value: c.received })), { color: 'var(--teal)' })}</div>
      <div class="card card-pad"><h2 class="h3-size mb-16">Last six months</h2>
        <div class="table-wrap" style="border:0"><table class="table"><thead><tr><th>Month</th><th class="text-right">Received</th><th class="text-right">Resolved</th></tr></thead>
        <tbody>${r.byMonth.map((m) => html`<tr><td>${monthName(m.month)}</td><td class="text-right">${m.received}</td><td class="text-right">${m.resolved}</td></tr>`)}</tbody></table></div></div>
    </div>
    <div class="grid grid-2 mt-24">
      <div class="card card-pad"><h2 class="h3-size">Our commitments</h2><ul class="check-list mt-16">
        <li>${icon('checkCircle', { cls: 'pass' })}<div class="cl-detail text-body">Acknowledge every grievance within ${r.commitments.ackHours} hours.</div></li>
        <li>${icon('checkCircle', { cls: 'pass' })}<div class="cl-detail text-body">Resolve within ${r.commitments.resolveDays} days — ${r.commitments.urgentResolveHours} hours for urgent safety issues such as fee demands or harassment.</div></li>
        <li>${icon('checkCircle', { cls: 'pass' })}<div class="cl-detail text-body">Hear the other party before deciding a grievance against them.</div></li>
        <li>${icon('checkCircle', { cls: 'pass' })}<div class="cl-detail text-body">Allow escalation to the Grievance Officer and appeals within ${r.commitments.appealDays} days.</div></li></ul></div>
      <div class="card card-pad"><h2 class="h3-size">Grievance Officer</h2><p><strong>${r.officer.name}</strong><br><a href="mailto:${r.officer.email}">${r.officer.email}</a></p>
        <p class="subtle">Report generated ${fmtDateTime(r.generatedAt)}. No personal data is included.</p><a class="btn btn-primary" href="/grievance-redressal">Raise or track a grievance</a></div>
    </div>`);
}

load().catch(() => render($('[data-report]'), html`<p class="muted">The report is unavailable right now.</p>`));
