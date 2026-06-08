import { waitForAuth } from '../services/authService.js';
import { listProducts } from '../services/productService.js';
import { listSales } from '../services/salesService.js';
import { listInvestors } from '../services/investorService.js';
import { getLowStockThreshold } from '../services/stockService.js';
import { askAssistant, getQuickQuestions } from '../services/aiService.js';
import {
  aggregateStock,
  aggregateMonthSales,
  monthlySeries,
  getLastNMonths,
  getLowStockList,
  getTopSellingProducts,
  getTopProfitSales,
  getLossSales,
  saleDate,
} from '../utils/analytics.js';
import { renderBarChart, renderGroupedBarChart, renderDoughnutChart } from '../utils/chartRenderer.js';
import { formatCurrency, formatPercent } from '../utils/formatCurrency.js';
import { formatSaleLinesSummary } from '../utils/calculations.js';
import { qs, showToast } from '../utils/domHelpers.js';

let dashboardData = null;

function showDashboardError(message) {
  const loading = qs('#dashboard-loading');
  if (loading) {
    loading.textContent = message;
    loading.hidden = false;
  }
  const content = qs('#dashboard-content');
  if (content) content.hidden = true;
}

function revealDashboard() {
  const loading = qs('#dashboard-loading');
  if (loading) loading.hidden = true;
  const content = qs('#dashboard-content');
  if (content) content.hidden = false;
}

function formatSaleDate(sale) {
  const d = saleDate(sale);
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function renderKpis(stock, monthStats) {
  const kpis = [
    { label: 'Produtos ativos', value: String(stock.totalProducts), hint: `${stock.totalPieces} peças no total` },
    { label: 'Valor em estoque (custo)', value: formatCurrency(stock.costValue), className: 'dashboard-kpi--warning' },
    { label: 'Potencial de venda', value: formatCurrency(stock.potentialValue) },
    { label: 'Estoque próprio', value: `${stock.proprioPieces} peças` },
    { label: 'Estoque investidor', value: `${stock.investidorPieces} peças` },
    { label: 'Faturamento do mês', value: formatCurrency(monthStats.revenue), className: 'dashboard-kpi--revenue' },
    { label: 'Lucro líquido do mês', value: formatCurrency(monthStats.profit), className: 'dashboard-kpi--profit' },
    { label: 'Margem média do mês', value: formatPercent(monthStats.avgMargin) },
    { label: 'Pedidos do mês', value: String(monthStats.count) },
    { label: 'Ticket médio do mês', value: formatCurrency(monthStats.ticket) },
  ];

  qs('#dashboard-kpis').innerHTML = kpis.map((k) => `
    <div class="dashboard-kpi ${k.className || ''}">
      <p class="dashboard-kpi__label">${k.label}</p>
      <p class="dashboard-kpi__value">${k.value}</p>
      ${k.hint ? `<p class="dashboard-kpi__hint">${k.hint}</p>` : ''}
    </div>
  `).join('');
}

function renderList(containerId, items, renderItem, emptyText) {
  const el = qs(containerId);
  if (!items.length) {
    el.innerHTML = `<p class="dashboard-list__empty">${emptyText}</p>`;
    return;
  }
  el.innerHTML = items.map(renderItem).join('');
}

function renderLists(products, sales, threshold) {
  const lowStock = getLowStockList(products, threshold).slice(0, 8);
  const topSelling = getTopSellingProducts(sales, 8);
  const topProfit = getTopProfitSales(sales, 8);
  const losses = getLossSales(sales, 8);

  renderList('#list-low-stock', lowStock, (item) => `
    <div class="dashboard-list__item">
      <div>
        <p class="dashboard-list__name">${item.productName} — ${item.size}</p>
        <p class="dashboard-list__meta">${item.stockOrigin === 'investidor' ? 'Investidor' : 'Próprio'}</p>
      </div>
      <span class="dashboard-list__value">${item.available} disp.</span>
    </div>
  `, 'Nenhum item com estoque baixo.');

  renderList('#list-top-selling', topSelling, (item) => `
    <div class="dashboard-list__item">
      <p class="dashboard-list__name">${item.productName}</p>
      <span class="dashboard-list__value">${item.quantity} peças</span>
    </div>
  `, 'Nenhuma venda registrada ainda.');

  renderList('#list-top-profit', topProfit, (sale) => `
    <div class="dashboard-list__item">
      <div>
        <p class="dashboard-list__name">${sale.productName || '—'}</p>
        <p class="dashboard-list__meta">${formatSaleDate(sale)} · ${formatSaleLinesSummary(sale)}</p>
      </div>
      <span class="dashboard-list__value dashboard-list__value--profit">${formatCurrency(sale.netProfit)}</span>
    </div>
  `, 'Nenhuma venda com lucro ainda.');

  renderList('#list-losses', losses, (sale) => `
    <div class="dashboard-list__item">
      <div>
        <p class="dashboard-list__name">${sale.productName || '—'}</p>
        <p class="dashboard-list__meta">${formatSaleDate(sale)}</p>
      </div>
      <span class="dashboard-list__value dashboard-list__value--loss">${formatCurrency(sale.netProfit)}</span>
    </div>
  `, 'Nenhuma venda com prejuízo.');
}

function renderCharts(sales, stock) {
  const months = getLastNMonths(6);
  const series = monthlySeries(sales, months);

  renderBarChart(qs('#chart-revenue'), {
    labels: series.map((m) => m.label),
    values: series.map((m) => m.revenue),
    title: 'Últimos 6 meses (R$)',
  });

  renderBarChart(qs('#chart-profit'), {
    labels: series.map((m) => m.label),
    values: series.map((m) => m.profit),
    color: getComputedStyle(document.documentElement).getPropertyValue('--color-success').trim(),
    title: 'Últimos 6 meses (R$)',
  });

  renderDoughnutChart(qs('#chart-origin'), {
    labels: ['Próprio', 'Investidor'],
    values: [stock.proprioPieces, stock.investidorPieces],
    title: 'Peças em estoque',
  });

  const top = getTopSellingProducts(sales, 5);
  renderGroupedBarChart(qs('#chart-top'), {
    labels: top.map((t) => {
      const name = t.productName || '—';
      return name.length > 10 ? `${name.slice(0, 10)}…` : name;
    }),
    series: [{ name: 'Peças', values: top.map((t) => t.quantity) }],
    title: 'Top 5 produtos',
  });
}

function renderAiChips() {
  const chips = getQuickQuestions();
  qs('#ai-chips').innerHTML = chips.map((q) => `
    <button type="button" class="dashboard-ai__chip" data-question="${q.replace(/"/g, '&quot;')}">${q}</button>
  `).join('');
}

function showAiResponse(text) {
  const el = qs('#ai-response');
  el.textContent = text;
  el.hidden = false;
}

async function handleAiQuestion(question) {
  if (!dashboardData) return;
  const result = askAssistant(question, dashboardData);
  showAiResponse(result.answer);
}

function bindChartsResize() {
  let timer;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (dashboardData) renderCharts(dashboardData.sales, dashboardData.stock);
    }, 200);
  });
}

