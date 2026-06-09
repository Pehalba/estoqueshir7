import { waitForAuth } from '../services/authService.js';
import { listStockEntries, entriesAsStockItems } from '../services/stockEntryService.js';
import { listSales } from '../services/salesService.js';
import { listInvestors } from '../services/investorService.js';
import { getLowStockThreshold } from '../services/stockService.js';
import { askAssistant, getQuickQuestions } from '../services/aiService.js';
import {
  aggregateStock,
  aggregateSalesTotals,
  aggregatePersonalizationTotals,
  getSalePersonalizationStats,
  saleHasPersonalization,
  summarizePersonalizationSales,
  monthlySeries,
  getLastNMonths,
  getLowStockListByProduct,
  getTopSellingProducts,
  getTopProfitSales,
  getLossSales,
  saleDate,
  isSaleActive,
} from '../utils/analytics.js';
import { renderBarChart, renderGroupedBarChart, renderDoughnutChart } from '../utils/chartRenderer.js';
import { formatCurrency, formatPercent } from '../utils/formatCurrency.js';
import { formatSaleLinesSummary, availableQty, unitCostWithImportTax } from '../utils/calculations.js';
import { qs, qsa, showToast, openModal, setupModalClose } from '../utils/domHelpers.js';
import { sortSizes } from '../utils/sizes.js';

let dashboardData = null;
let stockDetailOrigin = null;
let stockDetailTab = 'remaining';
let stockDetailView = 'stock';
let valueDetailType = 'potential';
let valueDetailView = 'total';

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
  const lines = sortSizes(sizes)
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

const VALUE_DETAIL_CONFIG = {
  potential: {
    source: 'stock',
    title: 'Potencial de venda',
    hints: {
      total: 'Resumo geral do potencial de venda, separado por origem do estoque.',
      product: 'Receita potencial somando todos os lotes de cada produto.',
      stock: 'Receita potencial de cada lote (preço sugerido × peças em estoque).',
    },
    emptyBadge: 'Sem potencial',
    unitLabel: 'sugerido',
    valueClass: 'dashboard-stock-detail__qty--money',
    highlightClass: 'dashboard-potential-summary__card--highlight',
    getEntryAmount(entry) {
      const qty = entryRemainingTotal(entry.sizes);
      return (Number(entry.suggestedSalePrice) || 0) * qty;
    },
    getUnitAmount(entry) {
      return Number(entry.suggestedSalePrice) || 0;
    },
  },
  cost: {
    source: 'stock',
    title: 'Valor em estoque (custo)',
    hints: {
      total: 'Resumo do custo total investido no estoque, por origem.',
      product: 'Custo somando todos os lotes de cada produto.',
      stock: 'Custo de cada lote (custo unitário × peças em estoque).',
    },
    emptyBadge: 'Sem custo',
    unitLabel: 'custo',
    valueClass: 'dashboard-stock-detail__qty--cost',
    highlightClass: 'dashboard-potential-summary__card--warning',
    getEntryAmount(entry) {
      const qty = entryRemainingTotal(entry.sizes);
      const unitCost = unitCostWithImportTax(entry.costPrice, entry.importTaxes, entry.sizes);
      return unitCost * qty;
    },
    getUnitAmount(entry) {
      return unitCostWithImportTax(entry.costPrice, entry.importTaxes, entry.sizes);
    },
  },
  revenue: {
    source: 'sales',
    metric: 'revenue',
    title: 'Faturamento total',
    hints: {
      total: 'Faturamento de todas as vendas, separado por origem do estoque.',
      product: 'Faturamento agrupado por produto vendido.',
      stock: 'Faturamento por lote de estoque de onde saiu a venda.',
    },
    emptyBadge: 'Sem faturamento',
    valueClass: 'dashboard-stock-detail__qty--money',
    highlightClass: 'dashboard-potential-summary__card--highlight',
  },
  profit: {
    source: 'sales',
    metric: 'profit',
    title: 'Lucro líquido total',
    hints: {
      total: 'Lucro líquido de todas as vendas, por origem do estoque.',
      product: 'Lucro líquido agrupado por produto vendido.',
      stock: 'Lucro por lote de estoque.',
      productInvestor: 'Repasse ao investidor (lucro dele) por produto — só estoque investidor.',
      productShir7: 'Lucro da SHIR7 por produto: peças + personalização (100% da loja).',
    },
    emptyBadge: 'Sem lucro',
    valueClass: 'dashboard-stock-detail__qty--profit',
    highlightClass: 'dashboard-potential-summary__card--profit',
  },
  margin: {
    source: 'sales',
    metric: 'margin',
    title: 'Margem média',
    hints: {
      total: 'Margem média (lucro ÷ faturamento) por origem do estoque.',
      product: 'Margem média por produto vendido.',
      stock: 'Margem média por lote de estoque.',
    },
    emptyBadge: 'Sem margem',
    valueClass: 'dashboard-stock-detail__qty--profit',
    highlightClass: 'dashboard-potential-summary__card--profit',
  },
  ticket: {
    source: 'sales',
    metric: 'ticket',
    title: 'Ticket médio',
    hints: {
      total: 'Valor médio por pedido, separado por origem do estoque.',
      product: 'Ticket médio por produto (faturamento ÷ pedidos).',
      stock: 'Ticket médio por lote de estoque.',
    },
    emptyBadge: 'Sem ticket',
    valueClass: 'dashboard-stock-detail__qty--money',
    highlightClass: 'dashboard-potential-summary__card--highlight',
  },
  persRevenue: {
    source: 'personalization',
    subtype: 'revenue',
    title: 'Faturamento por personalizações',
    hints: {
      total: 'Faturamento, custo e lucro líquido de todas as personalizações.',
      product: 'Valores de personalização agrupados por produto.',
      stock: 'Valores de personalização por lote de estoque.',
    },
    emptyBadge: 'Sem personalização',
  },
  persOrders: {
    source: 'personalization',
    subtype: 'orders',
    title: 'Pedidos personalizados',
    hints: {
      total: 'Quantidade de pedidos e peças com personalização.',
      product: 'Pedidos personalizados agrupados por produto.',
      stock: 'Pedidos personalizados por lote de estoque.',
    },
    emptyBadge: 'Sem pedidos',
  },
};

