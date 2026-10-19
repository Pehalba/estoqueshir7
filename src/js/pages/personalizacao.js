import {
  PRODUCTS,
  ALL_ITEMS,
  formatBatchDate,
  listBatchDates,
} from '../../data/personalization-alba-fedex-03.js';
import { SIZE_ORDER, displaySizeLabel } from '../utils/sizes.js';

const STORAGE_KEY = 'shir7-pers-done';
const REVIEW_KEY = 'shir7-pers-review';
const GRAFICA_ITEM_KEY = 'shir7-pers-grafica-items';
const SENT_DESCHAPADO_KEY = 'shir7-pers-sent-deschapado';
const SENT_GRAFICA_KEY = 'shir7-pers-sent-grafica';
const BATCH_DATES = listBatchDates();
const PRODUCT_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'br-home-amarela', label: 'Amarela jogador', tone: 'amarela' },
  { id: 'br-away-azul', label: 'Azul jogador', tone: 'azul' },
  { id: 'br-tor-ii', label: 'Azul torcedor', tone: 'azul' },
  { id: 'br-retro-2002', label: 'Retro 02', tone: 'amarela' },
  { id: 'br-retro-98', label: 'Retro 98', tone: 'amarela' },
  { id: 'br-tor-vermelha', label: 'Vermelha torcedor', tone: 'vermelha' },
  { id: 'br-jordan-preta', label: 'Jordan preta', tone: 'preta' },
];

const PRODUCT_SORT_ORDER = {
  'br-home-amarela': 0,
  'br-away-azul': 1,
  'br-retro-2002': 2,
  'br-retro-98': 3,
  'br-tor-ii': 4,
  'br-tor-vermelha': 5,
  'br-jordan-preta': 6,
};

let activeProduct = 'all';
let activeSize = 'all';
/** Quantidade de peças do pedido: 'all' | '1' | '2' | '3' | '4plus' */
let activeUnits = 'all';
/** 'all' por padrão para “marcar feito” não sumir o card da fila */
let activeStatus = 'all';
/** Data de cadastro ativa (YYYY-MM-DD) ou 'all'. Padrão: lote mais recente. */
let activeDate = BATCH_DATES[0] || 'all';
let activeTab = 'queue';
let searchQuery = '';
let hideGolaNotes = false;
let hideExtrasText = false;
let doneSet = loadDoneSet();
let reviewSet = loadReviewSet();
let graficaItemSet = loadGraficaItemSet();
let sentDeschapado = loadDateFlagSet(SENT_DESCHAPADO_KEY);
let sentGrafica = loadDateFlagSet(SENT_GRAFICA_KEY);

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

