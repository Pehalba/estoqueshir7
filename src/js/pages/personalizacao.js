import { PRODUCTS, ALL_ITEMS } from '../../data/personalization-alba-fedex-03.js';

const SIZE_ORDER = ['P', 'M', 'G', 'GG', 'XG'];
const STORAGE_KEY = 'shir7-pers-done';
const PRODUCT_FILTERS = [
  { id: 'br-tor-vermelha', label: 'Vermelha', tone: 'vermelha' },
  { id: 'br-home-amarela', label: 'Amarela', tone: 'amarela' },
];

let activeProduct = 'br-tor-vermelha';
let activeSize = 'all';
let activeStatus = 'pending';
let searchQuery = '';
let doneSet = loadDoneSet();

function loadDoneSet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveDoneSet() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...doneSet]));
}

function itemKey(item) {
  return `${item.productId}::${item.orderId}`;
}

function isDone(item) {
  return doneSet.has(itemKey(item));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayName(name) {
  const trimmed = String(name ?? '').trim();
  return trimmed || '—';
}

function displayNumber(number) {
  const trimmed = String(number ?? '').trim();
  return trimmed || '—';
}

function getVisibleItems() {
  return ALL_ITEMS.filter((i) => i.productId === activeProduct);
}

function filterItems() {
  const q = searchQuery.trim().toLowerCase();
  return getVisibleItems().filter((item) => {
    const done = isDone(item);
    if (activeStatus === 'pending' && done) return false;
    if (activeStatus === 'done' && !done) return false;
    if (activeSize !== 'all' && item.size !== activeSize) return false;
    if (!q) return true;
    return (
      item.orderId.toLowerCase().includes(q)
      || item.name.toLowerCase().includes(q)
      || item.number.toLowerCase().includes(q)
      || item.sizeLabel.toLowerCase().includes(q)
    );
  });
}

function renderStats() {
  const el = document.getElementById('pers-stats');
  if (!el) return;

  const scope = getVisibleItems();
  const doneCount = scope.filter(isDone).length;
  const pendingCount = scope.length - doneCount;
  const pct = scope.length ? Math.round((doneCount / scope.length) * 100) : 0;

  el.innerHTML = `
    <div class="pers-stat">
      <span class="pers-stat__value">${scope.length}</span>
      <span class="pers-stat__label">Total</span>
    </div>
    <div class="pers-stat pers-stat--pending">
      <span class="pers-stat__value">${pendingCount}</span>
      <span class="pers-stat__label">Pendentes</span>
    </div>
    <div class="pers-stat pers-stat--done">
      <span class="pers-stat__value">${doneCount}</span>
      <span class="pers-stat__label">Feitos</span>
    </div>
    <div class="pers-stat pers-stat--progress">
      <span class="pers-stat__value">${pct}%</span>
      <span class="pers-stat__label">Progresso</span>
    </div>
  `;
}

function renderCard(item) {
  const name = displayName(item.name);
  const number = displayNumber(item.number);
  const key = itemKey(item);
  const done = isDone(item);
  const accentClass = item.productAccent === 'yellow' ? ' pers-card__head--yellow' : '';
  const placeholderClass = item.placeholder ? ' pers-card--placeholder' : '';

  return `
    <article class="pers-card${done ? ' pers-card--done' : ''}${placeholderClass}" data-id="${escapeHtml(key)}">
      <header class="pers-card__head${accentClass}">
        <span class="pers-card__order">${escapeHtml(item.orderId)}</span>
        <span class="pers-card__size">${escapeHtml(item.sizeLabel)}</span>
      </header>

      <div class="pers-card__main">
        <div class="pers-card__thumb">
          <img
            class="pers-card__image"
            src="${escapeHtml(item.imageUrl)}"
            alt=""
            loading="lazy"
          >
        </div>
        <div class="pers-card__pers">
          ${item.placeholder ? '<span class="pers-card__badge">Aguardando pedido</span>' : ''}
          <span class="pers-card__name">${escapeHtml(name)}</span>
          <span class="pers-card__number">${escapeHtml(number)}</span>
        </div>
      </div>

      <footer class="pers-card__foot no-print">
        <button
          type="button"
          class="pers-done-btn${done ? ' pers-done-btn--active' : ''}"
          data-toggle-done="${escapeHtml(key)}"
          aria-pressed="${done ? 'true' : 'false'}"
        >
          <span class="pers-done-btn__icon" aria-hidden="true"></span>
          <span class="pers-done-btn__label">${done ? 'Feito' : 'Marcar feito'}</span>
        </button>
      </footer>
    </article>
  `;
}

function renderPillGroup(containerId, buttons, activeId, dataAttr, pillClass = '') {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = buttons
    .map(
      (btn) => `
        <button
          type="button"
          class="pers-pill${pillClass ? ` ${pillClass}` : ''}${btn.tone ? ` pers-pill--${btn.tone}` : ''}${activeId === btn.id ? ' pers-pill--active' : ''}"
          data-${dataAttr}="${escapeHtml(btn.id)}"
        >${escapeHtml(btn.label)}</button>
      `,
    )
    .join('');
}

function renderProductFilters() {
  renderPillGroup('pers-product-filters', PRODUCT_FILTERS, activeProduct, 'product');

  document.getElementById('pers-product-filters')?.querySelectorAll('[data-product]').forEach((el) => {
    el.addEventListener('click', () => {
      activeProduct = el.dataset.product || 'br-tor-vermelha';
      activeSize = 'all';
      updateSubtitle();
      renderProductFilters();
      renderSizeFilters();
      renderStats();
      renderGrid();
    });
  });
}

function renderStatusFilters() {
  renderPillGroup(
    'pers-status-filters',
    [
      { id: 'pending', label: 'Pendentes' },
      { id: 'done', label: 'Feitos' },
      { id: 'all', label: 'Todos' },
    ],
    activeStatus,
    'status',
  );

  document.getElementById('pers-status-filters')?.querySelectorAll('[data-status]').forEach((el) => {
    el.addEventListener('click', () => {
      activeStatus = el.dataset.status || 'all';
      renderStatusFilters();
      renderGrid();
    });
  });
}

function renderSizeFilters() {
  const scope = getVisibleItems().filter((i) => i.size);
  const sizesInScope = [...new Set(scope.map((i) => i.size))].sort(
    (a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b),
  );

  renderPillGroup(
    'pers-size-filters',
    [
      { id: 'all', label: 'Todos' },
      ...sizesInScope.map((size) => {
        const sample = scope.find((i) => i.size === size);
        return { id: size, label: sample?.sizeLabel?.split(' ')[0] || size };
      }),
    ],
    activeSize,
    'size',
  );

  document.getElementById('pers-size-filters')?.querySelectorAll('[data-size]').forEach((el) => {
    el.addEventListener('click', () => {
      activeSize = el.dataset.size || 'all';
      renderSizeFilters();
      renderGrid();
    });
  });
}

function updateSubtitle() {
  const subtitle = document.getElementById('pers-lot-title');
  if (!subtitle) return;

  const product = PRODUCTS[activeProduct];
  const count = ALL_ITEMS.filter((i) => i.productId === activeProduct).length;
  subtitle.textContent = product ? `${product.label} · ${count} peças` : '';
}

function bindDoneButtons() {
  document.querySelectorAll('[data-toggle-done]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleDone;
      if (!id) return;

      if (doneSet.has(id)) doneSet.delete(id);
      else doneSet.add(id);

      saveDoneSet();
      renderStats();
      renderGrid();
    });
  });
}

function renderGrid() {
  const grid = document.getElementById('pers-grid');
  if (!grid) return;

  const items = filterItems();
  grid.innerHTML = items.length
    ? items.map(renderCard).join('')
    : '<p class="pers-empty">Nenhum item neste filtro.</p>';

  bindDoneButtons();
}

function init() {
  document.getElementById('pers-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderGrid();
  });

  document.getElementById('pers-print-btn')?.addEventListener('click', () => {
    window.print();
  });

  updateSubtitle();
  renderProductFilters();
  renderStatusFilters();
  renderSizeFilters();
  renderStats();
  renderGrid();
}

init();
