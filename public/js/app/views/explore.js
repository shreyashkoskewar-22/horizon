import { html, render, $, $$, on, debounce } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get } from '../../lib/api.js';
import { oppCard, pagination, demoNotice, wireDemoNotice } from '../../lib/components.js';
import { skeletonCards, empty, errorState } from '../../lib/ui.js';
import { LABELS, plural } from '../../lib/format.js';
import { pageHeader, wireSaveButtons } from '../shared.js';

const MULTI = ['country', 'industry', 'orgType', 'workMode', 'visa'];
const SINGLE = ['q', 'paid', 'minComp', 'maxComp', 'duration', 'deadline', 'level', 'year', 'mode', 'sort', 'page'];
const SHOW_FIRST = 6;

/** Quick filters: each toggles one value of an existing filter. */
const QUICK = [
  { id: 'paid', label: 'Paid', key: 'paid', value: 'paid' },
  { id: 'visa', label: 'Visa sponsored', key: 'visa', value: 'yes', multi: true },
  { id: 'remote', label: 'Remote', key: 'workMode', value: 'remote', multi: true },
  { id: 'soon', label: 'Closing within 30 days', key: 'deadline', value: 'month' },
  { id: 'horizon', label: 'Apply on HORIZON', key: 'mode', value: 'horizon' },
];

function readState(search) {
  const s = {};
  MULTI.forEach((k) => { s[k] = search.getAll(k).flatMap((v) => v.split(',')).filter(Boolean); });
  SINGLE.forEach((k) => { s[k] = search.get(k) || ''; });
  s.sort = s.sort || 'recent';
  s.page = Number(s.page) || 1;
  return s;
}

function toSearch(s) {
  const p = new URLSearchParams();
  MULTI.forEach((k) => s[k].forEach((v) => p.append(k, v)));
  SINGLE.forEach((k) => { if (s[k] && !(k === 'sort' && s[k] === 'recent') && !(k === 'page' && Number(s[k]) === 1)) p.set(k, s[k]); });
  return p;
}

const queryFor = (s) => {
  const q = {};
  MULTI.forEach((k) => { if (s[k].length) q[k] = s[k]; });
  SINGLE.forEach((k) => { if (s[k]) q[k] = s[k]; });
  return q;
};

