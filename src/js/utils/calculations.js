import { sortSizes } from './sizes.js';

export const MAX_STOCK_ENTRY_PIECES = 100;

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
  return diluteLotCostPerUnit(importTaxes, sizesOrQty);
}

/** Dilui custo total do lote (imposto, frete internacional, etc.) por peça. */
export function diluteLotCostPerUnit(totalAmount, sizesOrQty) {
  const total = resolvePieceCount(sizesOrQty);
  const amount = Number(totalAmount) || 0;
  if (!total || amount <= 0) return 0;
  return amount / total;
}

/** Custo final por peça = compra + imposto + frete internacional diluídos. */
export function unitCostWithLotDeductions(baseCost, importTaxes, importFreight, sizesOrQty) {
  const base = Number(baseCost) || 0;
  return base
    + diluteLotCostPerUnit(importTaxes, sizesOrQty)
    + diluteLotCostPerUnit(importFreight, sizesOrQty);
}

/** @deprecated Use unitCostWithLotDeductions */
export function unitCostWithImportTax(costPrice, importTaxes, sizesOrQty) {
  return unitCostWithLotDeductions(costPrice, importTaxes, 0, sizesOrQty);
}

/**
 * Custo da mercadoria por peça (não inclui imposto/frete internacional — estes são custo operacional).
 */
export function getStockEntryUnitCost(entry) {
  return getStockEntryCostBreakdown(entry).baseUnit;
}

/** Capital do investidor por peça = custo de compra da mercadoria. */
export function getStockEntryInvestorCapitalUnit(entry) {
  return getStockEntryCostBreakdown(entry).investorCapitalUnit;
}

/** Custo da mercadoria na venda (sem imposto/frete internacional). */
export function resolveSaleUnitCost(sale, stockEntry = null) {
  if (stockEntry) {
    return getStockEntryUnitCost(stockEntry);
  }

  const base = Number(sale?.baseCostPrice);
  if (Number.isFinite(base) && base >= 0) {
    return base;
  }

  const unit = Number(sale?.unitCost) || 0;
  return Math.max(0, unit - resolveSaleLotOperationalCostPerUnit(sale));
}

export function resolveSaleLotImportCostPerUnit(sale, stockEntry = null) {
  if (stockEntry) {
    return getStockEntryCostBreakdown(stockEntry).importPerUnit;
  }
  return Number(sale?.importTaxPerUnit) || 0;
}

export function resolveSaleLotFreightCostPerUnit(sale, stockEntry = null) {
  if (stockEntry) {
    return getStockEntryCostBreakdown(stockEntry).freightPerUnit;
  }
  return Number(sale?.importFreightPerUnit) || 0;
}

/** Imposto + frete internacional diluídos por peça (custo operacional, como taxas Yampi/Appmax). */
export function resolveSaleLotOperationalCostPerUnit(sale, stockEntry = null) {
  return resolveSaleLotImportCostPerUnit(sale, stockEntry)
    + resolveSaleLotFreightCostPerUnit(sale, stockEntry);
}

/** Capital devolvido ao investidor por peça (só mercadoria). */
export function resolveInvestorCapitalUnitCost(sale, stockEntry = null) {
  return resolveSaleUnitCost(sale, stockEntry);
}