function loadReviewSet() {
  try {
    const raw = localStorage.getItem(REVIEW_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveReviewSet() {
  localStorage.setItem(REVIEW_KEY, JSON.stringify([...reviewSet]));
}

function loadGraficaItemSet() {
  try {
    const raw = localStorage.getItem(GRAFICA_ITEM_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveGraficaItemSet() {
  localStorage.setItem(GRAFICA_ITEM_KEY, JSON.stringify([...graficaItemSet]));
}

function loadDateFlagSet(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveDateFlagSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

function isDateDespachado(date) {
  return Boolean(date) && date !== 'all' && sentDeschapado.has(date);
}

function isDateGraficaSent(date) {
  return Boolean(date) && date !== 'all' && sentGrafica.has(date);
}

function toggleDateSendFlag(kind, date) {
  if (!date || date === 'all') return;
  const set = kind === 'deschapado' ? sentDeschapado : sentGrafica;
  const key = kind === 'deschapado' ? SENT_DESCHAPADO_KEY : SENT_GRAFICA_KEY;
  if (set.has(date)) set.delete(date);
  else set.add(date);
  saveDateFlagSet(key, set);
  renderDateFilters();
}

function itemKey(item) {
  return `${item.productId}::${item.orderId}`;
}

function isDone(item) {
  return doneSet.has(itemKey(item));
}

function isReview(item) {
  return reviewSet.has(itemKey(item));
}

function isGraficaItem(item) {
  return graficaItemSet.has(itemKey(item));
}

function dateHasReview(date) {
  if (!date || date === 'all') return false;
  return ALL_ITEMS.some(
    (item) => item.createdAt === date && !item.placeholder && reviewSet.has(itemKey(item)),
  );
}

function dateHasGraficaItem(date) {
  if (!date || date === 'all') return false;
  return ALL_ITEMS.some(
    (item) => item.createdAt === date && !item.placeholder && graficaItemSet.has(itemKey(item)),
  );
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

/** Artes de número “limpo” (só o dígito, sem collage). */
const NUMBER_FONT_ARTS = {
  22: '../src/assets/images/personalization/numbers/22.png',
};

/**
 * numberArt / Bolsonaro 22 / Neymar arte → mostra a arte no lugar do número.
 * Número puro (ex.: 22) → mostra a fonte do número.
 * Outros → texto.
 */
function resolveNumberDisplay(item) {
  if (item.numberArt) {
    const src = String(item.numberArt);
    const kind = /neymar/i.test(src)
      ? 'neymar'
      : /bolsonaro/i.test(src)
        ? 'bolsonaro'
        : 'number';
    return {
      type: 'art',
      src: item.numberArt,
      label: displayNumber(item.number),
      kind,
    };
  }

  const extras = Array.isArray(item.extras) ? item.extras : [];
  const costasArt = extras.find((extra) => {
    const label = String(extra.label || '');
    const place = String(extra.place || '');
    if (!extra.image) return false;
    if (/bolsonaro\s*22\s*arte/i.test(label)) return true;
    if (/neymar\s*arte/i.test(label) && /costas/i.test(place)) return true;
    return false;
  });
  if (costasArt) {
    const isNeymar = /neymar/i.test(String(costasArt.label || ''));
    return {
      type: 'art',
      src: costasArt.image,
      label: costasArt.label,
      kind: isNeymar ? 'neymar' : 'bolsonaro',
    };
  }

  const num = String(item.number ?? '').trim();
  if (num && NUMBER_FONT_ARTS[num]) {
    return {
      type: 'art',
      src: NUMBER_FONT_ARTS[num],
      label: num,
      kind: 'number',
    };
  }

  return { type: 'text', value: displayNumber(item.number) };
}

function parseOrderSortKey(orderId) {
  const raw = String(orderId ?? '').replace(/^#/, '').trim();
  const match = raw.match(/^(\d+)(?:-(\d+|[A-Za-z].*))?$/);
  if (!match) {
    return { n: Number.MAX_SAFE_INTEGER, suffix: raw.toLowerCase() };
  }
  const suffixRaw = match[2] || '';
  const suffixNum = /^\d+$/.test(suffixRaw) ? Number(suffixRaw) : 0;
  return {
    n: Number(match[1]),
    suffix: suffixRaw.toLowerCase(),
    suffixNum,
  };
}

/** Base do pedido: #1951-2 → 1951 */
function baseOrderId(orderId) {
  const parsed = parseOrderSortKey(orderId);
  if (parsed.n !== Number.MAX_SAFE_INTEGER) return String(parsed.n);
  return String(orderId ?? '').replace(/^#/, '').trim().toLowerCase();
}

/** Conta peças por pedido no escopo da data (ignora placeholder). */
function buildOrderUnitCounts(items) {
  const counts = new Map();
  for (const item of items) {
    if (item.placeholder) continue;
    const key = baseOrderId(item.orderId);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/** Pedido mais antigo → mais novo; depois peça (-2); depois desabilitados. */
function sortItemsForDisplay(items) {
  return [...items].sort((a, b) => {
    const orderA = parseOrderSortKey(a.orderId);
    const orderB = parseOrderSortKey(b.orderId);
    if (orderA.n !== orderB.n) return orderA.n - orderB.n;
    if (orderA.suffixNum !== orderB.suffixNum) return orderA.suffixNum - orderB.suffixNum;
    const suffixCmp = orderA.suffix.localeCompare(orderB.suffix);
    if (suffixCmp !== 0) return suffixCmp;

    const disabledA = a.disabled ? 1 : 0;
    const disabledB = b.disabled ? 1 : 0;
    if (disabledA !== disabledB) return disabledA - disabledB;

    const productA = PRODUCT_SORT_ORDER[a.productId] ?? 99;
    const productB = PRODUCT_SORT_ORDER[b.productId] ?? 99;
    if (productA !== productB) return productA - productB;

    const sizeA = SIZE_ORDER.indexOf(a.size);
    const sizeB = SIZE_ORDER.indexOf(b.size);
    const sizeRankA = sizeA === -1 ? 99 : sizeA;
    const sizeRankB = sizeB === -1 ? 99 : sizeB;
    return sizeRankA - sizeRankB;
  });
}

function getItemsByDate() {
  if (activeDate === 'all') return ALL_ITEMS;
  return ALL_ITEMS.filter((item) => item.createdAt === activeDate);
}

function getVisibleItems() {
  const byDate = getItemsByDate();
  const items = activeProduct === 'all'
    ? byDate
    : byDate.filter((i) => i.productId === activeProduct);
  return sortItemsForDisplay(items);
}

function filterItems() {
  const q = searchQuery.trim().toLowerCase();
  const unitCounts = activeUnits === 'all'
    ? null
    : buildOrderUnitCounts(getItemsByDate());
  const filterFourPlus = activeUnits === '4plus';
  const wantedUnits = activeUnits === 'all' || filterFourPlus ? null : Number(activeUnits);

  return sortItemsForDisplay(getVisibleItems().filter((item) => {
    const done = isDone(item);
    if (activeStatus === 'pending' && done) return false;
    if (activeStatus === 'done' && !done) return false;
    if (activeSize !== 'all' && item.size !== activeSize) return false;
    if (unitCounts) {
      const units = unitCounts.get(baseOrderId(item.orderId)) || 0;
      if (filterFourPlus) {
        if (units < 4) return false;
      } else if (wantedUnits != null && units !== wantedUnits) {
        return false;
      }
    }
    if (!q) return true;
    return (
      item.orderId.toLowerCase().includes(q)
      || item.name.toLowerCase().includes(q)
      || item.number.toLowerCase().includes(q)
      || item.sizeLabel.toLowerCase().includes(q)
    );
  }));
}

function getProductionItems() {
  return getItemsByDate().filter((item) => !item.placeholder);
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

function sizeLabelFor(_group, size) {
  return displaySizeLabel(size);
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
      .sort(([a], [b]) => {
        const idxA = SIZE_ORDER.indexOf(a);
        const idxB = SIZE_ORDER.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      })
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
  const numberDisplay = resolveNumberDisplay(item);
  const key = itemKey(item);
  const done = isDone(item);
  const review = isReview(item);
  const naGrafica = isGraficaItem(item);
  const kitType = item.kitType || 'jogador';
  const kitClass = ` pers-card--${kitType}`;
  const headClass = kitType === 'torcedor'
    ? ' pers-card__head--torcedor'
    : kitType === 'retro' || item.productAccent === 'yellow'
      ? ' pers-card__head--yellow'
      : '';
  const placeholderClass = item.placeholder ? ' pers-card--placeholder' : '';
  const disabledClass = item.disabled ? ' pers-card--disabled' : '';
  const sidesNote = item.persSides
    ? `<p class="pers-card__sides-note">Personalização na ${escapeHtml(item.persSides)}</p>`
    : '';
  const fontBtn = item.fontGuide
    ? `<button type="button" class="pers-font-btn no-print" data-font-product="${escapeHtml(item.productId)}" ${item.disabled ? 'disabled' : ''}>Consultar fonte</button>`
    : '';
  const showModel = activeProduct === 'all' || kitType === 'torcedor';
  const modelClass = kitType === 'torcedor' ? ' pers-card__model--torcedor' : '';
  const statusBadge = item.disabled
    ? '<span class="pers-card__badge pers-card__badge--wait">Aguardar</span>'
    : item.placeholder
      ? '<span class="pers-card__badge">Aguardando pedido</span>'
      : '';
  const dateBadge = item.createdAt
    ? `<span class="pers-card__badge pers-card__badge--date">${escapeHtml(formatBatchDate(item.createdAt))}</span>`
    : '';
  const extras = Array.isArray(item.extras) ? item.extras : [];
  // "Aviso" só para notas manuais (ex.: gola). Artes ficam na seção de extras.
  const noteText = String(item.note || '').trim();
  const hasExtras = extras.length > 0 || Boolean(item.alertImage);
  const hasAlertBlock = hasExtras || Boolean(noteText);
  const noteBlock = noteText
    ? `<p class="pers-card__note" role="note"><span class="pers-card__note-label">Aviso</span> ${escapeHtml(noteText)}</p>`
    : '';
  const alertNote = hasAlertBlock
    ? `<aside class="pers-card__alert${extras.some((e) => e.image) || item.alertImage ? ' pers-card__alert--with-image' : ''}" role="alert">
        ${noteBlock}
        ${hasExtras ? `
        <div class="pers-card__alert-text">
          <span class="pers-card__alert-label">Atenção — artes / extras</span>
          ${extras.length
            ? `<ul class="pers-card__alert-list">${extras.map((extra) => `
                <li>
                  <span class="pers-card__alert-place">${escapeHtml(extra.place)}</span>
                  <strong class="pers-card__alert-msg">${escapeHtml(extra.label)}</strong>
                </li>`).join('')}</ul>`
            : ''}
        </div>
        <div class="pers-card__alert-gallery">
          ${(extras.filter((e) => e.image).length
            ? extras.filter((e) => e.image)
            : item.alertImage
              ? [{ place: '', label: item.alert || 'Arte', image: item.alertImage }]
              : []
          ).map((extra) => `
            <figure class="pers-card__alert-figure">
              <img class="pers-card__alert-image" src="${escapeHtml(extra.image)}" alt="${escapeHtml(`${extra.place} ${extra.label}`.trim())}" loading="eager" decoding="async">
              ${extra.place ? `<figcaption>${escapeHtml(extra.place)}</figcaption>` : ''}
            </figure>`).join('')}
        </div>` : ''}
      </aside>`
    : '';
  const alertGif = hasAlertBlock
    ? '<img class="pers-card__alert-gif" src="../src/assets/images/personalization/alert.gif" alt="Alerta" width="22" height="22">'
    : '';
  const numberBlock = numberDisplay.type === 'art'
    ? `<img
         class="pers-card__number-art pers-card__number-art--${escapeHtml(numberDisplay.kind || 'number')}"
         src="${escapeHtml(numberDisplay.src)}"
         alt="${escapeHtml(numberDisplay.label || 'Número')}"
         loading="eager"
         decoding="async"
       >`
    : `<span class="pers-card__number">${escapeHtml(numberDisplay.value)}</span>`;

  return `
    <article class="pers-card${kitClass}${done ? ' pers-card--done' : ''}${review ? ' pers-card--review' : ''}${naGrafica ? ' pers-card--grafica' : ''}${placeholderClass}${disabledClass}${hasAlertBlock ? ' pers-card--alert' : ''}" data-id="${escapeHtml(key)}">
      <header class="pers-card__head${headClass}">
        <div class="pers-card__head-row">
          <span class="pers-card__order">${escapeHtml(item.orderId)}${alertGif}</span>
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
            loading="eager"
            decoding="async"
          >
          <span class="pers-card__size">${escapeHtml(item.sizeLabel)}</span>
          ${fontBtn}
        </div>
        <div class="pers-card__pers">
          ${statusBadge}${dateBadge}${review ? '<span class="pers-card__badge pers-card__badge--review">Revisão</span>' : ''}${naGrafica ? '<span class="pers-card__badge pers-card__badge--grafica">Na gráfica</span>' : ''}
          ${sidesNote}
          <span class="pers-card__name">${escapeHtml(name)}</span>
          ${numberBlock}
        </div>
      </div>
      ${alertNote}

      <footer class="pers-card__foot no-print">
        <button
          type="button"
          class="pers-done-btn${done ? ' pers-done-btn--active' : ''}"
          data-toggle-done="${escapeHtml(key)}"
          aria-pressed="${done ? 'true' : 'false'}"
          ${item.disabled ? 'disabled' : ''}
        >
          <span class="pers-done-btn__icon" aria-hidden="true"></span>
          <span class="pers-done-btn__label">${item.disabled ? 'Aguardar' : done ? 'Feito' : 'Marcar feito'}</span>
        </button>
        <button
          type="button"
          class="pers-review-btn${review ? ' pers-review-btn--active' : ''}"
          data-toggle-review="${escapeHtml(key)}"
          aria-pressed="${review ? 'true' : 'false'}"
          ${item.disabled ? 'disabled' : ''}
        >
          <span class="pers-review-btn__label">${review ? 'Em revisão' : 'Precisa de revisão'}</span>
        </button>
        <button
          type="button"
          class="pers-grafica-btn${naGrafica ? ' pers-grafica-btn--active' : ''}"
          data-toggle-grafica="${escapeHtml(key)}"
          aria-pressed="${naGrafica ? 'true' : 'false'}"
          ${item.disabled ? 'disabled' : ''}
        >
          <span class="pers-grafica-btn__label">${naGrafica ? 'Na gráfica' : 'Personalização na gráfica'}</span>
        </button>
        <button
          type="button"
          class="pers-print-card-btn"
          data-print-card="${escapeHtml(key)}"
          title="Imprimir esta unidade"
        >Imprimir</button>
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

function datePillClass(date) {
  const classes = ['pers-pill'];
  if (activeDate === date) classes.push('pers-pill--active');
  if (dateHasReview(date)) classes.push('pers-pill--review');
  if (isDateGraficaSent(date) || dateHasGraficaItem(date)) classes.push('pers-pill--grafica');
  if (isDateDespachado(date)) classes.push('pers-pill--despachado');
  return classes.join(' ');
}

function renderDateFilters() {
  const container = document.getElementById('pers-date-filters');
  if (!container) return;

  const dateButtons = [
    { id: 'all', label: 'Todas' },
    ...BATCH_DATES.map((date) => ({
      id: date,
      label: formatBatchDate(date),
    })),
  ];

  const pills = dateButtons
    .map((btn) => {
      if (btn.id === 'all') {
        const active = activeDate === 'all' ? ' pers-pill--active' : '';
        return `<button type="button" class="pers-pill${active}" data-date="all">Todas</button>`;
      }
      return `
        <button
          type="button"
          class="${datePillClass(btn.id)}"
          data-date="${escapeHtml(btn.id)}"
        >${escapeHtml(btn.label)}</button>
      `;
    })
    .join('');

  const showActions = activeDate !== 'all';
  const graficaOn = showActions && isDateGraficaSent(activeDate);
  const despachadoOn = showActions && isDateDespachado(activeDate);
  const actions = showActions
    ? `
      <div class="pers-date-actions" role="group" aria-label="Status do lote ${escapeHtml(formatBatchDate(activeDate))}">
        <button
          type="button"
          class="pers-date-action pers-date-action--grafica${graficaOn ? ' pers-date-action--on' : ''}"
          data-toggle-sent="${escapeHtml(activeDate)}"
          data-sent-kind="grafica"
          aria-pressed="${graficaOn ? 'true' : 'false'}"
        >${graficaOn ? '✓ Enviado à gráfica' : 'Marcar enviado à gráfica'}</button>
        <button
          type="button"
          class="pers-date-action pers-date-action--despachado${despachadoOn ? ' pers-date-action--on' : ''}"
          data-toggle-sent="${escapeHtml(activeDate)}"
          data-sent-kind="deschapado"
          aria-pressed="${despachadoOn ? 'true' : 'false'}"
        >${despachadoOn ? '✓ Despachado' : 'Marcar despachado'}</button>
      </div>
    `
    : '';

  container.innerHTML = `
    <div class="pers-date-filters__pills">${pills}</div>
    ${actions}
  `;

  container.querySelectorAll('[data-date]').forEach((el) => {
    el.addEventListener('click', () => {
      activeDate = el.dataset.date || 'all';
      activeProduct = 'all';
      activeSize = 'all';
      activeUnits = 'all';
      updateSubtitle();
      renderDateFilters();
      renderProductFilters();
      renderSizeFilters();
      renderUnitsFilters();
      renderStats();
      if (activeTab === 'summary') renderSummary();
      else renderGrid();
    });
  });

  container.querySelectorAll('[data-toggle-sent]').forEach((el) => {
    el.addEventListener('click', () => {
      toggleDateSendFlag(el.dataset.sentKind, el.dataset.toggleSent);
    });
  });
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
      { id: 'all', label: 'Todos' },
      { id: 'pending', label: 'Pendentes' },
      { id: 'done', label: 'Feitos' },
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
  const sizesInScope = [...new Set(scope.map((i) => i.size))].sort((a, b) => {
    const idxA = SIZE_ORDER.indexOf(a);
    const idxB = SIZE_ORDER.indexOf(b);
    if (idxA === -1 && idxB === -1) return a.localeCompare(b);
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });

  renderPillGroup(
    'pers-size-filters',
    [
      { id: 'all', label: 'Todos' },
      ...sizesInScope.map((size) => ({
        id: size,
        label: size === 'XG' ? 'XG / XGG' : size,
      })),
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

function renderUnitsFilters() {
  renderPillGroup(
    'pers-units-filters',
    [
      { id: 'all', label: 'Todos' },
      { id: '1', label: '1 unidade' },
      { id: '2', label: '2 unidades' },
      { id: '3', label: '3 unidades' },
      { id: '4plus', label: '4 ou mais' },
    ],
    activeUnits,
    'units',
  );

  document.getElementById('pers-units-filters')?.querySelectorAll('[data-units]').forEach((el) => {
    el.addEventListener('click', () => {
      activeUnits = el.dataset.units || 'all';
      renderUnitsFilters();
      renderGrid();
    });
  });
}

function syncAlertVisibility() {
  document.body.classList.toggle('pers-hide-gola-notes', hideGolaNotes);
  document.body.classList.toggle('pers-hide-extras-text', hideExtrasText);

  const golaBtn = document.getElementById('pers-toggle-gola');
  if (golaBtn) {
    golaBtn.classList.toggle('pers-pill--active', hideGolaNotes);
    golaBtn.setAttribute('aria-pressed', hideGolaNotes ? 'true' : 'false');
    golaBtn.textContent = hideGolaNotes ? 'Mostrar gola' : 'Ocultar gola';
  }

  const extrasBtn = document.getElementById('pers-toggle-extras-text');
  if (extrasBtn) {
    extrasBtn.classList.toggle('pers-pill--active', hideExtrasText);
    extrasBtn.setAttribute('aria-pressed', hideExtrasText ? 'true' : 'false');
    extrasBtn.textContent = hideExtrasText ? 'Mostrar textos' : 'Ocultar textos';
  }
}

function bindAlertToggles() {
  document.getElementById('pers-toggle-gola')?.addEventListener('click', () => {
    hideGolaNotes = !hideGolaNotes;
    syncAlertVisibility();
  });

  document.getElementById('pers-toggle-extras-text')?.addEventListener('click', () => {
    hideExtrasText = !hideExtrasText;
    syncAlertVisibility();
  });

  syncAlertVisibility();
}

function updateSubtitle() {
  const subtitle = document.getElementById('pers-lot-title');
  if (!subtitle) return;

  const scope = getVisibleItems();
  const dateHint = activeDate === 'all'
    ? 'todas as datas'
    : formatBatchDate(activeDate);

  if (activeProduct === 'all') {
    subtitle.textContent = `${scope.length} peças · ${dateHint}`;
    return;
  }

  const product = PRODUCTS[activeProduct];
  const sidesHint = product?.persSides ? ' · frente e atrás' : '';
  subtitle.textContent = product
    ? `${product.label} · ${scope.length} peças · ${dateHint}${sidesHint}`
    : '';
}

function bindDoneButtons() {
  document.querySelectorAll('[data-toggle-done]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleDone;
      if (!id) return;

      if (doneSet.has(id)) doneSet.delete(id);
      else {
        doneSet.add(id);
        reviewSet.delete(id);
        graficaItemSet.delete(id);
        saveReviewSet();
        saveGraficaItemSet();
        // Evita o card sumir se o filtro estiver em Pendentes
        if (activeStatus === 'pending') {
          activeStatus = 'all';
          renderStatusFilters();
        }
      }

      saveDoneSet();
      renderDateFilters();
      renderStats();
      renderGrid();
    });
  });

  document.querySelectorAll('[data-toggle-review]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleReview;
      if (!id) return;

      if (reviewSet.has(id)) reviewSet.delete(id);
      else {
        reviewSet.add(id);
        doneSet.delete(id);
        graficaItemSet.delete(id);
        saveDoneSet();
        saveGraficaItemSet();
      }

      saveReviewSet();
      renderDateFilters();
      renderStats();
      renderGrid();
    });
  });

  document.querySelectorAll('[data-toggle-grafica]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleGrafica;
      if (!id) return;

      if (graficaItemSet.has(id)) graficaItemSet.delete(id);
      else {
        graficaItemSet.add(id);
        doneSet.delete(id);
        reviewSet.delete(id);
        saveDoneSet();
        saveReviewSet();
      }

      saveGraficaItemSet();
      renderDateFilters();
      renderStats();
      renderGrid();
    });
  });

  document.querySelectorAll('[data-font-product]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openFontModal(btn.dataset.fontProduct);
    });
  });

  document.querySelectorAll('[data-print-card]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openPrintModal({ scope: 'one', unitId: btn.dataset.printCard });
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

function fillPrintUnitSelect(selectedId = '') {
  const select = document.getElementById('pers-print-unit');
  if (!select) return;

  const items = filterItems();
  if (!items.length) {
    select.innerHTML = '<option value="">Nenhuma unidade no filtro</option>';
    return;
  }

  select.innerHTML = items.map((item) => {
    const key = itemKey(item);
    const label = `${item.orderId} · ${displayName(item.name)} ${displayNumber(item.number)} · ${item.sizeLabel} · ${item.productLabel}`;
    return `<option value="${escapeHtml(key)}"${key === selectedId ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function syncPrintUnitVisibility() {
  const wrap = document.getElementById('pers-print-unit-wrap');
  const scopeOne = document.querySelector('input[name="pers-print-scope"][value="one"]')?.checked;
  if (wrap) wrap.hidden = !scopeOne;
}

function openPrintModal({ scope = 'all', unitId = '' } = {}) {
  const modal = document.getElementById('pers-print-modal');
  if (!modal) return;

  fillPrintUnitSelect(unitId);
  const scopeInput = document.querySelector(`input[name="pers-print-scope"][value="${scope}"]`);
  if (scopeInput) scopeInput.checked = true;
  syncPrintUnitVisibility();

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('pers-print-modal-open');
  document.getElementById('pers-print-confirm')?.focus();
}

function closePrintModal() {
  const modal = document.getElementById('pers-print-modal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('pers-print-modal-open');
}

function clearPrintMode() {
  document.body.classList.remove(
    'pers-printing',
    'pers-print-format-a4',
    'pers-print-format-thermal',
    'pers-print-scope-all',
    'pers-print-scope-one',
  );
  document.querySelectorAll('.pers-card--print-target').forEach((el) => {
    el.classList.remove('pers-card--print-target');
  });
  document.getElementById('pers-print-page-style')?.remove();
}

function applyPrintPageStyle(format) {
  document.getElementById('pers-print-page-style')?.remove();
  const style = document.createElement('style');
  style.id = 'pers-print-page-style';
  style.textContent = format === 'thermal'
    ? '@page { size: 80mm auto; margin: 2mm; }'
    : '@page { size: A4 portrait; margin: 5mm; }';
  document.head.appendChild(style);
}

function waitForPrintImages(root = document) {
  const imgs = [...root.querySelectorAll('.pers-card img, .pers-card__alert-image, .pers-card__number-art')];
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          // Força o browser a buscar a imagem (útil após lazy/print).
          if (img.src) {
            // eslint-disable-next-line no-self-assign
            img.src = img.src;
          }
        }),
    ),
  );
}

async function runPrint() {
  const scope = document.querySelector('input[name="pers-print-scope"]:checked')?.value || 'all';
  const format = document.querySelector('input[name="pers-print-format"]:checked')?.value || 'a4';
  const unitId = document.getElementById('pers-print-unit')?.value || '';

  if (scope === 'one' && !unitId) {
    window.alert('Escolha uma unidade para imprimir.');
    return;
  }

  // Impressão sempre na fila (não no resumo de tamanhos).
  if (activeTab !== 'queue') setActiveTab('queue');

  clearPrintMode();
  applyPrintPageStyle(format);
  document.body.classList.add('pers-printing', `pers-print-format-${format}`, `pers-print-scope-${scope}`);

  if (scope === 'one') {
    const card = document.querySelector(`.pers-card[data-id="${CSS.escape(unitId)}"]`);
    if (!card) {
      clearPrintMode();
      window.alert('Unidade não encontrada na fila atual.');
      return;
    }
    card.classList.add('pers-card--print-target');
  }

  closePrintModal();

  const cleanup = () => {
    clearPrintMode();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  try {
    await waitForPrintImages(document.getElementById('pers-grid') || document);
  } catch {
    /* segue mesmo se alguma imagem falhar */
  }

  window.setTimeout(() => {
    window.print();
    window.setTimeout(cleanup, 1500);
  }, 80);
}

function bindPrintModal() {
  document.getElementById('pers-print-btn')?.addEventListener('click', () => {
    openPrintModal({ scope: 'all' });
  });

  document.querySelectorAll('[data-print-modal-close]').forEach((el) => {
    el.addEventListener('click', closePrintModal);
  });

  document.querySelectorAll('input[name="pers-print-scope"]').forEach((input) => {
    input.addEventListener('change', syncPrintUnitVisibility);
  });

  document.getElementById('pers-print-confirm')?.addEventListener('click', runPrint);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePrintModal();
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

  bindPrintModal();
  bindFontModal();
  bindAlertToggles();
  bindTabs();
  updateSubtitle();
  renderDateFilters();
  renderProductFilters();
  renderStatusFilters();
  renderSizeFilters();
  renderUnitsFilters();
  renderStats();
  setActiveTab('queue');
}

init();
