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
let stockDetailTab = 'remaining';
let stockDetailView = 'stock';

const SIZE_ORDER = ['P', 'M', 'G', 'GG', 'XG'];

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

const STOCK_DETAIL_HINTS = {
  stock: {
    remaining: 'Quantidade total que ainda resta em cada lote (por tamanho).',
    available: 'Peças livres para venda em cada lote, descontando reservas.',
  },
  product: {
    remaining: 'Soma de todos os lotes do mesmo produto (por tamanho).',
    available: 'Peças disponíveis somando todos os lotes de cada produto.',
  },
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

function sortSizes(sizes) {
  return [...(sizes || [])].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a.size);
    const ib = SIZE_ORDER.indexOf(b.size);
    if (ia === -1 && ib === -1) return String(a.size).localeCompare(String(b.size), 'pt-BR');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function mergeSizesFromEntries(entries) {
  const map = new Map();

  entries.forEach((entry) => {
    (entry.sizes || []).forEach((s) => {
      const prev = map.get(s.size) || { quantity: 0, reserved: 0 };
      prev.quantity += Number(s.quantity) || 0;
      prev.reserved += Number(s.reserved) || 0;
      map.set(s.size, prev);
    });
  });

  return sortSizes(
    [...map.entries()].map(([size, data]) => ({
      size,
      quantity: data.quantity,
      reserved: data.reserved,
    }))
  );
}

function aggregateEntriesByProduct(entries) {
  const map = new Map();

  entries.forEach((entry) => {
    const key = entry.productId || entry.productName || entry.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  });

  return [...map.values()]
    .map((group) => {
      const first = group[0];
      const investorIds = [...new Set(group.map((e) => e.investorId).filter(Boolean))];
      return {
        productId: first.productId,
        productName: first.productName || first.name,
        lotCount: group.length,
        investorIds,
        sizes: mergeSizesFromEntries(group),
      };
    })
    .sort((a, b) => (a.productName || '').localeCompare(b.productName || '', 'pt-BR'));
}

function getStockDetailRows(entries, view) {
  if (view === 'product') return aggregateEntriesByProduct(entries);
  return [...entries].sort((a, b) => {
    const nameA = a.stockEntryName || a.productName || '';
    const nameB = b.stockEntryName || b.productName || '';
    return nameA.localeCompare(nameB, 'pt-BR');
  });
}

function renderStockDetailItem(entry, mode, isInvestor, view = 'stock') {
  const total = entryTotalByMode(entry.sizes, mode);
  const sizesText = formatEntrySizesByMode(entry.sizes, mode);
  const title = entry.productName || entry.name;

  let metaLines = '';

  if (view === 'stock') {
    if (entry.stockEntryName && entry.stockEntryName !== entry.productName) {
      metaLines += `<p class="dashboard-stock-detail__meta">Lote: ${entry.stockEntryName}</p>`;
    }
    if (isInvestor && entry.investorId) {
      metaLines += `<p class="dashboard-stock-detail__meta">Investidor: ${getInvestorName(entry.investorId)}</p>`;
    }
  } else {
    const lotLabel = entry.lotCount === 1 ? '1 lote' : `${entry.lotCount} lotes somados`;
    metaLines += `<p class="dashboard-stock-detail__meta">${lotLabel}</p>`;
    if (isInvestor && entry.investorIds?.length) {
      const names = entry.investorIds.map(getInvestorName).join(', ');
      metaLines += `<p class="dashboard-stock-detail__meta">Investidor(es): ${names}</p>`;
    }
  }

  if (total <= 0 || !sizesText) {
    return `
      <div class="dashboard-stock-detail__item dashboard-stock-detail__item--empty">
        <div class="dashboard-stock-detail__head">
          <strong>${title}</strong>
          <span class="badge badge--neutral dashboard-stock-detail__badge-empty">Estoque esgotado</span>
        </div>
        ${metaLines}
      </div>
    `;
  }

  return `
    <div class="dashboard-stock-detail__item">
      <div class="dashboard-stock-detail__head">
        <strong>${title}</strong>
        <span class="dashboard-stock-detail__qty">${total} peça(s)</span>
      </div>
      ${metaLines}
      <p class="dashboard-stock-detail__sizes">${sizesText}</p>
    </div>
  `;
}

function setStockDetailFilters(mode, view) {
  qsa('[data-stock-tab]', qs('#stock-detail-body')).forEach((btn) => {
    btn.classList.toggle('stock-detail-tabs__btn--active', btn.dataset.stockTab === mode);
  });
  qsa('[data-stock-view]', qs('#stock-detail-body')).forEach((btn) => {
    btn.classList.toggle('stock-detail-view__btn--active', btn.dataset.stockView === view);
  });
  const hint = qs('#stock-detail-hint');
  if (hint) hint.textContent = STOCK_DETAIL_HINTS[view]?.[mode] || '';
}

function renderStockDetailPanel(origin, mode = stockDetailTab, view = stockDetailView) {
  stockDetailTab = mode;
  stockDetailView = view;

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

  const rows = getStockDetailRows(entries, view);
  const modeLabel = mode === 'remaining' ? 'restam' : 'disponíveis';
  const viewLabel = view === 'product' ? 'por produto' : 'por lote';
  const totalPieces = rows.reduce((sum, e) => sum + entryTotalByMode(e.sizes, mode), 0);

  qs('#stock-detail-title').textContent = `${titleLabel} — ${totalPieces} peça(s) (${modeLabel}, ${viewLabel})`;

  const items = rows.map((e) => renderStockDetailItem(e, mode, isInvestor, view)).join('');
  if (panel) {
    panel.innerHTML = totalPieces === 0
      ? `<p class="dashboard-stock-detail__all-empty text-muted">Todas as peças desta origem estão esgotadas.</p>
         <div class="dashboard-stock-detail__list">${items}</div>`
      : `<div class="dashboard-stock-detail__list">${items}</div>`;
  }

  setStockDetailFilters(mode, view);
}

function openStockDetailModal(origin) {
  stockDetailOrigin = origin;
  stockDetailTab = 'remaining';
  stockDetailView = 'product';

  qs('#stock-detail-body').innerHTML = `
    <div class="stock-detail-toolbar">
      <nav class="stock-detail-tabs" aria-label="Tipo de quantidade">
        <button type="button" class="stock-detail-tabs__btn stock-detail-tabs__btn--active" data-stock-tab="remaining">Restam</button>
        <button type="button" class="stock-detail-tabs__btn" data-stock-tab="available">Disponíveis</button>
      </nav>
      <nav class="stock-detail-view" aria-label="Visualização">
        <span class="stock-detail-view__label">Ver:</span>
        <button type="button" class="stock-detail-view__btn" data-stock-view="stock">Por lote</button>
        <button type="button" class="stock-detail-view__btn stock-detail-view__btn--active" data-stock-view="product">Por produto</button>
      </nav>
    </div>
    <p class="stock-detail-tabs__hint text-sm text-muted" id="stock-detail-hint"></p>
    <div id="stock-detail-panel"></div>
  `;
  renderStockDetailPanel(origin, stockDetailTab, stockDetailView);
  openModal('stock-detail-modal');
}

function switchStockDetailTab(mode) {
  if (!stockDetailOrigin) return;
  renderStockDetailPanel(stockDetailOrigin, mode, stockDetailView);
}

function switchStockDetailView(view) {
  if (!stockDetailOrigin) return;
  renderStockDetailPanel(stockDetailOrigin, stockDetailTab, view);
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
    const viewBtn = e.target.closest('[data-stock-view]');
    if (viewBtn) {
      switchStockDetailView(viewBtn.dataset.stockView);
      return;
    }
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
