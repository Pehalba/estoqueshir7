import {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../services/productService.js';
import { CATALOG_PRODUCTS } from '../../data/catalog-products.js';
import { waitForAuth } from '../services/authService.js';
import { listInvestors } from '../services/investorService.js';
import {
  listStockEntries,
  getStockEntryById,
  deleteStockEntry,
} from '../services/stockEntryService.js';
import {
  registerMovement,
  registerStockEntry,
  updateStockEntryDetails,
  getMovementHistory,
  getLowStockThreshold,
  getLowStockItems,
  getStockSummary,
  migrateLegacyProductStock,
} from '../services/stockService.js';
import {
  availableQty,
  diluteLotCostPerUnit,
  getStockEntryUnitCost,
  totalQuantity,
  computeStockEntryFinancials,
  buildStockEntryQuantityStats,
  DEFAULT_SALE_PRICE,
} from '../utils/calculations.js';
import { validateProduct, validateStockEntry, parseSizesQuickInput } from '../utils/validators.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { SIZE_ORDER, sortSizes } from '../utils/sizes.js';
import {
  qs,
  qsa,
  showToast,
  openModal,
  closeModal,
  setupModalClose,
  setLoading,
} from '../utils/domHelpers.js';

let allProducts = [];
let allStockEntries = [];
let allInvestors = [];
let allMovements = [];
let lowStockThreshold = 5;
let movementsLoaded = false;
let editingId = null;
let viewingId = null;
let viewingStockEntryId = null;
let editingStockEntryId = null;
let editingStockProductId = '';
let editingEntryQuantity = null;
let editingSizeReservedMap = {};
let deletingId = null;
let deletingTarget = null;
let openedProductFromStock = false;
let pendingStockProductId = '';
let pendingStockName = '';

const stockEntriesTbody = qs('#stock-entries-tbody');
const stockSearchInput = qs('#stock-search-input');
const stockEntriesCount = qs('#stock-entries-count');
const catalogTbody = qs('#catalog-tbody');
const catalogSearchInput = qs('#catalog-search-input');
const catalogCount = qs('#catalog-count');
const productForm = qs('#product-form');
const formErrors = qs('#form-errors');
const stockInvestorGroup = qs('#stock-investor-group');
const stockOriginField = qs('#stock-stockOrigin');
const stockSizesRows = qs('#stock-sizes-rows');
const stockSizesTotal = qs('#stock-sizes-total');
const stockForm = qs('#stock-form');
const stockFormErrors = qs('#stock-form-errors');

function sizeSelectHtml(selected = '') {
  const options = SIZE_ORDER.map(
    (s) => `<option value="${s}" ${s === selected ? 'selected' : ''}>${s}</option>`
  ).join('');
  return `<option value="">Tam.</option>${options}`;
}

function renderStockSizeRow(size = '', quantity = '') {
  const isEdit = !!editingStockEntryId;
  const reserved = Number(editingSizeReservedMap[size]) || 0;
  const minQty = isEdit ? 0 : 1;
  const hint = isEdit && reserved > 0
    ? `<span class="stock-size-reserved-hint">mín. ${reserved} (reservado)</span>`
    : '';

  const row = document.createElement('div');
  row.className = 'sizes-editor__row';
  row.innerHTML = `
    <select class="form-input form-select stock-size-field">${sizeSelectHtml(size)}</select>
    <div class="stock-qty-wrap">
      <input class="form-input form-input--qty stock-qty-field" type="number" min="${minQty}" value="${quantity}" placeholder="Qtd">
      ${hint}
    </div>
    <button type="button" class="btn btn--ghost btn--sm btn-remove-stock-size" title="Remover">&times;</button>
  `;
  row.querySelector('.stock-size-field')?.addEventListener('change', () => {
    updateStockSizeRowReservedHint(row);
    updateStockSizesTotal();
  });
  row.querySelector('.stock-qty-field')?.addEventListener('input', updateStockSizesTotal);
  row.querySelector('.btn-remove-stock-size')?.addEventListener('click', () => {
    row.remove();
    updateStockSizesTotal();
    if (!stockSizesRows.children.length) addStockSizeRow();
  });
  return row;
}

function updateStockSizeRowReservedHint(row) {
  if (!editingStockEntryId) return;
  const size = row.querySelector('.stock-size-field')?.value || '';
  const reserved = Number(editingSizeReservedMap[size]) || 0;
  const wrap = row.querySelector('.stock-qty-wrap');
  if (!wrap) return;
  const input = wrap.querySelector('.stock-qty-field');
  let hint = wrap.querySelector('.stock-size-reserved-hint');
  if (reserved > 0) {
    if (!hint) {
      hint = document.createElement('span');
      hint.className = 'stock-size-reserved-hint';
      wrap.appendChild(hint);
    }
    hint.textContent = `mín. ${reserved} (reservado)`;
    if (input) input.min = reserved;
  } else if (hint) {
    hint.remove();
    if (input) input.min = 0;
  }
}

function addStockSizeRow(size = '', quantity = '') {
  stockSizesRows.appendChild(renderStockSizeRow(size, quantity));
  updateStockSizesTotal();
}

function setStockSizeRows(sizes) {
  stockSizesRows.innerHTML = '';
  if (sizes?.length) {
    sizes.forEach((s) => addStockSizeRow(s.size, s.quantity));
  } else {
    addStockSizeRow();
    addStockSizeRow();
  }
}

function collectStockSizesFromRows() {
  return [...stockSizesRows.querySelectorAll('.sizes-editor__row')].map((row) => ({
    size: row.querySelector('.stock-size-field')?.value || '',
    quantity: Number(row.querySelector('.stock-qty-field')?.value) || 0,
  })).filter((s) => {
    if (!s.size) return false;
    return editingStockEntryId ? s.quantity >= 0 : s.quantity > 0;
  });
}

function updateStockSizesTotal() {
  const sizes = collectStockSizesFromRows();
  const total = sizes.reduce((sum, s) => sum + s.quantity, 0);
  const summary = sizes.map((s) => `${s.quantity} ${s.size}`).join(', ');
  stockSizesTotal.textContent = summary
    ? `Total: ${total} peças (${summary})`
    : `Total: ${total} peças`;
  updateStockImportCostPreview();
}

function showStockFormErrors(errors) {
  if (!errors.length) {
    stockFormErrors.classList.remove('form-errors--visible');
    stockFormErrors.innerHTML = '';
    return;
  }
  stockFormErrors.innerHTML = `<ul>${errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;
  stockFormErrors.classList.add('form-errors--visible');
}

function populateStockProductSelect(selectedId = '') {
  const select = qs('#stock-product');
  if (!select) return;

  const options = allProducts
    .filter((p) => p.status !== 'inativo')
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');

  select.innerHTML = `<option value="">Selecione o produto</option>${options}`;
  select.value = selectedId || pendingStockProductId || '';
}

function syncStockNameFromProduct() {
  const productId = qs('#stock-product')?.value;
  const nameInput = qs('#stock-name');
  if (!nameInput || nameInput.value.trim()) return;
  const product = allProducts.find((p) => p.id === productId);
  if (product?.name) nameInput.value = product.name;
}

function resetStockForm() {
  stockForm?.reset();
  editingStockEntryId = null;
  editingStockProductId = '';
  editingEntryQuantity = null;
  editingSizeReservedMap = {};
  qs('#stock-name').value = '';
  qs('#stock-observation').value = '';
  qs('#stock-sizes-quick-input').value = '';
  qs('#stock-stockOrigin').value = 'proprio';
  qs('#stock-investorId').value = '';
  qs('#stock-suggestedSalePrice').value = DEFAULT_SALE_PRICE;
  qs('#stock-importTaxes').value = '';
  qs('#stock-importFreight').value = '';
  qs('#stock-importTaxesPaidAt').value = '';
  showStockFormErrors([]);
  setStockSizeRows([]);
  populateStockProductSelect();
  toggleStockInvestorField();
  setStockModalMode('create');
  updateStockImportCostPreview();
}

function setStockModalMode(mode = 'create') {
  const title = qs('.modal__title', qs('#stock-modal'));
  const submitBtn = qs('#btn-save-stock');
  const sizesEditor = qs('#stock-sizes-editor');
  const sizesTitle = qs('#stock-sizes-title');
  const sizesHint = qs('#stock-sizes-hint');
  const sizesQuick = qs('#stock-sizes-quick-wrap');
  const productSelect = qs('#stock-product');
  const nameInput = qs('#stock-name');
  const isEdit = mode === 'edit';

  if (title) title.textContent = isEdit ? 'Editar estoque' : 'Cadastrar estoque';
  if (submitBtn) submitBtn.textContent = isEdit ? 'Salvar alterações' : 'Registrar estoque';
  if (sizesEditor) sizesEditor.hidden = false;
  if (sizesTitle) {
    sizesTitle.textContent = isEdit ? 'Quantidade por tamanho' : 'Peças entrando no estoque';
  }
  if (sizesHint) {
    sizesHint.textContent = isEdit
      ? 'Ajuste a quantidade de cada tamanho. Não pode ser menor que o reservado (consignado).'
      : 'Informe quantidade + tamanho de cada peça que está entrando.';
  }
  if (sizesQuick) sizesQuick.hidden = isEdit;
  if (productSelect) {
    productSelect.disabled = isEdit;
    productSelect.required = !isEdit;
  }
  if (nameInput) nameInput.required = !isEdit;
}

function openStockModal(productId = '') {
  pendingStockProductId = productId;
  resetStockForm();
  if (productId) {
    qs('#stock-product').value = productId;
    syncStockNameFromProduct();
  }
  openModal('stock-modal');
}

async function openEditStockModal(id) {
  const result = await getStockEntryById(id);
  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  const entry = result.data;
  const importPerUnit = Number(entry.importTaxPerUnit)
    || diluteLotCostPerUnit(Number(entry.importTaxes) || 0, entry.entryQuantity || entry.quantity);
  const freightPerUnit = Number(entry.importFreightPerUnit)
    || diluteLotCostPerUnit(Number(entry.importFreight) || 0, entry.entryQuantity || entry.quantity);
  const baseCost = entry.baseCostPrice != null
    ? Number(entry.baseCostPrice)
    : Math.max(0, getStockEntryUnitCost(entry) - importPerUnit - freightPerUnit);

  resetStockForm();
  editingStockEntryId = id;
  editingStockProductId = entry.productId || '';
  editingEntryQuantity = Number(entry.entryQuantity) || totalQuantity(entry.sizes);
  editingSizeReservedMap = Object.fromEntries(
    (entry.sizes || []).map((s) => [s.size, Number(s.reserved) || 0])
  );
  setStockModalMode('edit');

  qs('#stock-name').value = entry.name || entry.productName || '';
  populateStockProductSelect(entry.productId);
  qs('#stock-stockOrigin').value = entry.stockOrigin || 'proprio';
  qs('#stock-investorId').value = entry.investorId || '';
  toggleStockInvestorField();
  qs('#stock-costPrice').value = baseCost || '';
  qs('#stock-suggestedSalePrice').value = entry.suggestedSalePrice ?? DEFAULT_SALE_PRICE;
  qs('#stock-minimumSalePrice').value = entry.minimumSalePrice ?? '';
  qs('#stock-importTaxes').value = entry.importTaxes ? entry.importTaxes : '';
  qs('#stock-importFreight').value = entry.importFreight ? entry.importFreight : '';
  qs('#stock-importTaxesPaidAt').value = entry.importTaxesPaidAt || '';
  qs('#stock-observation').value = entry.notes || '';
  setStockSizeRows((entry.sizes || []).map((s) => ({
    size: s.size,
    quantity: Number(s.quantity) || 0,
  })));
  updateStockImportCostPreview();
  openModal('stock-modal');
}

function openProductRegisterTab() {
  resetForm();
  switchTab('product-register');
}

function openProductRegisterFromStock() {
  openedProductFromStock = true;
  pendingStockProductId = qs('#stock-product')?.value || '';
  pendingStockName = qs('#stock-name')?.value || '';
  closeModal('stock-modal');
  openProductRegisterTab();
}

function applyStockQuickSizes() {
  const text = qs('#stock-sizes-quick-input').value;
  const parsed = parseSizesQuickInput(text);

  if (!parsed.length) {
    showToast('Formato inválido. Use: 10 M, 30 G, 5 GG', 'warning');
    return;
  }

  setStockSizeRows(parsed);
  qs('#stock-sizes-quick-input').value = '';
  showToast(`${parsed.length} tamanho(s) aplicado(s)!`, 'success');
}

function parseDecimalInput(value) {
  const str = String(value ?? '').trim();
  if (!str) return '';
  const normalized = str.includes(',') && !str.includes('.') ? str.replace(',', '.') : str;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : NaN;
}

function readStockDecimalField(selector) {
  const raw = qs(selector)?.value;
  if (raw === '' || raw == null) return '';
  return parseDecimalInput(raw);
}

function getStockPricingData() {
  return {
    costPrice: readStockDecimalField('#stock-costPrice'),
    suggestedSalePrice: readStockDecimalField('#stock-suggestedSalePrice'),
    minimumSalePrice: readStockDecimalField('#stock-minimumSalePrice'),
    importTaxes: readStockDecimalField('#stock-importTaxes'),
    importFreight: readStockDecimalField('#stock-importFreight'),
    importTaxesPaidAt: qs('#stock-importTaxesPaidAt')?.value || '',
  };
}

function updateStockImportCostPreview() {
  const preview = qs('#stock-import-cost-preview');
  if (!preview) return;

  const lines = collectStockSizesFromRows().filter((s) => s.size && Number(s.quantity) > 0);
  const { costPrice, importTaxes, importFreight } = getStockPricingData();
  const safeCost = Number.isFinite(Number(costPrice)) ? Number(costPrice) : 0;
  const safeTax = Number.isFinite(Number(importTaxes)) ? Number(importTaxes) : 0;
  const safeFreight = Number.isFinite(Number(importFreight)) ? Number(importFreight) : 0;
  const lineTotal = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  const total = editingEntryQuantity || lineTotal;
  const pieces = total || lineTotal;
  const taxPerUnit = diluteLotCostPerUnit(safeTax, pieces);
  const freightPerUnit = diluteLotCostPerUnit(safeFreight, pieces);
  const operationalPerUnit = taxPerUnit + freightPerUnit;
  const hasLotCosts = safeTax > 0 || safeFreight > 0;

  if (editingStockEntryId) {
    preview.textContent = pieces
      ? `Entrada original: ${pieces} peça(s). Estoque atual no formulário: ${lineTotal} peça(s). Mercadoria: ${formatCurrency(safeCost)}/peça. Operacional (imp.+frete): ${formatCurrency(operationalPerUnit)}/peça.`
      : 'Informe imposto/frete para ver o custo operacional por peça.';
    return;
  }

  if (!lineTotal) {
    preview.textContent = 'Informe as peças entrando para calcular o custo operacional por peça.';
    return;
  }

  if (!hasLotCosts) {
    preview.textContent = `Custo da mercadoria: ${formatCurrency(safeCost)}/peça. Sem imposto ou frete internacional.`;
    return;
  }

  const parts = [];
  if (taxPerUnit > 0) {
    parts.push(`imposto ${formatCurrency(taxPerUnit)}/peça (${formatCurrency(safeTax)} ÷ ${lineTotal})`);
  }
  if (freightPerUnit > 0) {
    parts.push(`frete ${formatCurrency(freightPerUnit)}/peça (${formatCurrency(safeFreight)} ÷ ${lineTotal})`);
  }
  preview.textContent =
    `Mercadoria ${formatCurrency(safeCost)}/peça. Custo operacional: ${parts.join(' + ')} — abate o lucro na venda (como Yampi/Appmax), não entra no custo do produto.`;
}

async function handleStockSubmit(e) {
  e.preventDefault();
  const isEdit = !!editingStockEntryId;
  const stockName = qs('#stock-name').value.trim()
    || (isEdit ? qs('#stock-product')?.selectedOptions?.[0]?.textContent?.trim() : '');
  const productId = isEdit
    ? editingStockProductId
    : qs('#stock-product').value;
  const lines = collectStockSizesFromRows();
  const pricing = getStockPricingData();

  const validation = validateStockEntry({
    stockEntryName: stockName,
    productId,
    stockOrigin: qs('#stock-stockOrigin')?.value || 'proprio',
    investorId: qs('#stock-investorId')?.value || '',
    lines,
    entryQuantity: editingEntryQuantity,
    isEdit,
    ...pricing,
  });

  showStockFormErrors(validation.errors);
  if (!validation.valid) {
    stockFormErrors?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast(validation.errors[0] || 'Corrija os erros no formulário.', 'warning');
    return;
  }

  const observation = qs('#stock-observation').value.trim();
  const btn = qs('#btn-save-stock');
  setLoading(btn, true);

  const payload = {
    stockEntryName: stockName,
    stockOrigin: qs('#stock-stockOrigin')?.value || 'proprio',
    investorId: qs('#stock-investorId')?.value || '',
    observation: observation || 'Entrada de estoque',
    pricing,
    lines: isEdit ? lines : undefined,
  };

  const result = editingStockEntryId
    ? await updateStockEntryDetails(editingStockEntryId, payload)
    : await registerStockEntry({
      productId,
      lines,
      ...payload,
    });

  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  if (editingStockEntryId) {
    showToast('Estoque atualizado!', 'success');
  } else {
    const pieces = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
    showToast(`${pieces} peça(s) adicionada(s) ao estoque!`, 'success');
  }

  closeModal('stock-modal');
  pendingStockProductId = '';
  pendingStockName = '';
  editingStockEntryId = null;
  editingStockProductId = '';
  editingEntryQuantity = null;
  await loadStockEntries({ fresh: true });
  if (movementsLoaded) {
    await loadMovements({ fresh: true });
  }
}

function formatCostCell(entry) {
  const cost = getStockEntryUnitCost(entry);
  if (!cost) {
    return '<span class="text-muted">—</span>';
  }
  const hasImport = (Number(entry.importTaxes) || 0) > 0
    || (Number(entry.importTaxPerUnit) || 0) > 0;
  const hasFreight = (Number(entry.importFreight) || 0) > 0
    || (Number(entry.importFreightPerUnit) || 0) > 0;
  const suffix = hasImport || hasFreight
    ? '<br><span class="text-sm text-muted">+ custo operacional na venda</span>'
    : '';
  return `<strong>${formatCurrency(cost)}</strong>${suffix}`;
}

function formatPriceCell(product) {
  const price = Number(product.suggestedSalePrice) || 0;
  if (!price) {
    return '<span class="text-muted">—</span>';
  }
  return formatCurrency(price);
}

function formatSizesBadges(sizes) {
  if (!sizes?.length) return '<span class="text-muted">—</span>';

  const sorted = sortSizes(sizes);
  const hasReserved = sorted.some((s) => (Number(s.reserved) || 0) > 0);

  const availBadges = sorted.map((s) => {
    const avail = availableQty(s);
    const qty = Number(s.quantity) || 0;
    const displayQty = hasReserved ? avail : qty;
    const soldOut = displayQty <= 0;
    const low = !soldOut && displayQty <= lowStockThreshold;
    const badgeClass = soldOut ? 'badge--error' : (low ? 'badge--warning' : 'badge--neutral');
    return `<span class="badge ${badgeClass}">${s.size}: ${displayQty}</span>`;
  }).join('');

  if (!hasReserved) {
    return `<div class="sizes-badges">${availBadges}</div>`;
  }

  const establishmentBadges = sorted.map((s) => {
    const reserved = Number(s.reserved) || 0;
    const badgeClass = reserved > 0 ? 'badge--establishment' : 'badge--establishment-empty';
    return `<span class="badge ${badgeClass}">${s.size}: ${reserved}</span>`;
  }).join('');

  return `
    <div class="sizes-badges-stack">
      <div class="sizes-badges sizes-badges--available" title="Disponível no estoque">${availBadges}</div>
      <div class="sizes-badges sizes-badges--establishment" title="Em estabelecimentos (consignado)">${establishmentBadges}</div>
    </div>
  `;
}

function productThumbHtml(imageUrl, alt = '') {
  if (!imageUrl) {
    return '<span class="table__thumb--empty" aria-hidden="true">—</span>';
  }
  const safeAlt = alt.replace(/"/g, '&quot;');
  return `<img class="table__thumb" src="${imageUrl}" alt="${safeAlt}" loading="lazy">`;
}

function updateImagePreview(url = qs('#field-imageUrl')?.value.trim()) {
  const preview = qs('#field-image-preview');
  if (!preview) return;
  if (!url) {
    preview.hidden = true;
    preview.removeAttribute('src');
    return;
  }
  preview.src = url;
  preview.hidden = false;
  preview.onerror = () => { preview.hidden = true; };
}

function getFormData() {
  return {
    name: qs('#field-name').value.trim(),
    imageUrl: qs('#field-imageUrl')?.value.trim() || '',
    sizes: [],
    supplier: qs('#field-supplier').value.trim(),
    status: qs('#field-status').value,
    notes: qs('#field-notes').value.trim(),
  };
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

function toggleStockInvestorField() {
  const isInvestor = stockOriginField?.value === 'investidor';
  if (stockInvestorGroup) stockInvestorGroup.style.display = isInvestor ? '' : 'none';
}

function getStatusBadge(status) {
  const map = { ativo: 'badge--success', inativo: 'badge--neutral', esgotado: 'badge--error' };
  const labels = { ativo: 'Ativo', inativo: 'Inativo', esgotado: 'Esgotado' };
  return `<span class="badge ${map[status] || 'badge--neutral'}">${labels[status] || status}</span>`;
}

function getOriginBadge(origin) {
  return origin === 'investidor'
    ? '<span class="badge badge--info">Investidor</span>'
    : '<span class="badge badge--neutral">Próprio</span>';
}

function getStockFilterValues() {
  return {
    search: stockSearchInput?.value.trim().toLowerCase() || '',
    product: qs('#stock-filter-product')?.value || '',
    size: qs('#stock-filter-size')?.value || '',
    origin: qs('#stock-filter-origin')?.value || '',
    investor: qs('#stock-filter-investor')?.value || '',
    status: qs('#stock-filter-status')?.value || '',
  };
}

function entryHasSize(entry, size) {
  return (entry.sizes || []).some((s) => s.size === size);
}

function filterStockEntries(entries) {
  const f = getStockFilterValues();
  return entries.filter((e) => {
    if (f.product && e.productId !== f.product) return false;
    if (f.size && !entryHasSize(e, f.size)) return false;
    if (f.origin && e.stockOrigin !== f.origin) return false;
    if (f.investor && e.investorId !== f.investor) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.search) {
      const hay = `${e.name} ${e.productName}`.toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    return true;
  });
}

function getCatalogFilterValues() {
  return {
    search: catalogSearchInput?.value.trim().toLowerCase() || '',
    status: qs('#catalog-filter-status')?.value || '',
  };
}

function filterCatalogProducts(products) {
  const f = getCatalogFilterValues();
  return products.filter((p) => {
    if (f.status && p.status !== f.status) return false;
    if (f.search && !p.name?.toLowerCase().includes(f.search)) return false;
    return true;
  });
}

function getInvestorName(id) {
  return allInvestors.find((i) => i.id === id)?.name || id || '—';
}

function populateInvestorSelects() {
  const options = allInvestors.map(
    (i) => `<option value="${i.id}">${i.name}</option>`
  ).join('');

  const stockInvestorSelect = qs('#stock-investorId');
  if (stockInvestorSelect) {
    const current = stockInvestorSelect.value;
    stockInvestorSelect.innerHTML = `<option value="">Selecione</option>${options}`;
    stockInvestorSelect.value = current;
  }

  ['#stock-filter-investor', '#hist-filter-investor'].forEach((sel) => {
    const select = qs(sel);
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Todos</option>${options}`;
    select.value = current;
  });
}

