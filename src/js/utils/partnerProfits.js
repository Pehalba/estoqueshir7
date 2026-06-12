import {
  filterSalesByPeriod,
  isSaleActive,
  getSalePersonalizationStats,
  saleHasPersonalization,
} from './analytics.js';
import {
  buildSaleFinancialsFromSale,
  calculateShir7ShirtShareForInvestor,
  resolveSaleUnitCost,
} from './calculations.js';

export const SHIR7_PARTNERS = [
  { id: 'pedro', name: 'Pedro', share: 0.5 },
  { id: 'eduardo', name: 'Eduardo', share: 0.5 },
];

/** Parte SHIR7 do lucro em venda de estoque investidor: 60% do lucro (sem personalização). */
export const SHIR7_INVESTOR_PROFIT_PERCENT = 60;

function getInvestorRepasse(sale) {
  const stored = Number(sale.investorPayout);
  if (Number.isFinite(stored) && stored > 0) {
    return stored;
  }
  return 0;
}

function decomposeSaleProfit(sale, settings = {}, investor = null, stockEntry = null) {
  const net = Number(sale.netProfit) || 0;
  const pers = getSalePersonalizationStats(sale, settings);
  const persProfit = pers.revenue - pers.cost;
  const financials = buildSaleFinancialsFromSale(sale, settings, stockEntry);
  const unitCost = resolveSaleUnitCost(sale, stockEntry);
  const shirtNetProfit = Math.max(0, net - persProfit);
  const payout = sale.stockOrigin === 'investidor' ? getInvestorRepasse(sale) : 0;
  const isInvestor = sale.stockOrigin === 'investidor';

  return {
    persRevenue: pers.revenue,
    persCost: pers.cost,
    persProfit,
    persPieces: pers.pieces,
    hasPersonalization: saleHasPersonalization(sale) && (pers.pieces > 0 || pers.revenue > 0 || pers.cost > 0),
    shirtNetProfit,
    shirtRevenue: Math.max(0, (Number(sale.totalRevenue) || 0) - pers.revenue),
    investorRepasse: payout,
    shir7ShirtFromInvestor: isInvestor && investor
      ? calculateShir7ShirtShareForInvestor(investor, {
        unitCost,
        quantity: sale.quantity,
        financials,
        persProfit,
      })
      : 0,
    shir7ShirtFromProprio: !isInvestor ? shirtNetProfit : 0,
    quantity: Number(sale.quantity) || 0,
  };
}

/**
 * Distribuição de lucros SHIR7:
 * - Camisas: repasse investidor, parte SHIR7 (investidor) e estoque próprio — sem personalização
 * - Personalização: faturamento e lucro 100% SHIR7 (investidor não participa)
 */
export function calculatePartnerDistribution(sales, investors = [], filters = {}, settings = {}, stockEntries = []) {
  const filtered = filterSalesByPeriod(sales, filters).filter(isSaleActive);
  const investorMap = new Map(investors.map((i) => [i.id, i]));
  const stockEntryMap = new Map((stockEntries || []).map((entry) => [entry.id, entry]));
  const byInvestor = new Map();

  let totalNetProfit = 0;
  let investorRepasseTotal = 0;
  let shir7ShirtFromInvestor = 0;
  let shir7ShirtFromProprio = 0;
  let shirtNetProfitTotal = 0;
  let investorSalesCount = 0;
  let proprioSalesCount = 0;
  let shirtPieces = 0;
  let proprioPieces = 0;

  let persRevenue = 0;
  let persCost = 0;
  let persProfit = 0;
  let persPieces = 0;
  let persOrderCount = 0;

  for (const sale of filtered) {
    const investor = sale.investorId ? investorMap.get(sale.investorId) : null;
    const stockEntry = sale.stockEntryId ? stockEntryMap.get(sale.stockEntryId) : null;
    const split = decomposeSaleProfit(sale, settings, investor, stockEntry);
    totalNetProfit += Number(sale.netProfit) || 0;
    shirtNetProfitTotal += split.shirtNetProfit;
    shirtPieces += split.quantity;

    if (split.hasPersonalization) {
      persOrderCount += 1;
      persRevenue += split.persRevenue;
      persCost += split.persCost;
      persProfit += split.persProfit;
      persPieces += split.persPieces;
    }

    if (sale.stockOrigin === 'investidor') {
      investorSalesCount += 1;
      investorRepasseTotal += split.investorRepasse;
      shir7ShirtFromInvestor += split.shir7ShirtFromInvestor;

      const invId = sale.investorId || 'sem-investidor';
      const prev = byInvestor.get(invId) || {
        repasse: 0,
        shir7Share: 0,
        netProfit: 0,
        shirtNetProfit: 0,
        sales: 0,
        pieces: 0,
        profitBase: 0,
      };

      prev.repasse += split.investorRepasse;
      prev.shir7Share += split.shir7ShirtFromInvestor;
      prev.netProfit += split.shirtNetProfit;
      prev.shirtNetProfit += split.shirtNetProfit;
      prev.sales += 1;
      prev.pieces += split.quantity;
      prev.profitBase += split.shirtNetProfit;
      byInvestor.set(invId, prev);
    } else {
      proprioSalesCount += 1;
      proprioPieces += split.quantity;
      shir7ShirtFromProprio += split.shir7ShirtFromProprio;
    }
  }

  const shir7ShirtTotal = shir7ShirtFromProprio + shir7ShirtFromInvestor;
  const shir7Total = shir7ShirtTotal + persProfit;
  const partners = SHIR7_PARTNERS.map((partner) => ({
    ...partner,
    amount: shir7Total * partner.share,
    fromProprio: shir7ShirtFromProprio * partner.share,
    fromInvestor: shir7ShirtFromInvestor * partner.share,
    fromPersonalization: persProfit * partner.share,
  }));

  return {
    totalNetProfit,
    investorRepasseTotal,
    shir7Total,
    shir7FromProprio: shir7ShirtFromProprio,
    shir7FromInvestor: shir7ShirtFromInvestor,
    proprioNetProfit: shir7ShirtFromProprio,
    proprioSalesCount,
    investorSalesCount,
    shirts: {
      investorRepasseTotal,
      shir7FromInvestor: shir7ShirtFromInvestor,
      shir7FromProprio: shir7ShirtFromProprio,
      shir7Total: shir7ShirtTotal,
      netProfit: shirtNetProfitTotal,
      investorSalesCount,
      proprioSalesCount,
      proprioPieces,
      pieces: shirtPieces,
    },
    personalization: {
      revenue: persRevenue,
      cost: persCost,
      netProfit: persProfit,
      orderCount: persOrderCount,
      pieces: persPieces,
    },
    partners,
    byInvestor: [...byInvestor.entries()]
      .map(([id, stats]) => ({
        investorId: id,
        investorName: investorMap.get(id)?.name || (id === 'sem-investidor' ? 'Sem vínculo' : '—'),
        ...stats,
      }))
      .sort((a, b) => b.repasse - a.repasse),
    saleCount: filtered.length,
  };
}

export function getDefaultPeriodFilters(period = 'month') {
  const now = new Date();
  if (period === 'all') {
    return { dateFrom: '', dateTo: '' };
  }
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    dateFrom: firstDay.toISOString().slice(0, 10),
    dateTo: now.toISOString().slice(0, 10),
  };
}
