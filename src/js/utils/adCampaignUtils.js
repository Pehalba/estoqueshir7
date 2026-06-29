import { isSaleActive } from './analytics.js';

/** Custo de ads de campanha — abate só do lucro da camisa, não da personalização. */
export function getSaleCampaignAdsCost(sale) {
  return Math.max(0, Number(sale?.campaignAdsCost) || 0);
}

export function isSaleEligibleForAdCampaign(sale) {
  return isSaleActive(sale)
    && sale.stockOrigin === 'investidor'
    && !sale.isSample
    && !sale.adCampaignId;
}

/** Últimas N vendas do estoque investidor ainda sem campanha de ads. */
export function pickInvestorSalesForCampaign(sales, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!n) return [];

  return [...(sales || [])]
    .filter(isSaleEligibleForAdCampaign)
    .sort((a, b) => {
      const ta = a.createdAt?.seconds ?? 0;
      const tb = b.createdAt?.seconds ?? 0;
      return tb - ta;
    })
    .slice(0, n);
}

export function formatSaleDate(sale) {
  if (!sale?.createdAt?.seconds) return '—';
  return new Date(sale.createdAt.seconds * 1000).toLocaleDateString('pt-BR');
}