async function loadInvestorsForSelect() {
  const result = await listInvestors();
  if (result.success) {
    allInvestors = result.data;
    populateInvestorSelects();
  }
}

function populateStockProductFilterSelects() {
  const productMap = new Map();
  allStockEntries.forEach((entry) => {
    if (!entry.productId) return;
    const name = entry.productName || allProducts.find((p) => p.id === entry.productId)?.name || entry.productId;
    productMap.set(entry.productId, name);
  });

  const options = [...productMap.entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR'))
    .map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`)
    .join('');

  ['#stock-filter-product', '#stock-history-filter-product', '#hist-filter-product'].forEach((sel) => {
    const select = qs(sel);
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Todos</option>${options}`;
    select.value = current;
  });
}

function entryHasLowStock(entry) {
  return (entry.sizes || []).some((s) => {
    const avail = availableQty(s);
    return avail > 0 && avail <= lowStockThreshold;
  });
}

function entryIsSoldOut(entry) {
  const sizes = entry.sizes || [];
  if (!sizes.length) return entry.status === 'esgotado';
  return sizes.every((s) => availableQty(s) <= 0) || entry.status === 'esgotado';
}

function getStockRowClass(entry) {
  if (entryIsSoldOut(entry)) return 'table__row--sold-out';
  if (entryHasLowStock(entry)) return 'table__row--low-stock';
  return '';
}

