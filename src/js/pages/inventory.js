import {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../services/productService.js';
import { waitForAuth } from '../services/authService.js';
import { listInvestors } from '../services/investorService.js';
import {
  registerMovement,
  getMovementHistory,
  getLowStockThreshold,
  getLowStockItems,
  getStockSummary,
} from '../services/stockService.js';
import {
  availableQty,
  importTaxPerUnit,
  unitCostWithImportTax,
  totalQuantity,
} from '../utils/calculations.js';
import { validateProduct, parseSizesQuickInput } from '../utils/validators.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import {
  qs,
  qsa,
  showToast,
  openModal,
  closeModal,
  setupModalClose,
  setLoading,
} from '../utils/domHelpers.js';

const SIZE_OPTIONS = ['P', 'M', 'G', 'GG', 'XG'];

let allProducts = [];
let allInvestors = [];
let allMovements = [];
let lowStockThreshold = 5;
let editingId = null;
let viewingId = null;
let deletingId = null;

const tbody = qs('#products-tbody');
const searchInput = qs('#search-input');
const productsCount = qs('#products-count');
const productForm = qs('#product-form');
const formErrors = qs('#form-errors');
const investorGroup = qs('#investor-group');
const stockOriginField = qs('#field-stockOrigin');
const sizesRows = qs('#sizes-rows');
const sizesTotal = qs('#sizes-total');

function sizeSelectHtml(selected = '') {
  const options = SIZE_OPTIONS.map(
    (s) => `<option value="${s}" ${s === selected ? 'selected' : ''}>${s}</option>`
  ).join('');
  return `<option value="">Tam.</option>${options}`;
}

function renderSizeRow(size = '', quantity = '') {
  const row = document.createElement('div');
  row.className = 'sizes-editor__row';
  row.innerHTML = `
    <select class="form-input form-select size-field">${sizeSelectHtml(size)}</select>
    <input class="form-input form-input--qty qty-field" type="number" min="0" value="${quantity}" placeholder="Qtd">
    <button type="button" class="btn btn--ghost btn--sm btn-remove-size" title="Remover">&times;</button>
  `;
  row.querySelector('.size-field')?.addEventListener('change', updateSizesTotal);
  row.querySelector('.qty-field')?.addEventListener('input', updateSizesTotal);
  row.querySelector('.btn-remove-size')?.addEventListener('click', () => {
    row.remove();
    updateSizesTotal();
    if (!sizesRows.children.length) addSizeRow();
  });
  return row;
}

function addSizeRow(size = '', quantity = '') {
  sizesRows.appendChild(renderSizeRow(size, quantity));
  updateSizesTotal();
}

function clearSizeRows() {
  sizesRows.innerHTML = '';
}

function setSizeRows(sizes) {
  clearSizeRows();
  if (sizes?.length) {
    sizes.forEach((s) => addSizeRow(s.size, s.quantity));
  } else {
    addSizeRow();
    addSizeRow();
  }
}

function collectSizesFromRows() {
  return [...sizesRows.querySelectorAll('.sizes-editor__row')].map((row) => ({
    size: row.querySelector('.size-field')?.value || '',
    quantity: row.querySelector('.qty-field')?.value || 0,
    reserved: 0,
  })).filter((s) => s.size || s.quantity);
}

function updateSizesTotal() {
  const sizes = collectSizesFromRows().filter((s) => s.size);
  const total = sizes.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
  const summary = sizes.map((s) => `${s.quantity} ${s.size}`).join(', ');
  sizesTotal.textContent = summary
    ? `Total: ${total} peças (${summary})`
    : `Total: ${total} peças`;
  updateImportCostPreview();
}

