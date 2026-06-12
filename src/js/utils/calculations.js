export function totalQuantity(sizes) {
  return (sizes || []).reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
}

/** Quantidade de peças para diluir imposto (array de tamanhos ou número). */
function resolvePieceCount(sizesOrQty) {
  if (typeof sizesOrQty === 'number') {
    return Math.max(0, sizesOrQty);
  }
  return totalQuantity(sizesOrQty);
}

/** Imposto de importação por peça = total de impostos ÷ quantidade de camisetas do lote */
export function importTaxPerUnit(importTaxes, sizesOrQty) {
  const total = resolvePieceCount(sizesOrQty);
  const taxes = Number(importTaxes) || 0;
  if (!total || taxes <= 0) return 0;
  return taxes / total;
}

/** Custo final por peça = custo unitário + imposto diluído por peça */
export function unitCostWithImportTax(costPrice, importTaxes, sizesOrQty) {
  return (Number(costPrice) || 0) + importTaxPerUnit(importTaxes, sizesOrQty);
}

/**
 * Custo unitário de um lote de estoque.
 * O imposto de importação é diluído na quantidade de peças na entrada e congelado por peça.
 */
export function getStockEntryUnitCost(entry) {
  if (!entry) return 0;

  const finalCost = Number(entry.costPrice) || 0;
  const frozenImportPerUnit = entry.importTaxPerUnit != null
    ? Number(entry.importTaxPerUnit)
    : null;
  const baseCost = entry.baseCostPrice != null
    ? Number(entry.baseCostPrice)
    : null;
  const importTaxes = Number(entry.importTaxes) || 0;

  if (frozenImportPerUnit != null && !Number.isNaN(frozenImportPerUnit)) {
    const base = baseCost != null && !Number.isNaN(baseCost)
      ? baseCost
      : Math.max(0, finalCost - frozenImportPerUnit);
    return Math.max(0, base + frozenImportPerUnit);
  }

  if (importTaxes <= 0) {
    return finalCost;
  }

  const entryPieces = Number(entry.entryQuantity) || resolvePieceCount(entry.sizes);
  const baseUnit = baseCost != null && !Number.isNaN(baseCost) ? baseCost : finalCost;
  if (!entryPieces) return baseUnit;
  return baseUnit + importTaxPerUnit(importTaxes, entryPieces);
}

/** Custo unitário da peça para repasse/capital (mercadoria + imposto diluído). */
export function resolveSaleUnitCost(sale, stockEntry = null) {
  if (stockEntry) {
    return getStockEntryUnitCost(stockEntry);
  }

  const base = Number(sale?.baseCostPrice);
  const importPer = Number(sale?.importTaxPerUnit);
  if (Number.isFinite(base) && importPer > 0) {
    return base + importPer;
  }

  return Number(sale?.unitCost) || 0;
}

export function getStockEntryCostBreakdown(entry) {
  if (!entry) {
    return { baseUnit: 0, importPerUnit: 0, unitCost: 0 };
  }

  const unitCost = getStockEntryUnitCost(entry);
  const entryPieces = Number(entry.entryQuantity) || totalQuantity(entry.sizes);
  const importPerUnit = entry.importTaxPerUnit != null
    ? Number(entry.importTaxPerUnit) || 0
    : importTaxPerUnit(Number(entry.importTaxes) || 0, entryPieces);
  const baseUnit = entry.baseCostPrice != null
    ? Number(entry.baseCostPrice) || 0
    : Math.max(0, unitCost - importPerUnit);

  return { baseUnit, importPerUnit, unitCost };
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
  capital_mais_lucro: (v) => `Capital de volta + ${v}% do lucro (sem personalização)`,
  percent_lucro: (v) => `${v}% do lucro`,
  percent_faturamento: (v) => `${v}% do faturamento`,
  fixo_peca: (v) => `R$ ${v} por peça vendida`,
  custo_comissao: (v) => `Custo da peça + ${v}% de comissão`,
  personalizado: (_, notes) => notes || 'Regra personalizada (ver observações)',
};

export const DEFAULT_REPASSE_TYPE = 'capital_mais_lucro';
export const DEFAULT_REPASSE_VALUE = 40;
export const DEFAULT_SALE_PRICE = 229.9;