function formatDetailAmount(type, amount) {
  if (type === 'margin') return formatPercent(amount);
  if (type === 'count') return String(amount);
  return formatCurrency(amount);
}

function getActiveSales() {
  return (dashboardData?.sales || []).filter(isSaleActive);
}

function getSaleInvestorProfit(sale) {
  if (sale.stockOrigin !== 'investidor') return 0;
  return Math.max(0, Number(sale.investorPayout) || 0);
}

function getSaleShir7Profit(sale) {
  const net = Number(sale.netProfit) || 0;
  return Math.max(0, net - getSaleInvestorProfit(sale));
}

function getSalePersonalizationProfit(sale) {
  const stats = getSalePersonalizationStats(sale);
  return stats.revenue - stats.cost;
}

function getSaleShir7ProfitSplit(sale) {
  const shir7Total = getSaleShir7Profit(sale);
  const persProfit = getSalePersonalizationProfit(sale);
  return {
    shir7Total,
    shir7Pieces: Math.max(0, shir7Total - persProfit),
    persProfit,
  };
}

function summarizeProfitSplit(sales) {
  return (sales || []).reduce((acc, sale) => {
    const split = getSaleShir7ProfitSplit(sale);
    acc.total += Number(sale.netProfit) || 0;
    acc.investor += getSaleInvestorProfit(sale);
    acc.shir7Pieces += split.shir7Pieces;
    acc.shir7Pers += split.persProfit;
    acc.shir7Total += split.shir7Total;
    return acc;
  }, {
    total: 0,
    investor: 0,
    shir7Pieces: 0,
    shir7Pers: 0,
    shir7Total: 0,
  });
}

function aggregateProfitByProduct(sales, mode) {
  const map = new Map();

  sales.forEach((sale) => {
    if (mode === 'investor' && sale.stockOrigin !== 'investidor') return;

    const key = sale.productId || sale.productName || '—';
    const title = sale.productName || '—';
    const prev = map.get(key) || {
      title,
      saleCount: 0,
      pieces: 0,
      amount: 0,
      shir7Pieces: 0,
      persProfit: 0,
      shir7Total: 0,
    };

    if (mode === 'investor') {
      const amount = getSaleInvestorProfit(sale);
      if (amount <= 0) return;
      prev.amount += amount;
    } else if (mode === 'shir7') {
      const split = getSaleShir7ProfitSplit(sale);
      if (split.shir7Total <= 0 && split.persProfit <= 0) return;
      prev.shir7Pieces += split.shir7Pieces;
      prev.persProfit += split.persProfit;
      prev.shir7Total += split.shir7Total;
      prev.amount = prev.shir7Total;
    }

    prev.saleCount += 1;
    prev.pieces += Number(sale.quantity) || 0;
    map.set(key, prev);
  });

  return [...map.values()].sort((a, b) => {
    const totalA = mode === 'shir7' ? a.shir7Total : a.amount;
    const totalB = mode === 'shir7' ? b.shir7Total : b.amount;
    return totalB - totalA;
  });
}

