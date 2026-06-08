import { listProducts } from '../services/productService.js';
import { listInvestors } from '../services/investorService.js';
import { listSales, createSale } from '../services/salesService.js';
import { waitForAuth } from '../services/authService.js';
import {
  availableQty,
  unitCostWithImportTax,
  calculateSaleFinancials,
  calculateInvestorRepasse,
  calculateTicketMedio,
} from '../utils/calculations.js';
import { validateSale } from '../utils/validators.js';
import { formatCurrency, formatPercent } from '../utils/formatCurrency.js';
import {
  qs,
  showToast,
  openModal,
  closeModal,
  setupModalClose,
  setLoading,
} from '../utils/domHelpers.js';

const CHANNEL_LABELS = {
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  presencial: 'Presencial',
  site: 'Site',
  outro: 'Outro',
};

const PAYMENT_LABELS = {
  pix: 'PIX',
  cartao: 'Cartão',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
  outro: 'Outro',
};

let allProducts = [];
let allInvestors = [];
let allSales = [];

const saleForm = qs('#sale-form');
const formErrors = qs('#form-errors');
const tbody = qs('#sales-tbody');

function formatDate(timestamp) {
  if (!timestamp?.seconds) return '—';
  return new Date(timestamp.seconds * 1000).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInvestorName(id) {
  return allInvestors.find((i) => i.id === id)?.name || '—';
}

function getSelectedProduct() {
  const id = qs('#field-product').value;
  return allProducts.find((p) => p.id === id) || null;
}

function getSaleInput() {
  const product = getSelectedProduct();
  const unitCost = product
    ? unitCostWithImportTax(product.costPrice, product.importTaxes, product.sizes)
    : 0;

  return {
    orderId: qs('#field-orderId').value.trim(),
    customer: qs('#field-customer').value,
    productId: qs('#field-product').value,
    size: qs('#field-size').value,
    quantity: qs('#field-quantity').value,
    unitPrice: qs('#field-unitPrice').value,
    unitCost,
    discount: qs('#field-discount').value,
    fees: qs('#field-fees').value,
    trafficCost: qs('#field-trafficCost').value,
    channel: qs('#field-channel').value,
    paymentMethod: qs('#field-payment').value,
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

function populateProductSelect() {
  const select = qs('#field-product');
  const current = select.value;
  const options = allProducts
    .filter((p) => p.status !== 'inativo')
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');
  select.innerHTML = `<option value="">Selecione</option>${options}`;
  select.value = current;
  updateSizeSelect();
}

function updateSizeSelect() {
  const product = getSelectedProduct();
  const sizeSelect = qs('#field-size');
  const infoEl = qs('#product-info');

  if (!product) {
    sizeSelect.innerHTML = '<option value="">Selecione o produto</option>';
    infoEl.textContent = '';
    updateFinancePreview();
    return;
  }

  const sizes = product.sizes || [];
  sizeSelect.innerHTML = sizes.length
    ? sizes.map((s) => {
      const avail = availableQty(s);
      return `<option value="${s.size}">${s.size} (disp: ${avail})</option>`;
    }).join('')
    : '<option value="">Sem estoque</option>';

  const unitCost = unitCostWithImportTax(
    product.costPrice,
    product.importTaxes,
    product.sizes
  );

  const origin = product.stockOrigin === 'investidor'
    ? `Investidor: ${getInvestorName(product.investorId)}`
    : 'Estoque próprio';

  infoEl.innerHTML = `
    <strong>${origin}</strong> ·
    Custo/peça: ${formatCurrency(unitCost)} ·
    Mínimo: ${formatCurrency(product.minimumSalePrice)} ·
    Sugerido: ${formatCurrency(product.suggestedSalePrice)}
  `;

  if (!qs('#field-unitPrice').value && product.suggestedSalePrice) {
    qs('#field-unitPrice').value = product.suggestedSalePrice;
  }

  updateFinancePreview();
}

function getPreviewFinancials() {
  const input = getSaleInput();
  const product = getSelectedProduct();
  if (!product || !input.size) return null;

  const sizeEntry = (product.sizes || []).find((s) => s.size === input.size);
  const stockAvailable = sizeEntry ? availableQty(sizeEntry) : 0;

  const financials = calculateSaleFinancials({
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    unitCost: input.unitCost,
    discount: input.discount,
    fees: input.fees,
    trafficCost: input.trafficCost,
  });

  let investorPayout = 0;
  if (product.stockOrigin === 'investidor' && product.investorId) {
    const investor = allInvestors.find((i) => i.id === product.investorId);
    if (investor) {
      investorPayout = calculateInvestorRepasse(investor, {
        unitCost: input.unitCost,
        quantity: input.quantity,
        netProfit: financials.netProfit,
        grossRevenue: financials.totalRevenue,
      });
    }
  }

  return { financials, investorPayout, stockAvailable, product };
}

function updateFinancePreview() {
  const preview = qs('#finance-preview');
  const data = getPreviewFinancials();

  if (!data) {
    preview.innerHTML = '<p class="text-muted">Selecione produto e tamanho para ver o resumo.</p>';
    return;
  }

  const { financials, investorPayout, stockAvailable } = data;
  const profitClass = financials.netProfit >= 0
    ? 'sales-finance-preview__value--profit'
    : 'sales-finance-preview__value--loss';

  preview.innerHTML = `
    <div class="sales-finance-preview__row">
      <span class="sales-finance-preview__label">Estoque disponível</span>
      <span>${stockAvailable} peça(s)</span>
    </div>
    <div class="sales-finance-preview__row">
      <span class="sales-finance-preview__label">Faturamento bruto</span>
      <span>${formatCurrency(financials.grossRevenue)}</span>
    </div>
    <div class="sales-finance-preview__row">
      <span class="sales-finance-preview__label">Faturamento total</span>
      <span>${formatCurrency(financials.totalRevenue)}</span>
    </div>
    <div class="sales-finance-preview__row">
      <span class="sales-finance-preview__label">Custo produtos</span>
      <span>${formatCurrency(financials.productCost)}</span>
    </div>
    <div class="sales-finance-preview__row">
      <span class="sales-finance-preview__label">Custos variáveis</span>
      <span>${formatCurrency(financials.variableCosts)}</span>
    </div>
    <div class="sales-finance-preview__row">
      <span class="sales-finance-preview__label">Lucro bruto</span>
      <span>${formatCurrency(financials.grossProfit)}</span>
    </div>
    <div class="sales-finance-preview__row sales-finance-preview__row--highlight">
      <span class="sales-finance-preview__label">Lucro líquido</span>
      <span class="${profitClass}">${formatCurrency(financials.netProfit)} (${formatPercent(financials.margin)})</span>
    </div>
    ${investorPayout > 0 ? `
    <div class="sales-finance-preview__row sales-finance-preview__row--highlight">
      <span class="sales-finance-preview__label">Repasse investidor</span>
      <span>${formatCurrency(investorPayout)}</span>
    </div>
    <div class="sales-finance-preview__row">
      <span class="sales-finance-preview__label">Seu lucro após repasse</span>
      <span>${formatCurrency(financials.netProfit - investorPayout)}</span>
    </div>` : ''}
    ${financials.roi != null ? `
    <div class="sales-finance-preview__row">
      <span class="sales-finance-preview__label">ROI (tráfego)</span>
      <span>${formatPercent(financials.roi)}</span>
    </div>` : ''}
  `;
}

function renderSummary() {
  const completed = allSales.filter((s) => s.status !== 'cancelada');
  const revenue = completed.reduce((sum, s) => sum + (Number(s.totalRevenue) || 0), 0);
  const profit = completed.reduce((sum, s) => sum + (Number(s.netProfit) || 0), 0);

  qs('#summary-orders').textContent = String(completed.length);
  qs('#summary-revenue').textContent = formatCurrency(revenue);
  qs('#summary-profit').textContent = formatCurrency(profit);
  qs('#summary-ticket').textContent = formatCurrency(calculateTicketMedio(allSales));
}

function filterSales() {
  const search = qs('#search-input').value.trim().toLowerCase();
  const channel = qs('#filter-channel').value;

  return allSales.filter((s) => {
    if (channel && s.channel !== channel) return false;
    if (!search) return true;
    const haystack = [s.orderId, s.productName, s.customer, s.size]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(search);
  });
}

function renderSalesTable() {
  const filtered = filterSales();
  const countEl = qs('#sales-count');

  countEl.textContent = filtered.length === allSales.length
    ? `${allSales.length} venda(s)`
    : `${filtered.length} de ${allSales.length} venda(s)`;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="table__empty">Nenhuma venda registrada.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((s) => `
    <tr>
      <td><strong>${s.orderId}</strong></td>
      <td>${s.productName} <span class="text-muted text-sm">${s.size}</span></td>
      <td>${s.quantity}</td>
      <td>${formatCurrency(s.totalRevenue)}</td>
      <td class="${s.netProfit >= 0 ? '' : 'text-muted'}">${formatCurrency(s.netProfit)}</td>
      <td>${s.investorPayout > 0 ? formatCurrency(s.investorPayout) : '—'}</td>
      <td class="text-sm">${formatDate(s.createdAt)}</td>
      <td>
        <button type="button" class="btn btn--ghost btn--sm" data-action="view" data-id="${s.id}">Ver</button>
      </td>
    </tr>
  `).join('');
}

function openViewModal(sale) {
  qs('#view-modal-title').textContent = `Pedido ${sale.orderId}`;
  qs('#view-modal-body').innerHTML = `
    <dl class="sale-view__grid">
      <div class="sale-view__field">
        <dt>Produto</dt>
        <dd>${sale.productName} — ${sale.size}</dd>
      </div>
      <div class="sale-view__field">
        <dt>Quantidade</dt>
        <dd>${sale.quantity}</dd>
      </div>
      <div class="sale-view__field">
        <dt>Cliente</dt>
        <dd>${sale.customer || '—'}</dd>
      </div>
      <div class="sale-view__field">
        <dt>Canal / Pagamento</dt>
        <dd>${CHANNEL_LABELS[sale.channel] || sale.channel} · ${PAYMENT_LABELS[sale.paymentMethod] || sale.paymentMethod}</dd>
      </div>
      <div class="sale-view__field">
        <dt>Origem</dt>
        <dd>${sale.stockOrigin === 'investidor' ? `Investidor (${getInvestorName(sale.investorId)})` : 'Próprio'}</dd>
      </div>
      <div class="sale-view__field">
        <dt>Preço unitário</dt>
        <dd>${formatCurrency(sale.unitPrice)}</dd>
      </div>
      <div class="sale-view__field">
        <dt>Custo unitário</dt>
        <dd>${formatCurrency(sale.unitCost)}</dd>
      </div>
      <div class="sale-view__field">
        <dt>Desconto / Taxas</dt>
        <dd>${formatCurrency(sale.discount)} / ${formatCurrency(sale.fees)}</dd>
      </div>
      <div class="sale-view__field">
        <dt>Faturamento bruto</dt>
        <dd>${formatCurrency(sale.grossRevenue)}</dd>
      </div>
      <div class="sale-view__field">
        <dt>Faturamento total</dt>
        <dd>${formatCurrency(sale.totalRevenue)}</dd>
      </div>
      <div class="sale-view__field">
        <dt>Lucro bruto</dt>
        <dd>${formatCurrency(sale.grossProfit)}</dd>
      </div>
      <div class="sale-view__field">
        <dt>Lucro líquido</dt>
        <dd>${formatCurrency(sale.netProfit)} (${formatPercent(sale.margin)})</dd>
      </div>
      <div class="sale-view__field">
        <dt>Repasse investidor</dt>
        <dd>${sale.investorPayout > 0 ? formatCurrency(sale.investorPayout) : '—'}</dd>
      </div>
      ${sale.roi != null ? `
      <div class="sale-view__field">
        <dt>ROI</dt>
        <dd>${formatPercent(sale.roi)}</dd>
      </div>` : ''}
      <div class="sale-view__field">
        <dt>Registrado em</dt>
        <dd>${formatDate(sale.createdAt)}</dd>
      </div>
    </dl>
  `;
  openModal('view-modal');
}

async function loadData() {
  qs('#sales-count').textContent = 'Carregando vendas...';

  const [prodResult, invResult, salesResult] = await Promise.all([
    listProducts(),
    listInvestors(),
    listSales(),
  ]);

  allProducts = prodResult.success ? prodResult.data : [];
  allInvestors = invResult.success ? invResult.data : [];

  if (!salesResult.success) {
    qs('#sales-count').textContent = 'Erro ao carregar vendas.';
    showToast(salesResult.error, 'error');
    return;
  }

  allSales = salesResult.data;
  populateProductSelect();
  renderSummary();
  renderSalesTable();
}

function resetForm() {
  saleForm.reset();
  qs('#field-quantity').value = '1';
  qs('#field-discount').value = '0';
  qs('#field-fees').value = '0';
  qs('#field-trafficCost').value = '0';
  formErrors.classList.remove('form-errors--visible');
  updateSizeSelect();
}

async function handleSubmit(e) {
  e.preventDefault();
  const input = getSaleInput();
  const preview = getPreviewFinancials();

  const validation = validateSale(input, {
    product: preview?.product,
    availableQty: preview?.stockAvailable,
    orderIdExists: false,
    financials: preview?.financials,
  });

  showFormErrors(validation.errors);
  if (!validation.valid) return;

  const btn = qs('#btn-save-sale');
  setLoading(btn, true);

  const result = await createSale(input);
  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    if (result.error.includes('pedido')) {
      showFormErrors([result.error]);
    }
    return;
  }

  showToast('Venda registrada! Estoque atualizado.', 'success');
  resetForm();
  await loadData();
}

function initEvents() {
  setupModalClose('view-modal');

  saleForm?.addEventListener('submit', handleSubmit);
  qs('#field-product')?.addEventListener('change', updateSizeSelect);
  qs('#field-size')?.addEventListener('change', updateFinancePreview);

  [
    '#field-quantity',
    '#field-unitPrice',
    '#field-discount',
    '#field-fees',
    '#field-trafficCost',
  ].forEach((sel) => {
    qs(sel)?.addEventListener('input', updateFinancePreview);
  });

  qs('#search-input')?.addEventListener('input', renderSalesTable);
  qs('#filter-channel')?.addEventListener('change', renderSalesTable);

  tbody?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="view"]');
    if (!btn) return;
    const sale = allSales.find((s) => s.id === btn.dataset.id);
    if (sale) openViewModal(sale);
  });
}

async function init() {
  initEvents();
  await waitForAuth();
  await loadData();
}

init();
