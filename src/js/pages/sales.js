import { listStockEntries, getStockEntryById } from '../services/stockEntryService.js';
import { listInvestors } from '../services/investorService.js';
import { listSales, createQuickSale, recalculateAllSalesPlatformFees } from '../services/salesService.js';
import {
  getGlobalSettings,
  saveGlobalSettings,
  DEFAULT_SETTINGS,
} from '../services/settingsService.js';
import { waitForAuth } from '../services/authService.js';
import {
  availableQty,
  getStockEntryUnitCost,
  getStockEntryInvestorCapitalUnit,
  getStockEntryCostBreakdown,
  calculateQuickSaleFinancials,
  calculateInvestorRepasseForSale,
  calculatePoolCostPerPiece,
  calculatePlatformFeesBreakdown,
  calculateTotalPlatformFees,
  piecesSoldInCurrentMonth,
  formatSaleLinesSummary,
  totalSaleLinesQuantity,
  DEFAULT_SALE_PRICE,
} from '../utils/calculations.js';
import { validateQuickSale, parseSizesQuickInput } from '../utils/validators.js';
import { parseSalesBatchText, validateOrderWithStockEntry, formatCouponUsedLabel, sanitizeCouponTextInLine } from '../utils/saleTextParser.js';
import { applyPlatformSettingsToSales } from '../utils/analytics.js';
import { allocateOrdersByPriority, normalizeOrderSize, collectStockAvailabilityErrors } from '../utils/stockAllocation.js';
import { formatPasteStockOptionLabel, pasteStockOptionAttrs } from '../utils/stockEntryDisplay.js';
import { formatCurrency, formatPercent } from '../utils/formatCurrency.js';
import {
  qs,
  qsa,
  showToast,
  setLoading,
} from '../utils/domHelpers.js';

const SIZE_OPTIONS = ['P', 'M', 'G', 'GG', 'XG'];

let allStockEntries = [];
let allInvestors = [];
let allSales = [];
let globalSettings = { ...DEFAULT_SETTINGS };
let couponsDraft = [];
let persTypesDraft = [];
let pasteStockOverrides = {};

const saleForm = qs('#sale-form');
const formErrors = qs('#form-errors');
const tbody = qs('#sales-tbody');
const saleLinesEl = qs('#sale-lines');