/**
 * Separa receita de camisa e personalização por linha.
 * Cupom/desconto incide só na camisa; personalização mantém valor cheio.
 * Preço embutido (pers. R$ 0 na linha): unitPrice = total pago; pers. = defaultPersonalizationPrice.
 */
export function resolveLineShirtAndPersonalization(line, defaultPersonalizationPrice = 50) {
  const qty = Number(line.quantity) || 0;
  const unitPrice = Number(line.unitPrice) || 0;
  const defaultPersPrice = Math.max(0, Number(defaultPersonalizationPrice) || 0);

  if (!line.isPersonalized) {
    const itemsSubtotal = qty * unitPrice;
    return {
      qty,
      shirtUnitPrice: unitPrice,
      persPerPiece: 0,
      itemsSubtotal,
      personalizationTotal: 0,
    };
  }

  let persPerPiece = Number(line.personalizationPerPiece) || 0;
  let shirtUnitPrice = unitPrice;

  if (persPerPiece <= 0 && defaultPersPrice > 0) {
    persPerPiece = defaultPersPrice;
    shirtUnitPrice = Math.max(0, unitPrice - persPerPiece);
  }

  return {
    qty,
    shirtUnitPrice,
    persPerPiece,
    itemsSubtotal: qty * shirtUnitPrice,
    personalizationTotal: qty * persPerPiece,
  };
}

/**
 * REGRA SHIR7: lucro de personalização é 100% da loja — não entra no repasse do investidor.
 * Custos variáveis (frete, taxas, ADS) são rateados proporcionalmente entre camisa e personalização.
 */
export function investorProfitExcludingPersonalization(financials) {
  const {
    itemsSubtotal = 0,
    personalizationTotal = 0,
    grossRevenue = 0,
    totalRevenue = 0,
    productCost = 0,
    variableCosts = 0,
    netProfit = 0,
    platformCost = 0,
  } = financials;

  const platformFee = Number(platformCost) || 0;
  const operationalVariableCosts = Math.max(0, (Number(variableCosts) || 0) - platformFee);

  if (!personalizationTotal || personalizationTotal <= 0) {
    return Math.max(0, (Number(netProfit) || 0) + platformFee);
  }

  if (!grossRevenue) {
    return Math.max(0, (Number(netProfit) || 0) + platformFee);
  }

  const itemShare = itemsSubtotal / grossRevenue;
  const itemRevenue = totalRevenue * itemShare;
  const costShare = totalRevenue > 0 ? itemRevenue / totalRevenue : itemShare;
  const itemVariableCosts = operationalVariableCosts * costShare;
  const itemNetProfit = itemRevenue - productCost - itemVariableCosts;

  return Math.max(0, itemNetProfit);
}

/**
 * Lucro líquido da camisa para repasse: lucro líquido total − lucro da personalização.
 * Frete, taxas e demais custos já estão no netProfit.
 */
export function resolveShirtNetProfitForRepasse(financials, persProfit = null) {
  const net = Number(financials?.netProfit) || 0;
  const pers = persProfit != null
    ? Number(persProfit) || 0
    : Math.max(
      0,
      (Number(financials?.personalizationTotal) || 0)
        - (Number(financials?.personalizationCostTotal) || 0)
    );
  return Math.max(0, net - pers);
}

export function investorRevenueExcludingPersonalization(financials) {
  const {
    itemsSubtotal = 0,
    personalizationTotal = 0,
    grossRevenue = 0,
    totalRevenue = 0,
  } = financials;

  if (!personalizationTotal || personalizationTotal <= 0 || !grossRevenue) {
    return totalRevenue;
  }

  return totalRevenue * (itemsSubtotal / grossRevenue);
}

/**
 * Repasse ao investidor com regra de personalização aplicada (vendas rápidas).
 */
export function calculateInvestorRepasseForSale(investor, { unitCost, quantity, financials, persProfit }) {
  const profitBase = resolveShirtNetProfitForRepasse(financials, persProfit);
  const revenueBase = investorRevenueExcludingPersonalization(financials);

  return calculateInvestorRepasse(investor, {
    unitCost,
    quantity,
    netProfit: profitBase,
    grossRevenue: revenueBase,
  });
}

