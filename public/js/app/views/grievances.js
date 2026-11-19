import { html, render, $ } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get } from '../../lib/api.js';
import { empty } from '../../lib/ui.js';
import { grievanceForm, wireGrievanceForm, grievanceView, wireGrievanceView, grievanceList, EXTERNAL_AVENUES } from '../../shared/grievance-ui.js';
import { pageHeader } from '../shared.js';

export default async function grievances(ctx) {
  const base = `${ctx.base}/grievances`;
  if (ctx.pattern.endsWith('/new')) return newGrievance(ctx, base);
  if (ctx.params.id) return detail(ctx, base);
  ctx.setTitle('Grievance Desk');
  ctx.setCrumbs([{ label: 'Grievance Desk' }]);
  const data = await get('/api/grievances/mine');
  render(ctx.el, html`${pageHeader({
    title: 'Grievance desk',
    subtitle: `Every grievance gets a ticket, a ${ctx.cfg.grievance.ackHours}-hour acknowledgement target and a ${ctx.cfg.grievance.resolveDays}-day resolution target.`,
    actions: html`<a class="btn" href="/transparency" data-external>${icon('barChart')} Transparency report</a><a class="btn btn-primary" href="${base}/new">${icon('plus')} File a grievance</a>`,
  })}
    ${ctx.role === 'recruiter' ? html`<section class="mb-24"><div class="section-title"><h2>${icon('scale')} Concerning your organisation</h2></div>
      ${data.concerning.length ? html`<div class="alert alert-warning mb-16">${icon('info')}<div>The grievance desk has asked your organisation to respond to these. Your reply is shared with the complainant and considered before any decision.</div></div>${grievanceList(data.concerning, { base })}`
    : html`<div class="card card-pad"><p class="muted mb-0">No grievances concerning your organisation need a response.</p></div>`}</section>` : ''}
    <section><div class="section-title"><h2>Grievances you filed</h2></div>
      ${data.filed.length ? grievanceList(data.filed, { base }) : html`<div class="card">${empty({ icon: 'scale', title: 'No grievances filed', text: 'If something goes wrong — a fee request, a misleading listing, a verification decision — tell us here.', action: html`<a class="btn btn-primary" href="${base}/new">File a grievance</a>` })}</div>`}</section>`);
  return undefined;
}

async function newGrievance(ctx, base) {
  ctx.setTitle('File a grievance');
  ctx.setCrumbs([{ label: 'Grievance Desk', href: base }, { label: 'File a grievance' }]);
  const q = ctx.query;
  const prefill = q.againstType && q.againstId ? { againstType: q.againstType, againstId: q.againstId, againstLabel: q.label || `${q.againstType} #${q.againstId}`, category: q.category || (q.againstType === 'opportunity' ? 'fake_listing' : undefined) } : {};
  render(ctx.el, html`${pageHeader({ title: 'File a grievance', subtitle: 'Tell us what happened. You’ll get a ticket number straight away and can follow every step.' })}
    <div class="detail"><div class="card card-pad" data-slot></div>
      <aside class="aside-sticky"><div class="card card-pad"><h2 class="h3-size">What happens next</h2><ul class="check-list mt-8">
        <li>${icon('checkCircle', { cls: 'pass' })}<div class="cl-detail text-body">Acknowledged by a person within ${ctx.cfg.grievance.ackHours} hours.</div></li>
        <li>${icon('checkCircle', { cls: 'pass' })}<div class="cl-detail text-body">If it concerns an organisation, they’re asked to respond before any decision.</div></li>
        <li>${icon('checkCircle', { cls: 'pass' })}<div class="cl-detail text-body">Resolved within ${ctx.cfg.grievance.resolveDays} days (${ctx.cfg.grievance.urgentResolveHours} hours for fee demands or harassment).</div></li>
        <li>${icon('checkCircle', { cls: 'pass' })}<div class="cl-detail text-body">Escalate to the Grievance Officer if a deadline passes or you disagree.</div></li></ul></div>
        <div class="card card-pad"><h2 class="h3-size">Other avenues</h2>${EXTERNAL_AVENUES}</div></aside></div>`);
  render($('[data-slot]', ctx.el), grievanceForm({ cfg: ctx.cfg, user: ctx.user, prefill }));
  wireGrievanceForm($('[data-grievance-form]', ctx.el), { user: ctx.user, captcha: null, onDone: (res) => ctx.navigate(`${base}/${res.id}`) });
}

async function detail(ctx, base) {
  const g = await get(`/api/grievances/${ctx.params.id}`);
  ctx.setTitle(g.ticketNo);
  ctx.setCrumbs([{ label: 'Grievance Desk', href: base }, { label: g.ticketNo }]);
  const draw = (data) => {
    render(ctx.el, grievanceView(data));
    wireGrievanceView(ctx.el, data, { reload: draw });
  };
  draw(g);
}