export default async function explore(ctx) {
  ctx.setTitle('Explore Internships');
  ctx.setCrumbs([{ label: 'Explore Internships' }]);
  const state = readState(ctx.search);
  const desktop = window.matchMedia('(min-width: 1081px)');
  render(ctx.el, html`<div data-demo-slot></div>${pageHeader({ title: 'Explore internships', subtitle: 'International opportunities reviewed by HORIZON. Every filter runs on the server.' })}
    <div class="searchbar">
      <div class="input-icon">${icon('search')}<input class="input" type="search" data-q placeholder="Search by title, organisation, country, city, industry or skill" aria-label="Search internships" value="${state.q}">
        <button class="btn btn-ghost btn-icon btn-sm clear" data-clear-q aria-label="Clear search" ${state.q ? '' : 'hidden'}>${icon('x', { size: 16 })}</button></div>
      <button class="btn filter-toggle" data-open-filters aria-controls="filters-panel" aria-expanded="false">${icon('sliders')} Filters <span class="filter-count" data-filter-count hidden></span></button>
    </div>
    <div class="quick-filters" role="group" aria-label="Quick filters" data-quick></div>
    <div class="explore">
      <div class="filters-backdrop" data-filters-backdrop hidden></div>
      <aside class="card filters" id="filters-panel" data-filters aria-label="Filters"><div class="card-body"><div class="spinner" role="status" aria-label="Loading filters"></div></div></aside>
      <section aria-labelledby="results-h">
        <h2 class="sr-only" id="results-h">Results</h2>
        <div class="results-head">
          <div class="count" data-count aria-live="polite" aria-atomic="true"></div>
          <div class="row gap-2"><label class="small muted" for="sort">Sort by</label>
            <select class="select sort-select" id="sort" data-sort>
              <option value="recent">Recently added</option><option value="deadline">Deadline approaching</option><option value="compensation">Highest compensation</option><option value="duration">Shortest duration</option>
            </select></div>
        </div>
        <div class="active-filters" data-active></div>
        <div data-results>${skeletonCards(6)}</div>
        <div data-pages></div>
      </section>
    </div>`);
  $('[data-sort]', ctx.el).value = state.sort;

  const [options, profile] = await Promise.all([get('/api/opportunities/filters'), get('/api/profile').catch(() => null)]);
  if (options.containsDemoData) render($('[data-demo-slot]', ctx.el), demoNotice());
  wireDemoNotice(ctx.el);
  const myYear = profile && profile.profile ? profile.profile.currentYear : null;
  const filtersEl = $('[data-filters]', ctx.el);

  // Long groups: most common first, six visible, the rest behind "Show more" (checked options stay visible).
  const checks = (name, values, labelFn = (v) => v, { searchable = false } = {}) => {
    const sorted = values.some((o) => o.count != null) ? [...values].sort((a, b) => (b.count || 0) - (a.count || 0) || String(a.value).localeCompare(String(b.value))) : values;
    const long = sorted.length > SHOW_FIRST;
    return html`${searchable && long ? html`<div class="input-icon filter-search">${icon('search', { size: 16 })}<input class="input" type="search" data-group-search="${name}" placeholder="Find a ${name === 'country' ? 'country' : 'value'}" aria-label="Find a ${name === 'country' ? 'country' : 'value'}"></div>` : ''}
      <div class="stack" data-group-list="${name}">${sorted.map((o, i) => html`<label class="check" ${long && i >= SHOW_FIRST ? html`data-more` : ''} ${long && i >= SHOW_FIRST && !state[name].includes(o.value) ? html`hidden` : ''} data-label="${String(labelFn(o.value)).toLowerCase()}"><input type="checkbox" data-group name="${name}" value="${o.value}" ${state[name].includes(o.value) ? 'checked' : ''}><span>${labelFn(o.value)}</span><span class="count">${o.count ?? ''}</span></label>`)}</div>
      ${long ? html`<button type="button" class="link-btn small mt-8" data-more-toggle="${name}" aria-expanded="false">Show ${sorted.length - SHOW_FIRST} more</button>` : ''}`;
  };
  const radios = (name, opts) => html`<div class="stack">${opts.map(([v, l]) => html`<label class="check"><input type="radio" name="${name}" value="${v}" ${state[name] === v ? 'checked' : ''}><span>${l}</span></label>`)}</div>`;
  const groups = [
    ['country', 'Country', () => checks('country', options.countries, undefined, { searchable: true }), () => state.country.length],
    ['industry', 'Industry', () => checks('industry', options.industries), () => state.industry.length],
    ['paid', 'Paid or unpaid', () => radios('paid', [['', 'Any'], ['paid', 'Paid only'], ['unpaid', 'Unpaid only']]), () => !!state.paid],
    ['comp', 'Monthly compensation (US$, indicative)', () => html`<div class="row gap-2"><input class="input" type="number" min="0" step="100" name="minComp" placeholder="Min" aria-label="Minimum monthly compensation in US dollars" value="${state.minComp}"><span class="subtle">–</span><input class="input" type="number" min="0" step="100" name="maxComp" placeholder="Max" aria-label="Maximum monthly compensation in US dollars" value="${state.maxComp}"></div>
        <p class="help mt-8">Converted from local currency for comparison only.</p><p class="field-error" data-comp-error></p>`, () => !!(state.minComp || state.maxComp)],
    ['workMode', 'Work arrangement', () => checks('workMode', ['onsite', 'hybrid', 'remote'].map((v) => ({ value: v })), (v) => LABELS.workMode[v]), () => state.workMode.length],
    ['duration', 'Duration', () => radios('duration', [['', 'Any length'], ['short', 'Up to 8 weeks'], ['medium', '9–16 weeks'], ['long', 'More than 16 weeks']]), () => !!state.duration],
    ['visa', 'Visa sponsorship', () => checks('visa', ['yes', 'case_by_case', 'not_required', 'no'].map((v) => ({ value: v })), (v) => LABELS.visaLong[v]), () => state.visa.length],
    ['deadline', 'Application deadline', () => radios('deadline', [['', 'Any time'], ['week', 'Within 7 days'], ['month', 'Within 30 days'], ['quarter', 'Within 90 days']]), () => !!state.deadline],
    ['level', 'Academic eligibility', () => html`<select class="select" name="level" aria-label="Level of study"><option value="">Any level</option><option value="undergraduate" ${state.level === 'undergraduate' ? 'selected' : ''}>Undergraduate</option><option value="postgraduate" ${state.level === 'postgraduate' ? 'selected' : ''}>Postgraduate</option><option value="doctoral" ${state.level === 'doctoral' ? 'selected' : ''}>Doctoral</option></select>
        ${myYear ? html`<label class="check mt-8"><input type="checkbox" name="year" value="${myYear}" ${state.year ? 'checked' : ''}><span>Open to my year (Year ${myYear})</span></label>` : ''}`, () => !!(state.level || state.year)],
    ['orgType', 'Organisation type', () => checks('orgType', options.orgTypes), () => state.orgType.length],
    ['mode', 'How to apply', () => radios('mode', [['', 'Any'], ['horizon', 'Apply on HORIZON'], ['external', 'Employer’s website']]), () => !!state.mode],
  ];
  render(filtersEl, html`<div class="filters-head"><h2>${icon('filter', { size: 16 })} Filters</h2>
      <div class="row gap-1"><button class="btn btn-sm btn-ghost hide-drawer" data-clear-all>Clear all</button><button class="btn btn-sm btn-icon btn-ghost filter-toggle" data-close-filters aria-label="Close filters">${icon('x', { size: 16 })}</button></div></div>
    <form data-filter-form class="filters-body">
      ${groups.map(([key, label, body, active], i) => html`<details class="filter-group" data-group-key="${key}" ${(desktop.matches && i < 3) || active() ? 'open' : ''}>
        <summary>${label}</summary><fieldset class="fieldset"><legend class="sr-only">${label}</legend>${body()}</fieldset></details>`)}
    </form>
    <div class="filters-foot"><button type="button" class="btn" data-clear-all>Clear all</button><button type="button" class="btn btn-primary grow" data-apply-filters>Show results</button></div>`);

  let controller = null;
  let lastTotal = 0;
  const resultsEl = $('[data-results]', ctx.el);
  const filterToggle = $('[data-open-filters]', ctx.el);

  function activeChips() {
    const chips = [];
    if (state.q) chips.push(['q', state.q, `“${state.q}”`]);
    MULTI.forEach((k) => state[k].forEach((v) => chips.push([k, v, k === 'workMode' ? LABELS.workMode[v] : k === 'visa' ? LABELS.visa[v] : v])));
    const singleLabels = { paid: { paid: 'Paid', unpaid: 'Unpaid' }, duration: { short: '≤ 8 weeks', medium: '9–16 weeks', long: '> 16 weeks' }, deadline: { week: 'Closing within 7 days', month: 'Closing within 30 days', quarter: 'Closing within 90 days' }, level: LABELS.level, mode: { horizon: 'Apply on HORIZON', external: 'Employer website' } };
    Object.entries(singleLabels).forEach(([k, map]) => { if (state[k]) chips.push([k, state[k], map[state[k]] || state[k]]); });
    if (state.minComp) chips.push(['minComp', state.minComp, `≥ US$${state.minComp}`]);
    if (state.maxComp) chips.push(['maxComp', state.maxComp, `≤ US$${state.maxComp}`]);
    if (state.year) chips.push(['year', state.year, `Open to Year ${state.year}`]);
    return chips;
  }

  const isOn = (q) => (q.multi ? state[q.key].includes(q.value) : state[q.key] === q.value);
  function renderQuick() {
    render($('[data-quick]', ctx.el), QUICK.map((q) => html`<button type="button" class="quick-chip" data-quick-id="${q.id}" aria-pressed="${String(isOn(q))}">${isOn(q) ? icon('check', { size: 14 }) : ''}${q.label}</button>`));
  }

  const form = $('[data-filter-form]', ctx.el);
  /** Writes state back into the filter form so quick chips, active chips and the panel agree. */
  function syncForm() {
    MULTI.forEach((k) => $$(`input[name="${k}"]`, form).forEach((i) => { i.checked = state[k].includes(i.value); }));
    ['paid', 'duration', 'deadline', 'mode'].forEach((k) => { const r = $(`input[name="${k}"][value="${CSS.escape(state[k])}"]`, form); if (r) r.checked = true; });
    form.level.value = state.level;
    if (form.year) form.year.checked = !!state.year;
    form.minComp.value = state.minComp;
    form.maxComp.value = state.maxComp;
  }

  async function suggestion() {
    // Which single active filter, if removed, would bring back the most results? Small, parallel count queries.
    const chips = activeChips().filter(([k]) => k !== 'q');
    if (!chips.length || chips.length > 5) return null;
    const tries = await Promise.all(chips.map(async ([k, v, label]) => {
      const s = { ...state, ...Object.fromEntries(MULTI.map((m) => [m, [...state[m]]])) };
      if (MULTI.includes(k)) s[k] = s[k].filter((x) => x !== v); else s[k] = '';
      try { const r = await get('/api/opportunities', { ...queryFor(s), page: 1, pageSize: 1 }); return { k, v, label, total: r.total }; } catch { return { total: 0 }; }
    }));
    const best = tries.sort((a, b) => b.total - a.total)[0];
    return best && best.total ? best : null;
  }

  async function load() {
    const search = toSearch(state);
    history.replaceState(history.state, '', `${ctx.path}${search.toString() ? `?${search}` : ''}`);
    if (controller) controller.abort();
    controller = new AbortController();
    render(resultsEl, skeletonCards(6));
    renderActive();
    renderQuick();
    try {
      const data = await get('/api/opportunities', { ...queryFor(state), pageSize: 9 }, { signal: controller.signal });
      lastTotal = data.total;
      render($('[data-count]', ctx.el), html`<strong>${data.total}</strong> ${data.total === 1 ? 'opportunity' : 'opportunities'} found`);
      render($('[data-apply-filters]', ctx.el), `Show ${plural(data.total, 'result')}`);
      if (data.items.length) render(resultsEl, html`<div class="opp-grid">${data.items.map((o) => oppCard(o))}</div>`);
      else {
        render(resultsEl, empty({ icon: 'search', title: 'No internships match these filters', text: 'Try removing a filter or searching for a broader term.', action: html`<button class="btn btn-primary" data-clear-all>Clear all filters</button>` }));
        const tip = await suggestion();
        if (tip && !lastTotal) render(resultsEl, empty({ icon: 'search', title: 'No internships match these filters', text: `Removing “${tip.label}” would show ${plural(tip.total, 'opportunity', 'opportunities')}.`, action: html`<div class="row wrap gap-2 justify-center"><button class="btn btn-primary" data-remove="${tip.k}" data-value="${tip.v}">Remove “${tip.label}”</button><button class="btn" data-clear-all>Clear all filters</button></div>` }));
      }
      render($('[data-pages]', ctx.el), pagination(data));
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err.fields && (err.fields.maxComp || err.fields.minComp)) { $('[data-comp-error]', ctx.el).textContent = err.fields.maxComp || err.fields.minComp; }
      render(resultsEl, errorState(err));
    }
  }

  function renderActive() {
    const chips = activeChips();
    render($('[data-active]', ctx.el), chips.length ? html`${chips.map(([k, v, l]) => html`<span class="chip">${l}<button type="button" data-remove="${k}" data-value="${v}" aria-label="Remove filter ${l}">${icon('x', { size: 13 })}</button></span>`)}<button class="btn btn-sm btn-ghost" data-clear-all>Clear all</button>` : '');
    $('[data-clear-q]', ctx.el).hidden = !state.q;
    const n = chips.filter(([k]) => k !== 'q').length;
    const badge = $('[data-filter-count]', ctx.el);
    badge.hidden = !n;
    badge.textContent = n;
    filterToggle.setAttribute('aria-label', n ? `Filters, ${n} active` : 'Filters');
  }

  const readForm = () => {
    MULTI.forEach((k) => { state[k] = $$(`input[name="${k}"]:checked`, form).map((i) => i.value); });
    ['paid', 'duration', 'deadline', 'mode'].forEach((k) => { const c = $(`input[name="${k}"]:checked`, form); state[k] = c ? c.value : ''; });
    state.level = form.level.value;
    state.year = form.year && form.year.checked ? form.year.value : '';
    state.minComp = form.minComp.value;
    state.maxComp = form.maxComp.value;
    $('[data-comp-error]', ctx.el).textContent = state.minComp && state.maxComp && Number(state.minComp) > Number(state.maxComp) ? 'Maximum must be greater than the minimum.' : '';
    if ($('[data-comp-error]', ctx.el).textContent) return false;
    state.page = 1;
    return true;
  };
  form.addEventListener('change', (e) => { if (e.target.type === 'number' || e.target.type === 'search') return; if (readForm()) load(); });
  form.addEventListener('input', debounce((e) => { if (e.target.type === 'number' && readForm()) load(); }, 500));
  form.addEventListener('submit', (e) => e.preventDefault());
  $('[data-q]', ctx.el).addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }, 350));
  $('[data-sort]', ctx.el).addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; load(); });
  on(ctx.el, 'click', '[data-clear-q]', () => { $('[data-q]', ctx.el).value = ''; state.q = ''; load(); });
  on(ctx.el, 'click', '[data-clear-all]', () => {
    MULTI.forEach((k) => { state[k] = []; });
    SINGLE.forEach((k) => { if (k !== 'sort') state[k] = ''; });
    state.page = 1;
    form.reset();
    $$('input[type=radio][value=""]', form).forEach((r) => { r.checked = true; });
    $('[data-q]', ctx.el).value = '';
    load();
  });
  on(ctx.el, 'click', '[data-remove]', (e, b) => {
    const k = b.dataset.remove;
    if (MULTI.includes(k)) state[k] = state[k].filter((v) => v !== b.dataset.value);
    else { state[k] = ''; if (k === 'q') $('[data-q]', ctx.el).value = ''; }
    syncForm();
    state.page = 1;
    load();
  });
  on(ctx.el, 'click', '[data-quick-id]', (e, b) => {
    const q = QUICK.find((x) => x.id === b.dataset.quickId);
    if (q.multi) state[q.key] = isOn(q) ? state[q.key].filter((v) => v !== q.value) : [...state[q.key], q.value];
    else state[q.key] = isOn(q) ? '' : q.value;
    syncForm();
    state.page = 1;
    load();
  });
  on(ctx.el, 'click', '[data-more-toggle]', (e, b) => {
    const list = $(`[data-group-list="${b.dataset.moreToggle}"]`, form);
    const expand = b.getAttribute('aria-expanded') !== 'true';
    $$('[data-more]', list).forEach((l) => { l.hidden = !expand && !l.querySelector('input').checked; });
    b.setAttribute('aria-expanded', String(expand));
    b.textContent = expand ? 'Show fewer' : `Show ${$$('[data-more]', list).length} more`;
  });
  on(ctx.el, 'input', '[data-group-search]', (e, input) => {
    const name = input.dataset.groupSearch;
    const q = input.value.trim().toLowerCase();
    const list = $(`[data-group-list="${name}"]`, form);
    const toggle = $(`[data-more-toggle="${name}"]`, form);
    const expanded = toggle && toggle.getAttribute('aria-expanded') === 'true';
    $$('label.check', list).forEach((l) => {
      l.hidden = q ? !l.dataset.label.includes(q) : (l.hasAttribute('data-more') && !expanded && !l.querySelector('input').checked);
    });
    if (toggle) toggle.hidden = !!q;
  });
  on(ctx.el, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); });
  on(ctx.el, 'click', '[data-action=retry]', load);

  // Mobile filter drawer: modal behaviour (focus trap, Escape, backdrop); focus returns to the trigger.
  const backdrop = $('[data-filters-backdrop]', ctx.el);
  const drawerOpen = () => filtersEl.classList.contains('open');
  function openFilters() {
    filtersEl.classList.add('open');
    backdrop.hidden = false;
    filterToggle.setAttribute('aria-expanded', 'true');
    filtersEl.setAttribute('role', 'dialog');
    filtersEl.setAttribute('aria-modal', 'true');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { const f = $('[data-close-filters]', filtersEl); if (f) f.focus(); }, 50);
  }
  function closeFilters({ returnFocus = true } = {}) {
    if (!drawerOpen()) return;
    filtersEl.classList.remove('open');
    backdrop.hidden = true;
    filterToggle.setAttribute('aria-expanded', 'false');
    filtersEl.removeAttribute('role');
    filtersEl.removeAttribute('aria-modal');
    document.body.style.overflow = '';
    if (returnFocus) filterToggle.focus();
  }
  const onKey = (e) => {
    if (!drawerOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); closeFilters(); return; }
    if (e.key === 'Tab') {
      const items = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary', filtersEl).filter((x) => x.offsetParent !== null);
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  ctx.onCleanup(() => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; });
  on(ctx.el, 'click', '[data-open-filters]', openFilters);
  on(ctx.el, 'click', '[data-close-filters]', () => closeFilters());
  on(ctx.el, 'click', '[data-apply-filters]', () => closeFilters());
  backdrop.addEventListener('click', () => closeFilters());
  const onBp = () => { if (desktop.matches) closeFilters({ returnFocus: false }); };
  desktop.addEventListener('change', onBp);
  ctx.onCleanup(() => desktop.removeEventListener('change', onBp));

  ['paid', 'duration', 'deadline', 'mode'].forEach((k) => { if (!state[k]) { const r = $(`input[name="${k}"][value=""]`, form); if (r) r.checked = true; } });
  wireSaveButtons(ctx.el);
  await load(); // the router restores Back scroll position after the first results render
}
