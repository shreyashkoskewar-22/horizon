import { html, render, on } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get } from '../../lib/api.js';
import { oppCard } from '../../lib/components.js';
import { skeletonCards, empty } from '../../lib/ui.js';
import { pageHeader, wireSaveButtons, trackModal } from '../shared.js';

export default async function saved(ctx) {
  ctx.setTitle('Saved Opportunities');
  ctx.setCrumbs([{ label: 'Saved Opportunities' }]);
  render(ctx.el, html`${pageHeader({ title: 'Saved opportunities', subtitle: 'Your shortlist. Deadlines from saved listings appear on your overview.', actions: html`<a class="btn" href="/app/explore">${icon('compass')} Explore more</a>` })}<h2 class="sr-only">Saved listings</h2><div data-list>${skeletonCards(3)}</div>`);
  const listEl = ctx.el.querySelector('[data-list]');
  let items = [];
  const draw = () => render(listEl, items.length
    ? html`<div class="opp-grid">${items.map((o) => html`<div class="stack gap-2">${oppCard(o)}
        <div class="row gap-2 saved-actions">${!o.isOpen ? html`<span class="badge badge-error">Closed</span>` : ''}${o.applicationStage ? html`<a class="btn btn-sm" href="/app/applications">${icon('columns', { size: 15 })} View in tracker</a>` : o.isOpen ? html`<button class="btn btn-sm" data-track="${o.id}">${icon('plus', { size: 15 })} Track application</button>` : ''}</div></div>`)}</div>`
    : empty({ icon: 'bookmark', title: 'No saved opportunities yet', text: 'Tap the bookmark on any internship to keep it here.', action: html`<a class="btn btn-primary" href="/app/explore">Explore internships</a>` }));
  const load = async () => { items = (await get('/api/saved')).items; draw(); };
  wireSaveButtons(ctx.el, { onChange: (id, nowSaved) => { if (!nowSaved) { items = items.filter((o) => String(o.id) !== String(id)); draw(); } } });
  on(ctx.el, 'click', '[data-track]', (e, b) => trackModal(items.find((o) => String(o.id) === b.dataset.track), { onDone: load }));
  await load();
}
