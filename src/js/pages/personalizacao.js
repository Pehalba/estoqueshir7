import { PRODUCTS, ALL_ITEMS } from '../../data/personalization-alba-fedex-03.js';

const SIZE_ORDER = ['P', 'M', 'G', 'GG', 'XG'];
const STORAGE_KEY = 'shir7-pers-done';
const PRODUCT_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'br-home-amarela', label: 'Amarela jogador', tone: 'amarela' },
  { id: 'br-away-azul', label: 'Azul jogador', tone: 'azul' },
  { id: 'br-tor-ii', label: 'Azul torcedor', tone: 'azul' },
  { id: 'br-retro-2002', label: 'Retro 02', tone: 'amarela' },
  { id: 'br-retro-98', label: 'Retro 98', tone: 'amarela' },
  { id: 'br-tor-vermelha', label: 'Vermelha torcedor', tone: 'vermelha' },
];

const PRODUCT_SORT_ORDER = {
  'br-home-amarela': 0,
  'br-away-azul': 1,
  'br-retro-2002': 2,
  'br-retro-98': 3,
  'br-tor-ii': 4,
  'br-tor-vermelha': 5,
};

let activeProduct = 'all';
let activeSize = 'all';
let activeStatus = 'pending';
let activeTab = 'queue';
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

function sortItemsForDisplay(items) {
  if (activeProduct !== 'all') return items;
  return [...items].sort((a, b) => {
    const orderA = PRODUCT_SORT_ORDER[a.productId] ?? 99;
    const orderB = PRODUCT_SORT_ORDER[b.productId] ?? 99;
    return orderA - orderB;
  });
}