function renderShir7ProfitListItem({ title, row, config }) {
  if (row.shir7Total <= 0 && row.persProfit <= 0) {
    return `
      <div class="dashboard-stock-detail__item dashboard-stock-detail__item--empty">
        <div class="dashboard-stock-detail__head">
          <strong>${title}</strong>
          <span class="badge badge--neutral dashboard-stock-detail__badge-empty">${config.emptyBadge}</span>
        </div>
      </div>
    `;
  }

  const persLine = row.persProfit > 0
    ? `Peças: ${formatCurrency(row.shir7Pieces)} · Personalização: ${formatCurrency(row.persProfit)}`
    : `Lucro em peças: ${formatCurrency(row.shir7Pieces)}`;

  return `
    <div class="dashboard-stock-detail__item">
      <div class="dashboard-stock-detail__head">
        <strong>${title}</strong>
        <span class="dashboard-stock-detail__qty dashboard-stock-detail__qty--profit">${formatCurrency(row.shir7Total)}</span>
      </div>
      <p class="dashboard-stock-detail__sizes">${persLine}</p>
      <p class="dashboard-stock-detail__meta">${row.saleCount} pedido(s) · ${row.pieces} peça(s)</p>
    </div>
  `;
}

function getPersonalizedSales() {
  return getActiveSales().filter(saleHasPersonalization);
}

function aggregatePersonalizationGroups(sales, mode) {
  const map = new Map();

  sales.forEach((sale) => {
    if (!saleHasPersonalization(sale)) return;

    const stats = getSalePersonalizationStats(sale);
    let key;
    let title;

    if (mode === 'product') {
      key = sale.productId || sale.productName || '—';
      title = sale.productName || '—';
    } else {
      key = sale.stockEntryId || sale.stockEntryName || `${sale.productId || ''}-${sale.productName || ''}`;
      title = sale.stockEntryName || sale.productName || '—';
    }

    const prev = map.get(key) || {
      title,
      productName: sale.productName,
      stockEntryName: sale.stockEntryName,
      stockOrigin: sale.stockOrigin,
      investorId: sale.investorId,
      revenue: 0,
      cost: 0,
      profit: 0,
      pieces: 0,
      orderCount: 0,
    };

    prev.revenue += stats.revenue;
    prev.cost += stats.cost;
    prev.profit += stats.revenue - stats.cost;
    prev.pieces += stats.pieces;
    prev.orderCount += 1;
    map.set(key, prev);
  });

  return [...map.values()].sort((a, b) => {
    if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
    return b.revenue - a.revenue;
  });
}

function renderPersFinancialListItem({ title, stats, metaLines = '' }) {
  if (stats.orderCount <= 0) {
    return `
      <div class="dashboard-stock-detail__item dashboard-stock-detail__item--empty">
        <div class="dashboard-stock-detail__head">
          <strong>${title}</strong>
          <span class="badge badge--neutral dashboard-stock-detail__badge-empty">Sem personalização</span>
        </div>
        ${metaLines}
      </div>
    `;
  }

  return `
    <div class="dashboard-stock-detail__item">
      <div class="dashboard-stock-detail__head">
        <strong>${title}</strong>
        <span class="dashboard-stock-detail__qty dashboard-stock-detail__qty--money">${formatCurrency(stats.revenue)}</span>
      </div>
      ${metaLines}
      <p class="dashboard-stock-detail__sizes">
        Custo: ${formatCurrency(stats.cost)} · Lucro:
        <span class="dashboard-stock-detail__qty--profit">${formatCurrency(stats.profit)}</span>
      </p>
      <p class="dashboard-stock-detail__meta">${stats.orderCount} pedido(s) · ${stats.pieces} peça(s) personalizada(s)</p>
    </div>
  `;
}

function renderPersOrdersListItem({ title, stats, metaLines = '' }) {
  if (stats.orderCount <= 0) {
    return `
      <div class="dashboard-stock-detail__item dashboard-stock-detail__item--empty">
        <div class="dashboard-stock-detail__head">
          <strong>${title}</strong>
          <span class="badge badge--neutral dashboard-stock-detail__badge-empty">Sem pedidos</span>
        </div>
        ${metaLines}
      </div>
    `;
  }

  return `
    <div class="dashboard-stock-detail__item">
      <div class="dashboard-stock-detail__head">
        <strong>${title}</strong>
        <span class="dashboard-stock-detail__qty">${stats.orderCount} pedido(s)</span>
      </div>
      ${metaLines}
      <p class="dashboard-stock-detail__sizes">${stats.pieces} peça(s) personalizada(s) · ${formatCurrency(stats.revenue)} faturados</p>
    </div>
  `;
}

function renderPersGroupMeta(row) {
  let meta = '';
  if (row.stockEntryName && row.stockEntryName !== row.productName) {
    meta += `<p class="dashboard-stock-detail__meta">Lote: ${row.stockEntryName}</p>`;
  }
  meta += `<p class="dashboard-stock-detail__meta">${row.stockOrigin === 'investidor' ? `Investidor: ${getInvestorName(row.investorId)}` : 'Origem: Próprio'}</p>`;
  if (row.productName && row.productName !== row.title) {
    meta += `<p class="dashboard-stock-detail__meta">Produto: ${row.productName}</p>`;
  }
  return meta;
}