function updateImportCostPreview() {
  const preview = qs('#import-cost-preview');
  if (!preview) return;

  const sizes = collectSizesFromRows().filter((s) => s.size);
  const costPrice = qs('#field-costPrice')?.value;
  const importTaxes = qs('#field-importTaxes')?.value;
  const total = totalQuantity(sizes);
  const taxPerUnit = importTaxPerUnit(importTaxes, sizes);
  const finalCost = unitCostWithImportTax(costPrice, importTaxes, sizes);

  if (!total) {
    preview.textContent = 'Informe os tamanhos/quantidades para calcular o imposto por peça.';
    return;
  }

  if (!importTaxes || Number(importTaxes) <= 0) {
    preview.textContent = `Custo por peça: ${formatCurrency(costPrice || 0)} (sem impostos informados)`;
    return;
  }

  preview.textContent =
    `Imposto por peça: ${formatCurrency(taxPerUnit)} (${formatCurrency(importTaxes)} ÷ ${total} peças) → ` +
    `Custo final por peça: ${formatCurrency(finalCost)}`;
}

function formatCostCell(product) {
  const sizes = product.sizes || [];
  const finalCost = unitCostWithImportTax(product.costPrice, product.importTaxes, sizes);
  const taxPerUnit = importTaxPerUnit(product.importTaxes, sizes);

  if (!product.importTaxes || Number(product.importTaxes) <= 0) {
    return formatCurrency(product.costPrice);
  }

  return `
    <strong>${formatCurrency(finalCost)}</strong>
    <br><span class="text-xs text-muted">base ${formatCurrency(product.costPrice)} + imp. ${formatCurrency(taxPerUnit)}</span>
  `;
}

function formatSizesBadges(sizes) {
  if (!sizes?.length) return '<span class="text-muted">—</span>';
  return `<div class="sizes-badges">${sizes.map((s) => {
    const avail = availableQty(s);
    const low = avail <= lowStockThreshold;
    const reserved = Number(s.reserved) || 0;
    const label = reserved > 0 ? `${s.size}: ${avail}/${s.quantity}` : `${s.size}: ${s.quantity}`;
    return `<span class="badge ${low ? 'badge--warning' : 'badge--neutral'}">${label}</span>`;
  }).join('')}</div>`;
}

function productHasLowStock(product) {
  return (product.sizes || []).some((s) => availableQty(s) <= lowStockThreshold);
}

