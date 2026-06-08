import { waitForAuth } from '../services/authService.js';
import { listProducts } from '../services/productService.js';
import { listSales } from '../services/salesService.js';
import { listInvestors } from '../services/investorService.js';
import {
  getGlobalSettings,
  saveGlobalSettings,
} from '../services/settingsService.js';
import {
  REPORT_TYPES,
  buildReport,
  exportToCsv,
  saveReportSnapshot,
} from '../services/reportService.js';
import {
  listExpenses,
  createExpense,
  deleteExpense,
} from '../services/expenseService.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { qs, qsa, showToast, setLoading } from '../utils/domHelpers.js';

let allProducts = [];
let allSales = [];
let allInvestors = [];
let currentReport = null;
let globalSettings = {};

function switchTab(tab) {
  qsa('.reports-tabs__btn').forEach((btn) => {
    btn.classList.toggle('reports-tabs__btn--active', btn.dataset.tab === tab);
  });
  qs('#tab-reports').hidden = tab !== 'reports';
  qs('#tab-settings').hidden = tab !== 'settings';
  qs('#tab-expenses').hidden = tab !== 'expenses';
}

function populateSelects() {
  const typeSelect = qs('#report-type');
  typeSelect.innerHTML = REPORT_TYPES.map(
    (t) => `<option value="${t.id}">${t.label}</option>`
  ).join('');

  const productSelect = qs('#filter-product');
  productSelect.innerHTML = '<option value="">Todos</option>' + allProducts.map(
    (p) => `<option value="${p.id}">${p.name}</option>`
  ).join('');

  const investorSelect = qs('#filter-investor');
  investorSelect.innerHTML = '<option value="">Todos</option>' + allInvestors.map(
    (i) => `<option value="${i.id}">${i.name}</option>`
  ).join('');

  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  qs('#filter-date-from').value = firstDay.toISOString().slice(0, 10);
  qs('#filter-date-to').value = today.toISOString().slice(0, 10);
  qs('#exp-date').value = today.toISOString().slice(0, 10);
}

function getFilters() {
  return {
    dateFrom: qs('#filter-date-from')?.value || '',
    dateTo: qs('#filter-date-to')?.value || '',
    productId: qs('#filter-product')?.value || '',
    investorId: qs('#filter-investor')?.value || '',
    stockOrigin: qs('#filter-origin')?.value || '',
    status: qs('#filter-status')?.value || '',
  };
}

function renderReportTable(report) {
  const thead = qs('#report-thead');
  const tbody = qs('#report-tbody');

  if (!report.rows.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="8" class="table__empty">Nenhum registro encontrado.</td></tr>';
    return;
  }

  thead.innerHTML = `<tr>${report.columns.map((c) => `<th>${c.label}</th>`).join('')}</tr>`;
  tbody.innerHTML = report.rows.map((row) => `
    <tr>${report.columns.map((c) => `<td>${row[c.key] ?? '—'}</td>`).join('')}</tr>
  `).join('');
}

async function handleGenerate(e) {
  e.preventDefault();
  const btn = qs('#btn-generate');
  setLoading(btn, true);

  const type = qs('#report-type').value;
  const filters = getFilters();
  const result = buildReport(type, filters, {
    products: allProducts,
    sales: allSales,
    investors: allInvestors,
  });

  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  currentReport = result.data;
  renderReportTable(currentReport);
  qs('#report-meta').textContent = `${REPORT_TYPES.find((t) => t.id === type)?.label || type} · ${currentReport.rows.length} registro(s)`;
  qs('#btn-export').disabled = !currentReport.rows.length;

  await saveReportSnapshot(currentReport, filters);
}

function handleExport() {
  if (!currentReport?.rows?.length) {
    showToast('Gere um relatório antes de exportar.', 'error');
    return;
  }
  const filename = `shir7-${currentReport.type}-${new Date().toISOString().slice(0, 10)}.csv`;
  const result = exportToCsv(currentReport, filename);
  if (result.success) {
    showToast('CSV exportado!', 'success');
  } else {
    showToast(result.error, 'error');
  }
}

