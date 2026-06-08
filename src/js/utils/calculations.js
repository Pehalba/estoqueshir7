export function totalQuantity(sizes) {
  return (sizes || []).reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
}

/** Imposto de importação por peça = total de impostos ÷ quantidade total */
export function importTaxPerUnit(importTaxes, sizes) {
  const total = totalQuantity(sizes);
  const taxes = Number(importTaxes) || 0;
  if (!total || taxes <= 0) return 0;
  return taxes / total;
}

/** Custo final por peça = custo unitário + imposto por peça */
export function unitCostWithImportTax(costPrice, importTaxes, sizes) {
  return (Number(costPrice) || 0) + importTaxPerUnit(importTaxes, sizes);
}

export function totalReserved(sizes) {
  return (sizes || []).reduce((sum, s) => sum + (Number(s.reserved) || 0), 0);
}

export function availableQty(sizeEntry) {
  return (Number(sizeEntry?.quantity) || 0) - (Number(sizeEntry?.reserved) || 0);
}

/**
 * Calcula novo saldo após movimentação em um tamanho.
 * @returns {{ quantity, reserved, error? }}
 */
export function applyMovement(sizeEntry, type, qty, adjustTo = null) {
  const quantity = Number(sizeEntry?.quantity) || 0;
  const reserved = Number(sizeEntry?.reserved) || 0;
  const amount = Number(qty) || 0;

  if (type === 'ajuste') {
    const newQty = Number(adjustTo);
    if (isNaN(newQty) || newQty < 0) {
      return { error: 'Informe a quantidade final válida para o ajuste.' };
    }
    if (newQty < reserved) {
      return { error: `Quantidade não pode ser menor que o reservado (${reserved}).` };
    }
    return { quantity: newQty, reserved };
  }

  if (amount <= 0) {
    return { error: 'Informe uma quantidade maior que zero.' };
  }

  switch (type) {
    case 'entrada':
      return { quantity: quantity + amount, reserved };

    case 'saida':
      if (availableQty({ quantity, reserved }) < amount) {
        return { error: 'Estoque disponível insuficiente.' };
      }
      return { quantity: quantity - amount, reserved };

    case 'reserva':
      if (availableQty({ quantity, reserved }) < amount) {
        return { error: 'Estoque disponível insuficiente para reservar.' };
      }
      return { quantity, reserved: reserved + amount };

    case 'devolucao':
      if (reserved >= amount) {
        return { quantity, reserved: reserved - amount };
      }
      return { quantity: quantity + amount, reserved };

    default:
      return { error: 'Tipo de movimentação inválido.' };
  }
}

const REPASSE_LABELS = {
  capital_mais_lucro: (v) => `Capital de volta + ${v}% do lucro líquido`,
  percent_lucro: (v) => `${v}% do lucro`,
  percent_faturamento: (v) => `${v}% do faturamento`,
  fixo_peca: (v) => `R$ ${v} por peça vendida`,
  custo_comissao: (v) => `Custo da peça + ${v}% de comissão`,
  personalizado: (_, notes) => notes || 'Regra personalizada (ver observações)',
};

export const DEFAULT_REPASSE_TYPE = 'capital_mais_lucro';
export const DEFAULT_REPASSE_VALUE = 40;

/**
 * Repasse ao investidor por venda.
 * capital_mais_lucro: custo das peças vendidas + % do lucro líquido total da venda.
 */
export function calculateInvestorRepasse(investor, { unitCost, quantity, netProfit, grossRevenue }) {
  const qty = Number(quantity) || 0;
  const cost = Number(unitCost) || 0;
  const profit = Number(netProfit) || 0;
  const rawPct = Number(investor?.repasseValue);
  const pct = Number.isFinite(rawPct) ? rawPct : DEFAULT_REPASSE_VALUE;
  const revenue = Number(grossRevenue) || 0;

  switch (investor?.repasseType) {
    case 'capital_mais_lucro': {
      const capital = cost * qty;
      const profitShare = profit * (pct / 100);
      return Math.max(0, capital + profitShare);
    }
    case 'percent_lucro':
      return Math.max(0, profit * (pct / 100));
    case 'percent_faturamento':
      return Math.max(0, revenue * (pct / 100));
    case 'fixo_peca':
      return Math.max(0, pct * qty);
    case 'custo_comissao':
      return Math.max(0, cost * qty * (1 + pct / 100));
    case 'personalizado':
    default:
      return 0;
  }
}