function getStockEntryQuantitySummary(entry) {
  return buildStockEntryQuantityStats(entry, []);
}

function formatStockQuantityCell(entry) {
  const { currentQty } = getStockEntryQuantitySummary(entry);
  return `<strong>${currentQty}</strong>`;
}

function formatSizesLine(sizes) {
  const list = sortSizes(sizes || []);
  if (!list.length) return '—';
  return list.map((s) => `${Number(s.quantity) || 0} ${s.size}`).join(', ');
}

function renderStockEntryWarningsHtml(stats) {
  const warnings = [];

  if (stats.entryQuantityMismatch) {
    warnings.push(
      `O campo "entrada" salvo no lote (${stats.storedEntryQty}) não bate com as peças cadastradas (${stats.entryPieces}). Os números abaixo usam o cadastro real.`,
    );
  }

  if (stats.hasMovementOversell) {
    warnings.push(
      `${stats.grossSoldQty} saída(s) no histórico para um lote de ${stats.entryPieces} peça(s) (${stats.oversoldQty} a mais). Verifique pedidos duplicados ou tamanhos errados.`,
    );
  }

  if (!warnings.length) return '';

  return `
    <div class="stock-view-alert" role="status">
      ${warnings.map((text) => `<p class="stock-view-alert__text">${text}</p>`).join('')}
    </div>
  `;
}

