import {
  aggregateStock,
  getLowStockList,
  getTopSellingProducts,
  getLossSales,
  getStagnantProducts,
  buildInvestorReport,
  aggregateMonthSales,
  filterSalesByPeriod,
} from '../utils/analytics.js';
import { formatCurrency, formatPercent } from '../utils/formatCurrency.js';
import { totalQuantity } from '../utils/calculations.js';

const QUICK_QUESTIONS = [
  'O que comprar agora?',
  'Produtos parados?',
  'Maior lucro do mês?',
  'Vendas com prejuízo?',
  'Melhor investidor?',
  'Próprio vs investidor?',
  'Resumo do mês',
];

export function getQuickQuestions() {
  return [...QUICK_QUESTIONS];
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  };
}

function answerBuySuggestions({ products, sales, threshold }) {
  const low = getLowStockList(products, threshold);
  const top = getTopSellingProducts(sales, 5);
  const topNames = new Set(top.map((t) => t.productName));

  const suggestions = low
    .filter((item) => topNames.has(item.productName))
    .slice(0, 6);

  if (!suggestions.length && !low.length) {
    return 'Não há itens com estoque baixo no momento. Revise os produtos mais vendidos para planejar a próxima compra.';
  }

  if (!suggestions.length) {
    const fallback = low.slice(0, 6).map((i) => `• ${i.productName} (${i.size}): ${i.available} disp.`).join('\n');
    return `Itens com estoque baixo:\n${fallback}`;
  }

  return `Priorize recompra destes tamanhos (estoque baixo + já vendem bem):\n${
    suggestions.map((i) => `• ${i.productName} — tam. ${i.size}: só ${i.available} disponível(is)`).join('\n')
  }`;
}

function answerStagnant({ products, sales }) {
  const range = monthRange();
  const stagnant = getStagnantProducts(products, sales, range).slice(0, 8);
  if (!stagnant.length) {
    return 'Nenhum produto com estoque parado neste mês. Todos os itens em estoque tiveram pelo menos uma venda.';
  }
  return `Produtos com estoque e sem venda no mês:\n${
    stagnant.map((p) => `• ${p.productName}: ${p.pieces} peças (${p.stockOrigin})`).join('\n')
  }`;
}

function answerMonthProfit({ sales }) {
  const now = new Date();
  const stats = aggregateMonthSales(sales, now.getFullYear(), now.getMonth());
  const top = filterSalesByPeriod(sales, monthRange())
    .sort((a, b) => (Number(b.netProfit) || 0) - (Number(a.netProfit) || 0))
    .slice(0, 3);

  const topLines = top.length
    ? top.map((s, i) => `${i + 1}. ${s.productName}: ${formatCurrency(s.netProfit)}`).join('\n')
    : 'Nenhuma venda no mês ainda.';

  return `Lucro do mês: ${formatCurrency(stats.profit)} (${stats.count} pedidos, margem média ${formatPercent(stats.avgMargin)}).\n\nMaiores lucros:\n${topLines}`;
}

function answerLosses({ sales }) {
  const losses = getLossSales(sales, 6);
  if (!losses.length) {
    return 'Ótimo! Nenhuma venda registrada com prejuízo.';
  }
  return `Vendas com prejuízo:\n${
    losses.map((s) => `• ${s.productName}: ${formatCurrency(s.netProfit)} (${s.quantity} peças)`).join('\n')
  }\n\nRevise cupom, frete, ADS e custo de personalização nessas saídas.`;
}

function answerBestInvestor({ sales, investors, products }) {
  if (!investors?.length) {
    return 'Não há investidores cadastrados.';
  }
  const report = buildInvestorReport(sales, investors, products)
    .sort((a, b) => b.profit - a.profit);
  const best = report[0];
  if (!best.saleCount) {
    return 'Nenhum investidor teve vendas registradas ainda.';
  }
  return `Melhor desempenho: ${best.investorName}\n• ${best.saleCount} vendas · ${best.soldPieces} peças\n• Faturamento: ${formatCurrency(best.revenue)}\n• Lucro: ${formatCurrency(best.profit)}\n• Repasse acumulado: ${formatCurrency(best.repasse)}`;
}

function answerOriginComparison({ products, sales }) {
  const stock = aggregateStock(products);
  const proprioSales = (sales || []).filter((s) => s.stockOrigin !== 'investidor' && s.status !== 'cancelada');
  const invSales = (sales || []).filter((s) => s.stockOrigin === 'investidor' && s.status !== 'cancelada');
  const proprioProfit = proprioSales.reduce((s, x) => s + (Number(x.netProfit) || 0), 0);
  const invProfit = invSales.reduce((s, x) => s + (Number(x.netProfit) || 0), 0);

  return `Estoque atual:\n• Próprio: ${stock.proprioPieces} peças\n• Investidor: ${stock.investidorPieces} peças\n\nLucro acumulado nas vendas:\n• Próprio: ${formatCurrency(proprioProfit)} (${proprioSales.length} pedidos)\n• Investidor: ${formatCurrency(invProfit)} (${invSales.length} pedidos)`;
}

