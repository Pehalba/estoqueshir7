import { filterSalesByPeriod, isSaleActive } from './analytics.js';
import { investorProfitExcludingPersonalization } from './calculations.js';

export const SHIR7_PARTNERS = [
  { id: 'pedro', name: 'Pedro', share: 0.5 },
  { id: 'eduardo', name: 'Eduardo', share: 0.5 },
];

/** Parte SHIR7 do lucro em venda de estoque investidor: 60% do lucro (sem personalização). */
export const SHIR7_INVESTOR_PROFIT_PERCENT = 60;

function getSaleFinancials(sale) {
  return {
    itemsSubtotal: Number(sale.itemsSubtotal) || Number(sale.grossRevenue) || 0,
    personalizationTotal: Number(sale.personalizationTotal) || 0,
    grossRevenue: Number(sale.grossRevenue) || 0,
    totalRevenue: Number(sale.totalRevenue) || 0,
    productCost: Number(sale.productCost) || Number(sale.unitCost) * (Number(sale.quantity) || 0),
    variableCosts: Number(sale.variableCosts) || 0,
    netProfit: Number(sale.netProfit) || 0,
  };
}

function getInvestorRepasse(sale) {
  const stored = Number(sale.investorPayout);
  if (Number.isFinite(stored) && stored > 0) {
    return stored;
  }
  return 0;
}

/**
 * Distribuição de lucros SHIR7:
 * - Estoque próprio: lucro líquido 50% Pedro / 50% Eduardo
 * - Estoque investidor: repasse = capital + 40% lucro (sem pers.); SHIR7 fica com o restante
 * - Personalização: 100% SHIR7 (já embutida no lucro líquido)
 */
export function calculatePartnerDistribution(sales, investors = [], filters = {}) {
  const filtered = filterSalesByPeriod(sales, filters).filter(isSaleActive);
  const investorMap = new Map(investors.map((i) => [i.id, i]));
  const byInvestor = new Map();

  let totalNetProfit = 0;
  let investorRepasseTotal = 0;
  let shir7FromProprio = 0;
  let shir7FromInvestor = 0;
  let proprioNetProfit = 0;
  let investorSalesCount = 0;
  let proprioSalesCount = 0;

  for (const sale of filtered) {
    const net = Number(sale.netProfit) || 0;
    totalNetProfit += net;

    if (sale.stockOrigin === 'investidor') {
      investorSalesCount += 1;
      const payout = getInvestorRepasse(sale);
      const shir7Share = Math.max(0, net - payout);

      investorRepasseTotal += payout;
      shir7FromInvestor += shir7Share;

      const invId = sale.investorId || 'sem-investidor';
      const prev = byInvestor.get(invId) || {
        repasse: 0,
        shir7Share: 0,
        netProfit: 0,
        sales: 0,
        pieces: 0,
        profitBase: 0,
      };

      const financials = getSaleFinancials(sale);
      prev.repasse += payout;
      prev.shir7Share += shir7Share;
      prev.netProfit += net;
      prev.sales += 1;
      prev.pieces += Number(sale.quantity) || 0;
      prev.profitBase += investorProfitExcludingPersonalization(financials);
      byInvestor.set(invId, prev);
    } else {
      proprioSalesCount += 1;
      proprioNetProfit += net;
      shir7FromProprio += net;
    }
  }

  const shir7Total = shir7FromProprio + shir7FromInvestor;
  const partners = SHIR7_PARTNERS.map((partner) => ({
    ...partner,
    amount: shir7Total * partner.share,
    fromProprio: shir7FromProprio * partner.share,
    fromInvestor: shir7FromInvestor * partner.share,
  }));

  return {
    totalNetProfit,
    investorRepasseTotal,
    shir7Total,
    shir7FromProprio,
    shir7FromInvestor,
    proprioNetProfit,
    proprioSalesCount,
    investorSalesCount,
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