export function getStockEntryCostBreakdown(entry) {
  if (!entry) {
    return {
      baseUnit: 0,
      importPerUnit: 0,
      freightPerUnit: 0,
      operationalCostPerUnit: 0,
      unitCost: 0,
      investorCapitalUnit: 0,
    };
  }

  const entryPieces = Number(entry.entryQuantity) || totalQuantity(entry.sizes);
  const importPerUnit = entry.importTaxPerUnit != null
    ? Number(entry.importTaxPerUnit) || 0
    : diluteLotCostPerUnit(Number(entry.importTaxes) || 0, entryPieces);
  const freightPerUnit = entry.importFreightPerUnit != null
    ? Number(entry.importFreightPerUnit) || 0
    : diluteLotCostPerUnit(Number(entry.importFreight) || 0, entryPieces);
  const storedFinal = Number(entry.costPrice) || 0;
  const baseUnit = entry.baseCostPrice != null
    ? Number(entry.baseCostPrice) || 0
    : Math.max(0, storedFinal - importPerUnit - freightPerUnit);
  const operationalCostPerUnit = importPerUnit + freightPerUnit;

  return {
    baseUnit,
    importPerUnit,
    freightPerUnit,
    operationalCostPerUnit,
    unitCost: baseUnit,
    investorCapitalUnit: baseUnit,
  };
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
  capital_mais_lucro: (v) => `Capital da mercadoria + ${v}% do lucro (sem imposto, frete int. ou pers.)`,
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
 * capitalUnitCost = só mercadoria; imposto/frete internacional entram no lucro, não no capital.
 */
export function calculateInvestorRepasseForSale(investor, {
  unitCost,
  capitalUnitCost,
  quantity,
  financials,
  persProfit,
  sale = null,
  stockEntry = null,
}) {
  const profitBase = resolveShirtNetProfitForRepasse(financials, persProfit);
  const revenueBase = investorRevenueExcludingPersonalization(financials);
  const capitalUnit = capitalUnitCost != null
    ? Number(capitalUnitCost)
    : resolveInvestorCapitalUnitCost(sale, stockEntry);

  return calculateInvestorRepasse(investor, {
    unitCost: capitalUnit,
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
  const lotImportCostPerUnit = resolveSaleLotImportCostPerUnit(sale, stockEntry);
  const lotFreightCostPerUnit = resolveSaleLotFreightCostPerUnit(sale, stockEntry);
  const lines = getSaleLinesForFinancials(sale);

  return calculateQuickSaleFinancials({
    lines,
    unitCost,
    lotImportCostPerUnit,
    lotFreightCostPerUnit,
    defaultPersonalizationCostPerPiece: defaultPersCost,
    defaultPersonalizationPrice: defaultPersPrice,
    platformCosts: settings.platformCosts || [],
  });
}

/**
 * Parte SHIR7 no lucro da camisa (estoque investidor).
 * capital_mais_lucro: 60% do lucro sem personalização (espelha o 40% do investidor).
 */
export function calculateShir7ShirtShareForInvestor(investor, {
  unitCost,
  capitalUnitCost,
  quantity,
  financials,
  persProfit,
  sale = null,
  stockEntry = null,
}) {
  const profitBase = resolveShirtNetProfitForRepasse(financials, persProfit);
  const qty = Number(quantity) || 0;
  const capitalUnit = capitalUnitCost != null
    ? Number(capitalUnitCost)
    : resolveInvestorCapitalUnitCost(sale, stockEntry);
  const rawPct = Number(investor?.repasseValue);
  const pct = Number.isFinite(rawPct) ? rawPct : DEFAULT_REPASSE_VALUE;

  if (investor?.repasseType === 'capital_mais_lucro' || investor?.repasseType === 'percent_lucro') {
    return Math.max(0, profitBase * (1 - pct / 100));
  }

  const payout = calculateInvestorRepasseForSale(investor, {
    unitCost,
    capitalUnitCost: capitalUnit,
    quantity: qty,
    financials,
    persProfit,
    sale,
    stockEntry,
  });
  const capital = capitalUnit * qty;
  const investorProfitShare = investor?.repasseType === 'percent_faturamento'
    ? payout
    : Math.max(0, payout - capital);

  return Math.max(0, profitBase - investorProfitShare);
}

/**
 * Repasse ao investidor por venda.
 * capital_mais_lucro: capital da mercadoria (sem imposto/frete int.) + % do lucro da camisa.
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

/** Estimativa de repasse (1 peça ou lote) com lucro = preço − mercadoria − custos operacionais do lote. */
export function estimateRepasseAtPrice(investor, product, quantity = 1) {
  const qty = Number(quantity) || 1;
  const baseCost = Number(product.baseCostPrice) || Number(product.costPrice) || 0;
  const pieces = product.sizes || product.entryQuantity || qty;
  const importPerUnit = diluteLotCostPerUnit(product.importTaxes, pieces);
  const freightPerUnit = diluteLotCostPerUnit(product.importFreight, pieces);
  const unitPrice = Number(product.suggestedSalePrice) || 0;
  const netProfit = (unitPrice - baseCost - importPerUnit - freightPerUnit) * qty;

  return calculateInvestorRepasse(investor, {
    unitCost: baseCost,
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
  lotImportCostPerUnit = 0,
  lotFreightCostPerUnit = 0,
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
  const importPerUnit = Number(lotImportCostPerUnit) || 0;
  const lotFreightPerUnit = Number(lotFreightCostPerUnit) || 0;
  const productCost = cost * totalQty;
  const lotImportCostTotal = importPerUnit * totalQty;
  const lotFreightCostTotal = lotFreightPerUnit * totalQty;
  const lotOperationalCostTotal = lotImportCostTotal + lotFreightCostTotal;
  const freightCost = safeLines.reduce((sum, l) => sum + l.freight, 0);
  const adsCostTotal = safeLines.reduce((sum, l) => sum + l.ads, 0);
  const extraFees = safeLines.reduce((sum, l) => sum + l.otherCosts, 0);
  const platformCost = calculateTotalPlatformFees(platformCosts, totalRevenue);
  const variableCosts = freightCost + adsCostTotal + extraFees + platformCost + lotOperationalCostTotal;
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
    lotImportCostPerUnit: importPerUnit,
    lotFreightCostPerUnit,
    lotImportCostTotal,
    lotFreightCostTotal,
    lotOperationalCostTotal,
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

export function getStockEntryPieces(entry) {
  if (entry?.entrySizes?.length) {
    return totalQuantity(entry.entrySizes);
  }
  const stored = Number(entry?.entryQuantity);
  if (stored > 0) return stored;
  return Number(entry?.quantity) || totalQuantity(entry?.sizes);
}

/** Entrada inicial do lote (cadastro), não estorno de pedido. */
export function isStockLotInitialMovement(movement) {
  if (movement?.type !== 'entrada') return false;
  if (movement?.relatedSaleId) return false;
  const obs = String(movement?.observation || '').toLowerCase();
  return !obs.includes('estorno');
}

function sumSizesFromMovements(movements, filterFn) {
  const map = new Map();
  (movements || []).filter(filterFn).forEach((movement) => {
    const qty = Number(movement.quantity) || 0;
    if (!movement.size || qty <= 0) return;
    map.set(movement.size, (map.get(movement.size) || 0) + qty);
  });
  return map;
}

function mapToSizeList(sizeMap) {
  return sortSizes([...sizeMap.entries()].map(([size, quantity]) => ({ size, quantity })));
}

/**
 * Contagem unificada do lote: entrada inicial pelas peças cadastradas (entrySizes ou
 * movimentos de entrada), vendidas = entrada − saldo atual.
 */
export function buildStockEntryQuantityStats(entry, movements = []) {
  const currentSizes = sortSizes((entry?.sizes || []).map((s) => ({
    size: s.size,
    quantity: Number(s.quantity) || 0,
  })));
  const currentQty = Number(entry?.quantity) || totalQuantity(currentSizes);
  const lotMovements = movements || [];

  let initialSizes = null;
  let initialSource = 'stored';

  if (entry?.entrySizes?.length) {
    initialSizes = sortSizes(entry.entrySizes.map((s) => ({
      size: s.size,
      quantity: Number(s.quantity) || 0,
    })));
  } else {
    const initialMap = sumSizesFromMovements(lotMovements, isStockLotInitialMovement);
    if (initialMap.size > 0) {
      initialSizes = mapToSizeList(initialMap);
      initialSource = 'movements';
    }
  }

  const soldMap = sumSizesFromMovements(lotMovements, (m) => m.type === 'saida');
  const grossSoldQty = [...soldMap.values()].reduce((sum, qty) => sum + qty, 0);

  let entryPieces;
  if (initialSizes?.length) {
    entryPieces = totalQuantity(initialSizes);
  } else {
    entryPieces = getStockEntryPieces(entry);
    initialSizes = currentSizes;
    initialSource = 'fallback';
  }

  const soldQty = Math.max(0, entryPieces - currentQty);
  const soldPercent = entryPieces > 0 ? Math.round((soldQty / entryPieces) * 100) : 0;
  const oversoldQty = Math.max(0, grossSoldQty - entryPieces);
  const storedEntryQty = Number(entry?.entryQuantity) || 0;
  const entryQuantityMismatch = storedEntryQty > 0 && storedEntryQty !== entryPieces;
  const hasMovementOversell = grossSoldQty > entryPieces;

  return {
    currentSizes,
    currentQty,
    initialSizes,
    initialSource,
    entryPieces,
    soldQty,
    soldPercent,
    grossSoldQty,
    oversoldQty,
    storedEntryQty,
    entryQuantityMismatch,
    hasMovementOversell,
    hasRecordedEntry: entryPieces > 0,
  };
}

export function computeStockEntryFinancials(entry) {
  const currentQty = Number(entry?.quantity) || totalQuantity(entry?.sizes);
  const entryPieces = getStockEntryPieces(entry);
  const breakdown = getStockEntryCostBreakdown(entry);
  const {
    baseCost: baseUnit,
    unitCost,
    importPerUnit,
    freightPerUnit,
  } = {
    baseCost: breakdown.baseUnit,
    unitCost: breakdown.unitCost,
    importPerUnit: breakdown.importPerUnit,
    freightPerUnit: breakdown.freightPerUnit,
  };
  const importTotal = Number(entry?.importTaxes) || 0;
  const freightTotal = Number(entry?.importFreight) || 0;
  const suggested = Number(entry?.suggestedSalePrice) || 0;
  const totalPaid = (baseUnit * entryPieces) + importTotal + freightTotal;
  const expectedReturn = suggested * currentQty;
  const operationalPerUnit = importPerUnit + freightPerUnit;
  const expectedProfit = expectedReturn - ((baseUnit + operationalPerUnit) * currentQty);

  return {
    entryPieces,
    currentQty,
    baseCost: baseUnit,
    unitCost: baseUnit,
    importTotal,
    importPerUnit,
    freightTotal,
    freightPerUnit,
    operationalPerUnit,
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
  const capitalUnitCost = resolveInvestorCapitalUnitCost(sale, stockEntry);
  const lotImportCostPerUnit = resolveSaleLotImportCostPerUnit(sale, stockEntry);
  const lotFreightCostPerUnit = resolveSaleLotFreightCostPerUnit(sale, stockEntry);
  const lines = getSaleLinesForFinancials(sale);

  const financials = calculateQuickSaleFinancials({
    lines,
    unitCost,
    lotImportCostPerUnit,
    lotFreightCostPerUnit,
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
      capitalUnitCost,
      quantity: financials.totalQty,
      financials,
      sale,
      stockEntry,
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
