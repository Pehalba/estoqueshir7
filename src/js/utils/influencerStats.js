import { filterSalesByPeriod, isSaleActive } from './analytics.js';

export function normalizeCouponToken(value) {
  return String(value || '').trim().toUpperCase().replace(/^@/, '');
}

export function parseInfluencerCouponCodes(codesStr) {
  return String(codesStr || '')
    .split(/[,;|\n]+/)
    .map(normalizeCouponToken)
    .filter(Boolean);
}

function collectSaleCouponTokens(sale) {
  const tokens = new Set();

  if (sale.couponName) tokens.add(normalizeCouponToken(sale.couponName));
  if (sale.couponId) tokens.add(normalizeCouponToken(sale.couponId));

  for (const line of sale.lines || []) {
    if (line.couponName) tokens.add(normalizeCouponToken(line.couponName));
    if (line.couponId) tokens.add(normalizeCouponToken(line.couponId));
  }

  return [...tokens];
}

export function saleMatchesInfluencer(sale, influencer) {
  const codes = parseInfluencerCouponCodes(influencer.couponCodes);
  if (!codes.length) return false;

  const saleTokens = collectSaleCouponTokens(sale);
  if (!saleTokens.length) return false;

  return codes.some((code) => saleTokens.some((token) => {
    if (token === code) return true;
    if (token.includes(code) || code.includes(token)) return true;
    return false;
  }));
}

export function calculateInfluencerCommissionForSale(sale, influencer) {
  const type = influencer.commissionType || 'percent_lucro';
  const value = Number(influencer.commissionValue) || 0;
  const qty = Number(sale.quantity) || 1;
  const revenue = Number(sale.totalRevenue) || 0;
  const profit = Math.max(0, Number(sale.netProfit) || 0);

  switch (type) {
    case 'percent_faturamento':
      return revenue * (value / 100);
    case 'fixo_peca':
      return qty * value;
    case 'fixo_venda':
      return value;
    case 'valor_fixo':
    case 'personalizado':
      return 0;
    case 'percent_lucro':
    default:
      return profit * (value / 100);
  }
}

export function calculateInfluencerDue(influencer, sales, filters = {}) {
  const type = influencer.commissionType || 'percent_lucro';
  const manualOnly = type === 'personalizado';

  if (type === 'valor_fixo') {
    return {
      due: Number(influencer.commissionValue) || 0,
      salesCount: 0,
      pieces: 0,
      manualOnly: false,
    };
  }

  if (manualOnly) {
    return { due: 0, salesCount: 0, pieces: 0, manualOnly: true };
  }

  const codes = parseInfluencerCouponCodes(influencer.couponCodes);
  if (!codes.length) {
    return { due: 0, salesCount: 0, pieces: 0, manualOnly: false };
  }

  const filtered = filterSalesByPeriod(sales, filters).filter(isSaleActive);
  let due = 0;
  let salesCount = 0;
  let pieces = 0;

  for (const sale of filtered) {
    if (!saleMatchesInfluencer(sale, influencer)) continue;
    due += calculateInfluencerCommissionForSale(sale, influencer);
    salesCount += 1;
    pieces += Number(sale.quantity) || 1;
  }

  return { due, salesCount, pieces, manualOnly: false };
}

export function getDefaultInfluencerPeriodFilters(period = 'month') {
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