function summarizeSalesGroup(sales) {
  const saleCount = sales.length;
  const pieces = sales.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
  const revenue = sales.reduce((sum, s) => sum + (Number(s.totalRevenue) || 0), 0);
  const profit = sales.reduce((sum, s) => sum + (Number(s.netProfit) || 0), 0);
  return { saleCount, pieces, revenue, profit };
}

function getSalesGroupAmount(sales, metric) {
  const stats = summarizeSalesGroup(sales);
  switch (metric) {
    case 'revenue':
      return stats.revenue;
    case 'profit':
      return stats.profit;
    case 'margin':
      return stats.revenue > 0 ? (stats.profit / stats.revenue) * 100 : 0;
    case 'ticket':
      return stats.saleCount > 0 ? stats.revenue / stats.saleCount : 0;
    default:
      return 0;
  }
}

function getSalesOriginSummary(sales, metric) {
  const buckets = { proprio: [], investidor: [] };
  sales.forEach((s) => {
    const key = s.stockOrigin === 'investidor' ? 'investidor' : 'proprio';
    buckets[key].push(s);
  });

  const proprioStats = summarizeSalesGroup(buckets.proprio);
  const investidorStats = summarizeSalesGroup(buckets.investidor);
  const allStats = summarizeSalesGroup(sales);

  return {
    proprio: {
      ...proprioStats,
      amount: getSalesGroupAmount(buckets.proprio, metric),
    },
    investidor: {
      ...investidorStats,
      amount: getSalesGroupAmount(buckets.investidor, metric),
    },
    totalPieces: allStats.pieces,
    totalSaleCount: allStats.saleCount,
    totalAmount: getSalesGroupAmount(sales, metric),
  };
}