function getFormData() {
  return {
    name: qs('#field-name').value.trim(),
    sizes: collectSizesFromRows(),
    supplier: qs('#field-supplier').value.trim(),
    stockOrigin: qs('#field-stockOrigin').value,
    investorId: qs('#field-investorId').value.trim(),
    costPrice: qs('#field-costPrice').value,
    importTaxes: qs('#field-importTaxes').value || 0,
    importTaxesPaidAt: qs('#field-importTaxesPaidAt').value || '',
    suggestedSalePrice: qs('#field-suggestedSalePrice').value,
    minimumSalePrice: qs('#field-minimumSalePrice').value,
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

function toggleInvestorField() {
  const isInvestor = stockOriginField.value === 'investidor';
  investorGroup.style.display = isInvestor ? '' : 'none';
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

function getFilterValues() {
  return {
    search: searchInput.value.trim().toLowerCase(),
    size: qs('#filter-size').value,
    origin: qs('#filter-origin').value,
    investor: qs('#filter-investor').value,
    status: qs('#filter-status').value,
  };
}

function productHasSize(product, size) {
  return (product.sizes || []).some((s) => s.size === size);
}

function filterProducts(products) {
  const f = getFilterValues();

  return products.filter((p) => {
    if (f.size && !productHasSize(p, f.size)) return false;
    if (f.origin && p.stockOrigin !== f.origin) return false;
    if (f.investor && p.investorId !== f.investor) return false;
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

  const fieldSelect = qs('#field-investorId');
  if (fieldSelect) {
    const current = fieldSelect.value;
    fieldSelect.innerHTML = `<option value="">Selecione</option>${options}`;
    fieldSelect.value = current;
  }

  ['#filter-investor', '#hist-filter-investor'].forEach((sel) => {
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

function renderTable(products) {
  const filtered = filterProducts(products);

  productsCount.textContent = filtered.length === allProducts.length
    ? `${allProducts.length} produto(s)`
    : `${filtered.length} de ${allProducts.length} produto(s)`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table__empty">Nenhum produto encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((p) => `
    <tr data-id="${p.id}" class="${productHasLowStock(p) ? 'table__row--low-stock' : ''}">
      <td><strong>${p.name}</strong></td>
      <td>${formatSizesBadges(p.sizes)}</td>
      <td>${p.quantity ?? 0}</td>
      <td>${formatCostCell(p)}</td>
      <td>${formatCurrency(p.suggestedSalePrice)}</td>
      <td>${getOriginBadge(p.stockOrigin)}</td>
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

async function loadProducts() {
  productsCount.textContent = 'Carregando produtos...';
  const result = await listProducts();

  if (!result.success) {
    productsCount.textContent = 'Erro ao carregar produtos.';
    showToast(result.error, 'error');
    return;
  }

  allProducts = result.data;
  renderTable(allProducts);
  refreshStockUI();
}

function resetForm() {
  productForm.reset();
  editingId = null;
  formErrors.classList.remove('form-errors--visible');
  qs('#sizes-quick-input').value = '';
  qs('#product-modal-title').textContent = 'Novo produto';
  setSizeRows([]);
  toggleInvestorField();
  updateImportCostPreview();
}

function fillForm(product) {
  qs('#field-name').value = product.name || '';
  qs('#field-status').value = product.status || 'ativo';
  qs('#field-supplier').value = product.supplier || '';
  qs('#field-stockOrigin').value = product.stockOrigin || 'proprio';
  qs('#field-investorId').value = product.investorId || '';
  qs('#field-costPrice').value = product.costPrice ?? '';
  qs('#field-importTaxes').value = product.importTaxes ?? '';
  qs('#field-importTaxesPaidAt').value = product.importTaxesPaidAt || '';
  qs('#field-suggestedSalePrice').value = product.suggestedSalePrice ?? '';
  qs('#field-minimumSalePrice').value = product.minimumSalePrice ?? '';
  qs('#field-notes').value = product.notes || '';
  setSizeRows(product.sizes || []);
  toggleInvestorField();
  updateImportCostPreview();
}

function applyQuickSizes() {
  const text = qs('#sizes-quick-input').value;
  const parsed = parseSizesQuickInput(text);

  if (!parsed.length) {
    showToast('Formato inválido. Use: 10 M, 30 G, 5 GG', 'warning');
    return;
  }

  setSizeRows(parsed);
  showToast(`${parsed.length} tamanho(s) aplicado(s)!`, 'success');
}

function openCreateModal() {
  resetForm();
  openModal('product-modal');
}

async function openEditModal(id) {
  const result = await getProductById(id);
  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  editingId = id;
  qs('#product-modal-title').textContent = 'Editar produto';
  fillForm(result.data);
  openModal('product-modal');
}

async function openViewModal(id) {
  const result = await getProductById(id);
  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  const p = result.data;
  viewingId = id;

  const sizesText = (p.sizes || []).map((s) => `${s.quantity} ${s.size}`).join(', ') || '—';
  const taxPerUnit = importTaxPerUnit(p.importTaxes, p.sizes);
  const finalCost = unitCostWithImportTax(p.costPrice, p.importTaxes, p.sizes);

  const fields = [
    ['Nome', p.name],
    ['Tamanhos', sizesText],
    ['Quantidade total', p.quantity ?? 0],
    ['Fornecedor', p.supplier],
    ['Origem', p.stockOrigin === 'investidor' ? 'Investidor' : 'Próprio'],
    ['Investidor', p.stockOrigin === 'investidor' ? getInvestorName(p.investorId) : '—'],
    ['Custo por peça (base)', formatCurrency(p.costPrice)],
    ['Impostos importação (total)', p.importTaxes ? formatCurrency(p.importTaxes) : '—'],
    ['Imposto por peça', p.importTaxes ? formatCurrency(taxPerUnit) : '—'],
    ['Custo final por peça', formatCurrency(finalCost)],
    ['Data pag. impostos', p.importTaxesPaidAt || '—'],
    ['Preço sugerido', formatCurrency(p.suggestedSalePrice)],
    ['Preço mínimo', formatCurrency(p.minimumSalePrice)],
    ['Status', p.status],
    ['Observações', p.notes || '—'],
  ];

  qs('#view-modal-body').innerHTML = `
    <div class="product-view__fields">
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
  qs('#delete-product-name').textContent = name;
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

  const result = editingId
    ? await updateProduct(editingId, data)
    : await createProduct(data);

  setLoading(saveBtn, false);

  if (result.success) {
    showToast(editingId ? 'Produto atualizado!' : 'Produto criado!', 'success');
    closeModal('product-modal');
    await loadProducts();
  } else {
    showToast(result.error, 'error');
  }
}

async function handleDelete() {
  if (!deletingId) return;

  const btn = qs('#btn-confirm-delete');
  setLoading(btn, true);
  const result = await deleteProduct(deletingId);
  setLoading(btn, false);

  if (result.success) {
    showToast('Produto excluído.', 'success');
    closeModal('delete-modal');
    deletingId = null;
    await loadProducts();
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
  qs('#tab-products').hidden = tab !== 'products';
  qs('#tab-stock').hidden = tab !== 'stock';
}

function populateMovementProductSelect() {
  const select = qs('#mov-product');
  const histSelect = qs('#hist-filter-product');
  const current = select.value;
  const histCurrent = histSelect.value;

  const options = allProducts.map((p) =>
    `<option value="${p.id}">${p.name}</option>`
  ).join('');

  select.innerHTML = `<option value="">Selecione</option>${options}`;
  histSelect.innerHTML = `<option value="">Todos</option>${options}`;
  select.value = current;
  histSelect.value = histCurrent;
  updateMovementSizeSelect();
}

function updateMovementSizeSelect() {
  const productId = qs('#mov-product').value;
  const sizeSelect = qs('#mov-size');
  const product = allProducts.find((p) => p.id === productId);

  if (!product) {
    sizeSelect.innerHTML = '<option value="">Selecione o produto</option>';
    return;
  }

  const sizes = product.sizes || [];
  sizeSelect.innerHTML = sizes.length
    ? sizes.map((s) => {
      const avail = availableQty(s);
      return `<option value="${s.size}">${s.size} (disp: ${avail})</option>`;
    }).join('')
    : '<option value="">Sem tamanhos — use Entrada</option>';
}

function toggleMovementTypeFields() {
  const isAdjust = qs('#mov-type').value === 'ajuste';
  qs('#mov-qty-group').hidden = isAdjust;
  qs('#mov-adjust-group').hidden = !isAdjust;
}

function renderStockSummary() {
  const summary = getStockSummary(allProducts);
  qs('#summary-proprio-pieces').textContent = `${summary.proprio.pieces} peças`;
  qs('#summary-proprio-products').textContent = `${summary.proprio.products} produto(s)`;
  qs('#summary-investidor-pieces').textContent = `${summary.investidor.pieces} peças`;
  qs('#summary-investidor-products').textContent = `${summary.investidor.products} produto(s)`;
}

function renderLowStockAlerts() {
  const items = getLowStockItems(allProducts, lowStockThreshold);
  const container = qs('#low-stock-list');

  if (!items.length) {
    container.innerHTML = '<p class="text-muted text-sm">Nenhum alerta no momento.</p>';
    return;
  }

  container.innerHTML = items.map((item) => `
    <div class="stock-alerts__item">
      <span><strong>${item.productName}</strong> — ${item.size}: ${item.available} disp.</span>
      <span class="badge ${item.stockOrigin === 'investidor' ? 'badge--info' : 'badge--neutral'}">
        ${item.stockOrigin === 'investidor' ? 'Investidor' : 'Próprio'}
      </span>
    </div>
  `).join('');
}

function getHistoryFilters() {
  return {
    productId: qs('#hist-filter-product').value,
    type: qs('#hist-filter-type').value,
    size: qs('#hist-filter-size').value,
    origin: qs('#hist-filter-origin').value,
    investor: qs('#hist-filter-investor').value,
  };
}

function filterMovements(movements) {
  const f = getHistoryFilters();
  return movements.filter((m) => {
    if (f.productId && m.productId !== f.productId) return false;
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
      <td class="text-sm">${m.observation || '—'}</td>
    </tr>
  `).join('');
}

async function loadMovements() {
  qs('#movements-count').textContent = 'Carregando histórico...';
  const result = await getMovementHistory();

  if (!result.success) {
    qs('#movements-count').textContent = 'Erro ao carregar histórico.';
    showToast(result.error, 'error');
    return;
  }

  allMovements = result.data;
  renderMovementsTable();
}

function refreshStockUI() {
  populateMovementProductSelect();
  renderStockSummary();
  renderLowStockAlerts();
  renderTable(allProducts);
}

async function handleMovementSubmit(e) {
  e.preventDefault();

  const type = qs('#mov-type').value;
  const payload = {
    productId: qs('#mov-product').value,
    size: qs('#mov-size').value,
    type,
    quantity: qs('#mov-quantity').value,
    adjustTo: qs('#mov-adjust').value,
    observation: qs('#mov-observation').value.trim(),
  };

  const btn = qs('#btn-register-movement');
  setLoading(btn, true);

  const result = await registerMovement(payload);

  setLoading(btn, false);

  if (result.success) {
    showToast('Movimentação registrada!', 'success');
    qs('#mov-observation').value = '';
    await loadProducts();
    await loadMovements();
  } else {
    showToast(result.error, 'error');
  }
}

function initStockEvents() {
  qsa('.inventory-tabs__btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  qs('#mov-product')?.addEventListener('change', updateMovementSizeSelect);
  qs('#mov-type')?.addEventListener('change', toggleMovementTypeFields);
  qs('#movement-form')?.addEventListener('submit', handleMovementSubmit);

  ['#hist-filter-product', '#hist-filter-type', '#hist-filter-size', '#hist-filter-origin', '#hist-filter-investor'].forEach((sel) => {
    qs(sel)?.addEventListener('change', renderMovementsTable);
  });

  qs('#btn-clear-hist-filters')?.addEventListener('click', () => {
    qs('#hist-filter-product').value = '';
    qs('#hist-filter-type').value = '';
    qs('#hist-filter-size').value = '';
    qs('#hist-filter-origin').value = '';
    qs('#hist-filter-investor').value = '';
    renderMovementsTable();
  });

  toggleMovementTypeFields();
}

function initEvents() {
  setupModalClose('product-modal');
  setupModalClose('view-modal');
  setupModalClose('delete-modal');

  qs('#btn-new-product')?.addEventListener('click', openCreateModal);
  qs('#btn-add-size')?.addEventListener('click', () => addSizeRow());
  qs('#btn-parse-sizes')?.addEventListener('click', applyQuickSizes);
  qs('#sizes-quick-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyQuickSizes();
    }
  });

  productForm?.addEventListener('submit', handleSave);
  stockOriginField?.addEventListener('change', toggleInvestorField);
  qs('#field-costPrice')?.addEventListener('input', updateImportCostPreview);
  qs('#field-importTaxes')?.addEventListener('input', updateImportCostPreview);
  searchInput?.addEventListener('input', () => renderTable(allProducts));

  ['#filter-size', '#filter-origin', '#filter-investor', '#filter-status'].forEach((sel) => {
    qs(sel)?.addEventListener('change', () => renderTable(allProducts));
  });

  qs('#btn-clear-filters')?.addEventListener('click', () => {
    searchInput.value = '';
    qs('#filter-size').value = '';
    qs('#filter-origin').value = '';
    qs('#filter-investor').value = '';
    qs('#filter-status').value = '';
    renderTable(allProducts);
  });

  tbody?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const product = allProducts.find((p) => p.id === btn.dataset.id);
    if (!product) return;

    if (btn.dataset.action === 'view') openViewModal(btn.dataset.id);
    if (btn.dataset.action === 'edit') openEditModal(btn.dataset.id);
    if (btn.dataset.action === 'delete') openDeleteModal(btn.dataset.id, product.name);
  });

  qs('#btn-edit-from-view')?.addEventListener('click', () => {
    if (viewingId) {
      closeModal('view-modal');
      openEditModal(viewingId);
    }
  });

  qs('#btn-confirm-delete')?.addEventListener('click', handleDelete);
}

async function init() {
  initEvents();
  initStockEvents();
  await waitForAuth();
  lowStockThreshold = await getLowStockThreshold();
  await loadInvestorsForSelect();
  await loadProducts();
  await loadMovements();
}

init();