/** Estimativa de repasse (1 peça ou lote) com lucro = preço − custo, sem taxas da venda. */
export function estimateRepasseAtPrice(investor, product, quantity = 1) {
  const qty = Number(quantity) || 1;
  const unitCost = unitCostWithImportTax(
    product.costPrice,
    product.importTaxes,
    product.sizes
  );
  const unitPrice = Number(product.suggestedSalePrice) || 0;
  const netProfit = (unitPrice - unitCost) * qty;

  return calculateInvestorRepasse(investor, {
    unitCost,
    quantity: qty,
    netProfit,
    grossRevenue: unitPrice * qty,
  });
}

export function formatRepasseRule(investor) {
  if (!investor?.repasseType) return '—';
  const fn = REPASSE_LABELS[investor.repasseType];
  if (!fn) return investor.repasseType;
  return fn(investor.repasseValue ?? 0, investor.notes);
}

export const DEFAULT_MIN_MARGIN_PERCENT = 10;

/**
 * Cálculos financeiros centralizados de uma venda.
 */
export function calculateSaleFinancials({
  quantity,
  unitPrice,
  unitCost,
  discount = 0,
  fees = 0,
  trafficCost = 0,
}) {
  const qty = Number(quantity) || 0;
  const price = Number(unitPrice) || 0;
  const cost = Number(unitCost) || 0;
  const disc = Number(discount) || 0;
  const fee = Number(fees) || 0;
  const traffic = Number(trafficCost) || 0;

  const grossRevenue = price * qty;
  const totalRevenue = Math.max(0, grossRevenue - disc);
  const productCost = cost * qty;
  const variableCosts = fee + traffic;
  const grossProfit = totalRevenue - productCost;
  const netProfit = grossProfit - variableCosts;
  const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const roi = traffic > 0 ? (netProfit / traffic) * 100 : null;

  return {
    grossRevenue,
    totalRevenue,
    productCost,
    variableCosts,
    grossProfit,
    netProfit,
    margin,
    roi,
  };
}

export function calculateTicketMedio(sales) {
  const completed = (sales || []).filter((s) => s.status !== 'cancelada');
  if (!completed.length) return 0;
  const total = completed.reduce((sum, s) => sum + (Number(s.totalRevenue) || 0), 0);
  return total / completed.length;
}

/** Totais de vendas já realizadas por investidor. */
export function investorSalesTotals(sales, investorId) {
  const linked = (sales || []).filter(
    (s) => s.investorId === investorId && s.status !== 'cancelada'
  );

  return linked.reduce(
    (acc, s) => {
      acc.soldValue += Number(s.totalRevenue) || 0;
      acc.profit += Number(s.netProfit) || 0;
      acc.repassePaid += Number(s.investorPayout) || 0;
      acc.saleCount += 1;
      return acc;
    },
    { soldValue: 0, profit: 0, repassePaid: 0, saleCount: 0 }
  );
}

/** Totais do investidor com base nos produtos em estoque. */
export function investorStockTotals(products, investorId) {
  const linked = (products || []).filter(
    (p) => p.stockOrigin === 'investidor' && p.investorId === investorId
  );

  let pieces = 0;
  let investedValue = 0;
  let potentialRevenue = 0;

  for (const p of linked) {
    const qty = totalQuantity(p.sizes);
    const unitCost = unitCostWithImportTax(p.costPrice, p.importTaxes, p.sizes);
    pieces += qty;
    investedValue += unitCost * qty;
    potentialRevenue += (Number(p.suggestedSalePrice) || 0) * qty;
  }

  return {
    productCount: linked.length,
    pieces,
    investedValue,
    potentialRevenue,
    potentialProfit: potentialRevenue - investedValue,
    products: linked,
  };
}