function renderDashboard({ products, sales, investors, threshold }) {
  const stock = aggregateStock(products);
  const now = new Date();
  const monthStats = aggregateMonthSales(sales, now.getFullYear(), now.getMonth());

  dashboardData = { products, sales, investors: investors || [], stock, threshold };

  renderKpis(stock, monthStats);
  renderLists(products, sales, threshold);
  renderAiChips();
  revealDashboard();

  // Gráficos após o painel visível (canvas precisa de largura real)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        renderCharts(sales, stock);
      } catch (err) {
        console.error('[SHIR7] Erro ao renderizar gráficos:', err);
      }
    });
  });
}

async function loadData() {
  const [productsRes, salesRes, investorsRes, threshold] = await Promise.all([
    listProducts(),
    listSales(),
    listInvestors(),
    getLowStockThreshold(),
  ]);

  const errors = [];
  if (!productsRes.success) errors.push(productsRes.error);
  if (!salesRes.success) errors.push(salesRes.error);
  if (!investorsRes.success) errors.push(investorsRes.error);

  if (errors.length) {
    errors.forEach((msg) => showToast(msg, 'error'));
  }

  if (!productsRes.success && !salesRes.success) {
    showDashboardError('Não foi possível carregar os dados. Verifique o Firebase e recarregue a página.');
    return;
  }

  renderDashboard({
    products: productsRes.success ? productsRes.data : [],
    sales: salesRes.success ? salesRes.data : [],
    investors: investorsRes.success ? investorsRes.data : [],
    threshold: threshold ?? 5,
  });
}

function initEvents() {
  qs('#ai-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = qs('#ai-input');
    const q = input?.value.trim();
    if (!q) return;
    handleAiQuestion(q);
    input.value = '';
  });

  qs('#ai-chips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.dashboard-ai__chip');
    if (!chip) return;
    handleAiQuestion(chip.dataset.question);
  });

  bindChartsResize();
}

async function init() {
  try {
    initEvents();
    await waitForAuth();
    await loadData();
  } catch (err) {
    console.error('[SHIR7] Erro ao iniciar dashboard:', err);
    showDashboardError('Erro ao carregar o dashboard. Recarregue a página.');
    showToast('Erro ao carregar o dashboard.', 'error');
  }
}

init();