function getVisibleItems() {
  if (activeProduct === 'all') return sortItemsForDisplay(ALL_ITEMS);
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

function getProductionItems() {
  return ALL_ITEMS.filter((item) => !item.placeholder);
}

function buildSummaryByProduct() {
  const map = new Map();

  for (const item of getProductionItems()) {
    const productId = item.productId;
    if (!map.has(productId)) {
      map.set(productId, {
        productId,
        label: item.productLabel,
        imageUrl: item.imageUrl,
        kitType: item.kitType || 'jogador',
        sizes: {},
        total: 0,
        items: [],
      });
    }

    const group = map.get(productId);
    const size = item.size || '?';
    group.sizes[size] = (group.sizes[size] || 0) + 1;
    group.total += 1;
    group.items.push(item);
  }

  return [...map.values()].sort(
    (a, b) => (PRODUCT_SORT_ORDER[a.productId] ?? 99) - (PRODUCT_SORT_ORDER[b.productId] ?? 99),
  );
}

function getSummarySizes(groups) {
  const sizes = new Set();
  groups.forEach((group) => {
    Object.keys(group.sizes).forEach((size) => sizes.add(size));
  });
  return [...sizes].sort((a, b) => {
    const idxA = SIZE_ORDER.indexOf(a);
    const idxB = SIZE_ORDER.indexOf(b);
    if (idxA === -1 && idxB === -1) return a.localeCompare(b);
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });
}

function sizeLabelFor(group, size) {
  const sample = group.items.find((item) => item.size === size);
  return sample?.sizeLabel?.split(' ')[0] || size;
}

function renderSummaryMatrix(groups, sizes) {
  if (!groups.length) {
    return '<p class="pers-empty">Nenhuma peça enviada para personalização.</p>';
  }

  const grandTotal = groups.reduce((sum, group) => sum + group.total, 0);
  const sizeHeaders = sizes
    .map((size) => `<th scope="col">${escapeHtml(size)}</th>`)
    .join('');
  const rows = groups.map((group) => {
    const cells = sizes
      .map((size) => {
        const count = group.sizes[size] || 0;
        return `<td class="pers-summary__qty${count ? ' pers-summary__qty--has' : ''}">${count || '—'}</td>`;
      })
      .join('');
    return `
      <tr>
        <th scope="row" class="pers-summary__model-cell">
          <span class="pers-summary__kit pers-summary__kit--${escapeHtml(group.kitType)}">${kitTypeLabel(group.kitType)}</span>
          ${escapeHtml(group.label)}
        </th>
        ${cells}
        <td class="pers-summary__qty pers-summary__qty--total"><strong>${group.total}</strong></td>
      </tr>
    `;
  }).join('');

  const columnTotals = sizes.map((size) => {
    const count = groups.reduce((sum, group) => sum + (group.sizes[size] || 0), 0);
    return `<td class="pers-summary__qty pers-summary__qty--total"><strong>${count || '—'}</strong></td>`;
  }).join('');

  return `
    <div class="pers-summary__hero">
      <span class="pers-summary__hero-value">${grandTotal}</span>
      <span class="pers-summary__hero-label">peças enviadas para personalizar</span>
    </div>

    <section class="pers-summary__section">
      <h2 class="pers-summary__heading">Resumo por modelo e tamanho</h2>
      <div class="table-wrapper pers-summary__table-wrap">
        <table class="table pers-summary__matrix">
          <thead>
            <tr>
              <th scope="col">Modelo</th>
              ${sizeHeaders}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total geral</th>
              ${columnTotals}
              <td class="pers-summary__qty pers-summary__qty--grand"><strong>${grandTotal}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  `;
}

function renderSummaryDetails(groups) {
  if (!groups.length) return '';

  const cards = groups.map((group) => {
    const sizeRows = Object.entries(group.sizes)
      .sort(([a], [b]) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b))
      .map(([size, count]) => {
        const orders = group.items
          .filter((item) => item.size === size)
          .map((item) => item.orderId)
          .join(', ');
        return `
          <tr>
            <td>${escapeHtml(sizeLabelFor(group, size))}</td>
            <td class="pers-summary__qty pers-summary__qty--has"><strong>${count}</strong></td>
            <td class="pers-summary__orders">${escapeHtml(orders)}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <article class="pers-summary-card pers-summary-card--${escapeHtml(group.kitType)}">
        <header class="pers-summary-card__head">
          <img class="pers-summary-card__thumb" src="${escapeHtml(group.imageUrl)}" alt="" loading="lazy">
          <div>
            <span class="pers-summary__kit pers-summary__kit--${escapeHtml(group.kitType)}">${kitTypeLabel(group.kitType)}</span>
            <h3 class="pers-summary-card__title">${escapeHtml(group.label)}</h3>
            <p class="pers-summary-card__meta">${group.total} peça${group.total === 1 ? '' : 's'}</p>
          </div>
        </header>
        <div class="table-wrapper">
          <table class="table pers-summary-card__table">
            <thead>
              <tr>
                <th scope="col">Tamanho</th>
                <th scope="col">Qtd</th>
                <th scope="col">Pedidos</th>
              </tr>
            </thead>
            <tbody>${sizeRows}</tbody>
          </table>
        </div>
      </article>
    `;
  }).join('');

  return `
    <section class="pers-summary__section">
      <h2 class="pers-summary__heading">Detalhe por modelo</h2>
      <div class="pers-summary-cards">${cards}</div>
    </section>
  `;
}

function renderSummary() {
  const el = document.getElementById('pers-summary');
  if (!el) return;

  const groups = buildSummaryByProduct();
  const sizes = getSummarySizes(groups);
  el.innerHTML = renderSummaryMatrix(groups, sizes) + renderSummaryDetails(groups);
}

function setActiveTab(tab) {
  activeTab = tab === 'summary' ? 'summary' : 'queue';

  document.querySelectorAll('[data-tab]').forEach((btn) => {
    const isActive = btn.dataset.tab === activeTab;
    btn.classList.toggle('pers-tab--active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  const queuePanel = document.getElementById('pers-panel-queue');
  const summaryPanel = document.getElementById('pers-panel-summary');
  const queueControls = document.getElementById('pers-queue-controls');
  const stats = document.getElementById('pers-stats');

  if (queuePanel) queuePanel.hidden = activeTab !== 'queue';
  if (summaryPanel) summaryPanel.hidden = activeTab !== 'summary';
  if (queueControls) queueControls.hidden = activeTab !== 'queue';
  if (stats) stats.hidden = activeTab === 'summary';
  document.body.classList.toggle('pers-tab-summary-active', activeTab === 'summary');

  if (activeTab === 'summary') {
    renderSummary();
  } else {
    renderGrid();
  }
}

function bindTabs() {
  document.getElementById('pers-tabs')?.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveTab(btn.dataset.tab);
    });
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

function kitTypeLabel(kitType) {
  if (kitType === 'torcedor') return 'TORCEDOR';
  if (kitType === 'retro') return 'RETRO';
  return 'JOGADOR';
}

function renderCard(item) {
  const name = displayName(item.name);
  const number = displayNumber(item.number);
  const key = itemKey(item);
  const done = isDone(item);
  const kitType = item.kitType || 'jogador';
  const kitClass = ` pers-card--${kitType}`;
  const headClass = kitType === 'torcedor'
    ? ' pers-card__head--torcedor'
    : kitType === 'retro' || item.productAccent === 'yellow'
      ? ' pers-card__head--yellow'
      : '';
  const placeholderClass = item.placeholder ? ' pers-card--placeholder' : '';
  const sidesNote = item.persSides
    ? `<p class="pers-card__sides-note">Personalização na ${escapeHtml(item.persSides)}</p>`
    : '';
  const fontBtn = item.fontGuide
    ? `<button type="button" class="pers-font-btn no-print" data-font-product="${escapeHtml(item.productId)}">Consultar fonte</button>`
    : '';
  const showModel = activeProduct === 'all' || kitType === 'torcedor';
  const modelClass = kitType === 'torcedor' ? ' pers-card__model--torcedor' : '';

  return `
    <article class="pers-card${kitClass}${done ? ' pers-card--done' : ''}${placeholderClass}" data-id="${escapeHtml(key)}">
      <header class="pers-card__head${headClass}">
        <div class="pers-card__head-row">
          <span class="pers-card__order">${escapeHtml(item.orderId)}</span>
          <span class="pers-card__kit pers-card__kit--${escapeHtml(kitType)}">${kitTypeLabel(kitType)}</span>
        </div>
        ${showModel ? `<span class="pers-card__model${modelClass}">${escapeHtml(item.productLabel)}</span>` : ''}
      </header>

      <div class="pers-card__main">
        <div class="pers-card__thumb">
          <img
            class="pers-card__image"
            src="${escapeHtml(item.imageUrl)}"
            alt=""
            loading="lazy"
          >
          <span class="pers-card__size">${escapeHtml(item.sizeLabel)}</span>
          ${fontBtn}
        </div>
        <div class="pers-card__pers">
          ${item.placeholder ? '<span class="pers-card__badge">Aguardando pedido</span>' : ''}
          ${sidesNote}
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
      activeProduct = el.dataset.product || 'all';
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

  if (activeProduct === 'all') {
    subtitle.textContent = `${ALL_ITEMS.length} peças · todas as cores`;
    return;
  }

  const product = PRODUCTS[activeProduct];
  const count = ALL_ITEMS.filter((i) => i.productId === activeProduct).length;
  const sidesHint = product?.persSides ? ' · frente e atrás' : '';
  subtitle.textContent = product ? `${product.label} · ${count} peças${sidesHint}` : '';
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

  document.querySelectorAll('[data-font-product]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openFontModal(btn.dataset.fontProduct);
    });
  });
}

function renderFontModalSlide(slide) {
  const safeSrc = escapeHtml(slide.src);
  const safeLabel = escapeHtml(slide.label);
  return `
    <figure class="pers-font-slide">
      <figcaption class="pers-font-slide__label">${safeLabel}</figcaption>
      <div class="pers-font-slide__frame">
        <img
          class="pers-font-slide__img"
          src="${safeSrc}"
          alt="${safeLabel}"
          loading="lazy"
          data-font-img
        >
        <p class="pers-font-slide__placeholder" data-font-placeholder hidden>
          Foto da fonte em breve.<br>
          <code>${safeSrc}</code>
        </p>
      </div>
    </figure>
  `;
}

function bindFontModalImages() {
  document.querySelectorAll('[data-font-img]').forEach((img) => {
    const showPlaceholder = () => {
      img.hidden = true;
      const placeholder = img.parentElement?.querySelector('[data-font-placeholder]');
      if (placeholder) placeholder.hidden = false;
    };

    img.addEventListener('error', showPlaceholder);
    if (img.complete && img.naturalWidth === 0) showPlaceholder();
  });
}

function openFontModal(productId) {
  const guide = PRODUCTS[productId]?.fontGuide;
  const modal = document.getElementById('pers-font-modal');
  const titleEl = document.getElementById('pers-font-modal-title');
  const hintEl = document.getElementById('pers-font-modal-hint');
  const bodyEl = document.getElementById('pers-font-modal-body');
  if (!guide || !modal || !titleEl || !hintEl || !bodyEl) return;

  titleEl.textContent = guide.title || 'Consultar fonte';
  hintEl.textContent = guide.hint || '';
  bodyEl.innerHTML = (guide.images || []).map(renderFontModalSlide).join('');

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('pers-font-modal-open');
  bindFontModalImages();
  modal.querySelector('.pers-font-modal__close')?.focus();
}

function closeFontModal() {
  const modal = document.getElementById('pers-font-modal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('pers-font-modal-open');
}

function bindFontModal() {
  document.querySelectorAll('[data-font-modal-close]').forEach((el) => {
    el.addEventListener('click', closeFontModal);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeFontModal();
  });
}

function renderEmptyState() {
  if (ALL_ITEMS.length === 0) {
    return '<p class="pers-empty">Nenhum pedido na fila. Edite <code>src/data/personalization-alba-fedex-03.js</code> para adicionar.</p>';
  }

  const product = activeProduct !== 'all' ? PRODUCTS[activeProduct] : null;
  if (product?.fontGuide) {
    return `
      <div class="pers-empty pers-empty--with-font">
        <p>Nenhum item neste filtro${product.label ? ` · ${escapeHtml(product.label)}` : ''}.</p>
        <button type="button" class="btn btn--secondary pers-empty__font-btn no-print" data-font-product="${escapeHtml(activeProduct)}">
          Consultar fonte
        </button>
      </div>
    `;
  }

  return '<p class="pers-empty">Nenhum item neste filtro.</p>';
}

function renderGrid() {
  const grid = document.getElementById('pers-grid');
  if (!grid) return;

  const items = filterItems();
  grid.innerHTML = items.length
    ? items.map(renderCard).join('')
    : renderEmptyState();

  bindDoneButtons();
}

function clearDoneSet() {
  doneSet.clear();
  saveDoneSet();
  renderStats();
  renderGrid();
}

function bindMobileToolbarScroll() {
  const mq = window.matchMedia('(max-width: 899px)');
  let lastY = window.scrollY;
  let ticking = false;

  const update = () => {
    if (!mq.matches) {
      document.body.classList.remove('pers-toolbar-scroll-hidden');
      ticking = false;
      return;
    }

    const y = window.scrollY;
    if (y <= 8) {
      document.body.classList.remove('pers-toolbar-scroll-hidden');
    } else if (y > lastY + 6 && y > 72) {
      document.body.classList.add('pers-toolbar-scroll-hidden');
    } else if (y < lastY - 6) {
      document.body.classList.remove('pers-toolbar-scroll-hidden');
    }

    lastY = y;
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  mq.addEventListener('change', () => {
    if (!mq.matches) document.body.classList.remove('pers-toolbar-scroll-hidden');
  });
}

function init() {
  document.getElementById('pers-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderGrid();
  });

  document.getElementById('pers-clear-done-btn')?.addEventListener('click', () => {
    if (!doneSet.size) return;
    if (window.confirm('Limpar todas as marcas de "feito" salvas neste navegador?')) {
      clearDoneSet();
    }
  });

  document.getElementById('pers-print-btn')?.addEventListener('click', () => {
    window.print();
  });

  bindFontModal();
  bindTabs();
  bindMobileToolbarScroll();
  updateSubtitle();
  renderProductFilters();
  renderStatusFilters();
  renderSizeFilters();
  renderStats();
  setActiveTab('queue');
}

init();