function answerMonthSummary({ sales, products, threshold }) {
  const now = new Date();
  const stats = aggregateMonthSales(sales, now.getFullYear(), now.getMonth());
  const stock = aggregateStock(products);
  const lowCount = getLowStockList(products, threshold).length;
  return `Resumo ${now.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}:\n• Faturamento: ${formatCurrency(stats.revenue)}\n• Lucro: ${formatCurrency(stats.profit)}\n• Peças vendidas: ${stats.pieces}\n• Pedidos: ${stats.count}\n• Ticket médio: ${formatCurrency(stats.ticket)}\n\nEstoque: ${stock.totalPieces} peças (${formatCurrency(stock.costValue)} em custo)\nAlertas estoque baixo: ${lowCount} tamanho(s)`;
}

function answerMarginCosts({ sales }) {
  const monthSales = filterSalesByPeriod(sales, monthRange());
  const freight = monthSales.reduce((s, x) => s + (Number(x.freight) || 0), 0);
  const ads = monthSales.reduce((s, x) => s + (Number(x.adsCost) || 0), 0);
  const fees = monthSales.reduce((s, x) => s + (Number(x.fees) || 0), 0);
  const persCost = monthSales.reduce((s, x) => s + (Number(x.personalizationCost) || 0), 0);
  const discount = monthSales.reduce((s, x) => s + (Number(x.discount) || 0), 0);

  return `Custos que impactam a margem neste mês:\n• Cupons/descontos: ${formatCurrency(discount)}\n• Frete: ${formatCurrency(freight)}\n• ADS/tráfego: ${formatCurrency(ads)}\n• Outros: ${formatCurrency(fees)}\n• Custo personalização: ${formatCurrency(persCost)}\n\nDica: frete e ADS são por linha na saída rápida — revise pedidos com margem baixa.`;
}

function answerMinPrice({ products }) {
  const items = (products || [])
    .filter((p) => p.status !== 'inativo' && totalQuantity(p.sizes) > 0 && Number(p.minimumSalePrice) > 0)
    .slice(0, 8);
  if (!items.length) {
    return 'Nenhum produto com preço mínimo cadastrado. Defina em Estoque → Cadastro de produtos.';
  }
  return `Preços mínimos cadastrados:\n${
    items.map((p) => `• ${p.name}: mín. ${formatCurrency(p.minimumSalePrice)} · sugerido ${formatCurrency(p.suggestedSalePrice)}`).join('\n')
  }`;
}

/**
 * Assistente por regras internas — sem API externa.
 * @param {string} question
 * @param {{ products, sales, investors?, threshold? }} context
 */
export function askAssistant(question, context = {}) {
  const q = normalize(question);
  const data = {
    products: context.products || [],
    sales: context.sales || [],
    investors: context.investors || [],
    threshold: context.threshold ?? 5,
  };

  let answer = '';

  if (/compr|tamanh|recompra|repor/.test(q)) {
    answer = answerBuySuggestions(data);
  } else if (/parad|encalh|sem venda/.test(q)) {
    answer = answerStagnant(data);
  } else if (/preju|prejuizo|negativ/.test(q)) {
    answer = answerLosses(data);
  } else if (/maior lucro|melhor lucro|lucro do mes/.test(q)) {
    answer = answerMonthProfit(data);
  } else if (/investidor|repasse/.test(q)) {
    answer = answerBestInvestor(data);
  } else if (/proprio|investidor|origem|vs/.test(q)) {
    answer = answerOriginComparison(data);
  } else if (/resumo|mes|faturamento/.test(q)) {
    answer = answerMonthSummary(data);
  } else if (/margem|custo|frete|ads|cupom/.test(q)) {
    answer = answerMarginCosts(data);
  } else if (/preco min|minimo|suger/.test(q)) {
    answer = answerMinPrice(data);
  } else {
    answer = `Não entendi bem. Tente perguntas como:\n• ${QUICK_QUESTIONS.join('\n• ')}`;
  }

  return { success: true, answer };
}

/** Stub para integração futura com Cloud Function. */
export async function callCloudFunction(payload) {
  return {
    success: false,
    error: 'Integração com IA externa ainda não configurada.',
    payload,
  };
}
