import { waitForAuth } from '../services/authService.js';
import { listStockEntries, entriesAsStockItems } from '../services/stockEntryService.js';
import { listSales } from '../services/salesService.js';
import { listInvestors } from '../services/investorService.js';
import { getLowStockThreshold } from '../services/stockService.js';
import { askAssistant, getQuickQuestions } from '../services/aiService.js';
import {
  aggregateStock,
  aggregateSalesTotals,
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
import { formatSaleLinesSummary, availableQty } from '../utils/calculations.js';
import { qs, qsa, showToast, openModal, setupModalClose } from '../utils/domHelpers.js';

let dashboardData = null;
let stockDetailOrigin = null;

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

function getInvestorName(id) {
  return dashboardData?.investors?.find((i) => i.id === id)?.name || '—';
}

const STOCK_DETAIL_TAB_HINTS = {
  remaining: 'Quantidade total que ainda resta em cada lote (por tamanho).',
  available: 'Peças livres para venda, descontando reservas.',
};

function entryRemainingTotal(sizes) {
  return (sizes || []).reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
}

function entryAvailableTotal(sizes) {
  return (sizes || []).reduce((sum, s) => sum + availableQty(s), 0);
}

function entryTotalByMode(sizes, mode) {
  return mode === 'remaining' ? entryRemainingTotal(sizes) : entryAvailableTotal(sizes);
}

function formatEntrySizesByMode(sizes, mode) {
  const lines = (sizes || [])
    .map((s) => {
      const qty = mode === 'remaining'
        ? Number(s.quantity) || 0
        : availableQty(s);
      if (qty <= 0) return null;

      const reserved = Number(s.reserved) || 0;
      if (mode === 'available' && reserved > 0) {
        return `${s.size}: ${qty} (${reserved} reserv.)`;
      }
      return `${s.size}: ${qty}`;
    })
    .filter(Boolean);

  return lines.length ? lines.join(' · ') : null;
}

function getStockDetailEntries(origin) {
  return (dashboardData?.products || []).filter(
    (e) => e.status !== 'inativo' && e.stockOrigin === origin
  );
}

function renderStockDetailItem(entry, mode, isInvestor) {
  const total = entryTotalByMode(entry.sizes, mode);
  const sizesText = formatEntrySizesByMode(entry.sizes, mode);
  const lotLine = entry.stockEntryName && entry.stockEntryName !== entry.productName
    ? `<p class="dashboard-stock-detail__meta">Lote: ${entry.stockEntryName}</p>`
    : '';
  const investorLine = isInvestor
    ? `<p class="dashboard-stock-detail__meta">Investidor: ${getInvestorName(entry.investorId)}</p>`
    : '';

  if (total <= 0 || !sizesText) {
    return `
      <div class="dashboard-stock-detail__item dashboard-stock-detail__item--empty">
        <div class="dashboard-stock-detail__head">
          <strong>${entry.productName || entry.name}</strong>
          <span class="badge badge--neutral dashboard-stock-detail__badge-empty">Estoque esgotado</span>
        </div>
        ${lotLine}
        ${investorLine}
      </div>
    `;
  }

  return `
    <div class="dashboard-stock-detail__item">
      <div class="dashboard-stock-detail__head">
        <strong>${entry.productName || entry.name}</strong>
        <span class="dashboard-stock-detail__qty">${total} peça(s)</span>
      </div>
      ${lotLine}
      ${investorLine}
      <p class="dashboard-stock-detail__sizes">${sizesText}</p>
    </div>
  `;
}

function setStockDetailTab(mode) {
  qsa('.stock-detail-tabs__btn', qs('#stock-detail-body')).forEach((btn) => {
    btn.classList.toggle('stock-detail-tabs__btn--active', btn.dataset.stockTab === mode);
  });
  const hint = qs('#stock-detail-hint');
  if (hint) hint.textContent = STOCK_DETAIL_TAB_HINTS[mode] || '';
}

function renderStockDetailPanel(origin, mode = 'remaining') {
  const isInvestor = origin === 'investidor';
  const titleLabel = isInvestor ? 'Estoque investidor' : 'Estoque próprio';
  const entries = getStockDetailEntries(origin);
  const panel = qs('#stock-detail-panel');

  if (!entries.length) {
    qs('#stock-detail-title').textContent = titleLabel;
    if (panel) {
      panel.innerHTML = '<p class="text-muted">Nenhum lote cadastrado nesta origem.</p>';
    }
    return;
  }

  const modeLabel = mode === 'remaining' ? 'restam' : 'disponíveis';
  const totalPieces = entries.reduce((sum, e) => sum + entryTotalByMode(e.sizes, mode), 0);
  qs('#stock-detail-title').textContent = `${titleLabel} — ${totalPieces} peça(s) (${modeLabel})`;

  const items = entries.map((e) => renderStockDetailItem(e, mode, isInvestor)).join('');
  if (panel) {
    panel.innerHTML = totalPieces === 0
      ? `<p class="dashboard-stock-detail__all-empty text-muted">Todas as peças desta origem estão esgotadas.</p>
         <div class="dashboard-stock-detail__list">${items}</div>`
      : `<div class="dashboard-stock-detail__list">${items}</div>`;
  }

  setStockDetailTab(mode);
}

function openStockDetailModal(origin) {
  stockDetailOrigin = origin;
  qs('#stock-detail-body').innerHTML = `
    <nav class="stock-detail-tabs">
      <button type="button" class="stock-detail-tabs__btn stock-detail-tabs__btn--active" data-stock-tab="remaining">Restam</button>
      <button type="button" class="stock-detail-tabs__btn" data-stock-tab="available">Disponíveis</button>
    </nav>
    <p class="stock-detail-tabs__hint text-sm text-muted" id="stock-detail-hint"></p>
    <div id="stock-detail-panel"></div>
  `;
  renderStockDetailPanel(origin, 'remaining');
  openModal('stock-detail-modal');
}

function switchStockDetailTab(mode) {
  if (!stockDetailOrigin) return;
  renderStockDetailPanel(stockDetailOrigin, mode);
}

function renderKpis(stock, salesStats) {
  const kpis = [
    { label: 'Lotes em estoque', value: String(stock.totalProducts), hint: `${stock.totalPieces} peças no total` },
    { label: 'Valor em estoque (custo)', value: formatCurrency(stock.costValue), className: 'dashboard-kpi--warning' },
    { label: 'Potencial de venda', value: formatCurrency(stock.potentialValue) },
    { label: 'Pedidos', value: String(salesStats.count) },
    {
      label: 'Estoque próprio',
      value: `${stock.proprioPieces} peças`,
      detailOrigin: 'proprio',
      hint: 'Clique para ver o detalhe',
      hintClass: 'dashboard-kpi__hint--action',
    },
    {
      label: 'Estoque investidor',
      value: `${stock.investidorPieces} peças`,
      detailOrigin: 'investidor',
      hint: 'Clique para ver o detalhe',
      hintClass: 'dashboard-kpi__hint--action',
    },
    { label: 'Faturamento total', value: formatCurrency(salesStats.revenue), className: 'dashboard-kpi--revenue', hint: `${salesStats.pieces} peça(s) vendidas` },
    { label: 'Lucro líquido total', value: formatCurrency(salesStats.profit), className: 'dashboard-kpi--profit' },
    { label: 'Margem média', value: formatPercent(salesStats.avgMargin) },
    { label: 'Ticket médio', value: formatCurrency(salesStats.ticket) },
  ];

  qs('#dashboard-kpis').innerHTML = kpis.map((k) => `
    <div
      class="dashboard-kpi ${k.className || ''} ${k.detailOrigin ? 'dashboard-kpi--clickable' : ''}"
      ${k.detailOrigin ? `data-detail-origin="${k.detailOrigin}" role="button" tabindex="0"` : ''}
    >
      <p class="dashboard-kpi__label">${k.label}</p>
      <p class="dashboard-kpi__value">${k.value}</p>
      ${k.hint ? `<p class="dashboard-kpi__hint ${k.hintClass || ''}">${k.hint}</p>` : ''}
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
        <p class="dashboard-list__name">${item.stockEntryName ? `${item.stockEntryName} · ` : ''}${item.productName} — ${item.size}</p>
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
  const salesStats = aggregateSalesTotals(sales);

  dashboardData = { products, sales, investors: investors || [], stock, threshold };

  renderKpis(stock, salesStats);
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
  const [stockRes, salesRes, investorsRes, threshold] = await Promise.all([
    listStockEntries(),
    listSales(),
    listInvestors(),
    getLowStockThreshold(),
  ]);

  const errors = [];
  if (!stockRes.success) errors.push(stockRes.error);
  if (!salesRes.success) errors.push(salesRes.error);
  if (!investorsRes.success) errors.push(investorsRes.error);

  if (errors.length) {
    errors.forEach((msg) => showToast(msg, 'error'));
  }

  if (!stockRes.success && !salesRes.success) {
    showDashboardError('Não foi possível carregar os dados. Verifique o Firebase e recarregue a página.');
    return;
  }

  renderDashboard({
    products: stockRes.success ? entriesAsStockItems(stockRes.data) : [],
    sales: salesRes.success ? salesRes.data : [],
    investors: investorsRes.success ? investorsRes.data : [],
    threshold: threshold ?? 5,
  });
}

function initEvents() {
  setupModalClose('stock-detail-modal');

  qs('#stock-detail-body')?.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-stock-tab]');
    if (!tabBtn) return;
    switchStockDetailTab(tabBtn.dataset.stockTab);
  });

  qs('#dashboard-kpis')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-detail-origin]');
    if (!card) return;
    openStockDetailModal(card.dataset.detailOrigin);
  });

  qs('#dashboard-kpis')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-detail-origin]');
    if (!card) return;
    e.preventDefault();
    openStockDetailModal(card.dataset.detailOrigin);
  });

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
