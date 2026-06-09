import {
  totalQuantity,
  unitCostWithImportTax,
  availableQty,
  calculateTicketMedio,
} from './calculations.js';

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function saleDate(sale) {
  if (!sale?.createdAt?.seconds) return null;
  return new Date(sale.createdAt.seconds * 1000);
}

export function isSaleActive(sale) {
  return sale?.status !== 'cancelada';
}

export function isSaleInMonth(sale, year, month) {
  const d = saleDate(sale);
  if (!d || !isSaleActive(sale)) return false;
  return d.getFullYear() === year && d.getMonth() === month;
}

export function isSaleInRange(sale, from, to) {
  const d = saleDate(sale);
  if (!d || !isSaleActive(sale)) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function getLastNMonths(count = 6) {
  const now = new Date();
  const months = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: MONTH_NAMES[d.getMonth()],
    });
  }
  return months;
}

export function filterSalesByPeriod(sales, { dateFrom = '', dateTo = '' } = {}) {
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
  const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;
  return (sales || []).filter((s) => isSaleInRange(s, from, to));
}

export function aggregateStock(products) {
  let totalProducts = 0;
  let totalPieces = 0;
  let costValue = 0;
  let potentialValue = 0;
  let proprioPieces = 0;
  let investidorPieces = 0;

  for (const p of products || []) {
    if (p.status === 'inativo') continue;
    totalProducts += 1;
    const qty = totalQuantity(p.sizes);
    const unitCost = unitCostWithImportTax(p.costPrice, p.importTaxes, p.sizes);
    const unitPrice = Number(p.suggestedSalePrice) || 0;
    totalPieces += qty;
    costValue += unitCost * qty;
    potentialValue += unitPrice * qty;
    if (p.stockOrigin === 'investidor') {
      investidorPieces += qty;
    } else {
      proprioPieces += qty;
    }
  }

  return {
    totalProducts,
    totalPieces,
    costValue,
    potentialValue,
    proprioPieces,
    investidorPieces,
  };
}

function aggregateSalesStats(salesList) {
  const list = salesList || [];
  const revenue = list.reduce((sum, s) => sum + (Number(s.totalRevenue) || 0), 0);
  const profit = list.reduce((sum, s) => sum + (Number(s.netProfit) || 0), 0);
  const pieces = list.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
  const margins = list.map((s) => Number(s.margin) || 0).filter((m) => m !== 0);
  const avgMargin = margins.length
    ? margins.reduce((a, b) => a + b, 0) / margins.length
    : 0;

  return {
    count: list.length,
    revenue,
    profit,
    pieces,
    avgMargin,
    ticket: calculateTicketMedio(list),
  };
}

/** Totais de vendas concluídas em toda a operação. */
export function aggregateSalesTotals(sales) {
  return aggregateSalesStats((sales || []).filter(isSaleActive));
}

function extractLinePersonalization(line) {
  if (!line?.isPersonalized) {
    return { revenue: 0, cost: 0, pieces: 0 };
  }

  const qty = Number(line.quantity) || 0;
  const persGross = qty * (Number(line.personalizationPerPiece) || 0);
  const itemsGross = qty * (Number(line.unitPrice) || 0);
  const lineGross = itemsGross + persGross;
  const couponPct = Math.min(100, Math.max(0, Number(line.couponPercent) || 0));
  const lineDiscount = lineGross * (couponPct / 100);
  const persDiscount = lineGross > 0 ? lineDiscount * (persGross / lineGross) : 0;
  const revenue = Math.max(0, persGross - persDiscount);
  const cost = qty * (Number(line.personalizationCostPerPiece) || 0);

  return { revenue, cost, pieces: qty };
}

export function getSalePersonalizationStats(sale) {
  const lines = sale?.lines || [];

  if (lines.length) {
    return lines.reduce((acc, line) => {
      const stats = extractLinePersonalization(line);
      acc.revenue += stats.revenue;
      acc.cost += stats.cost;
      acc.pieces += stats.pieces;
      return acc;
    }, { revenue: 0, cost: 0, pieces: 0 });
  }

  const revenue = Number(sale?.personalizationTotal) || 0;
  const cost = Number(sale?.personalizationCost) || 0;
  const hasPersonalization = !!sale?.isPersonalized || revenue > 0 || cost > 0;
  const pieces = hasPersonalization ? (Number(sale?.quantity) || 0) : 0;

  return { revenue, cost, pieces };
}

export function saleHasPersonalization(sale) {
  const stats = getSalePersonalizationStats(sale);
  return stats.pieces > 0 || stats.revenue > 0 || stats.cost > 0 || !!sale?.isPersonalized;
}

export function summarizePersonalizationSales(sales) {
  return (sales || []).reduce((acc, sale) => {
    if (!saleHasPersonalization(sale)) return acc;

    const stats = getSalePersonalizationStats(sale);
    acc.revenue += stats.revenue;
    acc.cost += stats.cost;
    acc.profit += stats.revenue - stats.cost;
    acc.pieces += stats.pieces;
    acc.orderCount += 1;
    return acc;
  }, {
    revenue: 0,
    cost: 0,
    profit: 0,
    pieces: 0,
    orderCount: 0,
  });
}