/** Monta financials completos a partir de uma venda (linhas + taxas atuais). */
export function buildSaleFinancialsFromSale(sale, settings = {}, stockEntry = null) {
  const defaultPersCost = Number(settings.personalizationCostPerPiece) || 10;
  const defaultPersPrice = Number(settings.defaultPersonalizationPrice) || 50;
  const unitCost = resolveSaleUnitCost(sale, stockEntry);
  const lines = getSaleLinesForFinancials(sale);

  const computed = calculateQuickSaleFinancials({
    lines,
    unitCost,
    defaultPersonalizationCostPerPiece: defaultPersCost,
    defaultPersonalizationPrice: defaultPersPrice,
    platformCosts: settings.platformCosts || [],
  });

  return {
    ...computed,
    unitCost,
    netProfit: Number(sale?.netProfit) ?? computed.netProfit,
    platformCost: Number(sale?.platformCost) ?? computed.platformCost,
    variableCosts: Number(sale?.variableCosts) ?? computed.variableCosts,
  };
}

/**
 * Parte SHIR7 no lucro da camisa (estoque investidor).
 * capital_mais_lucro: 60% do lucro sem personalização (espelha o 40% do investidor).
 */
export function calculateShir7ShirtShareForInvestor(investor, { unitCost, quantity, financials, persProfit }) {
  const profitBase = resolveShirtNetProfitForRepasse(financials, persProfit);
  const qty = Number(quantity) || 0;
  const cost = Number(unitCost) || 0;
  const rawPct = Number(investor?.repasseValue);
  const pct = Number.isFinite(rawPct) ? rawPct : DEFAULT_REPASSE_VALUE;

  if (investor?.repasseType === 'capital_mais_lucro' || investor?.repasseType === 'percent_lucro') {
    return Math.max(0, profitBase * (1 - pct / 100));
  }

  const payout = calculateInvestorRepasseForSale(investor, {
    unitCost: cost,
    quantity: qty,
    financials,
    persProfit,
  });
  const capital = cost * qty;
  const investorProfitShare = investor?.repasseType === 'percent_faturamento'
    ? payout
    : Math.max(0, payout - capital);

  return Math.max(0, profitBase - investorProfitShare);
}

/**
 * Repasse ao investidor por venda.
 * capital_mais_lucro: custo das peças vendidas + % do lucro (sem personalização).
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

/** Soma quantidade de linhas de venda rápida. */
export function totalSaleLinesQuantity(lines) {
  return (lines || []).reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
}

/**
 * Venda rápida: vários tamanhos, cupom % e personalização por peça.
 */
/** Custo diluído da piscina (ADS + outros) por peça no período. */
export function calculatePoolCostPerPiece({ adsPool = 0, otherPoolCosts = 0, piecesInPeriod = 0 }) {
  const pool = (Number(adsPool) || 0) + (Number(otherPoolCosts) || 0);
  const pieces = Math.max(1, Number(piecesInPeriod) || 0);
  return pool / pieces;
}

/** Taxa de um serviço: % sobre o faturamento do pedido + valor fixo por pedido. */
export function calculatePlatformFee(platform, totalRevenue) {
  if (!platform) return 0;
  const revenue = Math.max(0, Number(totalRevenue) || 0);
  const percent = Math.max(0, Number(platform.percent) || 0);
  const fixed = Math.max(0, Number(platform.fixedPerOrder) || 0);
  return revenue * (percent / 100) + fixed;
}

/** Soma Shopify + Yampi + Appmax (e demais) em toda venda do site. */
export function calculateTotalPlatformFees(platforms, totalRevenue) {
  return (platforms || []).reduce(
    (sum, platform) => sum + calculatePlatformFee(platform, totalRevenue),
    0
  );
}

export function calculatePlatformFeesBreakdown(platforms, totalRevenue) {
  return (platforms || [])
    .map((platform) => ({
      id: platform.id,
      name: platform.name,
      role: platform.role || '',
      amount: calculatePlatformFee(platform, totalRevenue),
    }))
    .filter((row) => row.amount > 0);
}

