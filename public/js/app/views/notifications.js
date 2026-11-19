import { html, render, on } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, post } from '../../lib/api.js';
import { empty, toast } from '../../lib/ui.js';
import { fmtDateTime, timeAgo, dayGroup } from '../../lib/format.js';
import { pageHeader } from '../shared.js';

const ICONS = { verification: 'shieldCheck', application: 'send', applicant: 'users', grievance: 'scale', document: 'fileCheck', listing: 'briefcase', account: 'user' };

export default async function notifications(ctx) {
  ctx.setTitle('Notifications');
  ctx.setCrumbs([{ label: 'Notifications' }]);
  const load = async () => {
    const data = await get('/api/notifications');
    const groups = [];
    for (const n of data.items) {
      const day = dayGroup(n.createdAt);
      if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, items: [] });
      groups[groups.length - 1].items.push(n);
    }
    render(ctx.el, html`${pageHeader({ title: 'Notifications', subtitle: data.unread ? `${data.unread} unread` : 'You’re all caught up.', actions: data.unread ? html`<button class="btn" data-readall>${icon('check')} Mark all read</button>` : '' })}
      ${data.items.length ? html`<div class="stack gap-5">${groups.map((g) => html`<section aria-labelledby="day-${g.day}">
        <h2 class="label-caps mb-8" id="day-${g.day}">${g.day}</h2>
        <div class="card notif-list">${g.items.map((n) => html`<a class="notif-item ${n.read ? '' : 'unread'}" href="${n.link || '#'}" data-nid="${n.id}">
          <span class="ni-icon" aria-hidden="true">${icon(ICONS[n.type] || 'bell', { size: 16 })}</span>
          <div class="grow"><div class="ni-title">${n.read ? '' : html`<span class="sr-only">Unread: </span>`}${n.title}</div>${n.body ? html`<div class="ni-body">${n.body}</div>` : ''}<div class="ni-time" title="${fmtDateTime(n.createdAt)}">${timeAgo(n.createdAt)}</div></div>
          <span class="ni-dot ${n.read ? 'read' : ''}" aria-hidden="true"></span></a>`)}</div></section>`)}</div>`
    : html`<div class="card">${empty({ icon: 'bell', title: 'No notifications yet', text: 'Updates on your verification, applications and grievances will appear here.' })}</div>`}`);
  };
  on(ctx.el, 'click', '[data-readall]', async () => { await post('/api/notifications/read-all', {}); toast('All notifications marked as read.'); ctx.refreshBell(); load(); });
  on(ctx.el, 'click', '[data-nid]', (e, a) => { post(`/api/notifications/${a.dataset.nid}/read`, {}).then(ctx.refreshBell).catch(() => {}); });
  await load();
}