function formatDate(timestamp) {
  if (!timestamp?.seconds) return '—';
  return new Date(timestamp.seconds * 1000).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInvestorName(id) {
  return allInvestors.find((i) => i.id === id)?.name || '—';
}

function getSelectedStockEntry() {
  return allStockEntries.find((e) => e.id === qs('#field-product').value) || null;
}

function getActivePlatformCosts() {
  return collectPlatformCostsFromForm();
}

function collectPlatformCostsFromForm() {
  const read = (id) => ({
    percent: Number(qs(`#set-platform-${id}-percent`)?.value) || 0,
    fixedPerOrder: Number(qs(`#set-platform-${id}-fixed`)?.value) || 0,
  });

  return (globalSettings.platformCosts || []).map((platform) => {
    const values = read(platform.id);
    return {
      ...platform,
      percent: values.percent,
      fixedPerOrder: values.fixedPerOrder,
    };
  });
}

function fillPlatformCostsForm() {
  (globalSettings.platformCosts || []).forEach((platform) => {
    const percentEl = qs(`#set-platform-${platform.id}-percent`);
    const fixedEl = qs(`#set-platform-${platform.id}-fixed`);
    if (percentEl) percentEl.value = platform.percent;
    if (fixedEl) fixedEl.value = platform.fixedPerOrder;
  });
}

function renderPlatformFeesPreview(exampleRevenue = 229.9) {
  const el = qs('#platform-fees-preview');
  if (!el) return;

  const platforms = getActivePlatformCosts();
  const total = calculateTotalPlatformFees(platforms, exampleRevenue);
  const lines = platforms
    .map((p) => {
      const fee = calculateTotalPlatformFees([p], exampleRevenue);
      if (fee <= 0) return null;
      const parts = [];
      if (p.percent > 0) parts.push(`${p.percent}%`);
      if (p.fixedPerOrder > 0) parts.push(`${formatCurrency(p.fixedPerOrder)} fixo`);
      return `<li><strong>${p.name}</strong> (${p.role || '—'}): ${formatCurrency(fee)}${parts.length ? ` · ${parts.join(' + ')}` : ''}</li>`;
    })
    .filter(Boolean);

  el.innerHTML = total > 0
    ? `<p><strong>Exemplo em pedido de ${formatCurrency(exampleRevenue)}:</strong> ${formatCurrency(total)} de taxas somadas.</p>
       <ul class="platform-fees-preview__list">${lines.join('')}</ul>`
    : '<p class="text-muted">Nenhuma taxa configurada — configure Shopify, Yampi e Appmax abaixo.</p>';
}

function getBasePrice() {
  return DEFAULT_SALE_PRICE;
}

function sizeSelectHtml(selected = '', product) {
  const sizes = product?.sizes || SIZE_OPTIONS.map((s) => ({ size: s }));
  const options = sizes.map((s) => {
    const avail = typeof s.quantity === 'number' ? availableQty(s) : null;
    const label = avail != null ? `${s.size} (${avail})` : s.size;
    return `<option value="${s.size}" ${s.size === selected ? 'selected' : ''}>${label}</option>`;
  }).join('');
  return `<option value="">Tam.</option>${options}`;
}

function couponSelectHtml(selectedId = '') {
  const options = globalSettings.coupons.map(
    (c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.name} −${c.percent}%</option>`
  ).join('');
  return `<option value="">—</option>${options}`;
}

function getPersonalizationType(typeId) {
  if (!typeId) return null;
  return globalSettings.personalizationTypes?.find((t) => t.id === typeId) || null;
}

function resolveLinePersonalization(typeId, priceOverride, costOverride) {
  const type = getPersonalizationType(typeId);
  const defaultPrice = Number(globalSettings.defaultPersonalizationPrice) || 50;
  const defaultCost = Number(globalSettings.personalizationCostPerPiece) || 10;

  if (type) {
    return {
      personalizationTypeId: type.id,
      personalizationTypeName: type.name,
      personalizationPerPiece: priceOverride != null && priceOverride !== ''
        ? Number(priceOverride) || type.price
        : type.price,
      personalizationCostPerPiece: costOverride != null && costOverride !== ''
        ? Number(costOverride) || type.cost
        : type.cost,
    };
  }

  return {
    personalizationTypeId: '',
    personalizationTypeName: '',
    personalizationPerPiece: priceOverride != null && priceOverride !== ''
      ? Number(priceOverride) || defaultPrice
      : defaultPrice,
    personalizationCostPerPiece: costOverride != null && costOverride !== ''
      ? Number(costOverride) || defaultCost
      : defaultCost,
  };
}

function defaultLineExtras() {
  const pers = resolveLinePersonalization('');
  return {
    couponId: '',
    freight: Number(globalSettings.defaultFreight) || 0,
    ads: 0,
    otherCosts: 0,
    isPersonalized: false,
    personalizationTypeId: '',
    ...pers,
  };
}

function getLineCoupon(couponId) {
  if (!couponId) {
    return { couponId: '', couponName: '', couponPercent: 0 };
  }
  const coupon = globalSettings.coupons.find((c) => c.id === couponId);
  return {
    couponId,
    couponName: coupon?.name || '',
    couponPercent: coupon?.percent || 0,
  };
}

function refreshLineCouponSelects() {
  qsa('.sale-lines__row', saleLinesEl).forEach((row) => {
    const select = row.querySelector('.line-coupon');
    if (!select) return;
    const current = select.value;
    select.innerHTML = couponSelectHtml(current);
    select.value = current;
  });
}

function collectLinesFromDOM() {
  return qsa('.sale-lines__row', saleLinesEl).map((row) => {
    const couponId = row.querySelector('.line-coupon')?.value || '';
    const coupon = getLineCoupon(couponId);
    return {
      size: row.querySelector('.line-size')?.value || '',
      quantity: Number(row.querySelector('.line-qty')?.value) || 0,
      unitPrice: Number(row.querySelector('.line-price')?.value) || 0,
      ...coupon,
      freight: Number(row.querySelector('.line-freight')?.value) || 0,
      ads: Number(row.querySelector('.line-ads')?.value) || 0,
      otherCosts: Number(row.querySelector('.line-other')?.value) || 0,
      isPersonalized: row.querySelector('.line-pers-check')?.checked || false,
      ...(row.querySelector('.line-pers-check')?.checked
        ? {
          personalizationTypeId: '',
          personalizationTypeName: '',
          personalizationPerPiece: Number(row.querySelector('.line-pers-value')?.value) || 0,
          personalizationCostPerPiece: Number(row.querySelector('.line-pers-cost')?.value) || 0,
        }
        : {
          personalizationTypeId: '',
          personalizationTypeName: '',
          personalizationPerPiece: 0,
          personalizationCostPerPiece: 0,
        }),
    };
  }).filter((l) => l.size && l.quantity > 0);
}

function getLineAvailable(size) {
  const stockEntry = getSelectedStockEntry();
  const entry = stockEntry?.sizes?.find((s) => s.size === size);
  return entry ? availableQty(entry) : 0;
}

function renderSaleLine(line = {}) {
  const {
    size = '',
    quantity = '',
    unitPrice = '',
    freight = defaultLineExtras().freight,
    ads = 0,
    otherCosts = 0,
    couponId = '',
    isPersonalized = false,
    personalizationPerPiece = defaultLineExtras().personalizationPerPiece,
    personalizationCostPerPiece = defaultLineExtras().personalizationCostPerPiece,
  } = line;
  const stockEntry = getSelectedStockEntry();
  const row = document.createElement('div');
  row.className = 'sale-lines__row';
  const price = unitPrice !== '' ? unitPrice : getBasePrice();
  row.innerHTML = `
    <label class="sale-lines__field">
      <span class="sale-lines__field-label">Tamanho</span>
      <select class="form-input form-select line-size">${sizeSelectHtml(size, stockEntry)}</select>
    </label>
    <label class="sale-lines__field">
      <span class="sale-lines__field-label">Quantidade</span>
      <input class="form-input line-qty" type="number" min="1" value="${quantity}" placeholder="Qtd">
    </label>
    <label class="sale-lines__field">
      <span class="sale-lines__field-label">Preço (R$)</span>
      <input class="form-input line-price" type="number" min="0" step="0.01" value="${price}" placeholder="R$">
    </label>
    <label class="sale-lines__field">
      <span class="sale-lines__field-label">Cupom</span>
      <select class="form-input form-select line-coupon" title="Cupom da linha">${couponSelectHtml(couponId)}</select>
    </label>
    <label class="sale-lines__field">
      <span class="sale-lines__field-label">Frete</span>
      <input class="form-input line-freight" type="number" min="0" step="0.01" value="${freight}" title="Frete da linha">
    </label>
    <label class="sale-lines__field">
      <span class="sale-lines__field-label">Ads</span>
      <input class="form-input line-ads" type="number" min="0" step="0.01" value="${ads}" title="ADS / tráfego da linha">
    </label>
    <label class="sale-lines__field">
      <span class="sale-lines__field-label">Outros</span>
      <input class="form-input line-other" type="number" min="0" step="0.01" value="${otherCosts}" title="Outros gastos da linha">
    </label>
    <div class="sale-lines__field sale-lines__field--avail">
      <span class="sale-lines__field-label">Disponível</span>
      <span class="sale-lines__avail text-sm text-muted"></span>
    </div>
    <button type="button" class="btn btn--ghost btn--sm btn-remove-line" title="Remover">&times;</button>
    <div class="sale-lines__pers">
      <label class="sale-lines__pers-check">
        <input type="checkbox" class="line-pers-check" ${isPersonalized ? 'checked' : ''}>
        <span>Personalização</span>
      </label>
      <div class="sale-lines__pers-fields" ${isPersonalized ? '' : 'hidden'}>
        <label class="sale-lines__pers-field">
          <span class="sale-lines__pers-label">Venda</span>
          <input class="form-input line-pers-value" type="number" min="0" step="0.01" value="${personalizationPerPiece}" title="Venda personalizada (R$/peça)">
        </label>
        <label class="sale-lines__pers-field">
          <span class="sale-lines__pers-label">Custo</span>
          <input class="form-input line-pers-cost" type="number" min="0" step="0.01" value="${personalizationCostPerPiece}" title="Custo personalização (R$/peça)">
        </label>
      </div>
    </div>
  `;

  const persValue = row.querySelector('.line-pers-value');
  const persCost = row.querySelector('.line-pers-cost');
  const persFields = row.querySelector('.sale-lines__pers-fields');

  const applyPersDefaults = () => {
    const resolved = resolveLinePersonalization('', persValue?.value, persCost?.value);
    if (persValue && persValue.value === '') {
      persValue.value = resolved.personalizationPerPiece;
    }
    if (persCost && persCost.value === '') {
      persCost.value = resolved.personalizationCostPerPiece;
    }
    updatePreview();
  };

  const updateAvail = () => {
    const s = row.querySelector('.line-size')?.value;
    const avail = s ? getLineAvailable(s) : '—';
    row.querySelector('.sale-lines__avail').textContent = s ? String(avail) : '—';
  };

  row.querySelector('.line-size')?.addEventListener('change', () => {
    updateAvail();
    updatePreview();
    updateLinesTotal();
  });
  row.querySelector('.line-qty')?.addEventListener('input', () => {
    updatePreview();
    updateLinesTotal();
  });
  row.querySelector('.line-price')?.addEventListener('input', updatePreview);
  row.querySelector('.line-coupon')?.addEventListener('change', updatePreview);
  row.querySelector('.line-freight')?.addEventListener('input', updatePreview);
  row.querySelector('.line-ads')?.addEventListener('input', updatePreview);
  row.querySelector('.line-other')?.addEventListener('input', updatePreview);
  row.querySelector('.line-pers-check')?.addEventListener('change', (e) => {
    const show = e.target.checked;
    if (persFields) persFields.hidden = !show;
    if (show) applyPersDefaults();
    else updatePreview();
  });
  row.querySelector('.line-pers-value')?.addEventListener('input', updatePreview);
  row.querySelector('.line-pers-cost')?.addEventListener('input', updatePreview);
  row.querySelector('.btn-remove-line')?.addEventListener('click', () => {
    row.remove();
    if (!qsa('.sale-lines__row', saleLinesEl).length) addSaleLine();
    updatePreview();
    updateLinesTotal();
  });

  updateAvail();
  return row;
}

function addSaleLine(line = {}) {
  saleLinesEl.appendChild(renderSaleLine({
    ...defaultLineExtras(),
    ...line,
  }));
  updateLinesTotal();
  updatePreview();
}

function setSaleLines(lines) {
  qsa('.sale-lines__row', saleLinesEl).forEach((row) => row.remove());
  if (!lines.length) {
    addSaleLine();
    return;
  }
  lines.forEach((l) => addSaleLine({
    ...l,
    unitPrice: l.unitPrice ?? getBasePrice(),
  }));
}

function updateLinesTotal() {
  const lines = collectLinesFromDOM();
  const total = totalSaleLinesQuantity(lines);
  qs('#sale-lines-total').textContent = `${total} peça(s)`;
}

function showFormErrors(errors) {
  if (!errors.length) {
    formErrors.classList.remove('form-errors--visible');
    formErrors.innerHTML = '';
    return;
  }
  formErrors.innerHTML = `<ul>${errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;
  formErrors.classList.add('form-errors--visible');
}

function getActiveStockEntries() {
  return allStockEntries.filter((e) => e.status !== 'inativo' && e.status !== 'esgotado');
}

/** Colagem: inclui lotes esgotados para escolha manual (ex.: Fedex 03 após 100 peças). */
function getPasteStockEntries() {
  return allStockEntries.filter((e) => e.status !== 'inativo');
}

function stockEntryOptionsHtml() {
  return getActiveStockEntries()
    .map((e) => `<option value="${e.id}">${e.name} — ${e.productName}</option>`)
    .join('');
}

function populateProductSelect() {
  const select = qs('#field-product');
  const current = select.value;
  select.innerHTML = `<option value="">Selecione o estoque</option>${stockEntryOptionsHtml()}`;
  select.value = current;
  onStockEntryChange();
}

function getSelectedPasteStockEntry() {
  return allStockEntries.find((e) => e.id === qs('#field-paste-stock')?.value) || null;
}

function pasteStockOptionHtml(entry, selectedId = '') {
  const attrs = pasteStockOptionAttrs(entry);
  const selected = entry.id === selectedId ? ' selected' : '';
  return `<option value="${entry.id}" class="${attrs.class}" data-tone="${attrs['data-tone']}"${selected}>${formatPasteStockOptionLabel(entry)}</option>`;
}

function populatePasteStockSelect() {
  const select = qs('#field-paste-stock');
  if (!select) return;
  const current = select.value;
  const options = getPasteStockEntries().map((e) => pasteStockOptionHtml(e)).join('');
  select.innerHTML = `<option value="">Selecione o estoque (obrigatório)</option>${options}`;
  select.value = current;
  onPasteStockChange();
}

function pasteStockOptionsHtml(selectedId = '') {
  const options = getPasteStockEntries().map((e) => pasteStockOptionHtml(e, selectedId)).join('');
  return `<option value=""${!selectedId ? ' selected' : ''}>— Escolher estoque —</option>${options}`;
}

function requirePasteStockSelected(showMessage = true) {
  if (getSelectedPasteStockEntry()) return true;
  if (showMessage) {
    showToast('Selecione o estoque em lote antes de continuar.', 'warning');
    qs('#field-paste-stock')?.focus();
  }
  return false;
}

function buildPasteAllocationOverrides(orderCount) {
  const bulkStock = getSelectedPasteStockEntry();
  const overrides = { ...pasteStockOverrides };

  if (!bulkStock) return overrides;

  for (let i = 0; i < orderCount; i += 1) {
    if (!overrides[i]) {
      overrides[i] = bulkStock.id;
    }
  }

  return overrides;
}

function applyPasteStockOverrides(batch) {
  const overrides = buildPasteAllocationOverrides(batch.orders.length);
  const orders = allocateOrdersByPriority(
    batch.orders,
    allStockEntries,
    overrides
  );

  return {
    ...batch,
    orders,
    valid: orders.filter((o) => o.valid),
    invalid: orders.filter((o) => !o.valid),
  };
}

function buildPasteStockGroups(orders) {
  const groups = new Map();

  orders.forEach((order) => {
    const key = order.stockEntryId || '__none__';
    if (!groups.has(key)) {
      groups.set(key, {
        stockEntryId: order.stockEntryId || '',
        label: order.stockLabel || 'Sem estoque',
        count: 0,
        valid: 0,
        orderIds: [],
      });
    }
    const group = groups.get(key);
    group.count += 1;
    if (order.valid) group.valid += 1;
    if (order.orderId) group.orderIds.push(order.orderId);
  });

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function renderPasteStockGroups(orders) {
  const groups = buildPasteStockGroups(orders);
  if (!groups.length) return '';

  const items = groups.map((group) => {
    const warn = !group.stockEntryId ? ' sales-paste-preview__group-item--warn' : '';
    const ordersText = group.orderIds.length
      ? ` · pedidos ${group.orderIds.slice(0, 8).join(', ')}${group.orderIds.length > 8 ? '…' : ''}`
      : '';
    return `
      <li class="sales-paste-preview__group-item${warn}">
        <strong>${group.label}</strong>
        <span>${group.count} pedido(s) · ${group.valid} pronto(s)${ordersText}</span>
      </li>
    `;
  }).join('');

  return `
    <div class="sales-paste-preview__groups">
      <p class="sales-paste-preview__groups-title">Organização por estoque (Fedex 03 → 04 → 05 → LZ)</p>
      <ul class="sales-paste-preview__group-list">${items}</ul>
    </div>
  `;
}

function onPasteStockChange() {
  const stockEntry = getSelectedPasteStockEntry();
  const infoEl = qs('#paste-stock-info');
  if (!infoEl) return;

  if (!stockEntry) {
    infoEl.textContent = '';
    return;
  }

  const unitCost = getStockEntryUnitCost(stockEntry);
  const origin = stockEntry.stockOrigin === 'investidor'
    ? `Investidor: ${getInvestorName(stockEntry.investorId)}`
    : 'Próprio';

  infoEl.innerHTML = `
    <strong>${origin}</strong> · Custo ${formatCurrency(unitCost)} · Mín. ${formatCurrency(stockEntry.minimumSalePrice)}
  `;

  if (qs('#sales-paste-input')?.value?.trim()) {
    previewPasteOrders();
  }
}

function onStockEntryChange() {
  const stockEntry = getSelectedStockEntry();
  const infoEl = qs('#product-info');

  if (!stockEntry) {
    infoEl.textContent = '';
    setSaleLines([]);
    updatePreview();
    return;
  }

  const unitCost = getStockEntryUnitCost(stockEntry);
  const origin = stockEntry.stockOrigin === 'investidor'
    ? `Investidor: ${getInvestorName(stockEntry.investorId)}`
    : 'Próprio';

  infoEl.innerHTML = `
    <strong>${origin}</strong> · Custo ${formatCurrency(unitCost)} · Mín. ${formatCurrency(stockEntry.minimumSalePrice)}
  `;

  qs('#field-base-price').value = stockEntry.suggestedSalePrice || DEFAULT_SALE_PRICE;

  qsa('.sale-lines__row', saleLinesEl).forEach((row) => {
    const select = row.querySelector('.line-size');
    const current = select.value;
    select.innerHTML = sizeSelectHtml(current, stockEntry);
    select.value = current;
    const avail = current ? getLineAvailable(current) : '—';
    row.querySelector('.sale-lines__avail').textContent = current ? String(avail) : '—';
  });

  updatePreview();
}

function switchTab(tab) {
  qsa('.sales-tabs__btn').forEach((btn) => {
    btn.classList.toggle('sales-tabs__btn--active', btn.dataset.tab === tab);
  });
  qs('#tab-quick').hidden = tab !== 'quick';
  qs('#tab-paste').hidden = tab !== 'paste';
  qs('#tab-history').hidden = tab !== 'history';
  qs('#tab-costs').hidden = tab !== 'costs';
  qs('#tab-personalization').hidden = tab !== 'personalization';
}

function getPasteParserContext() {
  return {
    stockEntries: allStockEntries,
    stockMatchMode: 'defer',
    coupons: globalSettings.coupons || [],
    defaultFreight: globalSettings.defaultFreight,
    defaultPersonalizationPrice: globalSettings.defaultPersonalizationPrice,
  };
}

function getOrderFallbackUnitPrice(order) {
  if (order.unitPrice > 0) return order.unitPrice;
  const entry = allStockEntries.find((e) => e.id === order.stockEntryId);
  return entry?.suggestedSalePrice || DEFAULT_SALE_PRICE;
}

function buildLinesFromParsedOrder(order, fallbackUnitPrice = getBasePrice()) {
  const linePrice = order.isSample
    ? 0
    : (order.unitPrice > 0 ? order.unitPrice : fallbackUnitPrice);
  const priceAlreadyDiscounted = Number(order.discountedPrice) > 0;
  const defaultPers = Number(globalSettings.defaultPersonalizationPrice) || 50;
  const coupon = priceAlreadyDiscounted
    ? { ...order.coupon, couponPercent: 0 }
    : order.coupon;

  let unitPriceForLine = linePrice;
  let persDefaults;

  if (order.isPersonalized) {
    if (priceAlreadyDiscounted) {
      unitPriceForLine = Math.max(0, linePrice - defaultPers);
      persDefaults = {
        ...resolveLinePersonalization(''),
        personalizationPerPiece: defaultPers,
      };
    } else {
      persDefaults = resolveLinePersonalization('');
    }
  } else {
    persDefaults = {
      personalizationTypeId: '',
      personalizationTypeName: '',
      personalizationPerPiece: 0,
      personalizationCostPerPiece: 0,
    };
  }

  return order.sizes.map((sizeLine) => ({
    size: sizeLine.size,
    quantity: sizeLine.quantity,
    unitPrice: unitPriceForLine,
    couponId: coupon.couponId,
    couponName: coupon.couponName,
    couponPercent: coupon.couponPercent,
    freight: order.isSample ? 0 : (Number(order.freight) || 0),
    ads: 0,
    otherCosts: 0,
    isPersonalized: order.isPersonalized,
    ...persDefaults,
  }));
}

function renderPastePreview(batch) {
  const el = qs('#sales-paste-preview');
  if (!el) return;

  if (!batch.orders.length) {
    el.innerHTML = '<p class="text-muted">Cole os pedidos acima e clique em Pré-visualizar.</p>';
    return;
  }

  const rows = batch.orders.map((order, index) => {
    const sizesText = order.sizes.map((s) => `${s.quantity} ${s.size}`).join(', ') || '—';
    const status = order.valid
      ? '<span class="badge badge--success">OK</span>'
      : `<span class="badge badge--warning">Revisar</span>`;
    const errors = order.errors.length
      ? `<p class="sales-paste-preview__error">${order.errors.join(' ')}</p>`
      : '';

    return `
      <div class="sales-paste-preview__item ${order.valid ? '' : 'sales-paste-preview__item--error'}">
        <div class="sales-paste-preview__head">
          <strong>#${index + 1}</strong> ${status}
          <span class="sales-paste-preview__order">${order.orderId || 'auto'}</span>
        </div>
        ${order.productName ? `<p class="sales-paste-preview__model"><strong>Modelo:</strong> ${order.productName}</p>` : ''}
        <div class="sales-paste-preview__stock">
          <label class="form-group__label" for="paste-stock-${index}">Estoque</label>
          <select class="form-input form-select paste-order-stock" id="paste-stock-${index}" data-order-index="${index}">
            ${pasteStockOptionsHtml(order.stockEntryId)}
          </select>
        </div>
        ${order.saleDate ? `<p><strong>Data pedido:</strong> ${order.saleDate}</p>` : ''}
        <p><strong>Peças:</strong> ${sizesText}</p>
        ${order.allocationHint ? `<p class="text-sm text-muted"><strong>Saldo no lote:</strong> ${order.allocationHint}</p>` : ''}
        ${order.splitFromQuantity > 1 ? `<p class="text-sm text-muted">Gerado da qtd ${order.splitFromQuantity} na planilha (pedido ${order.splitPart}/${order.splitFromQuantity})</p>` : ''}
        ${order.isSample ? '<p><strong>Faturamento:</strong> <span class="badge badge--neutral">Amostra</span> R$ 0,00</p>' : ''}
        ${!order.isSample && order.unitPrice > 0 ? `<p><strong>Faturamento:</strong> ${formatCurrency(order.unitPrice)}${order.listPrice > order.unitPrice ? ` <span class="text-muted">(lista ${formatCurrency(order.listPrice)})</span>` : ''}</p>` : ''}
        <p><strong>Pers.:</strong> ${order.isPersonalized ? 'Sim' : 'Não'}
          · <strong>Cupom:</strong> ${formatCouponUsedLabel(order.coupon)}
          · <strong>Frete:</strong> ${formatCurrency(order.freight)}</p>
        <p class="text-sm text-muted">${sanitizeCouponTextInLine(order.raw)}</p>
        ${errors}
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <p class="sales-paste-preview__summary">
      <strong>${batch.valid.length}</strong> pronto(s) ·
      <strong>${batch.invalid.length}</strong> com aviso ·
      <strong>${batch.total}</strong> linha(s) ·
      <strong>${buildPasteStockGroups(batch.orders).filter((g) => g.stockEntryId).length}</strong> estoque(s)
    </p>
    ${renderPasteStockGroups(batch.orders)}
    <div class="sales-paste-preview__list">${rows}</div>
  `;
}

function previewPasteOrders() {
  const text = qs('#sales-paste-input')?.value || '';
  let batch = parseSalesBatchText(text, getPasteParserContext());

  if (!text.trim()) {
    renderPastePreview({ orders: [], valid: [], invalid: [], total: 0 });
    return batch;
  }

  if (!requirePasteStockSelected(false)) {
    batch = {
      ...batch,
      orders: batch.orders.map((order) => ({
        ...order,
        stockEntryId: '',
        stockLabel: '—',
        valid: false,
        errors: [...(order.errors || []), 'Selecione o estoque em lote acima.'],
      })),
      valid: [],
      invalid: batch.orders,
    };
  } else {
    batch = applyPasteStockOverrides(batch);
  }

  renderPastePreview(batch);
  return batch;
}

function onPasteOrderStockChange(index, stockEntryId) {
  if (stockEntryId) {
    pasteStockOverrides[index] = stockEntryId;
  } else {
    delete pasteStockOverrides[index];
  }
  previewPasteOrders();
}

function applyPasteStockToAll() {
  const stockEntry = getSelectedPasteStockEntry();
  if (!stockEntry) {
    showToast('Selecione um estoque para aplicar a todos.', 'warning');
    return;
  }

  const text = qs('#sales-paste-input')?.value || '';
  const parsed = parseSalesBatchText(text, getPasteParserContext());
  if (!parsed.orders.length) {
    showToast('Cole os pedidos antes de aplicar o estoque.', 'warning');
    return;
  }

  parsed.orders.forEach((_, index) => {
    pasteStockOverrides[index] = stockEntry.id;
  });
  previewPasteOrders();
  showToast(`Estoque "${stockEntry.name}" aplicado a ${parsed.orders.length} pedido(s).`, 'success');
}

function resetPasteStockMatching() {
  pasteStockOverrides = {};
  previewPasteOrders();
  showToast('Realocado na ordem Fedex 03 → 04 → 05 → LZ.', 'success');
}

function applyFirstPasteOrderToForm() {
  const batch = previewPasteOrders();
  const order = batch.valid[0] || batch.orders[0];
  if (!order) {
    showToast('Nenhum pedido para aplicar.', 'warning');
    return;
  }
  if (!order.valid) {
    showToast(order.errors.join(' '), 'error');
    return;
  }

  const stockEntry = allStockEntries.find((e) => e.id === order.stockEntryId);
  if (!stockEntry) {
    showToast('Selecione o estoque deste pedido na pré-visualização.', 'warning');
    return;
  }

  qs('#field-product').value = stockEntry.id;
  onStockEntryChange();
  setSaleLines(buildLinesFromParsedOrder(order, getOrderFallbackUnitPrice(order)));
  switchTab('quick');
  showToast('Primeiro pedido aplicado no formulário. Revise e confirme.', 'success');
}

function orderUsesSpreadsheetPrice(order) {
  return !!order.isSample || Number(order.discountedPrice) > 0 || Number(order.unitPrice) > 0;
}

async function refreshStockEntryInCache(stockEntryId) {
  const result = await getStockEntryById(stockEntryId);
  if (!result.success) return;
  const index = allStockEntries.findIndex((entry) => entry.id === stockEntryId);
  if (index >= 0) {
    allStockEntries[index] = result.data;
  }
}

async function registerParsedOrder(order) {
  if (!order?.stockEntryId) {
    return { success: false, error: 'Selecione o estoque para este pedido.' };
  }

  const entryResult = await getStockEntryById(order.stockEntryId);
  if (!entryResult.success) {
    return { success: false, error: entryResult.error || 'Estoque não encontrado.' };
  }
  const stockEntry = entryResult.data;

  const stockErrors = collectStockAvailabilityErrors(stockEntry, order.sizes || []);
  if (stockErrors.length) {
    return { success: false, error: stockErrors.join(' ') };
  }

  const lines = buildLinesFromParsedOrder(order, getOrderFallbackUnitPrice(order));
  const unitCost = getStockEntryUnitCost(stockEntry);
  const costBreakdown = getStockEntryCostBreakdown(stockEntry);
  const stockLikeProduct = {
    name: stockEntry.productName,
    sizes: stockEntry.sizes,
    minimumSalePrice: stockEntry.minimumSalePrice,
    stockOrigin: stockEntry.stockOrigin,
    investorId: stockEntry.investorId,
  };

  const linesWithStock = lines.map((line) => {
    const size = normalizeOrderSize(line.size);
    const sizeEntry = (stockEntry.sizes || []).find(
      (s) => normalizeOrderSize(s.size) === size
    );
    return {
      ...line,
      size,
      available: sizeEntry ? availableQty(sizeEntry) : 0,
    };
  });

  const financials = calculateQuickSaleFinancials({
    lines,
    unitCost,
    lotImportCostPerUnit: costBreakdown.importPerUnit,
    lotFreightCostPerUnit: costBreakdown.freightPerUnit,
    defaultPersonalizationCostPerPiece: globalSettings.personalizationCostPerPiece,
    defaultPersonalizationPrice: globalSettings.defaultPersonalizationPrice,
    platformCosts: getActivePlatformCosts(),
    isSample: !!order.isSample,
  });

  const allowBelowMinimum = orderUsesSpreadsheetPrice(order);
  const validation = validateQuickSale(
    {
      stockEntryId: order.stockEntryId,
      unitCost,
      lines,
      allowBelowMinimum,
      isSample: !!order.isSample,
      allowZeroPrice: !!order.isSample,
      skipNegativeProfitCheck: allowBelowMinimum || !!order.isSample,
    },
    {
      product: stockLikeProduct,
      lines: linesWithStock,
      financials,
      skipMinimumPriceCheck: allowBelowMinimum,
      allowZeroPrice: !!order.isSample,
      skipNegativeProfitCheck: allowBelowMinimum || !!order.isSample,
    }
  );

  if (!validation.valid) {
    return { success: false, error: validation.errors.join(' ') };
  }

  return createQuickSale({
    stockEntryId: order.stockEntryId,
    productId: stockEntry.productId,
    unitCost,
    lines,
    orderId: order.orderId || undefined,
    allowBelowMinimum,
    isSample: !!order.isSample,
    allowZeroPrice: !!order.isSample,
    skipNegativeProfitCheck: allowBelowMinimum || !!order.isSample,
    platformCosts: getActivePlatformCosts(),
    defaultPersonalizationCostPerPiece: globalSettings.personalizationCostPerPiece,
    defaultPersonalizationPrice: globalSettings.defaultPersonalizationPrice,
  });
}

async function registerFirstPasteOrder() {
  if (!requirePasteStockSelected()) return;

  const batch = previewPasteOrders();
  const order = batch.valid[0];
  if (!order) {
    const first = batch.orders[0];
    showToast(
      first?.errors?.join(' ') || 'Nenhum pedido válido. Pré-visualize e confira o estoque.',
      first ? 'error' : 'warning'
    );
    return;
  }

  const btn = qs('#btn-paste-register-one');
  setLoading(btn, true);
  const result = await registerParsedOrder(order);
  setLoading(btn, false);

  if (result.success) {
    showToast(
      `Pedido ${order.orderId} cadastrado · faturamento ${order.isSample ? 'amostra R$ 0,00' : formatCurrency(order.unitPrice)}`,
      'success'
    );
    await loadData({ freshSales: true });
    previewPasteOrders();
    switchTab('history');
  } else {
    showToast(result.error, 'error');
  }
}

async function registerAllPasteOrders() {
  if (!requirePasteStockSelected()) return;

  const initial = previewPasteOrders();
  if (!initial.valid.length) {
    showToast('Nenhum pedido válido. Ajuste o estoque de cada linha na pré-visualização.', 'warning');
    return;
  }

  const btn = qs('#btn-paste-register-all');
  setLoading(btn, true);

  let ok = 0;
  const failures = [];
  const pendingIndices = initial.orders
    .map((order, index) => ({ order, index }))
    .filter(({ order }) => order.valid)
    .map(({ index }) => index);

  for (const index of pendingIndices) {
    const batch = previewPasteOrders();
    const order = batch.orders[index];

    if (!order.valid) {
      failures.push(`${order.orderId || order.raw}: ${order.errors.join(' ') || 'Sem estoque disponível.'}`);
      continue;
    }

    const result = await registerParsedOrder(order);
    if (result.success) {
      ok += 1;
      await refreshStockEntryInCache(order.stockEntryId);
    } else {
      failures.push(`${order.orderId || order.raw}: ${result.error}`);
    }
  }

  setLoading(btn, false);

  if (ok > 0) {
    showToast(
      `${ok} pedido(s) cadastrado(s)! Veja em Saídas recentes ou Pedidos (#EXT também aparece).`,
      'success'
    );
    if (!failures.length) {
      qs('#sales-paste-input').value = '';
      pasteStockOverrides = {};
      renderPastePreview({ orders: [], valid: [], invalid: [], total: 0 });
    }
    await loadData({ freshSales: true });
    if (!failures.length) {
      switchTab('history');
    }
  }

  if (failures.length) {
    showToast(
      `${failures.length} pedido(s) não cadastrado(s). Confira a lista abaixo.`,
      'error'
    );
    renderPasteBatchFailures(failures);
    previewPasteOrders();
  }
}

function renderPasteBatchFailures(failures) {
  const el = qs('#sales-paste-preview');
  if (!el || !failures.length) return;

  const items = failures.map((line) => `<li>${line}</li>`).join('');
  const block = `
    <div class="sales-paste-preview__failures">
      <p class="sales-paste-preview__failures-title">Pedidos não cadastrados (${failures.length})</p>
      <ul class="sales-paste-preview__failures-list">${items}</ul>
    </div>
  `;

  if (el.querySelector('.sales-paste-preview__failures')) {
    el.querySelector('.sales-paste-preview__failures').outerHTML = block;
  } else {
    el.insertAdjacentHTML('afterbegin', block);
  }
}

function loadPasteTestExample() {
  const example = '#1163\t28/05/2026\tVermelha\tGG\t1\tCom personalização\tSim (NAZARIO7)\tR$ 279,90\tR$ 260,31';
  const input = qs('#sales-paste-input');
  if (!input) return;
  input.value = example;
  switchTab('paste');
  previewPasteOrders();
  showToast('Exemplo #1163 carregado. Confira a pré-visualização e cadastre.', 'success');
}

function startPasteVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Ditado não disponível neste navegador. Use Chrome ou Edge.', 'warning');
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  const textarea = qs('#sales-paste-input');
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    if (!textarea) return;
    textarea.value = textarea.value
      ? `${textarea.value.trim()}\n${transcript}`
      : transcript;
    previewPasteOrders();
  };
  recognition.onerror = () => {
    showToast('Não foi possível captar o áudio.', 'error');
  };

  recognition.start();
  showToast('Ouvindo… fale o pedido.', 'info');
}

function updateCostLabels() {
  const pieces = piecesSoldInCurrentMonth(allSales, totalSaleLinesQuantity(collectLinesFromDOM()));
  const poolPerPiece = calculatePoolCostPerPiece({
    adsPool: globalSettings.adsPool,
    otherPoolCosts: globalSettings.otherPoolCosts,
    piecesInPeriod: pieces,
  });

  const poolEl = qs('#pool-label');
  if (poolEl) poolEl.textContent = formatCurrency(poolPerPiece);
}

function renderPoolPreview() {
  const el = qs('#pool-preview');
  if (!el) return;

  const pieces = piecesSoldInCurrentMonth(allSales);
  const poolTotal = (Number(globalSettings.adsPool) || 0) + (Number(globalSettings.otherPoolCosts) || 0);
  const perPiece = calculatePoolCostPerPiece({
    adsPool: globalSettings.adsPool,
    otherPoolCosts: globalSettings.otherPoolCosts,
    piecesInPeriod: Math.max(pieces, 1),
  });

  el.innerHTML = `
    <p><strong>Piscina total:</strong> ${formatCurrency(poolTotal)}</p>
    <p><strong>Peças vendidas no mês:</strong> ${pieces}</p>
    <p><strong>Diluição atual:</strong> ${formatCurrency(perPiece)} / peça</p>
    <p class="text-sm text-muted">Use esse valor na coluna Ads de cada linha da saída rápida (× quantidade, se quiser).</p>
  `;
}

function renderCouponsList() {
  const list = qs('#coupons-list');
  if (!list) return;

  if (!couponsDraft.length) {
    list.innerHTML = '<p class="text-muted text-sm">Nenhum cupom cadastrado.</p>';
    return;
  }

  list.innerHTML = couponsDraft.map((c) => `
    <div class="coupons-list__item" data-id="${c.id}">
      <span><strong>${c.name}</strong> −${c.percent}%</span>
      <button type="button" class="btn btn--ghost btn--sm btn-remove-coupon" data-id="${c.id}">&times;</button>
    </div>
  `).join('');
}

function renderPersTypesList() {
  const list = qs('#pers-types-list');
  if (!list) return;

  if (!persTypesDraft.length) {
    list.innerHTML = '<p class="text-muted text-sm">Nenhum tipo cadastrado. Use o padrão nas linhas.</p>';
    return;
  }

  list.innerHTML = persTypesDraft.map((t) => `
    <div class="coupons-list__item" data-id="${t.id}">
      <span>
        <strong>${t.name}</strong>
        · Venda ${formatCurrency(t.price)}
        · Custo ${formatCurrency(t.cost)}
        · Lucro ${formatCurrency(Math.max(0, t.price - t.cost))}
      </span>
      <button type="button" class="btn btn--ghost btn--sm btn-remove-pers-type" data-id="${t.id}">&times;</button>
    </div>
  `).join('');
}

function renderPersPreview() {
  const el = qs('#pers-preview');
  if (!el) return;

  const price = Number(qs('#set-pers-price')?.value ?? globalSettings.defaultPersonalizationPrice) || 0;
  const cost = Number(qs('#set-pers-cost')?.value ?? globalSettings.personalizationCostPerPiece) || 0;
  const profit = Math.max(0, price - cost);

  el.innerHTML = `
    <p><strong>Preço ao cliente:</strong> ${formatCurrency(price)} / peça</p>
    <p><strong>Custo interno:</strong> ${formatCurrency(cost)} / peça</p>
    <p><strong>Lucro por peça personalizada:</strong> ${formatCurrency(profit)}</p>
    <p class="text-sm text-muted">Esse lucro não entra no repasse do investidor.</p>
  `;
}

function fillSettingsForm() {
  qs('#set-freight').value = globalSettings.defaultFreight;
  qs('#set-ads').value = globalSettings.adsPool;
  qs('#set-other').value = globalSettings.otherPoolCosts;
  qs('#set-pers-price').value = globalSettings.defaultPersonalizationPrice;
  qs('#set-pers-cost').value = globalSettings.personalizationCostPerPiece;
  fillPlatformCostsForm();
  couponsDraft = globalSettings.coupons.map((c) => ({ ...c }));
  persTypesDraft = (globalSettings.personalizationTypes || []).map((t) => ({ ...t }));
  renderCouponsList();
  renderPersTypesList();
  renderPoolPreview();
  renderPersPreview();
  renderPlatformFeesPreview();
  refreshLineCouponSelects();
  updateCostLabels();
}

async function loadSettings() {
  const result = await getGlobalSettings();
  if (result.success) {
    globalSettings = result.data;
    fillSettingsForm();
  }
}

function stockEntryAsProduct(entry) {
  if (!entry) return null;
  return {
    name: entry.productName,
    sizes: entry.sizes,
    costPrice: entry.costPrice,
    importTaxes: entry.importTaxes,
    suggestedSalePrice: entry.suggestedSalePrice,
    minimumSalePrice: entry.minimumSalePrice,
    stockOrigin: entry.stockOrigin,
    investorId: entry.investorId,
  };
}

function getFormData() {
  const stockEntry = getSelectedStockEntry();
  const unitCost = stockEntry
    ? getStockEntryUnitCost(stockEntry)
    : 0;
  const lines = collectLinesFromDOM();

  return {
    stockEntryId: qs('#field-product').value,
    productId: stockEntry?.productId || qs('#field-product').value,
    unitCost,
    lines,
  };
}

function getPreviewData() {
  const data = getFormData();
  const stockEntry = getSelectedStockEntry();
  const product = stockEntryAsProduct(stockEntry);
  if (!stockEntry || !data.lines.length) return null;

  const linesWithStock = data.lines.map((l) => ({
    ...l,
    available: getLineAvailable(l.size),
  }));

  const financials = calculateQuickSaleFinancials({
    lines: data.lines,
    unitCost: data.unitCost,
    lotImportCostPerUnit: getStockEntryCostBreakdown(stockEntry).importPerUnit,
    lotFreightCostPerUnit: getStockEntryCostBreakdown(stockEntry).freightPerUnit,
    defaultPersonalizationCostPerPiece: globalSettings.personalizationCostPerPiece,
    defaultPersonalizationPrice: globalSettings.defaultPersonalizationPrice,
    platformCosts: getActivePlatformCosts(),
  });

  let investorPayout = 0;
  if (stockEntry.stockOrigin === 'investidor' && stockEntry.investorId) {
    const investor = allInvestors.find((i) => i.id === stockEntry.investorId);
    if (investor) {
      investorPayout = calculateInvestorRepasseForSale(investor, {
        unitCost: data.unitCost,
        capitalUnitCost: getStockEntryInvestorCapitalUnit(stockEntry),
        quantity: financials.totalQty,
        financials,
        stockEntry,
      });
    }
  }

  return { financials, investorPayout, product, lines: linesWithStock };
}

function updatePreview() {
  const preview = qs('#finance-preview');
  const data = getPreviewData();

  if (!data) {
    preview.innerHTML = '<span class="text-muted">Adicione tamanhos para ver o total.</span>';
    return;
  }

  const { financials, investorPayout } = data;
  const profitClass = financials.netProfit >= 0
    ? 'sales-finance-preview__value--profit'
    : 'sales-finance-preview__value--loss';

  const parts = [
    `<strong>${financials.totalQty} peça(s)</strong>`,
    `Subtotal ${formatCurrency(financials.itemsSubtotal)}`,
  ];

  if (financials.personalizationTotal > 0) {
    parts.push(`+ Personalização ${formatCurrency(financials.personalizationTotal)}`);
  }
  if (financials.personalizationCostTotal > 0) {
    parts.push(`− Custo pers. ${formatCurrency(financials.personalizationCostTotal)}`);
  }
  if (financials.discount > 0) {
    const couponLabel = financials.couponPercent > 0
      ? `− Cupom ${formatPercent(financials.couponPercent)} (${formatCurrency(financials.discount)})`
      : `− Cupons (${formatCurrency(financials.discount)})`;
    parts.push(couponLabel);
  }
  if (financials.freightCost > 0) {
    parts.push(`− Frete ${formatCurrency(financials.freightCost)}`);
  }
  if (financials.adsCostTotal > 0) {
    parts.push(`− Ads ${formatCurrency(financials.adsCostTotal)}`);
  }
  if (financials.extraFees > 0) {
    parts.push(`− Outros ${formatCurrency(financials.extraFees)}`);
  }
  if (financials.platformCost > 0) {
    const breakdown = calculatePlatformFeesBreakdown(getActivePlatformCosts(), financials.totalRevenue);
    const detail = breakdown.map((row) => row.name).join(' + ');
    parts.push(`− Taxas site (${detail}) ${formatCurrency(financials.platformCost)}`);
  }

  parts.push(
    `<span class="sales-finance-preview__total">Total <strong>${formatCurrency(financials.totalRevenue)}</strong></span>`,
    `<span class="${profitClass}">Lucro ${formatCurrency(financials.netProfit)}</span>`
  );

  if (investorPayout > 0) {
    parts.push(`Repasse ${formatCurrency(investorPayout)}`);
    if (financials.personalizationTotal > 0) {
      parts.push('Personalização não entra no repasse');
    }
  }

  preview.innerHTML = parts.map((p) => `<span class="sales-finance-preview__chip">${p}</span>`).join('');
}

function applyQuickSizes() {
  const text = qs('#sizes-quick-input').value;
  const parsed = parseSizesQuickInput(text);
  const basePrice = getBasePrice();

  if (!parsed.length) {
    showToast('Use: 5 G, 10 M', 'warning');
    return;
  }

  const existing = collectLinesFromDOM();
  const merged = [...existing];

  parsed.forEach((p) => {
    const idx = merged.findIndex((m) => m.size === p.size);
    if (idx >= 0) {
      merged[idx].quantity = Number(merged[idx].quantity) + p.quantity;
    } else {
      merged.push({
        size: p.size,
        quantity: p.quantity,
        unitPrice: basePrice,
        ...defaultLineExtras(),
      });
    }
  });

  setSaleLines(merged);
  qs('#sizes-quick-input').value = '';
  showToast(`${parsed.length} tamanho(s) adicionado(s)!`, 'success');
}

function renderSummary() {
  const completed = allSales.filter((s) => s.status !== 'cancelada');
  const revenue = completed.reduce((sum, s) => sum + (Number(s.totalRevenue) || 0), 0);
  const profit = completed.reduce((sum, s) => sum + (Number(s.netProfit) || 0), 0);
  const pieces = completed.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);

  qs('#summary-revenue').textContent = formatCurrency(revenue);
  qs('#summary-profit').textContent = formatCurrency(profit);
  qs('#summary-pieces').textContent = String(pieces);
}

function filterSales() {
  const search = qs('#search-input').value.trim().toLowerCase();
  if (!search) return allSales;
  return allSales.filter((s) =>
    (s.productName || '').toLowerCase().includes(search)
    || String(s.orderId || '').toLowerCase().includes(search)
    || formatSaleLinesSummary(s).toLowerCase().includes(search)
  );
}

function saleUsedCoupon(sale) {
  if (sale.couponName || sale.couponId || Number(sale.couponPercent) > 0) return true;
  return (sale.lines || []).some(
    (line) => line.couponName || line.couponId || Number(line.couponPercent) > 0
  );
}

function renderSalesTable() {
  const filtered = filterSales();
  qs('#sales-count').textContent = `${filtered.length} saída(s) recente(s)`;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table__empty">Nenhuma saída registrada.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((s) => `
    <tr>
      <td class="text-sm">${formatDate(s.createdAt)}</td>
      <td>
        ${s.orderId ? `<div class="text-sm text-muted">${s.orderId}</div>` : ''}
        <strong>${s.productName}</strong>
        <div class="text-sm text-muted">${formatSaleLinesSummary(s)}</div>
        ${s.isSample ? '<span class="badge badge--neutral">Amostra</span>' : ''}
        ${(Number(s.platformCost) || 0) > 0 ? '<span class="badge badge--info">Site</span>' : ''}
        ${(s.isPersonalized || s.lines?.some((l) => l.isPersonalized)) ? '<span class="badge badge--info">Personalizado</span>' : ''}
        ${saleUsedCoupon(s) ? '<span class="badge badge--neutral">Cupom</span>' : ''}
      </td>
      <td>${s.quantity}</td>
      <td>${formatCurrency(s.totalRevenue)}</td>
      <td class="${s.netProfit >= 0 ? '' : 'text-muted'}">${formatCurrency(s.netProfit)}</td>
    </tr>
  `).join('');
}

async function loadData(options = {}) {
  const [stockResult, invResult, salesResult] = await Promise.all([
    listStockEntries(),
    listInvestors(),
    listSales({}, options.freshSales ? { fresh: true } : {}),
  ]);

  allStockEntries = stockResult.success ? stockResult.data : [];
  allInvestors = invResult.success ? invResult.data : [];
  allSales = salesResult.success
    ? applyPlatformSettingsToSales(salesResult.data, globalSettings, allInvestors)
    : [];

  if (!salesResult.success) {
    showToast(salesResult.error, 'error');
  }

  populateProductSelect();
  populatePasteStockSelect();
  renderSummary();
  renderSalesTable();
  renderPoolPreview();
  updateCostLabels();
}


function handleAddPersType() {
  const name = qs('#new-pers-name').value.trim();
  const price = Number(qs('#new-pers-price').value);
  const cost = Number(qs('#new-pers-cost').value);

  if (!name) {
    showToast('Informe o nome do tipo.', 'warning');
    return;
  }
  if (isNaN(price) || price < 0) {
    showToast('Preço inválido.', 'warning');
    return;
  }
  if (isNaN(cost) || cost < 0) {
    showToast('Custo inválido.', 'warning');
    return;
  }

  persTypesDraft.push({
    id: `p${Date.now()}`,
    name,
    price,
    cost,
  });

  qs('#new-pers-name').value = '';
  qs('#new-pers-price').value = '';
  qs('#new-pers-cost').value = '';
  renderPersTypesList();
}

async function handleSavePersTypes() {
  const btn = qs('#btn-save-pers-types');
  setLoading(btn, true);

  const result = await saveGlobalSettings({
    ...globalSettings,
    personalizationTypes: persTypesDraft,
  });

  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  globalSettings = result.data;
  persTypesDraft = (globalSettings.personalizationTypes || []).map((t) => ({ ...t }));
  renderPersTypesList();
  showToast('Tipos de personalização salvos!', 'success');
}

async function handlePersonalizationForm(e) {
  e.preventDefault();
  const btn = qs('#personalization-form button[type="submit"]');
  setLoading(btn, true);

  const result = await saveGlobalSettings({
    ...globalSettings,
    defaultPersonalizationPrice: qs('#set-pers-price').value,
    personalizationCostPerPiece: qs('#set-pers-cost').value,
  });

  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  globalSettings = result.data;
  fillSettingsForm();
  showToast('Custos de personalização salvos!', 'success');
}

async function handleSavePlatformCosts() {
  const btn = qs('#btn-save-platform-costs');
  setLoading(btn, true);

  const platformCosts = collectPlatformCostsFromForm();
  const result = await saveGlobalSettings({
    ...globalSettings,
    platformCosts,
  });

  if (!result.success) {
    setLoading(btn, false);
    showToast(result.error, 'error');
    return;
  }

  globalSettings = result.data;
  fillPlatformCostsForm();
  renderPlatformFeesPreview();
  updatePreview();

  const recalc = await recalculateAllSalesPlatformFees(globalSettings);
  setLoading(btn, false);

  if (!recalc.success) {
    showToast(`Taxas salvas, mas falha ao recalcular pedidos: ${recalc.error}`, 'warning');
    return;
  }

  await loadData();
  showToast(
    recalc.data?.updated
      ? `Taxas salvas! ${recalc.data.updated} pedido(s) recalculado(s).`
      : 'Taxas salvas!',
    'success'
  );
}

async function handleCostsForm(e) {
  e.preventDefault();
  const btn = qs('#costs-form button[type="submit"]');
  setLoading(btn, true);

  const result = await saveGlobalSettings({
    ...globalSettings,
    defaultFreight: qs('#set-freight').value,
    adsPool: qs('#set-ads').value,
    otherPoolCosts: qs('#set-other').value,
    platformCosts: collectPlatformCostsFromForm(),
    coupons: couponsDraft,
  });

  if (!result.success) {
    setLoading(btn, false);
    showToast(result.error, 'error');
    return;
  }

  globalSettings = result.data;
  fillSettingsForm();

  const recalc = await recalculateAllSalesPlatformFees(globalSettings);
  setLoading(btn, false);

  if (!recalc.success) {
    showToast(`Custos salvos, mas falha ao recalcular pedidos: ${recalc.error}`, 'warning');
    return;
  }

  await loadData();
  showToast(
    recalc.data?.updated
      ? `Custos salvos! ${recalc.data.updated} pedido(s) recalculado(s).`
      : 'Custos salvos!',
    'success'
  );
}

async function handleSaveCoupons() {
  const btn = qs('#btn-save-coupons');
  setLoading(btn, true);

  const result = await saveGlobalSettings({
    ...globalSettings,
    coupons: couponsDraft,
  });

  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  globalSettings = result.data;
  couponsDraft = globalSettings.coupons.map((c) => ({ ...c }));
  refreshLineCouponSelects();
  renderCouponsList();
  showToast('Cupons salvos!', 'success');
}

function handleAddCoupon() {
  const name = qs('#new-coupon-name').value.trim().toUpperCase();
  const percent = Number(qs('#new-coupon-percent').value);

  if (!name) {
    showToast('Informe o nome do cupom.', 'warning');
    return;
  }
  if (!percent || percent <= 0 || percent > 100) {
    showToast('Percentual deve ser entre 1 e 100.', 'warning');
    return;
  }

  couponsDraft.push({
    id: `c${Date.now()}`,
    name,
    percent,
  });

  qs('#new-coupon-name').value = '';
  qs('#new-coupon-percent').value = '';
  renderCouponsList();
}

function resetForm() {
  saleForm.reset();
  formErrors.classList.remove('form-errors--visible');
  setSaleLines([]);
  onStockEntryChange();
}

async function handleSubmit(e) {
  e.preventDefault();
  const data = getFormData();
  const preview = getPreviewData();

  const validation = validateQuickSale(data, {
    product: preview?.product,
    lines: preview?.lines,
    financials: preview?.financials,
  });

  showFormErrors(validation.errors);
  if (!validation.valid) return;

  const btn = qs('#btn-save-sale');
  setLoading(btn, true);
  const result = await createQuickSale({
    ...data,
    platformCosts: getActivePlatformCosts(),
    defaultPersonalizationCostPerPiece: globalSettings.personalizationCostPerPiece,
    defaultPersonalizationPrice: globalSettings.defaultPersonalizationPrice,
  });
  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  showToast(`Saída registrada! ${result.data.quantity} peça(s) baixadas.`, 'success');
  resetForm();
  await loadData();
}

function initEvents() {
  saleForm?.addEventListener('submit', handleSubmit);
  qs('#field-product')?.addEventListener('change', onStockEntryChange);
  ['#set-platform-shopify-percent', '#set-platform-shopify-fixed',
    '#set-platform-yampi-percent', '#set-platform-yampi-fixed',
    '#set-platform-appmax-percent', '#set-platform-appmax-fixed'].forEach((sel) => {
    qs(sel)?.addEventListener('input', () => {
      renderPlatformFeesPreview();
      updatePreview();
    });
  });
  qs('#btn-parse-sizes')?.addEventListener('click', applyQuickSizes);
  qs('#sizes-quick-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyQuickSizes();
    }
  });
  qs('#btn-add-line')?.addEventListener('click', () => addSaleLine());
  qs('#search-input')?.addEventListener('input', renderSalesTable);

  qsa('.sales-tabs__btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  qs('#field-paste-stock')?.addEventListener('change', onPasteStockChange);

  qs('#btn-paste-apply-stock-all')?.addEventListener('click', applyPasteStockToAll);
  qs('#btn-paste-auto-match')?.addEventListener('click', resetPasteStockMatching);

  qs('#sales-paste-preview')?.addEventListener('change', (event) => {
    const select = event.target.closest('.paste-order-stock');
    if (!select) return;
    onPasteOrderStockChange(Number(select.dataset.orderIndex), select.value);
  });

  qs('#btn-paste-preview')?.addEventListener('click', () => {
    const text = qs('#sales-paste-input')?.value?.trim();
    if (text && !getSelectedPasteStockEntry()) {
      showToast('Selecione o estoque em lote antes de pré-visualizar.', 'warning');
    }
    previewPasteOrders();
  });
  qs('#btn-paste-apply-one')?.addEventListener('click', applyFirstPasteOrderToForm);
  qs('#btn-paste-register-one')?.addEventListener('click', registerFirstPasteOrder);
  qs('#btn-paste-register-all')?.addEventListener('click', registerAllPasteOrders);
  qs('#btn-paste-load-example')?.addEventListener('click', loadPasteTestExample);
  qs('#btn-paste-voice')?.addEventListener('click', startPasteVoiceInput);
  qs('#sales-paste-input')?.addEventListener('input', () => {
    if (qs('#sales-paste-preview')?.dataset.live === '1') previewPasteOrders();
  });

  qs('#costs-form')?.addEventListener('submit', handleCostsForm);
  qs('#btn-save-platform-costs')?.addEventListener('click', handleSavePlatformCosts);
  qs('#personalization-form')?.addEventListener('submit', handlePersonalizationForm);
  qs('#btn-add-pers-type')?.addEventListener('click', handleAddPersType);
  qs('#btn-save-pers-types')?.addEventListener('click', handleSavePersTypes);
  qs('#pers-types-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-pers-type');
    if (!btn) return;
    persTypesDraft = persTypesDraft.filter((t) => t.id !== btn.dataset.id);
    renderPersTypesList();
  });
  ['#set-pers-price', '#set-pers-cost'].forEach((sel) => {
    qs(sel)?.addEventListener('input', renderPersPreview);
  });
  qs('#btn-add-coupon')?.addEventListener('click', handleAddCoupon);
  qs('#btn-save-coupons')?.addEventListener('click', handleSaveCoupons);
  qs('#coupons-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-coupon');
    if (!btn) return;
    couponsDraft = couponsDraft.filter((c) => c.id !== btn.dataset.id);
    renderCouponsList();
  });

  ['#set-ads', '#set-other'].forEach((sel) => {
    qs(sel)?.addEventListener('input', () => {
      globalSettings.adsPool = Number(qs('#set-ads').value) || 0;
      globalSettings.otherPoolCosts = Number(qs('#set-other').value) || 0;
      renderPoolPreview();
    });
  });
}

async function init() {
  initEvents();
  await waitForAuth();
  await loadSettings();
  await loadData();
}

init();