function aggregateSalesGroups(sales, metric, mode) {
  const map = new Map();

  sales.forEach((sale) => {
    let key;
    let title;
    if (mode === 'product') {
      key = sale.productId || sale.productName || '—';
      title = sale.productName || '—';
    } else {
      key = sale.stockEntryId || sale.stockEntryName || `${sale.productId || ''}-${sale.productName || ''}`;
      title = sale.stockEntryName || sale.productName || '—';
    }

    if (!map.has(key)) {
      map.set(key, {
        title,
        productName: sale.productName,
        stockEntryName: sale.stockEntryName,
        stockOrigin: sale.stockOrigin,
        investorId: sale.investorId,
        sales: [],
      });
    }
    map.get(key).sales.push(sale);
  });

  return [...map.values()]
    .map((group) => {
      const stats = summarizeSalesGroup(group.sales);
      return {
        ...group,
        saleCount: stats.saleCount,
        pieces: stats.pieces,
        revenue: stats.revenue,
        amount: getSalesGroupAmount(group.sales, metric),
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

function renderMetricSummaryCard(label, amount, metric, metaText, className = '') {
  return `
    <div class="dashboard-potential-summary__card ${className}">
      <p class="dashboard-potential-summary__label">${label}</p>
      <p class="dashboard-potential-summary__value">${formatDetailAmount(metric, amount)}</p>
      <p class="dashboard-potential-summary__meta">${metaText}</p>
    </div>
  `;
}

function renderSalesListItem({ title, amount, metric, saleCount, pieces, config, metaLines = '' }) {
  const hasData = saleCount > 0;

  if (!hasData) {
    return `
      <div class="dashboard-stock-detail__item dashboard-stock-detail__item--empty">
        <div class="dashboard-stock-detail__head">
          <strong>${title}</strong>
          <span class="badge badge--neutral dashboard-stock-detail__badge-empty">${config.emptyBadge}</span>
        </div>
        ${metaLines}
      </div>
    `;
  }

  return `
    <div class="dashboard-stock-detail__item">
      <div class="dashboard-stock-detail__head">
        <strong>${title}</strong>
        <span class="dashboard-stock-detail__qty ${config.valueClass}">${formatDetailAmount(metric, amount)}</span>
      </div>
      ${metaLines}
      <p class="dashboard-stock-detail__sizes">${saleCount} pedido(s) · ${pieces} peça(s)</p>
    </div>
  `;
}

function getActiveStockEntries() {
  return (dashboardData?.products || []).filter((e) => e.status !== 'inativo');
}

function getValueOriginSummary(entries, config) {
  const summary = {
    proprio: { pieces: 0, amount: 0 },
    investidor: { pieces: 0, amount: 0 },
  };

  entries.forEach((entry) => {
    const qty = entryRemainingTotal(entry.sizes);
    const amount = config.getEntryAmount(entry);
    const key = entry.stockOrigin === 'investidor' ? 'investidor' : 'proprio';
    summary[key].pieces += qty;
    summary[key].amount += amount;
  });

  return {
    ...summary,
    totalPieces: summary.proprio.pieces + summary.investidor.pieces,
    totalAmount: summary.proprio.amount + summary.investidor.amount,
  };
}

function aggregateValueByProduct(entries, config) {
  const map = new Map();

  entries.forEach((entry) => {
    const key = entry.productId || entry.productName || entry.id;
    const qty = entryRemainingTotal(entry.sizes);
    const amount = config.getEntryAmount(entry);
    const prev = map.get(key) || {
      productName: entry.productName || entry.name,
      pieces: 0,
      amount: 0,
      lotCount: 0,
    };
    prev.pieces += qty;
    prev.amount += amount;
    prev.lotCount += 1;
    map.set(key, prev);
  });

  return [...map.values()]
    .map((row) => ({
      ...row,
      unitAmount: row.pieces > 0 ? row.amount / row.pieces : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function getValueStockRows(entries, config) {
  return [...entries]
    .map((entry) => ({
      ...entry,
      pieces: entryRemainingTotal(entry.sizes),
      amount: config.getEntryAmount(entry),
      unitAmount: config.getUnitAmount(entry),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function renderValueSummaryCard(label, pieces, amount, className = '') {
  return `
    <div class="dashboard-potential-summary__card ${className}">
      <p class="dashboard-potential-summary__label">${label}</p>
      <p class="dashboard-potential-summary__value">${formatCurrency(amount)}</p>
      <p class="dashboard-potential-summary__meta">${pieces} peça(s)</p>
    </div>
  `;
}

function renderValueListItem({ title, amount, pieces, unitAmount, config, metaLines = '' }) {
  if (pieces <= 0 || amount <= 0) {
    return `
      <div class="dashboard-stock-detail__item dashboard-stock-detail__item--empty">
        <div class="dashboard-stock-detail__head">
          <strong>${title}</strong>
          <span class="badge badge--neutral dashboard-stock-detail__badge-empty">${config.emptyBadge}</span>
        </div>
        ${metaLines}
      </div>
    `;
  }

  return `
    <div class="dashboard-stock-detail__item">
      <div class="dashboard-stock-detail__head">
        <strong>${title}</strong>
        <span class="dashboard-stock-detail__qty ${config.valueClass}">${formatCurrency(amount)}</span>
      </div>
      ${metaLines}
      <p class="dashboard-stock-detail__sizes">${pieces} peça(s) · ${formatCurrency(unitAmount)}/peça (${config.unitLabel})</p>
    </div>
  `;
}

function setValueDetailFilters(view) {
  qsa('[data-value-view]', qs('#value-detail-body')).forEach((btn) => {
    btn.classList.toggle('stock-detail-view__btn--active', btn.dataset.valueView === view);
  });
  const config = VALUE_DETAIL_CONFIG[valueDetailType];
  const hint = qs('#value-detail-hint');
  if (hint) hint.textContent = config?.hints[view] || '';
}

function renderStockValueDetailPanel(view, config) {
  const entries = getActiveStockEntries();
  const panel = qs('#value-detail-panel');
  const summary = getValueOriginSummary(entries, config);

  qs('#value-detail-title').textContent = `${config.title} — ${formatCurrency(summary.totalAmount)}`;

  if (!entries.length) {
    if (panel) panel.innerHTML = '<p class="text-muted">Nenhum lote cadastrado.</p>';
    setValueDetailFilters(view);
    return;
  }

  let content = '';

  if (view === 'total') {
    content = `
      <div class="dashboard-potential-summary">
        ${renderValueSummaryCard('Total geral', summary.totalPieces, summary.totalAmount, config.highlightClass)}
        ${renderValueSummaryCard('Estoque próprio', summary.proprio.pieces, summary.proprio.amount)}
        ${renderValueSummaryCard('Estoque investidor', summary.investidor.pieces, summary.investidor.amount)}
      </div>
    `;
  } else if (view === 'product') {
    const rows = aggregateValueByProduct(entries, config);
    const items = rows.map((row) => renderValueListItem({
      title: row.productName,
      amount: row.amount,
      pieces: row.pieces,
      unitAmount: row.unitAmount,
      config,
      metaLines: `<p class="dashboard-stock-detail__meta">${row.lotCount === 1 ? '1 lote' : `${row.lotCount} lotes somados`}</p>`,
    })).join('');
    content = `<div class="dashboard-stock-detail__list">${items}</div>`;
  } else {
    const rows = getValueStockRows(entries, config);
    const items = rows.map((row) => {
      let meta = '';
      if (row.stockEntryName && row.stockEntryName !== row.productName) {
        meta += `<p class="dashboard-stock-detail__meta">Lote: ${row.stockEntryName}</p>`;
      }
      meta += `<p class="dashboard-stock-detail__meta">${row.stockOrigin === 'investidor' ? `Investidor: ${getInvestorName(row.investorId)}` : 'Origem: Próprio'}</p>`;
      return renderValueListItem({
        title: row.productName || row.name,
        amount: row.amount,
        pieces: row.pieces,
        unitAmount: row.unitAmount,
        config,
        metaLines: meta,
      });
    }).join('');
    content = `<div class="dashboard-stock-detail__list">${items}</div>`;
  }

  if (panel) panel.innerHTML = content;
  setValueDetailFilters(view);
}

function renderSalesValueDetailPanel(view, config) {
  const metric = config.metric;
  const sales = getActiveSales();
  const panel = qs('#value-detail-panel');
  const summary = getSalesOriginSummary(sales, metric);
  const profitSplit = metric === 'profit' ? summarizeProfitSplit(sales) : null;

  qs('#value-detail-title').textContent = `${config.title} — ${formatDetailAmount(metric, summary.totalAmount)}`;

  if (!sales.length) {
    if (panel) panel.innerHTML = '<p class="text-muted">Nenhuma venda registrada.</p>';
    setValueDetailFilters(view);
    return;
  }

  let content = '';

  if (view === 'total') {
    if (metric === 'profit') {
      content = `
        <div class="dashboard-potential-summary dashboard-potential-summary--pers">
          ${renderMetricSummaryCard('Lucro líquido', profitSplit.total, metric, `${summary.totalSaleCount} pedido(s) · ${summary.totalPieces} peça(s)`, config.highlightClass)}
          ${renderMetricSummaryCard('Lucro investidor', profitSplit.investor, metric, 'Repasse total aos investidores')}
          ${renderMetricSummaryCard('Lucro SHIR7', profitSplit.shir7Total, metric, `Peças: ${formatCurrency(profitSplit.shir7Pieces)} · Pers.: ${formatCurrency(profitSplit.shir7Pers)}`, 'dashboard-potential-summary__card--profit')}
        </div>
      `;
    } else {
      content = `
        <div class="dashboard-potential-summary">
          ${renderMetricSummaryCard('Total geral', summary.totalAmount, metric, `${summary.totalSaleCount} pedido(s) · ${summary.totalPieces} peça(s)`, config.highlightClass)}
          ${renderMetricSummaryCard('Estoque próprio', summary.proprio.amount, metric, `${summary.proprio.saleCount} pedido(s) · ${summary.proprio.pieces} peça(s)`)}
          ${renderMetricSummaryCard('Estoque investidor', summary.investidor.amount, metric, `${summary.investidor.saleCount} pedido(s) · ${summary.investidor.pieces} peça(s)`)}
        </div>
      `;
    }
  } else if (view === 'productInvestor' && metric === 'profit') {
    const rows = aggregateProfitByProduct(sales, 'investor');
    const items = rows.map((row) => renderSalesListItem({
      title: row.title,
      amount: row.amount,
      metric,
      saleCount: row.saleCount,
      pieces: row.pieces,
      config,
    })).join('');
    content = rows.length
      ? `<div class="dashboard-stock-detail__list">${items}</div>`
      : '<p class="text-muted">Nenhum lucro de investidor por produto.</p>';
  } else if (view === 'productShir7' && metric === 'profit') {
    const rows = aggregateProfitByProduct(sales, 'shir7');
    const items = rows.map((row) => renderShir7ProfitListItem({
      title: row.title,
      row,
      config,
    })).join('');
    content = rows.length
      ? `<div class="dashboard-stock-detail__list">${items}</div>`
      : '<p class="text-muted">Nenhum lucro SHIR7 por produto.</p>';
  } else if (view === 'product') {
    const rows = aggregateSalesGroups(sales, metric, 'product');
    const items = rows.map((row) => renderSalesListItem({
      title: row.title,
      amount: row.amount,
      metric,
      saleCount: row.saleCount,
      pieces: row.pieces,
      config,
    })).join('');
    content = `<div class="dashboard-stock-detail__list">${items}</div>`;
  } else {
    const rows = aggregateSalesGroups(sales, metric, 'stock');
    const items = rows.map((row) => {
      let meta = '';
      if (row.stockEntryName && row.stockEntryName !== row.productName) {
        meta += `<p class="dashboard-stock-detail__meta">Lote: ${row.stockEntryName}</p>`;
      }
      meta += `<p class="dashboard-stock-detail__meta">${row.stockOrigin === 'investidor' ? `Investidor: ${getInvestorName(row.investorId)}` : 'Origem: Próprio'}</p>`;
      if (row.productName && row.productName !== row.title) {
        meta += `<p class="dashboard-stock-detail__meta">Produto: ${row.productName}</p>`;
      }
      return renderSalesListItem({
        title: row.title,
        amount: row.amount,
        metric,
        saleCount: row.saleCount,
        pieces: row.pieces,
        config,
        metaLines: meta,
      });
    }).join('');
    content = `<div class="dashboard-stock-detail__list">${items}</div>`;
  }

  if (panel) panel.innerHTML = content;
  setValueDetailFilters(view);
}

function renderPersonalizationValueDetailPanel(view, config) {
  const sales = getPersonalizedSales();
  const panel = qs('#value-detail-panel');
  const summary = summarizePersonalizationSales(sales);
  const isRevenue = config.subtype === 'revenue';

  const titleSuffix = isRevenue
    ? formatCurrency(summary.revenue)
    : `${summary.orderCount} pedido(s)`;
  qs('#value-detail-title').textContent = `${config.title} — ${titleSuffix}`;

  if (!sales.length) {
    if (panel) panel.innerHTML = '<p class="text-muted">Nenhuma personalização registrada.</p>';
    setValueDetailFilters(view);
    return;
  }

  let content = '';

  if (view === 'total') {
    if (isRevenue) {
      content = `
        <div class="dashboard-potential-summary dashboard-potential-summary--pers">
          ${renderMetricSummaryCard('Faturamento', summary.revenue, 'revenue', `${summary.orderCount} pedido(s) · ${summary.pieces} peça(s)`, 'dashboard-potential-summary__card--highlight')}
          ${renderMetricSummaryCard('Custo', summary.cost, 'revenue', 'Custo de personalização por peça', 'dashboard-potential-summary__card--warning')}
          ${renderMetricSummaryCard('Lucro líquido', summary.profit, 'revenue', 'Faturamento − custo de personalização', 'dashboard-potential-summary__card--profit')}
        </div>
      `;
    } else {
      content = `
        <div class="dashboard-potential-summary dashboard-potential-summary--2">
          ${renderMetricSummaryCard('Pedidos personalizados', summary.orderCount, 'count', 'Vendas com ao menos uma peça personalizada', 'dashboard-potential-summary__card--highlight')}
          ${renderMetricSummaryCard('Peças personalizadas', summary.pieces, 'count', `${formatCurrency(summary.revenue)} faturados em personalização`)}
        </div>
        <div class="dashboard-stock-detail__list dashboard-stock-detail__list--compact">
          ${sales.slice(0, 10).map((sale) => {
            const stats = getSalePersonalizationStats(sale);
            const orderLabel = sale.orderId || sale.productName || '—';
            return `
              <div class="dashboard-stock-detail__item">
                <div class="dashboard-stock-detail__head">
                  <strong>${orderLabel}</strong>
                  <span class="dashboard-stock-detail__qty">${stats.pieces} peça(s)</span>
                </div>
                <p class="dashboard-stock-detail__meta">${sale.productName || '—'}${sale.stockEntryName ? ` · ${sale.stockEntryName}` : ''}</p>
                <p class="dashboard-stock-detail__sizes">${formatSaleDate(sale)} · ${formatCurrency(stats.revenue)} faturados</p>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
  } else if (view === 'product') {
    const rows = aggregatePersonalizationGroups(sales, 'product');
    const items = rows.map((row) => (
      isRevenue
        ? renderPersFinancialListItem({ title: row.title, stats: row })
        : renderPersOrdersListItem({ title: row.title, stats: row })
    )).join('');
    content = `<div class="dashboard-stock-detail__list">${items}</div>`;
  } else {
    const rows = aggregatePersonalizationGroups(sales, 'stock');
    const items = rows.map((row) => {
      const meta = renderPersGroupMeta(row);
      return isRevenue
        ? renderPersFinancialListItem({ title: row.title, stats: row, metaLines: meta })
        : renderPersOrdersListItem({ title: row.title, stats: row, metaLines: meta });
    }).join('');
    content = `<div class="dashboard-stock-detail__list">${items}</div>`;
  }

  if (panel) panel.innerHTML = content;
  setValueDetailFilters(view);
}

function renderValueDetailPanel(type = valueDetailType, view = valueDetailView) {
  valueDetailType = type;
  valueDetailView = view;
  const config = VALUE_DETAIL_CONFIG[type];
  if (!config) return;

  if (config.source === 'sales') {
    renderSalesValueDetailPanel(view, config);
    return;
  }

  if (config.source === 'personalization') {
    renderPersonalizationValueDetailPanel(view, config);
    return;
  }

  renderStockValueDetailPanel(view, config);
}

function renderValueDetailNav(type) {
  const tabs = [
    { id: 'total', label: 'Total' },
    { id: 'product', label: 'Por produto' },
    { id: 'stock', label: 'Por estoque' },
  ];

  if (type === 'profit') {
    tabs.push(
      { id: 'productInvestor', label: 'Lucro investidor' },
      { id: 'productShir7', label: 'Lucro SHIR7' },
    );
  }

  const buttons = tabs.map((tab, index) => `
    <button
      type="button"
      class="stock-detail-view__btn ${index === 0 ? 'stock-detail-view__btn--active' : ''}"
      data-value-view="${tab.id}"
    >${tab.label}</button>
  `).join('');

  return `
    <nav class="stock-detail-view stock-detail-view--full stock-detail-view--wrap" aria-label="Visualização">
      ${buttons}
    </nav>
  `;
}

function openValueDetailModal(type) {
  if (!VALUE_DETAIL_CONFIG[type]) return;
  valueDetailType = type;
  valueDetailView = 'total';
  qs('#value-detail-body').innerHTML = `
    ${renderValueDetailNav(type)}
    <p class="stock-detail-tabs__hint text-sm text-muted" id="value-detail-hint"></p>
    <div id="value-detail-panel"></div>
  `;
  renderValueDetailPanel(type, 'total');
  openModal('value-detail-modal');
}

function switchValueDetailView(view) {
  renderValueDetailPanel(valueDetailType, view);
}

function renderKpis(stock, salesStats, persStats) {
  const kpis = [
    { label: 'Lotes em estoque', value: String(stock.totalProducts), hint: `${stock.totalPieces} peças no total` },
    {
      label: 'Valor em estoque (custo)',
      value: formatCurrency(stock.costValue),
      className: 'dashboard-kpi--warning',
      kpiAction: 'cost',
      hint: 'Clique para ver o detalhe',
      hintClass: 'dashboard-kpi__hint--action',
    },
    {
      label: 'Potencial de venda',
      value: formatCurrency(stock.potentialValue),
      kpiAction: 'potential',
      hint: 'Clique para ver o detalhe',
      hintClass: 'dashboard-kpi__hint--action',
    },
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
    {
      label: 'Faturamento total',
      value: formatCurrency(salesStats.revenue),
      className: 'dashboard-kpi--revenue',
      kpiAction: 'revenue',
      hint: 'Clique para ver o detalhe',
      hintClass: 'dashboard-kpi__hint--action',
    },
    {
      label: 'Lucro líquido total',
      value: formatCurrency(salesStats.profit),
      className: 'dashboard-kpi--profit',
      kpiAction: 'profit',
      hint: 'Clique para ver o detalhe',
      hintClass: 'dashboard-kpi__hint--action',
    },
    {
      label: 'Margem média',
      value: formatPercent(salesStats.avgMargin),
      kpiAction: 'margin',
      hint: 'Clique para ver o detalhe',
      hintClass: 'dashboard-kpi__hint--action',
    },
    {
      label: 'Ticket médio',
      value: formatCurrency(salesStats.ticket),
      kpiAction: 'ticket',
      hint: 'Clique para ver o detalhe',
      hintClass: 'dashboard-kpi__hint--action',
    },
    {
      label: 'Faturamento personalizações',
      value: formatCurrency(persStats.revenue),
      className: 'dashboard-kpi--info',
      kpiAction: 'persRevenue',
      hint: 'Clique para ver lucro e custo',
      hintClass: 'dashboard-kpi__hint--action',
    },
    {
      label: 'Pedidos personalizados',
      value: String(persStats.orderCount),
      className: 'dashboard-kpi--info',
      kpiAction: 'persOrders',
      hint: `${persStats.pieces} peça(s) personalizada(s) · Clique para ver o detalhe`,
      hintClass: 'dashboard-kpi__hint--action',
    },
  ];

  qs('#dashboard-kpis').innerHTML = kpis.map((k) => `
    <div
      class="dashboard-kpi ${k.className || ''} ${k.detailOrigin || k.kpiAction ? 'dashboard-kpi--clickable' : ''}"
      ${k.detailOrigin ? `data-detail-origin="${k.detailOrigin}"` : ''}
      ${k.kpiAction ? `data-kpi-action="${k.kpiAction}"` : ''}
      ${k.detailOrigin || k.kpiAction ? 'role="button" tabindex="0"' : ''}
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
  const lowStock = getLowStockListByProduct(products, threshold).slice(0, 8);
  const topSelling = getTopSellingProducts(sales, 8);
  const topProfit = getTopProfitSales(sales, 8);
  const losses = getLossSales(sales, 8);

  renderList('#list-low-stock', lowStock, (item) => `
    <div class="dashboard-list__item">
      <p class="dashboard-list__name">${item.productName} — ${item.size}</p>
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
  const persStats = aggregatePersonalizationTotals(sales);

  dashboardData = { products, sales, investors: investors || [], stock, threshold };

  renderKpis(stock, salesStats, persStats);
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
  setupModalClose('value-detail-modal');

  qs('#value-detail-body')?.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-value-view]');
    if (!viewBtn) return;
    switchValueDetailView(viewBtn.dataset.valueView);
  });

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
    const valueCard = e.target.closest('[data-kpi-action]');
    if (valueCard?.dataset.kpiAction && VALUE_DETAIL_CONFIG[valueCard.dataset.kpiAction]) {
      openValueDetailModal(valueCard.dataset.kpiAction);
      return;
    }
    const card = e.target.closest('[data-detail-origin]');
    if (!card) return;
    openStockDetailModal(card.dataset.detailOrigin);
  });

  qs('#dashboard-kpis')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const valueCard = e.target.closest('[data-kpi-action]');
    if (valueCard?.dataset.kpiAction && VALUE_DETAIL_CONFIG[valueCard.dataset.kpiAction]) {
      e.preventDefault();
      openValueDetailModal(valueCard.dataset.kpiAction);
      return;
    }
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