function renderStockSizesComparisonHtml(stats) {
  const { initialSizes, currentSizes, soldQty } = stats;
  const initialLine = formatSizesLine(initialSizes);
  const currentLine = formatSizesLine(currentSizes);
  const initialTotal = stats.entryPieces;
  const currentTotal = stats.currentQty;

  return `
    <div class="stock-size-compare">
      <div class="stock-size-compare__row">
        <span class="stock-size-compare__label">Estoque inicial</span>
        <span class="stock-size-compare__value">${initialLine}</span>
        <span class="stock-size-compare__total">${initialTotal} peça(s)</span>
      </div>
      <div class="stock-size-compare__row stock-size-compare__row--current">
        <span class="stock-size-compare__label">Estoque final (saldo)</span>
        <span class="stock-size-compare__value">${currentLine}</span>
        <span class="stock-size-compare__total">${currentTotal} peça(s)</span>
      </div>
      ${soldQty > 0 ? `<p class="stock-size-compare__note text-sm text-muted">${soldQty} peça(s) vendida(s) deste lote.</p>` : ''}
    </div>
  `;
}

function groupMovementsByStockEntry(movements) {
  const map = new Map();
  (movements || []).forEach((movement) => {
    const entryId = movement.stockEntryId;
    if (!entryId) return;
    if (!map.has(entryId)) map.set(entryId, []);
    map.get(entryId).push(movement);
  });
  return map;
}