function fillSettingsForm() {
  qs('#cfg-low-stock').value = globalSettings.lowStockThreshold ?? 5;
  qs('#cfg-min-margin').value = globalSettings.minMarginPercent ?? 10;
  qs('#cfg-default-fees').value = globalSettings.defaultFees ?? 0;
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const btn = qs('#settings-form button[type="submit"]');
  setLoading(btn, true);

  const result = await saveGlobalSettings({
    ...globalSettings,
    lowStockThreshold: Number(qs('#cfg-low-stock').value) || 5,
    minMarginPercent: Number(qs('#cfg-min-margin').value) || 10,
    defaultFees: Number(qs('#cfg-default-fees').value) || 0,
  });

  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  globalSettings = result.data;
  showToast('Configurações salvas!', 'success');
}

function formatExpenseDate(exp) {
  if (exp.date) return new Date(`${exp.date}T12:00:00`).toLocaleDateString('pt-BR');
  if (exp.createdAt?.seconds) {
    return new Date(exp.createdAt.seconds * 1000).toLocaleDateString('pt-BR');
  }
  return '—';
}

function renderExpenses(expenses) {
  qs('#expenses-count').textContent = `${expenses.length} despesa(s)`;
  const list = qs('#expenses-list');

  if (!expenses.length) {
    list.innerHTML = '<p class="text-sm text-muted">Nenhuma despesa registrada.</p>';
    return;
  }

  list.innerHTML = expenses.map((exp) => `
    <div class="expenses-list__item">
      <div class="expenses-list__info">
        <p class="expenses-list__desc">${exp.description}</p>
        <p class="expenses-list__meta">${formatExpenseDate(exp)} · ${exp.category}</p>
      </div>
      <div class="expenses-list__actions">
        <span class="expenses-list__amount">${formatCurrency(exp.amount)}</span>
        <button type="button" class="btn btn--ghost btn--sm btn-delete-expense" data-id="${exp.id}" title="Excluir">&times;</button>
      </div>
    </div>
  `).join('');
}

async function loadExpenses() {
  const result = await listExpenses();
  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }
  renderExpenses(result.data);
}

async function handleExpenseSubmit(e) {
  e.preventDefault();
  const btn = qs('#expense-form button[type="submit"]');
  setLoading(btn, true);

  const result = await createExpense({
    description: qs('#exp-description').value,
    amount: qs('#exp-amount').value,
    category: qs('#exp-category').value,
    date: qs('#exp-date').value,
  });

  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  qs('#expense-form').reset();
  qs('#exp-date').value = new Date().toISOString().slice(0, 10);
  showToast('Despesa registrada!', 'success');
  await loadExpenses();
}

function initEvents() {
  qsa('.reports-tabs__btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  qs('#report-form')?.addEventListener('submit', handleGenerate);
  qs('#btn-export')?.addEventListener('click', handleExport);
  qs('#settings-form')?.addEventListener('submit', handleSettingsSubmit);
  qs('#expense-form')?.addEventListener('submit', handleExpenseSubmit);

  qs('#expenses-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-delete-expense');
    if (!btn) return;
    const result = await deleteExpense(btn.dataset.id);
    if (result.success) {
      showToast('Despesa removida.', 'success');
      await loadExpenses();
    } else {
      showToast(result.error, 'error');
    }
  });
}

async function loadData() {
  const [productsRes, salesRes, investorsRes, settingsRes] = await Promise.all([
    listProducts(),
    listSales(),
    listInvestors(),
    getGlobalSettings(),
  ]);

  if (productsRes.success) allProducts = productsRes.data;
  if (salesRes.success) allSales = salesRes.data;
  if (investorsRes.success) allInvestors = investorsRes.data;
  if (settingsRes.success) globalSettings = settingsRes.data;

  populateSelects();
  fillSettingsForm();
  await loadExpenses();
}

async function init() {
  initEvents();
  await waitForAuth();
  await loadData();
}

init();
