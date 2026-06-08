import { listProducts } from '../services/productService.js';
import { listInvestors } from '../services/investorService.js';
import { listSales, createQuickSale } from '../services/salesService.js';
import {
  getGlobalSettings,
  saveGlobalSettings,
  DEFAULT_SETTINGS,
} from '../services/settingsService.js';
import { waitForAuth } from '../services/authService.js';
import {
  availableQty,
  unitCostWithImportTax,
  calculateQuickSaleFinancials,
  calculateInvestorRepasseForSale,
  calculatePoolCostPerPiece,
  piecesSoldInCurrentMonth,
  formatSaleLinesSummary,
  totalSaleLinesQuantity,
  DEFAULT_SALE_PRICE,
} from '../utils/calculations.js';
import { validateQuickSale, parseSizesQuickInput } from '../utils/validators.js';
import { formatCurrency, formatPercent } from '../utils/formatCurrency.js';
import {
  qs,
  qsa,
  showToast,
  setLoading,
} from '../utils/domHelpers.js';

const SIZE_OPTIONS = ['P', 'M', 'G', 'GG', 'XG'];

let allProducts = [];
let allInvestors = [];
let allSales = [];
let globalSettings = { ...DEFAULT_SETTINGS };
let couponsDraft = [];
let persTypesDraft = [];

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

function getSelectedProduct() {
  return allProducts.find((p) => p.id === qs('#field-product').value) || null;
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
  const product = getSelectedProduct();
  const entry = product?.sizes?.find((s) => s.size === size);
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
  const product = getSelectedProduct();
  const row = document.createElement('div');
  row.className = 'sale-lines__row';
  const price = unitPrice !== '' ? unitPrice : getBasePrice();
  row.innerHTML = `
    <select class="form-input form-select line-size">${sizeSelectHtml(size, product)}</select>
    <input class="form-input line-qty" type="number" min="1" value="${quantity}" placeholder="Qtd">
    <input class="form-input line-price" type="number" min="0" step="0.01" value="${price}" placeholder="R$">
    <select class="form-input form-select line-coupon" title="Cupom da linha">${couponSelectHtml(couponId)}</select>
    <input class="form-input line-freight" type="number" min="0" step="0.01" value="${freight}" title="Frete da linha">
    <input class="form-input line-ads" type="number" min="0" step="0.01" value="${ads}" title="ADS / tráfego da linha">
    <input class="form-input line-other" type="number" min="0" step="0.01" value="${otherCosts}" title="Outros gastos da linha">
    <span class="sale-lines__avail text-sm text-muted"></span>
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

function populateProductSelect() {
  const select = qs('#field-product');
  const current = select.value;
  select.innerHTML = `<option value="">Selecione o estoque</option>${allProducts
    .filter((p) => p.status !== 'inativo')
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('')}`;
  select.value = current;
  onProductChange();
}

function onProductChange() {
  const product = getSelectedProduct();
  const infoEl = qs('#product-info');

  if (!product) {
    infoEl.textContent = '';
    setSaleLines([]);
    updatePreview();
    return;
  }

  const unitCost = unitCostWithImportTax(
    product.costPrice,
    product.importTaxes,
    product.sizes
  );
  const origin = product.stockOrigin === 'investidor'
    ? `Investidor: ${getInvestorName(product.investorId)}`
    : 'Próprio';

  infoEl.innerHTML = `
    <strong>${origin}</strong> · Custo ${formatCurrency(unitCost)} · Mín. ${formatCurrency(product.minimumSalePrice)}
  `;

  qs('#field-base-price').value = DEFAULT_SALE_PRICE;

  qsa('.sale-lines__row', saleLinesEl).forEach((row) => {
    const select = row.querySelector('.line-size');
    const current = select.value;
    select.innerHTML = sizeSelectHtml(current, product);
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
  qs('#tab-history').hidden = tab !== 'history';
  qs('#tab-costs').hidden = tab !== 'costs';
  qs('#tab-personalization').hidden = tab !== 'personalization';
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
  couponsDraft = globalSettings.coupons.map((c) => ({ ...c }));
  persTypesDraft = (globalSettings.personalizationTypes || []).map((t) => ({ ...t }));
  renderCouponsList();
  renderPersTypesList();
  renderPoolPreview();
  renderPersPreview();
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

function getFormData() {
  const product = getSelectedProduct();
  const unitCost = product
    ? unitCostWithImportTax(product.costPrice, product.importTaxes, product.sizes)
    : 0;
  const lines = collectLinesFromDOM();

  return {
    productId: qs('#field-product').value,
    unitCost,
    lines,
  };
}

function getPreviewData() {
  const data = getFormData();
  const product = getSelectedProduct();
  if (!product || !data.lines.length) return null;

  const linesWithStock = data.lines.map((l) => ({
    ...l,
    available: getLineAvailable(l.size),
  }));

  const financials = calculateQuickSaleFinancials({
    lines: data.lines,
    unitCost: data.unitCost,
    defaultPersonalizationCostPerPiece: globalSettings.personalizationCostPerPiece,
  });

  let investorPayout = 0;
  if (product.stockOrigin === 'investidor' && product.investorId) {
    const investor = allInvestors.find((i) => i.id === product.investorId);
    if (investor) {
      investorPayout = calculateInvestorRepasseForSale(investor, {
        unitCost: data.unitCost,
        quantity: financials.totalQty,
        financials,
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
    || formatSaleLinesSummary(s).toLowerCase().includes(search)
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
        <strong>${s.productName}</strong>
        <div class="text-sm text-muted">${formatSaleLinesSummary(s)}</div>
        ${(s.isPersonalized || s.lines?.some((l) => l.isPersonalized)) ? '<span class="badge badge--info">Personalizado</span>' : ''}
        ${[...new Set((s.lines || []).filter((l) => l.couponName).map((l) => l.couponName))]
          .map((name) => `<span class="badge badge--neutral">${name}</span>`).join('')}
        ${!s.lines?.length && s.couponName ? `<span class="badge badge--neutral">${s.couponName}</span>` : ''}
      </td>
      <td>${s.quantity}</td>
      <td>${formatCurrency(s.totalRevenue)}</td>
      <td class="${s.netProfit >= 0 ? '' : 'text-muted'}">${formatCurrency(s.netProfit)}</td>
    </tr>
  `).join('');
}

async function loadData() {
  const [prodResult, invResult, salesResult] = await Promise.all([
    listProducts(),
    listInvestors(),
    listSales(),
  ]);

  allProducts = prodResult.success ? prodResult.data : [];
  allInvestors = invResult.success ? invResult.data : [];
  allSales = salesResult.success ? salesResult.data : [];

  if (!salesResult.success) {
    showToast(salesResult.error, 'error');
  }

  populateProductSelect();
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

async function handleCostsForm(e) {
  e.preventDefault();
  const btn = qs('#costs-form button[type="submit"]');
  setLoading(btn, true);

  const result = await saveGlobalSettings({
    ...globalSettings,
    defaultFreight: qs('#set-freight').value,
    adsPool: qs('#set-ads').value,
    otherPoolCosts: qs('#set-other').value,
    coupons: couponsDraft,
  });

  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  globalSettings = result.data;
  fillSettingsForm();
  showToast('Custos salvos!', 'success');
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
  onProductChange();
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
    defaultPersonalizationCostPerPiece: globalSettings.personalizationCostPerPiece,
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
  qs('#field-product')?.addEventListener('change', onProductChange);
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

  qs('#costs-form')?.addEventListener('submit', handleCostsForm);
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