export function calculateQuickSaleFinancials({
  lines,
  unitCost,
  defaultPersonalizationCostPerPiece = 0,
  defaultPersonalizationPrice = 50,
  platformCosts = [],
}) {
  const defaultPersCost = Number(defaultPersonalizationCostPerPiece) || 0;
  const defaultPersPrice = Number(defaultPersonalizationPrice) || 50;
  const safeLines = (lines || []).map((l) => ({
    quantity: Number(l.quantity) || 0,
    unitPrice: Number(l.unitPrice) || 0,
    freight: Number(l.freight) || 0,
    ads: Number(l.ads) || 0,
    otherCosts: Number(l.otherCosts) || 0,
    isPersonalized: !!l.isPersonalized,
    personalizationPerPiece: Number(l.personalizationPerPiece) || 0,
    personalizationCostPerPiece: l.isPersonalized
      ? Number(l.personalizationCostPerPiece ?? defaultPersCost) || 0
      : 0,
    couponPercent: Math.min(100, Math.max(0, Number(l.couponPercent) || 0)),
  }));

  const lineTotals = safeLines.map((l) => {
    const split = resolveLineShirtAndPersonalization(l, defaultPersPrice);
    const lineDiscount = split.itemsSubtotal * (l.couponPercent / 100);
    const itemRevenue = Math.max(0, split.itemsSubtotal - lineDiscount);
    const lineRevenue = itemRevenue + split.personalizationTotal;
    const lineGross = split.itemsSubtotal + split.personalizationTotal;
    return {
      itemsSubtotal: split.itemsSubtotal,
      personalization: split.personalizationTotal,
      lineGross,
      lineDiscount,
      lineRevenue,
    };
  });

  const totalQty = totalSaleLinesQuantity(safeLines);
  const itemsSubtotal = lineTotals.reduce((sum, l) => sum + l.itemsSubtotal, 0);
  const personalizedQty = safeLines.reduce(
    (sum, l) => sum + (l.isPersonalized ? l.quantity : 0),
    0
  );
  const personalizationTotal = lineTotals.reduce((sum, l) => sum + l.personalization, 0);
  const personalizationCostTotal = safeLines.reduce((sum, l) => {
    if (!l.isPersonalized) return sum;
    return sum + l.quantity * l.personalizationCostPerPiece;
  }, 0);
  const grossRevenue = itemsSubtotal + personalizationTotal;
  const discount = lineTotals.reduce((sum, l) => sum + l.lineDiscount, 0);
  const totalRevenue = lineTotals.reduce((sum, l) => sum + l.lineRevenue, 0);
  const couponPercents = [...new Set(
    safeLines.filter((l) => l.couponPercent > 0).map((l) => l.couponPercent)
  )];
  const cost = Number(unitCost) || 0;
  const productCost = cost * totalQty;
  const freightCost = safeLines.reduce((sum, l) => sum + l.freight, 0);
  const adsCostTotal = safeLines.reduce((sum, l) => sum + l.ads, 0);
  const extraFees = safeLines.reduce((sum, l) => sum + l.otherCosts, 0);
  const platformCost = calculateTotalPlatformFees(platformCosts, totalRevenue);
  const variableCosts = freightCost + adsCostTotal + extraFees + platformCost;
  const grossProfit = totalRevenue - productCost;
  const netProfit = grossProfit - variableCosts - personalizationCostTotal;
  const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  return {
    itemsSubtotal,
    personalizationTotal,
    personalizedQty,
    personalizationCostTotal,
    grossRevenue,
    discount,
    couponPercent: couponPercents.length === 1 ? couponPercents[0] : 0,
    totalRevenue,
    productCost,
    freightCost,
    adsCostTotal,
    poolCostTotal: adsCostTotal,
    extraFees,
    platformCost,
    variableCosts,
    grossProfit,
    netProfit,
    margin,
    totalQty,
  };
}

/** Peças vendidas no mês corrente (para diluir piscina de custos). */
export function piecesSoldInCurrentMonth(sales, extraQty = 0) {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  const monthPieces = (sales || [])
    .filter((s) => {
      if (s.status === 'cancelada' || !s.createdAt?.seconds) return false;
      const d = new Date(s.createdAt.seconds * 1000);
      return d.getMonth() === month && d.getFullYear() === year;
    })
    .reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);

  return monthPieces + (Number(extraQty) || 0);
}