function renderStockHistoryItemHtml(entry, stats) {
  const currentLine = formatSizesLine(stats.currentSizes);
  const initialLine = formatSizesLine(stats.initialSizes);
  const soldNote = stats.soldQty > 0
    ? `<p class="stock-history-item__sold">${stats.soldQty} peça(s) vendida(s)</p>`
    : '';

  return `
    <article class="stock-history-item" data-stock-name="${escapeHtml(entry.name || '')}" data-product-name="${escapeHtml(entry.productName || '')}" data-product-id="${escapeHtml(entry.productId || '')}">
      <div class="stock-history-item__header">
        <span class="stock-history-item__name">${escapeHtml(entry.name || '—')}</span>
        <span class="stock-history-item__product">${escapeHtml(entry.productName || '—')}</span>
        <span class="stock-history-item__meta">${getStatusBadge(entry.status)}</span>
      </div>
      <div class="stock-history-item__compare">
        <div class="stock-history-item__col stock-history-item__col--initial">
          <span class="stock-history-item__label">Estoque inicial</span>
          <span class="stock-history-item__value">${initialLine}</span>
          <span class="stock-history-item__total">${stats.entryPieces} peça(s)</span>
        </div>
        <div class="stock-history-item__col stock-history-item__col--current">
          <span class="stock-history-item__label">Estoque atual</span>
          <span class="stock-history-item__value">${currentLine}</span>
          <span class="stock-history-item__total">${stats.currentQty} peça(s)</span>
        </div>
      </div>
      ${soldNote}
    </article>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getStockHistoryFilterValues() {
  return {
    search: qs('#stock-history-search')?.value.trim().toLowerCase() || '',
    product: qs('#stock-history-filter-product')?.value || '',
  };
}

function filterStockHistoryItems() {
  const f = getStockHistoryFilterValues();
  const items = qsa('.stock-history-item', qs('#stock-history-list'));
  let visible = 0;

  items.forEach((item) => {
    const hay = `${item.dataset.stockName} ${item.dataset.productName}`.toLowerCase();
    const matchesSearch = !f.search || hay.includes(f.search);
    const matchesProduct = !f.product || item.dataset.productId === f.product;
    const show = matchesSearch && matchesProduct;
    item.hidden = !show;
    if (show) visible += 1;
  });

  const countEl = qs('#stock-history-count');
  if (countEl) {
    const hasFilter = f.search || f.product;
    countEl.textContent = hasFilter
      ? `${visible} de ${items.length} estoque(s)`
      : `${items.length} estoque(s)`;
  }
}

function renderStockHistoryList(entries, movementsByEntry) {
  const listEl = qs('#stock-history-list');
  const countEl = qs('#stock-history-count');
  if (!listEl) return;

  const sorted = [...entries].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));

  if (!sorted.length) {
    listEl.innerHTML = '<p class="table__empty">Nenhum estoque cadastrado.</p>';
    if (countEl) countEl.textContent = '0 estoque(s)';
    return;
  }

  listEl.innerHTML = sorted.map((entry) => {
    const entryMovements = movementsByEntry.get(entry.id) || [];
    const stats = buildStockEntryQuantityStats(entry, entryMovements);
    return renderStockHistoryItemHtml(entry, stats);
  }).join('');

  filterStockHistoryItems();
}

async function loadMovementsForHistory() {
  const result = await getMovementHistory({}, { fresh: true });
  if (!result.success) {
    showToast(result.error, 'error');
    return false;
  }

  allMovements = result.data;
  movementsLoaded = true;
  return true;
}

async function openStockHistoryModal() {
  const listEl = qs('#stock-history-list');
  const countEl = qs('#stock-history-count');
  if (!listEl) return;

  listEl.innerHTML = '<p class="table__empty">Carregando histórico...</p>';
  if (countEl) countEl.textContent = 'Carregando...';
  openModal('stock-history-modal');

  const loaded = await loadMovementsForHistory();
  if (!loaded) {
    listEl.innerHTML = '<p class="table__empty">Não foi possível carregar o histórico.</p>';
    if (countEl) countEl.textContent = 'Erro ao carregar';
    return;
  }

  const movementsByEntry = groupMovementsByStockEntry(allMovements);
  populateStockProductFilterSelects();
  renderStockHistoryList(allStockEntries, movementsByEntry);
}

function renderStockQuantitySummaryHtml(summary) {
  const { currentQty, entryPieces, soldQty, soldPercent, hasRecordedEntry } = summary;

  if (!hasRecordedEntry) {
    return `
      <div class="stock-view-summary stock-view-summary--single">
        <div class="stock-view-summary__card">
          <span class="stock-view-summary__label">Peças no estoque</span>
          <strong class="stock-view-summary__value">${currentQty}</strong>
        </div>
        <p class="stock-view-summary__note text-sm text-muted">Entrada original não registrada neste lote (cadastro antigo).</p>
      </div>
    `;
  }

  return `
    <div class="stock-view-summary">
      <div class="stock-view-summary__card">
        <span class="stock-view-summary__label">Entrada original</span>
        <strong class="stock-view-summary__value">${entryPieces}</strong>
      </div>
      <div class="stock-view-summary__card stock-view-summary__card--sold">
        <span class="stock-view-summary__label">Vendidas</span>
        <strong class="stock-view-summary__value">${soldQty}</strong>
        <span class="stock-view-summary__meta">${soldPercent}%</span>
      </div>
      <div class="stock-view-summary__card stock-view-summary__card--current">
        <span class="stock-view-summary__label">Restantes</span>
        <strong class="stock-view-summary__value">${currentQty}</strong>
      </div>
    </div>
  `;
}

function renderStockEntriesTable(entries) {
  const filtered = filterStockEntries(entries);

  stockEntriesCount.textContent = filtered.length === allStockEntries.length
    ? `${allStockEntries.length} estoque(s) cadastrado(s)`
    : `${filtered.length} de ${allStockEntries.length} estoque(s)`;

  if (!filtered.length) {
    stockEntriesTbody.innerHTML = `<tr><td colspan="9" class="table__empty">Nenhum estoque cadastrado. Use + Cadastrar estoque.</td></tr>`;
    return;
  }

  stockEntriesTbody.innerHTML = filtered.map((e) => `
    <tr data-id="${e.id}" class="${getStockRowClass(e)}">
      <td><strong>${e.name}</strong></td>
      <td>${e.productName || '—'}</td>
      <td>${formatSizesBadges(e.sizes)}</td>
      <td>${formatStockQuantityCell(e)}</td>
      <td>${formatCostCell(e)}</td>
      <td>${formatPriceCell(e)}</td>
      <td>${getOriginBadge(e.stockOrigin)}${e.stockOrigin === 'investidor' ? `<br><span class="text-sm text-muted">${getInvestorName(e.investorId)}</span>` : ''}</td>
      <td>${getStatusBadge(e.status)}</td>
      <td>
        <div class="table__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-action="view-stock" data-id="${e.id}">Ver</button>
          <button type="button" class="btn btn--danger btn--sm" data-action="delete-stock" data-id="${e.id}">Excluir</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderCatalogTable(products) {
  const filtered = filterCatalogProducts(products);

  catalogCount.textContent = filtered.length === allProducts.length
    ? `${allProducts.length} produto(s) no catálogo`
    : `${filtered.length} de ${allProducts.length} produto(s)`;

  if (!filtered.length) {
    catalogTbody.innerHTML = `<tr><td colspan="6" class="table__empty">Nenhum produto cadastrado.</td></tr>`;
    return;
  }

  catalogTbody.innerHTML = filtered.map((p) => `
    <tr data-id="${p.id}">
      <td>${productThumbHtml(p.imageUrl, p.name)}</td>
      <td><strong>${p.name}</strong></td>
      <td>${p.supplier || '—'}</td>
      <td>${p.category || '—'}</td>
      <td>${getStatusBadge(p.status)}</td>
      <td>
        <div class="table__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-action="view" data-id="${p.id}">Ver</button>
          <button type="button" class="btn btn--secondary btn--sm" data-action="edit" data-id="${p.id}">Editar</button>
          <button type="button" class="btn btn--danger btn--sm" data-action="delete" data-id="${p.id}">Excluir</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function importCatalogIfNeeded(products) {
  const existingNames = new Set(products.map((p) => p.name?.trim().toLowerCase()));
  const pending = CATALOG_PRODUCTS.filter(
    (item) => !existingNames.has(item.name.trim().toLowerCase())
  );

  if (!pending.length) return { imported: 0 };

  let imported = 0;
  for (const item of pending) {
    const result = await createProduct({
      ...item,
      sizes: [],
    });
    if (result.success) imported += 1;
  }

  return { imported };
}

async function loadStockEntries(options = {}) {
  stockEntriesCount.textContent = 'Carregando estoques...';

  const [productsResult, stockResult] = await Promise.all([
    listProducts(options),
    listStockEntries({}, options),
  ]);

  if (productsResult.success) {
    allProducts = productsResult.data;
    const migration = await migrateLegacyProductStock(
      allProducts,
      stockResult.success ? stockResult.data : null
    );

    if (migration.migrated > 0) {
      showToast(`${migration.migrated} estoque(s) legado(s) migrado(s) para lotes.`, 'success');
      const [refreshedProducts, refreshedStock] = await Promise.all([
        listProducts({ fresh: true }),
        listStockEntries({}, { fresh: true }),
      ]);
      if (refreshedProducts.success) allProducts = refreshedProducts.data;
      if (refreshedStock.success) {
        allStockEntries = refreshedStock.data;
        renderStockEntriesTable(allStockEntries);
        renderCatalogTable(allProducts);
        refreshStockUI();
        return;
      }
    }

    const { imported } = await importCatalogIfNeeded(allProducts);
    if (imported > 0) {
      showToast(`${imported} produto(s) do catálogo SHIR7 cadastrado(s)!`, 'success');
      const refreshed = await listProducts({ fresh: true });
      if (refreshed.success) allProducts = refreshed.data;
    }
  }

  if (!stockResult.success) {
    stockEntriesCount.textContent = 'Erro ao carregar estoques.';
    showToast(stockResult.error, 'error');
    return;
  }

  allStockEntries = stockResult.data;
  renderStockEntriesTable(allStockEntries);
  renderCatalogTable(allProducts);
  refreshStockUI();
}

function resetForm() {
  productForm.reset();
  editingId = null;
  formErrors.classList.remove('form-errors--visible');
  qs('#product-register-title').textContent = 'Novo produto';
  updateImagePreview('');
}

function fillForm(product) {
  qs('#field-name').value = product.name || '';
  qs('#field-imageUrl').value = product.imageUrl || '';
  qs('#field-status').value = product.status || 'ativo';
  qs('#field-supplier').value = product.supplier || '';
  qs('#field-notes').value = product.notes || '';
  updateImagePreview(product.imageUrl);
}

async function openEditProductTab(id) {
  const result = await getProductById(id);
  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  editingId = id;
  qs('#product-register-title').textContent = 'Editar produto';
  fillForm(result.data);
  switchTab('product-register');
}

async function openViewModal(id) {
  const result = await getProductById(id);
  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  const p = result.data;
  viewingId = id;
  viewingStockEntryId = null;
  qs('.modal__title', qs('#view-modal')).textContent = 'Detalhes do produto';

  const imageBlock = p.imageUrl
    ? `<img class="product-view__image" src="${p.imageUrl}" alt="${p.name}">`
    : '<div class="product-view__image table__thumb--empty">Sem foto</div>';

  const fields = [
    ['Nome', p.name],
    ['Categoria', p.category || '—'],
    ['SKU', p.sku || '—'],
    ['Fornecedor', p.supplier],
    ['Status', p.status],
    ['Observações', p.notes || '—'],
  ];

  qs('#view-modal-body').innerHTML = `
    <div class="product-view__grid">
      ${imageBlock}
      <div class="product-view__fields">
        ${fields.map(([label, value]) => `
          <div>
            <div class="product-view__field-label">${label}</div>
            <div class="product-view__field-value">${value}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  openModal('view-modal');
}

async function openStockEntryViewModal(id) {
  const result = await getStockEntryById(id);
  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  const e = result.data;
  viewingStockEntryId = id;
  viewingId = null;
  qs('.modal__title', qs('#view-modal')).textContent = 'Detalhes do estoque';

  const fin = computeStockEntryFinancials(e);
  const movResult = await getMovementHistory({ stockEntryId: e.id });
  const movements = movResult.success ? movResult.data : [];
  const qtySummary = buildStockEntryQuantityStats(e, movements);
  const finWithStats = {
    ...fin,
    entryPieces: qtySummary.entryPieces,
    importPerUnit: diluteLotCostPerUnit(Number(e.importTaxes) || 0, qtySummary.entryPieces),
    freightPerUnit: diluteLotCostPerUnit(Number(e.importFreight) || 0, qtySummary.entryPieces),
  };
  finWithStats.operationalPerUnit = finWithStats.importPerUnit + finWithStats.freightPerUnit;
  finWithStats.totalPaid = (fin.baseCost * finWithStats.entryPieces)
    + (Number(e.importTaxes) || 0)
    + (Number(e.importFreight) || 0);

  const fields = [
    ['Nome do estoque', e.name],
    ['Produto', e.productName],
    ['Custo mercadoria/peça', formatCurrency(finWithStats.baseCost)],
    ...(finWithStats.importTotal > 0
      ? [
        ['Imposto importação (total)', formatCurrency(finWithStats.importTotal)],
        ['Peças na entrada', finWithStats.entryPieces || '—'],
        ['Imposto diluído/peça', `${formatCurrency(finWithStats.importPerUnit)} (${formatCurrency(finWithStats.importTotal)} ÷ ${finWithStats.entryPieces} peças)`],
      ]
      : []),
    ...(finWithStats.freightTotal > 0
      ? [
        ['Frete internacional (total)', formatCurrency(finWithStats.freightTotal)],
        ['Frete diluído/peça', `${formatCurrency(finWithStats.freightPerUnit)} (${formatCurrency(finWithStats.freightTotal)} ÷ ${finWithStats.entryPieces} peças)`],
      ]
      : []),
    ['Custo operacional/peça (imp.+frete)', formatCurrency(finWithStats.operationalPerUnit)],
    ['Valor pago no lote', `${formatCurrency(finWithStats.totalPaid)} (${formatCurrency(finWithStats.baseCost)} × ${finWithStats.entryPieces} peças${finWithStats.importTotal > 0 ? ` + ${formatCurrency(finWithStats.importTotal)} imposto` : ''}${finWithStats.freightTotal > 0 ? ` + ${formatCurrency(finWithStats.freightTotal)} frete` : ''})`],
    ['Retorno esperado (restantes)', `${formatCurrency(fin.expectedReturn)} (${formatCurrency(e.suggestedSalePrice)} × ${fin.currentQty} peças)`],
    ['Lucro esperado (restantes)', formatCurrency(fin.expectedProfit)],
    ['Preço sugerido', formatCurrency(e.suggestedSalePrice)],
    ['Preço mínimo', formatCurrency(e.minimumSalePrice)],
    ['Origem', e.stockOrigin === 'investidor' ? 'Investidor' : 'Próprio'],
    ['Investidor', e.stockOrigin === 'investidor' ? getInvestorName(e.investorId) : '—'],
    ['Status', e.status],
    ['Observações', e.notes || '—'],
  ];

  qs('#view-modal-body').innerHTML = `
    ${renderStockEntryWarningsHtml(qtySummary)}
    ${renderStockQuantitySummaryHtml(qtySummary)}
    ${renderStockSizesComparisonHtml(qtySummary)}
    <div class="product-view__fields stock-view-fields">
      ${fields.map(([label, value]) => `
        <div>
          <div class="product-view__field-label">${label}</div>
          <div class="product-view__field-value">${value}</div>
        </div>
      `).join('')}
    </div>
  `;

  openModal('view-modal');
}

function openDeleteModal(id, name) {
  deletingId = id;
  deletingTarget = 'product';
  qs('#delete-item-label').textContent = `o produto ${name}`;
  const warning = qs('#delete-extra-warning');
  if (warning) {
    warning.hidden = true;
    warning.textContent = '';
  }
  openModal('delete-modal');
}

function openDeleteStockModal(entry) {
  deletingId = entry.id;
  deletingTarget = 'stock';
  qs('#delete-item-label').textContent = `o estoque ${entry.name}`;
  const warning = qs('#delete-extra-warning');
  const qty = entry.quantity ?? totalQuantity(entry.sizes);
  if (warning) {
    if (qty > 0) {
      warning.hidden = false;
      warning.textContent = `Este lote ainda tem ${qty} peça(s) em estoque. O histórico de movimentações será mantido, mas o lote deixará de aparecer nas vendas.`;
    } else {
      warning.hidden = true;
      warning.textContent = '';
    }
  }
  openModal('delete-modal');
}

async function handleSave(e) {
  e.preventDefault();
  const data = getFormData();
  const validation = validateProduct(data);

  if (!validation.valid) {
    showFormErrors(validation.errors);
    return;
  }

  showFormErrors([]);
  const saveBtn = qs('#btn-save-product');
  setLoading(saveBtn, true);

  let payload = data;
  if (editingId) {
    const existing = allProducts.find((p) => p.id === editingId);
    if (existing) {
      payload = {
        ...data,
        sku: existing.sku,
        category: existing.category,
        costPrice: existing.costPrice,
        importTaxes: existing.importTaxes,
        importTaxesPaidAt: existing.importTaxesPaidAt,
        suggestedSalePrice: existing.suggestedSalePrice,
        minimumSalePrice: existing.minimumSalePrice,
      };
    }
  }

  const result = editingId
    ? await updateProduct(editingId, payload)
    : await createProduct(payload);

  setLoading(saveBtn, false);

  if (result.success) {
    const wasFromStock = openedProductFromStock;
    const newProductId = !editingId ? result.data?.id : null;
    showToast(editingId ? 'Produto atualizado!' : 'Produto criado!', 'success');
    editingId = null;
    resetForm();
    openedProductFromStock = false;
    await loadStockEntries({ fresh: true });
    if (wasFromStock) {
      openStockModal(newProductId || pendingStockProductId);
      if (pendingStockName) qs('#stock-name').value = pendingStockName;
      pendingStockName = '';
    } else {
      switchTab('catalog');
    }
  } else {
    showToast(result.error, 'error');
  }
}

async function handleDelete() {
  if (!deletingId || !deletingTarget) return;

  const btn = qs('#btn-confirm-delete');
  setLoading(btn, true);
  const result = deletingTarget === 'stock'
    ? await deleteStockEntry(deletingId)
    : await deleteProduct(deletingId);
  setLoading(btn, false);

  if (result.success) {
    const wasStock = deletingTarget === 'stock';
    showToast(wasStock ? 'Estoque excluído.' : 'Produto excluído.', 'success');
    closeModal('delete-modal');
    deletingId = null;
    deletingTarget = null;
    await loadStockEntries({ fresh: true });
    if (wasStock && movementsLoaded) {
      await loadMovements({ fresh: true });
    }
  } else {
    showToast(result.error, 'error');
  }
}

const MOVEMENT_LABELS = {
  entrada: 'Entrada',
  saida: 'Saída',
  ajuste: 'Ajuste',
  reserva: 'Reserva',
  devolucao: 'Devolução',
};

function formatDate(timestamp) {
  if (!timestamp?.seconds) return '—';
  return new Date(timestamp.seconds * 1000).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function switchTab(tab) {
  qsa('.inventory-tabs__btn').forEach((btn) => {
    btn.classList.toggle('inventory-tabs__btn--active', btn.dataset.tab === tab);
  });
  qs('#tab-stock-entries').hidden = tab !== 'stock-entries';
  qs('#tab-catalog').hidden = tab !== 'catalog';
  qs('#tab-product-register').hidden = tab !== 'product-register';
  qs('#tab-movements').hidden = tab !== 'movements';

  if (tab === 'movements' && !movementsLoaded) {
    movementsLoaded = true;
    loadMovements();
  }
}

function populateMovementStockSelect() {
  const select = qs('#mov-stock-entry');
  const histSelect = qs('#hist-filter-stock');
  const current = select?.value;
  const histCurrent = histSelect?.value;

  const options = allStockEntries
    .filter((e) => e.status !== 'inativo')
    .map((e) => `<option value="${e.id}">${e.name} — ${e.productName}</option>`)
    .join('');

  if (select) {
    select.innerHTML = `<option value="">Selecione</option>${options}`;
    select.value = current;
  }
  if (histSelect) {
    histSelect.innerHTML = `<option value="">Todos</option>${options}`;
    histSelect.value = histCurrent;
  }
  updateMovementSizeSelect();
}

function updateMovementSizeSelect() {
  const entryId = qs('#mov-stock-entry')?.value;
  const sizeSelect = qs('#mov-size');
  const entry = allStockEntries.find((e) => e.id === entryId);

  if (!entry) {
    sizeSelect.innerHTML = '<option value="">Selecione o estoque</option>';
    return;
  }

  const sizes = entry.sizes || [];
  sizeSelect.innerHTML = sizes.length
    ? sortSizes(sizes).map((s) => {
      const avail = availableQty(s);
      return `<option value="${s.size}">${s.size} (disp: ${avail})</option>`;
    }).join('')
    : '<option value="">Sem peças neste estoque</option>';
}

function toggleMovementTypeFields() {
  const isAdjust = qs('#mov-type').value === 'ajuste';
  qs('#mov-qty-group').hidden = isAdjust;
  qs('#mov-adjust-group').hidden = !isAdjust;
}

function renderStockSummary() {
  const summary = getStockSummary(allStockEntries);
  qs('#summary-proprio-pieces').textContent = `${summary.proprio.pieces} peças`;
  qs('#summary-proprio-products').textContent = `${summary.proprio.entries} lote(s)`;
  qs('#summary-investidor-pieces').textContent = `${summary.investidor.pieces} peças`;
  qs('#summary-investidor-products').textContent = `${summary.investidor.entries} lote(s)`;
}

function renderLowStockAlerts() {
  const items = getLowStockItems(allStockEntries, lowStockThreshold);
  const container = qs('#low-stock-list');

  if (!items.length) {
    container.innerHTML = '<p class="text-muted text-sm">Nenhum alerta no momento.</p>';
    return;
  }

  container.innerHTML = items.map((item) => `
    <div class="stock-alerts__item">
      <span><strong>${item.stockEntryName || item.productName}</strong> — ${item.size}: ${item.available} disp.</span>
      <span class="badge ${item.available <= 0 ? 'badge--error' : (item.stockOrigin === 'investidor' ? 'badge--info' : 'badge--neutral')}">
        ${item.available <= 0 ? 'Esgotado' : (item.stockOrigin === 'investidor' ? 'Investidor' : 'Próprio')}
      </span>
    </div>
  `).join('');
}

function getHistoryFilters() {
  return {
    productId: qs('#hist-filter-product')?.value || '',
    stockEntryId: qs('#hist-filter-stock')?.value || '',
    type: qs('#hist-filter-type')?.value || '',
    size: qs('#hist-filter-size')?.value || '',
    origin: qs('#hist-filter-origin')?.value || '',
    investor: qs('#hist-filter-investor')?.value || '',
  };
}

function filterMovements(movements) {
  const f = getHistoryFilters();
  return movements.filter((m) => {
    if (f.productId && m.productId !== f.productId) return false;
    if (f.stockEntryId && m.stockEntryId !== f.stockEntryId) return false;
    if (f.type && m.type !== f.type) return false;
    if (f.size && m.size !== f.size) return false;
    if (f.origin && m.stockOrigin !== f.origin) return false;
    if (f.investor && m.investorId !== f.investor) return false;
    return true;
  });
}

function renderMovementsTable() {
  const filtered = filterMovements(allMovements);
  const countEl = qs('#movements-count');
  const tbodyMov = qs('#movements-tbody');

  countEl.textContent = filtered.length === allMovements.length
    ? `${allMovements.length} movimentação(ões)`
    : `${filtered.length} de ${allMovements.length} movimentação(ões)`;

  if (!filtered.length) {
    tbodyMov.innerHTML = '<tr><td colspan="9" class="table__empty">Nenhuma movimentação encontrada.</td></tr>';
    return;
  }

  tbodyMov.innerHTML = filtered.map((m) => `
    <tr>
      <td>${formatDate(m.createdAt)}</td>
      <td>${m.productName || '—'}</td>
      <td>${m.size}</td>
      <td><span class="badge badge--neutral">${MOVEMENT_LABELS[m.type] || m.type}</span></td>
      <td>${m.quantity}</td>
      <td>${m.previousQty} → ${m.newQty}</td>
      <td>${m.stockOrigin === 'investidor' ? 'Investidor' : 'Próprio'}</td>
      <td class="text-sm">${m.userEmail || '—'}</td>
      <td class="text-sm">${m.stockEntryName ? `<strong>${m.stockEntryName}</strong>${m.observation ? `<br>${m.observation}` : ''}` : (m.observation || '—')}</td>
    </tr>
  `).join('');
}

async function loadMovements(options = {}) {
  qs('#movements-count').textContent = 'Carregando histórico...';
  const result = await getMovementHistory({}, options);

  if (!result.success) {
    qs('#movements-count').textContent = 'Erro ao carregar histórico.';
    showToast(result.error, 'error');
    return;
  }

  allMovements = result.data;
  renderMovementsTable();
}

function refreshStockUI() {
  populateMovementStockSelect();
  populateStockProductSelect();
  populateStockProductFilterSelects();
  renderStockSummary();
  renderLowStockAlerts();
  renderStockEntriesTable(allStockEntries);
  renderCatalogTable(allProducts);
}

async function handleMovementSubmit(e) {
  e.preventDefault();

  const entryId = qs('#mov-stock-entry')?.value;
  const entry = allStockEntries.find((item) => item.id === entryId);
  const type = qs('#mov-type').value;
  const payload = {
    stockEntryId: entryId,
    productId: entry?.productId || '',
    size: qs('#mov-size').value,
    type,
    quantity: qs('#mov-quantity').value,
    adjustTo: qs('#mov-adjust').value,
    observation: qs('#mov-observation').value.trim(),
    stockEntryName: entry?.name || '',
  };

  const btn = qs('#btn-register-movement');
  setLoading(btn, true);

  const result = await registerMovement(payload);

  setLoading(btn, false);

  if (result.success) {
    showToast('Movimentação registrada!', 'success');
    qs('#mov-observation').value = '';
    await loadStockEntries({ fresh: true });
    if (movementsLoaded) {
      await loadMovements({ fresh: true });
    }
  } else {
    showToast(result.error, 'error');
  }
}

function initStockEvents() {
  qsa('.inventory-tabs__btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  qs('#mov-stock-entry')?.addEventListener('change', updateMovementSizeSelect);
  qs('#mov-type')?.addEventListener('change', toggleMovementTypeFields);
  qs('#movement-form')?.addEventListener('submit', handleMovementSubmit);

  ['#hist-filter-product', '#hist-filter-stock', '#hist-filter-type', '#hist-filter-size', '#hist-filter-origin', '#hist-filter-investor'].forEach((sel) => {
    qs(sel)?.addEventListener('change', renderMovementsTable);
  });

  qs('#btn-clear-hist-filters')?.addEventListener('click', () => {
    qs('#hist-filter-product').value = '';
    qs('#hist-filter-stock').value = '';
    qs('#hist-filter-type').value = '';
    qs('#hist-filter-size').value = '';
    qs('#hist-filter-origin').value = '';
    qs('#hist-filter-investor').value = '';
    renderMovementsTable();
  });

  toggleMovementTypeFields();
}

function initEvents() {
  setupModalClose('stock-modal');
  setupModalClose('view-modal');
  setupModalClose('stock-history-modal');
  setupModalClose('delete-modal');

  qs('#btn-register-stock')?.addEventListener('click', () => openStockModal());
  qs('#btn-stock-history')?.addEventListener('click', openStockHistoryModal);
  qs('#stock-history-search')?.addEventListener('input', filterStockHistoryItems);
  qs('#stock-history-filter-product')?.addEventListener('change', filterStockHistoryItems);
  qs('#btn-go-product-register')?.addEventListener('click', openProductRegisterFromStock);
  qs('#btn-reset-product-form')?.addEventListener('click', resetForm);
  qs('#stock-product')?.addEventListener('change', syncStockNameFromProduct);
  stockForm?.addEventListener('submit', handleStockSubmit);
  qs('#btn-stock-add-size')?.addEventListener('click', () => addStockSizeRow());
  qs('#btn-stock-parse-sizes')?.addEventListener('click', applyStockQuickSizes);
  qs('#stock-sizes-quick-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyStockQuickSizes();
    }
  });
  productForm?.addEventListener('submit', handleSave);
  qs('#field-imageUrl')?.addEventListener('input', (e) => updateImagePreview(e.target.value.trim()));
  stockOriginField?.addEventListener('change', toggleStockInvestorField);
  ['#stock-costPrice', '#stock-importTaxes', '#stock-importFreight', '#stock-suggestedSalePrice', '#stock-minimumSalePrice'].forEach((sel) => {
    qs(sel)?.addEventListener('input', updateStockImportCostPreview);
  });

  stockSearchInput?.addEventListener('input', () => renderStockEntriesTable(allStockEntries));
  ['#stock-filter-product', '#stock-filter-size', '#stock-filter-origin', '#stock-filter-investor', '#stock-filter-status'].forEach((sel) => {
    qs(sel)?.addEventListener('change', () => renderStockEntriesTable(allStockEntries));
  });
  qs('#btn-clear-stock-filters')?.addEventListener('click', () => {
    stockSearchInput.value = '';
    qs('#stock-filter-product').value = '';
    qs('#stock-filter-size').value = '';
    qs('#stock-filter-origin').value = '';
    qs('#stock-filter-investor').value = '';
    qs('#stock-filter-status').value = '';
    renderStockEntriesTable(allStockEntries);
  });

  catalogSearchInput?.addEventListener('input', () => renderCatalogTable(allProducts));
  qs('#catalog-filter-status')?.addEventListener('change', () => renderCatalogTable(allProducts));
  qs('#btn-clear-catalog-filters')?.addEventListener('click', () => {
    catalogSearchInput.value = '';
    qs('#catalog-filter-status').value = '';
    renderCatalogTable(allProducts);
  });

  stockEntriesTbody?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const entry = allStockEntries.find((item) => item.id === btn.dataset.id);
    if (!entry) return;

    if (btn.dataset.action === 'view-stock') openStockEntryViewModal(btn.dataset.id);
    if (btn.dataset.action === 'delete-stock') openDeleteStockModal(entry);
  });

  catalogTbody?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const product = allProducts.find((p) => p.id === btn.dataset.id);
    if (!product) return;

    if (btn.dataset.action === 'view') openViewModal(btn.dataset.id);
    if (btn.dataset.action === 'edit') openEditProductTab(btn.dataset.id);
    if (btn.dataset.action === 'delete') openDeleteModal(btn.dataset.id, product.name);
  });

  qs('#btn-edit-from-view')?.addEventListener('click', () => {
    if (viewingStockEntryId) {
      const stockId = viewingStockEntryId;
      closeModal('view-modal');
      openEditStockModal(stockId);
      return;
    }
    if (viewingId) {
      closeModal('view-modal');
      openEditProductTab(viewingId);
    }
  });

  qs('#btn-confirm-delete')?.addEventListener('click', handleDelete);
}

async function init() {
  initEvents();
  initStockEvents();
  await waitForAuth();
  await Promise.all([
    getLowStockThreshold().then((value) => {
      lowStockThreshold = value ?? 5;
    }),
    loadInvestorsForSelect(),
    loadStockEntries(),
  ]);
}

init();