/** Totais de personalização em vendas ativas de toda a operação. */
export function aggregatePersonalizationTotals(sales) {
  const active = (sales || []).filter(isSaleActive);
  return summarizePersonalizationSales(active);
}

export function aggregateMonthSales(sales, year, month) {
  const monthSales = (sales || []).filter((s) => isSaleInMonth(s, year, month));
  return aggregateSalesStats(monthSales);
}

export function monthlySeries(sales, months) {
  return months.map(({ year, month, label }) => {
    const stats = aggregateMonthSales(sales, year, month);
    return { label, year, month, ...stats };
  });
}

export function getLowStockList(products, threshold) {
  const items = [];
  for (const p of products || []) {
    if (p.status === 'inativo') continue;
    for (const s of p.sizes || []) {
      const avail = availableQty(s);
      if (avail <= threshold) {
        items.push({
          productId: p.productId || p.id,
          productName: p.productName || p.name,
          stockEntryName: p.stockEntryName || '',
          size: s.size,
          available: avail,
          stockOrigin: p.stockOrigin,
        });
      }
    }
  }
  return items.sort((a, b) => a.available - b.available);
}

export function getLowStockListByProduct(products, threshold) {
  const byProductSize = new Map();

  for (const entry of products || []) {
    if (entry.status === 'inativo') continue;

    const productId = entry.productId || entry.id;
    const productName = entry.productName || entry.name || '—';

    for (const sizeEntry of entry.sizes || []) {
      const key = `${productId}|${sizeEntry.size}`;
      const prev = byProductSize.get(key) || {
        productId,
        productName,
        size: sizeEntry.size,
        available: 0,
      };
      prev.available += availableQty(sizeEntry);
      byProductSize.set(key, prev);
    }
  }

  return [...byProductSize.values()]
    .filter((item) => item.available <= threshold)
    .sort((a, b) => a.available - b.available);
}

export function getTopSellingProducts(sales, limit = 5) {
  const map = new Map();
  for (const s of sales || []) {
    if (!isSaleActive(s)) continue;
    const key = s.productId || s.productName;
    const prev = map.get(key) || {
      productId: s.productId,
      productName: s.productName || '—',
      quantity: 0,
      revenue: 0,
    };
    prev.quantity += Number(s.quantity) || 0;
    prev.revenue += Number(s.totalRevenue) || 0;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => b.quantity - a.quantity).slice(0, limit);
}

export function getTopProfitSales(sales, limit = 5) {
  return (sales || [])
    .filter(isSaleActive)
    .sort((a, b) => (Number(b.netProfit) || 0) - (Number(a.netProfit) || 0))
    .slice(0, limit);
}

export function getLossSales(sales, limit = 10) {
  return (sales || [])
    .filter((s) => isSaleActive(s) && (Number(s.netProfit) || 0) < 0)
    .sort((a, b) => (Number(a.netProfit) || 0) - (Number(b.netProfit) || 0))
    .slice(0, limit);
}

export function getStagnantProducts(products, sales, { dateFrom, dateTo } = {}) {
  const soldIds = new Set(
    filterSalesByPeriod(sales, { dateFrom, dateTo }).map((s) => s.productId).filter(Boolean)
  );
  return (products || [])
    .filter((p) => p.status !== 'inativo' && totalQuantity(p.sizes) > 0 && !soldIds.has(p.productId || p.id))
    .map((p) => ({
      productId: p.productId || p.id,
      productName: p.productName || p.name,
      stockEntryName: p.stockEntryName || '',
      pieces: totalQuantity(p.sizes),
      stockOrigin: p.stockOrigin,
    }))
    .sort((a, b) => b.pieces - a.pieces);
}

export function buildInvestorReport(sales, investors, products) {
  return (investors || []).map((inv) => {
    const invSales = (sales || []).filter(
      (s) => s.investorId === inv.id && isSaleActive(s)
    );
    const stockProducts = (products || []).filter(
      (p) => p.stockOrigin === 'investidor' && p.investorId === inv.id
    );
    const piecesInStock = stockProducts.reduce((sum, p) => sum + totalQuantity(p.sizes), 0);
    return {
      investorId: inv.id,
      investorName: inv.name,
      saleCount: invSales.length,
      soldPieces: invSales.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0),
      revenue: invSales.reduce((sum, s) => sum + (Number(s.totalRevenue) || 0), 0),
      profit: invSales.reduce((sum, s) => sum + (Number(s.netProfit) || 0), 0),
      repasse: invSales.reduce((sum, s) => sum + (Number(s.investorPayout) || 0), 0),
      piecesInStock,
      productsInStock: stockProducts.length,
    };
  });
}