export function computeStockEntryFinancials(entry) {
  const currentQty = Number(entry?.quantity) || totalQuantity(entry?.sizes);
  const entryPieces = Number(entry?.entryQuantity) || currentQty;
  const unitCost = getStockEntryUnitCost(entry);
  const importTotal = Number(entry?.importTaxes) || 0;
  const importPerUnit = Number(entry?.importTaxPerUnit)
    || importTaxPerUnit(importTotal, entryPieces);
  const baseCost = entry?.baseCostPrice != null
    ? Number(entry.baseCostPrice)
    : Math.max(0, unitCost - importPerUnit);
  const suggested = Number(entry?.suggestedSalePrice) || 0;
  const totalPaid = (baseCost * entryPieces) + importTotal;
  const expectedReturn = suggested * currentQty;
  const expectedProfit = expectedReturn - (unitCost * currentQty);

  return {
    entryPieces,
    currentQty,
    baseCost,
    unitCost,
    importTotal,
    importPerUnit,
    totalPaid,
    expectedReturn,
    expectedProfit,
  };
}

export function formatSaleLinesSummary(sale) {
  if (sale?.lines?.length) {
    return sale.lines.map((l) => `${l.quantity} ${l.size}`).join(', ');
  }
  if (sale?.size) {
    return `${sale.quantity || 0} ${sale.size}`;
  }
  return '—';
}

export function calculateTicketMedio(sales) {
  const completed = (sales || []).filter((s) => s.status !== 'cancelada');
  if (!completed.length) return 0;
  const total = completed.reduce((sum, s) => sum + (Number(s.totalRevenue) || 0), 0);
  return total / completed.length;
}

function getSaleLinesForFinancials(sale) {
  if (sale?.lines?.length) {
    return sale.lines.map((line) => ({ ...line }));
  }

  return [{
    size: sale.size || '',
    quantity: Number(sale.quantity) || 1,
    unitPrice: Number(sale.unitPrice) || 0,
    freight: Number(sale.freight) || 0,
    ads: Number(sale.adsCost ?? sale.poolCost) || 0,
    otherCosts: Number(sale.fees) || 0,
    couponId: sale.couponId || '',
    couponName: sale.couponName || '',
    couponPercent: Number(sale.couponPercent) || 0,
    isPersonalized: !!sale.isPersonalized,
    personalizationPerPiece: Number(sale.personalizationPerPiece) || 0,
    personalizationCostPerPiece: Number(sale.personalizationCost) || 0,
  }];
}

/** Recalcula lucro da venda com as taxas atuais (Shopify, Yampi, Appmax). */
export function recalculateSaleWithPlatformSettings(sale, settings = {}, investor = null, stockEntry = null) {
  if (!sale || sale.status === 'cancelada') return sale;

  const platformCosts = settings.platformCosts || [];
  const defaultPersCost = Number(settings.personalizationCostPerPiece) || 10;
  const defaultPersPrice = Number(settings.defaultPersonalizationPrice) || 50;
  const unitCost = resolveSaleUnitCost(sale, stockEntry);
  const lines = getSaleLinesForFinancials(sale);

  const financials = calculateQuickSaleFinancials({
    lines,
    unitCost,
    defaultPersonalizationCostPerPiece: defaultPersCost,
    defaultPersonalizationPrice: defaultPersPrice,
    platformCosts,
  });

  const platformFees = calculatePlatformFeesBreakdown(
    platformCosts,
    financials.totalRevenue
  );

  let investorPayout = Number(sale.investorPayout) || 0;
  if (sale.stockOrigin === 'investidor' && investor) {
    investorPayout = calculateInvestorRepasseForSale(investor, {
      unitCost,
      quantity: financials.totalQty,
      financials,
    });
  }

  return {
    ...sale,
    unitCost,
    itemsSubtotal: financials.itemsSubtotal,
    personalizationTotal: financials.personalizationTotal,
    grossRevenue: financials.grossRevenue,
    totalRevenue: financials.totalRevenue,
    discount: financials.discount,
    grossProfit: financials.grossProfit,
    netProfit: financials.netProfit,
    margin: financials.margin,
    platformCost: financials.platformCost,
    platformFees,
    variableCosts: financials.variableCosts,
    investorPayout,
  };
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
    const unitCost = getStockEntryUnitCost(p);
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
