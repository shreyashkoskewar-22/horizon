import { html, render, debounce } from './dom.js';

/**
 * Accessible autocomplete: a text input (role=combobox) plus a hidden value input.
 * search(q) returns [{ value, label, sub }]. Keyboard: ↑/↓ to move, Enter to choose, Esc to close.
 */
export function combobox({ input, hidden, search, onSelect, minChars = 0, emptyText = 'No matches' }) {
  const wrap = input.closest('.combo') || input.parentElement;
  const listId = `${input.id || 'combo'}-list`;
  const list = document.createElement('div');
  list.className = 'combo-list';
  list.id = listId;
  list.setAttribute('role', 'listbox');
  const lbl = input.id && document.querySelector(`label[for="${input.id}"]`);
  if (lbl) list.setAttribute('aria-label', lbl.textContent.trim());
  list.hidden = true;
  wrap.appendChild(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('autocomplete', 'off');
  let items = [];
  let active = -1;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const highlight = (i) => {
    active = i;
    [...list.children].forEach((el, idx) => { el.classList.toggle('active', idx === i); if (el.getAttribute('role') === 'option') el.setAttribute('aria-selected', String(idx === i)); });
    const el = list.children[i];
    if (el) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
  };
  const choose = (item) => {
    input.value = item.label;
    if (hidden) { hidden.value = item.value; hidden.dispatchEvent(new Event('change', { bubbles: true })); }
    close();
    if (onSelect) onSelect(item);
  };
  const show = async () => {
    const q = input.value.trim();
    if (q.length < minChars) return close();
    items = await search(q);
    render(list, items.length
      ? items.map((it, i) => html`<div class="combo-option" role="option" aria-selected="false" id="${listId}-${i}" data-i="${i}"><span>${it.label}</span>${it.sub ? html`<small>${it.sub}</small>` : ''}</div>`)
      : html`<div class="combo-option" aria-disabled="true"><span class="subtle">${emptyText}</span></div>`);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  };
  const debounced = debounce(show, 150);
  input.addEventListener('input', () => { if (hidden) hidden.value = ''; debounced(); });
  input.addEventListener('focus', () => { if (!input.value || !hidden || !hidden.value) show(); });
  input.addEventListener('keydown', (e) => {
    if (list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { show(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(items.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(0, active - 1)); }
    else if (e.key === 'Enter' && !list.hidden && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('[data-i]');
    if (opt) { e.preventDefault(); choose(items[Number(opt.dataset.i)]); }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      close();
      if (hidden && !hidden.value && input.value.trim() && items.length > 0) {
        const val = input.value.trim().toLowerCase();
        const match = items.find((it) => it.label.toLowerCase() === val)
          || items.find((it) => it.sub && it.sub.toLowerCase() === val)
          || (items.length === 1 ? items[0] : null);
        if (match) choose(match);
      }
    }, 150);
  });
  return { close, refresh: show };
}
