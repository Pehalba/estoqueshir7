import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';
import { cachedFetch, invalidateCache, CACHE_KEYS } from '../utils/dataCache.js';
import { getCurrentUser } from './authService.js';
import { getProductById } from './productService.js';
import { getStockEntryById, listStockEntries } from './stockEntryService.js';
import { getInvestorById } from './investorService.js';
import { registerMovement } from './stockService.js';
import {
  availableQty,
  getStockEntryUnitCost,
  getStockEntryCostBreakdown,
  calculateSaleFinancials,
  calculateQuickSaleFinancials,
  calculatePlatformFeesBreakdown,
  calculateInvestorRepasse,
  calculateInvestorRepasseForSale,
  resolveInvestorCapitalUnitCost,
  resolveSaleLotImportCostPerUnit,
  resolveSaleLotFreightCostPerUnit,
  totalSaleLinesQuantity,
  recalculateSaleWithPlatformSettings,
} from '../utils/calculations.js';
import { validateSale, validateQuickSale } from '../utils/validators.js';
import { normalizeShopOrderId, parseShopifyAdminOrderUrl } from '../utils/orderShipping.js';
import { normalizeOrderSize } from '../utils/stockAllocation.js';

const COLLECTION = 'sales';
const MOVEMENTS = 'stockMovements';

function mapSale(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

async function fetchSalesFromFirestore() {
  const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  const sales = snapshot.docs.map(mapSale);
  sales.sort((a, b) => {
    const ta = a.createdAt?.seconds ?? 0;
    const tb = b.createdAt?.seconds ?? 0;
    return tb - ta;
  });
  return { success: true, data: sales };
}

export async function listSales(filters = {}, options = {}) {
  try {
    const result = await cachedFetch(CACHE_KEYS.SALES, fetchSalesFromFirestore, options);
    if (!result.success) return result;

    let sales = [...result.data];

    if (filters.status) {
      sales = sales.filter((s) => s.status === filters.status);
    }
    if (filters.channel) {
      sales = sales.filter((s) => s.channel === filters.channel);
    }
    if (filters.investorId) {
      sales = sales.filter((s) => s.investorId === filters.investorId);
    }
    if (filters.stockOrigin) {
      sales = sales.filter((s) => s.stockOrigin === filters.stockOrigin);
    }
    if (filters.search) {
      const term = filters.search.toLowerCase();
      sales = sales.filter((s) =>
        [s.orderId, s.productName, s.customer, s.trackingCode].filter(Boolean).join(' ').toLowerCase().includes(term)
      );
    }
    if (filters.shippingStatus) {
      sales = sales.filter((s) => {
        const status = s.shippingStatus || (s.trackingCode ? 'enviado' : 'nao_enviado');
        return status === filters.shippingStatus;
      });
    }

    return { success: true, data: sales, fromCache: result.fromCache };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getSaleById(id) {
  try {
    const snapshot = await getDoc(doc(db, COLLECTION, id));
    if (!snapshot.exists()) {
      return { success: false, error: 'Venda não encontrada.' };
    }
    return { success: true, data: mapSale(snapshot) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function orderIdExists(orderId) {
  try {
    const q = query(
      collection(db, COLLECTION),
      where('orderId', '==', orderId.trim()),
      limit(1)
    );
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch {
    return false;
  }
}

export async function createSale(input) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const orderId = String(input.orderId || '').trim();
  const stockEntryId = input.stockEntryId || input.productId;
  const size = input.size;
  const quantity = Number(input.quantity) || 0;

  try {
    const [entryResult, duplicate] = await Promise.all([
      getStockEntryById(stockEntryId),
      orderIdExists(orderId),
    ]);

    if (!entryResult.success) {
      return { success: false, error: entryResult.error };
    }

    const stockEntry = entryResult.data;
    const productId = stockEntry.productId;
    const productResult = productId
      ? await getProductById(productId)
      : { success: true, data: { name: stockEntry.productName } };
    const product = productResult.success
      ? productResult.data
      : { name: stockEntry.productName };

    const stockLikeProduct = {
      ...product,
      sizes: stockEntry.sizes,
      costPrice: stockEntry.costPrice,
      importTaxes: stockEntry.importTaxes,
      suggestedSalePrice: stockEntry.suggestedSalePrice,
      minimumSalePrice: stockEntry.minimumSalePrice,
      stockOrigin: stockEntry.stockOrigin,
      investorId: stockEntry.investorId,
    };

    const sizeEntry = (stockEntry.sizes || []).find(
      (s) => normalizeOrderSize(s.size) === normalizeOrderSize(size)
    );
    const stockAvailable = sizeEntry ? availableQty(sizeEntry) : 0;
    const unitCost = getStockEntryUnitCost(stockEntry);
    const costBreakdown = getStockEntryCostBreakdown(stockEntry);
    const capitalUnitCost = costBreakdown.investorCapitalUnit;

    const financials = calculateSaleFinancials({
      quantity,
      unitPrice: input.unitPrice,
      unitCost,
      discount: input.discount,
      fees: input.fees,
      trafficCost: input.trafficCost,
    });
    const lotOperationalTotal = (costBreakdown.importPerUnit + costBreakdown.freightPerUnit) * quantity;
    if (lotOperationalTotal > 0) {
      financials.variableCosts = (Number(financials.variableCosts) || 0) + lotOperationalTotal;
      financials.netProfit = (Number(financials.netProfit) || 0) - lotOperationalTotal;
      financials.margin = financials.totalRevenue > 0
        ? (financials.netProfit / financials.totalRevenue) * 100
        : 0;
    }

    const validation = validateSale(
      { ...input, orderId, unitCost, stockEntryId },
      { product: stockLikeProduct, availableQty: stockAvailable, orderIdExists: duplicate, financials }
    );

    if (!validation.valid) {
      return { success: false, error: validation.errors.join(' ') };
    }

    let investor = null;
    let investorPayout = 0;

    if (stockEntry.stockOrigin === 'investidor' && stockEntry.investorId) {
      const invResult = await getInvestorById(stockEntry.investorId);
      if (invResult.success) {
        investor = invResult.data;
        investorPayout = calculateInvestorRepasse(investor, {
          unitCost: capitalUnitCost,
          quantity,
          netProfit: financials.netProfit,
          grossRevenue: financials.totalRevenue,
        });
      }
    }

    const movementResult = await registerMovement({
      stockEntryId,
      productId,
      size,
      type: 'saida',
      quantity,
      observation: `Venda pedido ${orderId}`,
      stockEntryName: stockEntry.name,
    });

    if (!movementResult.success) {
      return { success: false, error: movementResult.error };
    }

    const salePayload = {
      orderId,
      stockEntryId,
      productId,
      productName: stockEntry.productName || product.name || '',
      stockEntryName: stockEntry.name || '',
      size,
      quantity,
      unitPrice: Number(input.unitPrice) || 0,
      unitCost,
      baseCostPrice: costBreakdown.baseUnit,
      importTaxPerUnit: costBreakdown.importPerUnit,
      importFreightPerUnit: costBreakdown.freightPerUnit,
      discount: Number(input.discount) || 0,
      fees: Number(input.fees) || 0,
      trafficCost: Number(input.trafficCost) || 0,
      channel: input.channel || '',
      paymentMethod: input.paymentMethod || '',
      customer: input.customer?.trim() || '',
      stockOrigin: stockEntry.stockOrigin || 'proprio',
      investorId: stockEntry.investorId || '',
      investorPayout,
      grossRevenue: financials.grossRevenue,
      totalRevenue: financials.totalRevenue,
      variableCosts: financials.variableCosts,
      grossProfit: financials.grossProfit,
      netProfit: financials.netProfit,
      margin: financials.margin,
      roi: financials.roi,
      movementId: movementResult.data.movementId,
      status: 'concluida',
      shippingStatus: 'nao_enviado',
      trackingCode: '',
      userId: user.uid,
      userEmail: user.email || '',
      createdAt: serverTimestamp(),
    };

    const saleRef = await addDoc(collection(db, COLLECTION), salePayload);

    await updateDoc(doc(db, MOVEMENTS, movementResult.data.movementId), {
      relatedSaleId: saleRef.id,
    });

    invalidateCache(
      CACHE_KEYS.SALES,
      CACHE_KEYS.STOCK_ENTRIES,
      CACHE_KEYS.MOVEMENTS
    );

    return { success: true, data: { id: saleRef.id, ...salePayload, investorPayout } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function generateQuickOrderId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `S${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Venda rápida: vários tamanhos, cupom %, personalização, baixa múltipla no estoque. */
export async function createQuickSale(input) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const stockEntryId = input.stockEntryId || input.productId;
  const lines = (input.lines || []).map((l) => ({
    size: l.size,
    quantity: Number(l.quantity) || 0,
    unitPrice: Number(l.unitPrice) || 0,
    freight: Number(l.freight) || 0,
    ads: Number(l.ads) || 0,
    otherCosts: Number(l.otherCosts) || 0,
    couponId: l.couponId || '',
    couponName: l.couponName || '',
    couponPercent: Number(l.couponPercent) || 0,
    isPersonalized: !!l.isPersonalized,
    personalizationTypeId: l.personalizationTypeId || '',
    personalizationTypeName: l.personalizationTypeName || '',
    personalizationPerPiece: l.isPersonalized
      ? Number(l.personalizationPerPiece) || 0
      : 0,
    personalizationCostPerPiece: l.isPersonalized
      ? Number(l.personalizationCostPerPiece) || 0
      : 0,
  }));

  try {
    const entryResult = await getStockEntryById(stockEntryId);
    if (!entryResult.success) {
      return { success: false, error: entryResult.error };
    }

    const stockEntry = entryResult.data;
    const productId = stockEntry.productId;
    const productResult = productId ? await getProductById(productId) : { success: true, data: { name: stockEntry.productName } };
    const product = productResult.success ? productResult.data : { name: stockEntry.productName };

    const unitCost = getStockEntryUnitCost(stockEntry);
    const costBreakdown = getStockEntryCostBreakdown(stockEntry);
    const capitalUnitCost = costBreakdown.investorCapitalUnit;

    const stockLikeProduct = {
      ...product,
      sizes: stockEntry.sizes,
      costPrice: stockEntry.costPrice,
      importTaxes: stockEntry.importTaxes,
      suggestedSalePrice: stockEntry.suggestedSalePrice,
      minimumSalePrice: stockEntry.minimumSalePrice,
      stockOrigin: stockEntry.stockOrigin,
      investorId: stockEntry.investorId,
    };

    const linesWithStock = lines.map((line) => {
      const size = normalizeOrderSize(line.size);
      const sizeEntry = (stockEntry.sizes || []).find(
        (s) => normalizeOrderSize(s.size) === size
      );
      return {
        ...line,
        size,
        available: sizeEntry ? availableQty(sizeEntry) : 0,
      };
    });

    const platformCosts = input.platformCosts || [];

    const financials = calculateQuickSaleFinancials({
      lines,
      unitCost,
      lotImportCostPerUnit: costBreakdown.importPerUnit,
      lotFreightCostPerUnit: costBreakdown.freightPerUnit,
      defaultPersonalizationCostPerPiece: input.defaultPersonalizationCostPerPiece,
      defaultPersonalizationPrice: input.defaultPersonalizationPrice,
      platformCosts,
    });

    const platformFees = calculatePlatformFeesBreakdown(platformCosts, financials.totalRevenue);

    const skipMinimumPriceCheck = !!input.allowBelowMinimum;
    const validation = validateQuickSale(
      { ...input, unitCost, productId: stockEntryId, allowBelowMinimum: skipMinimumPriceCheck },
      { product: stockLikeProduct, lines: linesWithStock, financials, skipMinimumPriceCheck }
    );

    if (!validation.valid) {
      return { success: false, error: validation.errors.join(' ') };
    }

    let investor = null;
    let investorPayout = 0;

    if (stockEntry.stockOrigin === 'investidor' && stockEntry.investorId) {
      const invResult = await getInvestorById(stockEntry.investorId);
      if (invResult.success) {
        investor = invResult.data;
        investorPayout = calculateInvestorRepasseForSale(investor, {
          unitCost,
          capitalUnitCost,
          quantity: financials.totalQty,
          financials,
          stockEntry,
        });
      }
    }

    const orderId = String(input.orderId || '').trim() || generateQuickOrderId();
    if (input.orderId) {
      const duplicate = await orderIdExists(orderId);
      if (duplicate) {
        return { success: false, error: `Pedido ${orderId} já foi registrado.` };
      }
    }

    const movementIds = [];

    for (const line of lines) {
      const movementResult = await registerMovement({
        stockEntryId,
        productId,
        size: line.size,
        type: 'saida',
        quantity: line.quantity,
        observation: `Venda rápida ${orderId}`,
        stockEntryName: stockEntry.name,
      });

      if (!movementResult.success) {
        return {
          success: false,
          error: `${line.size}: ${movementResult.error}`,
        };
      }
      movementIds.push(movementResult.data.movementId);
    }

    const totalQty = totalSaleLinesQuantity(lines);
    const avgUnitPrice = totalQty > 0 ? financials.itemsSubtotal / totalQty : 0;

    const salePayload = {
      orderId,
      stockEntryId,
      productId,
      productName: stockEntry.productName || product.name || '',
      stockEntryName: stockEntry.name || '',
      lines,
      size: lines.map((l) => l.size).join(', '),
      quantity: totalQty,
      unitPrice: avgUnitPrice,
      unitCost,
      baseCostPrice: costBreakdown.baseUnit,
      importTaxPerUnit: costBreakdown.importPerUnit,
      importFreightPerUnit: costBreakdown.freightPerUnit,
      discount: financials.discount,
      couponPercent: financials.couponPercent,
      couponId: '',
      couponName: [...new Set(lines.filter((l) => l.couponName).map((l) => l.couponName))].join(', '),
      isPersonalized: lines.some((l) => l.isPersonalized),
      personalizationPerPiece: 0,
      personalizationTotal: financials.personalizationTotal,
      personalizationCost: financials.personalizationCostTotal,
      freight: financials.freightCost,
      adsCost: financials.adsCostTotal,
      poolCost: financials.adsCostTotal,
      fees: financials.extraFees,
      platformCost: financials.platformCost,
      platformFees,
      variableCosts: financials.variableCosts,
      trafficCost: 0,
      channel: 'site',
      paymentMethod: input.paymentMethod || 'pix',
      customer: '',
      stockOrigin: stockEntry.stockOrigin || 'proprio',
      investorId: stockEntry.investorId || '',
      investorPayout,
      itemsSubtotal: financials.itemsSubtotal,
      grossRevenue: financials.grossRevenue,
      totalRevenue: financials.totalRevenue,
      grossProfit: financials.grossProfit,
      netProfit: financials.netProfit,
      margin: financials.margin,
      roi: null,
      movementIds,
      movementId: movementIds[0] || '',
      status: 'concluida',
      shippingStatus: 'nao_enviado',
      trackingCode: '',
      userId: user.uid,
      userEmail: user.email || '',
      createdAt: serverTimestamp(),
    };

    const saleRef = await addDoc(collection(db, COLLECTION), salePayload);

    await Promise.all(
      movementIds.map((mid) =>
        updateDoc(doc(db, MOVEMENTS, mid), { relatedSaleId: saleRef.id })
      )
    );

    invalidateCache(
      CACHE_KEYS.SALES,
      CACHE_KEYS.STOCK_ENTRIES,
      CACHE_KEYS.MOVEMENTS
    );

    return { success: true, data: { id: saleRef.id, ...salePayload } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateSaleShipping(saleId, input = {}) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const trackingCode = String(input.trackingCode ?? '').trim();
  let shippingStatus = input.shippingStatus;

  if (shippingStatus !== 'nao_enviado' && shippingStatus !== 'enviado') {
    shippingStatus = trackingCode ? 'enviado' : 'nao_enviado';
  }

  if (shippingStatus === 'enviado' && !trackingCode) {
    return { success: false, error: 'Informe o código de rastreio para marcar como enviado.' };
  }

  try {
    const payload = {
      trackingCode,
      shippingStatus,
      shippedAt: shippingStatus === 'enviado' ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    };

    await updateDoc(doc(db, COLLECTION, saleId), payload);
    invalidateCache(CACHE_KEYS.SALES);

    return { success: true, data: { id: saleId, ...payload } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateSaleShopifyLink(saleId, input = {}) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const rawUrl = String(input.shopifyUrl ?? input.url ?? '').trim();
  const parsed = rawUrl ? parseShopifyAdminOrderUrl(rawUrl) : null;
  const shopifyOrderId = String(
    input.shopifyOrderId || parsed?.shopifyOrderId || ''
  ).trim();

  if (rawUrl && !shopifyOrderId) {
    return { success: false, error: 'URL da Shopify inválida. Cole o link do admin do pedido.' };
  }

  try {
    const payload = {
      shopifyOrderId,
      shopifyAdminUrl: shopifyOrderId && rawUrl ? rawUrl.split('?')[0] : '',
      updatedAt: serverTimestamp(),
    };

    await updateDoc(doc(db, COLLECTION, saleId), payload);
    invalidateCache(CACHE_KEYS.SALES);

    return {
      success: true,
      data: {
        id: saleId,
        ...payload,
        storeHandle: parsed?.storeHandle || null,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getSaleStockLines(sale) {
  if (sale?.lines?.length) {
    return sale.lines
      .map((line) => ({
        size: String(line.size || '').trim(),
        quantity: Number(line.quantity) || 0,
      }))
      .filter((line) => line.size && line.quantity > 0);
  }

  const size = String(sale?.size || '').trim();
  const quantity = Number(sale?.quantity) || 0;
  if (!size || quantity <= 0) return [];

  if (size.includes(',')) {
    return size.split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => ({ size: part, quantity: 1 }));
  }

  return [{ size, quantity }];
}

/** Exclui venda/pedido e devolve as peças ao estoque. */
export async function deleteSale(saleId) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  if (!saleId) {
    return { success: false, error: 'Pedido não informado.' };
  }

  try {
    const saleResult = await getSaleById(saleId);
    if (!saleResult.success) {
      return saleResult;
    }

    const sale = saleResult.data;
    const stockEntryId = sale.stockEntryId || sale.productId;
    const orderLabel = normalizeShopOrderId(sale.orderId) || saleId;
    const stockLines = getSaleStockLines(sale);

    if (stockEntryId && stockLines.length) {
      for (const line of stockLines) {
        const movementResult = await registerMovement({
          stockEntryId,
          productId: sale.productId || '',
          size: line.size,
          type: 'entrada',
          quantity: line.quantity,
          observation: `Estorno — pedido #${orderLabel} excluído`,
          stockEntryName: sale.stockEntryName || '',
          relatedSaleId: saleId,
        });

        if (!movementResult.success) {
          return {
            success: false,
            error: `Não foi possível devolver ${line.quantity}× ${line.size} ao estoque: ${movementResult.error}`,
          };
        }
      }
    }

    await deleteDoc(doc(db, COLLECTION, saleId));

    invalidateCache(
      CACHE_KEYS.SALES,
      CACHE_KEYS.STOCK_ENTRIES,
      CACHE_KEYS.MOVEMENTS
    );

    return {
      success: true,
      data: {
        id: saleId,
        orderId: sale.orderId,
        restoredPieces: stockLines.reduce((sum, line) => sum + line.quantity, 0),
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function applyShopifyLinkBatch(entries = []) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  if (!entries.length) {
    return { success: false, error: 'Nenhum link válido na lista.' };
  }

  try {
    const salesResult = await listSales({}, { fresh: true });
    if (!salesResult.success) {
      return { success: false, error: salesResult.error };
    }

    const byOrderId = new Map();
    for (const sale of salesResult.data) {
      const key = normalizeShopOrderId(sale.orderId);
      if (key && !byOrderId.has(key)) {
        byOrderId.set(key, sale);
      }
    }

    const applied = [];
    const missing = [];

    for (const entry of entries) {
      const sale = entry.orderId ? byOrderId.get(entry.orderId) : null;
      if (!sale) {
        missing.push(entry.orderId || entry.url || '?');
        continue;
      }

      const result = await updateSaleShopifyLink(sale.id, {
        shopifyUrl: entry.url,
        shopifyOrderId: entry.shopifyOrderId,
      });

      if (result.success) {
        applied.push(entry.orderId || sale.orderId);
      } else {
        missing.push(`${entry.orderId || sale.orderId}: ${result.error}`);
      }
    }

    return {
      success: applied.length > 0,
      data: { applied, missing },
      error: applied.length ? '' : 'Nenhum pedido encontrado para os links informados.',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function applyTrackingBatch(entries = []) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  if (!entries.length) {
    return { success: false, error: 'Nenhum rastreio válido na lista.' };
  }

  try {
    const salesResult = await listSales({}, { fresh: true });
    if (!salesResult.success) {
      return { success: false, error: salesResult.error };
    }

    const byOrderId = new Map();
    for (const sale of salesResult.data) {
      const key = normalizeShopOrderId(sale.orderId);
      if (key && !byOrderId.has(key)) {
        byOrderId.set(key, sale);
      }
    }

    const applied = [];
    const missing = [];

    for (const entry of entries) {
      const sale = byOrderId.get(entry.orderId);
      if (!sale) {
        missing.push(entry.orderId);
        continue;
      }

      const result = await updateSaleShipping(sale.id, {
        trackingCode: entry.trackingCode,
        shippingStatus: 'enviado',
      });

      if (result.success) {
        applied.push(entry.orderId);
      } else {
        missing.push(`${entry.orderId}: ${result.error}`);
      }
    }

    return {
      success: applied.length > 0,
      data: { applied, missing },
      error: applied.length ? '' : 'Nenhum pedido encontrado para os rastreios informados.',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function normalizeSaleLines(sale) {
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
    personalizationTypeId: sale.personalizationTypeId || '',
    personalizationTypeName: sale.personalizationTypeName || '',
    personalizationPerPiece: Number(sale.personalizationPerPiece) || 0,
    personalizationCostPerPiece: Number(sale.personalizationCost) || 0,
  }];
}

function applyPersonalizationToLines(lines, isPersonalized, defaultPersCost = 10) {
  return lines.map((line) => {
    if (!isPersonalized) {
      return {
        ...line,
        isPersonalized: false,
        personalizationPerPiece: 0,
        personalizationCostPerPiece: 0,
      };
    }

    const hadPers = !!line.isPersonalized;
    const persPrice = hadPers && Number(line.personalizationPerPiece) > 0
      ? Number(line.personalizationPerPiece)
      : 0;
    const persCost = hadPers && Number(line.personalizationCostPerPiece) > 0
      ? Number(line.personalizationCostPerPiece)
      : defaultPersCost;

    return {
      ...line,
      isPersonalized: true,
      personalizationPerPiece: persPrice,
      personalizationCostPerPiece: persCost,
    };
  });
}

function normalizeInputLines(inputLines, defaultPersCost = 10) {
  return (inputLines || []).map((line) => ({
    size: line.size,
    quantity: Number(line.quantity) || 0,
    unitPrice: Number(line.unitPrice) || 0,
    freight: Number(line.freight) || 0,
    ads: Number(line.ads) || 0,
    otherCosts: Number(line.otherCosts) || 0,
    couponId: line.couponId || '',
    couponName: line.couponName || '',
    couponPercent: Number(line.couponPercent) || 0,
    isPersonalized: !!line.isPersonalized,
    personalizationTypeId: line.personalizationTypeId || '',
    personalizationTypeName: line.personalizationTypeName || '',
    personalizationPerPiece: line.isPersonalized ? Number(line.personalizationPerPiece) || 0 : 0,
    personalizationCostPerPiece: line.isPersonalized
      ? Number(line.personalizationCostPerPiece ?? defaultPersCost) || 0
      : 0,
  }));
}

function validateOrderEdit(lines, financials) {
  const errors = [];

  if (!lines.length) {
    errors.push('Informe ao menos uma linha válida.');
  }

  for (const line of lines) {
    if (!line.size) {
      errors.push('Tamanho inválido.');
      continue;
    }
    if (!line.quantity || line.quantity < 1) {
      errors.push(`${line.size}: quantidade inválida.`);
    }
    if (!line.unitPrice || line.unitPrice <= 0) {
      errors.push(`${line.size}: preço inválido.`);
    }
    if (line.isPersonalized) {
      if (Number(line.personalizationPerPiece) < 0) {
        errors.push(`${line.size}: valor de personalização inválido.`);
      }
      if (Number(line.personalizationCostPerPiece) < 0) {
        errors.push(`${line.size}: custo de personalização inválido.`);
      }
    }
  }

  if (financials?.netProfit < 0) {
    errors.push('Lucro líquido negativo — ajuste preços ou custos.');
  }

  return { valid: errors.length === 0, errors };
}

function buildSaleOrderPayload(sale, lines, financials, platformFees, investorPayout) {
  const totalQty = totalSaleLinesQuantity(lines);
  const avgUnitPrice = totalQty > 0 ? financials.itemsSubtotal / totalQty : 0;

  return {
    lines,
    size: lines.map((l) => l.size).join(', '),
    quantity: totalQty,
    unitPrice: avgUnitPrice,
    itemsSubtotal: financials.itemsSubtotal,
    couponPercent: financials.couponPercent,
    couponName: [...new Set(lines.filter((l) => l.couponName).map((l) => l.couponName))].join(', '),
    isPersonalized: lines.some((l) => l.isPersonalized),
    personalizationTotal: financials.personalizationTotal,
    personalizationCost: financials.personalizationCostTotal,
    freight: financials.freightCost,
    adsCost: financials.adsCostTotal,
    poolCost: financials.adsCostTotal,
    fees: financials.extraFees,
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
    updatedAt: serverTimestamp(),
  };
}

export async function updateSaleOrder(saleId, input = {}) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const defaultPersCost = Number(input.defaultPersonalizationCostPerPiece) || 10;
  const defaultPersPrice = Number(input.defaultPersonalizationPrice) || 50;
  const platformCosts = input.platformCosts || [];

  try {
    const saleResult = await getSaleById(saleId);
    if (!saleResult.success) {
      return saleResult;
    }

    const sale = saleResult.data;
    const unitCost = Number(sale.unitCost) || 0;
    const lotImportCostPerUnit = resolveSaleLotImportCostPerUnit(sale);
    const lotFreightCostPerUnit = resolveSaleLotFreightCostPerUnit(sale);
    const lines = normalizeInputLines(input.lines, defaultPersCost);

    const financials = calculateQuickSaleFinancials({
      lines,
      unitCost,
      lotImportCostPerUnit,
      lotFreightCostPerUnit,
      defaultPersonalizationCostPerPiece: defaultPersCost,
      defaultPersonalizationPrice: defaultPersPrice,
      platformCosts,
    });

    const validation = validateOrderEdit(lines, financials);
    if (!validation.valid) {
      return { success: false, error: validation.errors.join(' ') };
    }

    const platformFees = calculatePlatformFeesBreakdown(platformCosts, financials.totalRevenue);

    let investorPayout = Number(sale.investorPayout) || 0;
    if (sale.stockOrigin === 'investidor' && sale.investorId) {
      const invResult = await getInvestorById(sale.investorId);
      if (invResult.success) {
        investorPayout = calculateInvestorRepasseForSale(invResult.data, {
          unitCost,
          capitalUnitCost: resolveInvestorCapitalUnitCost(sale),
          quantity: financials.totalQty,
          financials,
          sale,
        });
      }
    }

    const payload = buildSaleOrderPayload(sale, lines, financials, platformFees, investorPayout);

    await updateDoc(doc(db, COLLECTION, saleId), payload);
    invalidateCache(CACHE_KEYS.SALES);

    return { success: true, data: { id: saleId, ...payload } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** @deprecated Use updateSaleOrder */
export async function updateSalePersonalization(saleId, input = {}) {
  const saleResult = await getSaleById(saleId);
  if (!saleResult.success) return saleResult;

  const lines = applyPersonalizationToLines(
    normalizeSaleLines(saleResult.data),
    !!input.isPersonalized,
    Number(input.defaultPersonalizationCostPerPiece) || 10
  );

  return updateSaleOrder(saleId, {
    ...input,
    lines,
  });
}

export async function recalculateAllSalesPlatformFees(settings = {}) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  try {
    const salesResult = await listSales({}, { fresh: true });
    if (!salesResult.success) {
      return { success: false, error: salesResult.error };
    }

    const investorCache = new Map();
    const stockEntriesResult = await listStockEntries({}, { fresh: true });
    const stockEntryMap = new Map(
      (stockEntriesResult.success ? stockEntriesResult.data : []).map((entry) => [entry.id, entry])
    );
    let updated = 0;

    for (const sale of salesResult.data) {
      if (sale.status === 'cancelada') continue;

      let investor = null;
      if (sale.stockOrigin === 'investidor' && sale.investorId) {
        if (!investorCache.has(sale.investorId)) {
          const invResult = await getInvestorById(sale.investorId);
          investorCache.set(
            sale.investorId,
            invResult.success ? invResult.data : null
          );
        }
        investor = investorCache.get(sale.investorId);
      }

      const stockEntry = sale.stockEntryId ? stockEntryMap.get(sale.stockEntryId) : null;
      const recalculated = recalculateSaleWithPlatformSettings(sale, settings, investor, stockEntry);
      const oldPlatform = Number(sale.platformCost) || 0;
      const newPlatform = Number(recalculated.platformCost) || 0;
      const oldNet = Number(sale.netProfit) || 0;
      const newNet = Number(recalculated.netProfit) || 0;
      const oldPers = Number(sale.personalizationTotal) || 0;
      const newPers = Number(recalculated.personalizationTotal) || 0;
      const oldDiscount = Number(sale.discount) || 0;
      const newDiscount = Number(recalculated.discount) || 0;
      const oldUnitCost = Number(sale.unitCost) || 0;
      const newUnitCost = Number(recalculated.unitCost) || 0;

      if (
        Math.abs(oldPlatform - newPlatform) < 0.005
        && Math.abs(oldNet - newNet) < 0.005
        && Math.abs(oldPers - newPers) < 0.005
        && Math.abs(oldDiscount - newDiscount) < 0.005
        && Math.abs(oldUnitCost - newUnitCost) < 0.005
        && Math.abs((Number(sale.investorPayout) || 0) - (Number(recalculated.investorPayout) || 0)) < 0.005
      ) {
        continue;
      }

      await updateDoc(doc(db, COLLECTION, sale.id), {
        unitCost: recalculated.unitCost,
        itemsSubtotal: recalculated.itemsSubtotal,
        personalizationTotal: recalculated.personalizationTotal,
        grossRevenue: recalculated.grossRevenue,
        totalRevenue: recalculated.totalRevenue,
        discount: recalculated.discount,
        grossProfit: recalculated.grossProfit,
        netProfit: recalculated.netProfit,
        margin: recalculated.margin,
        platformCost: recalculated.platformCost,
        platformFees: recalculated.platformFees,
        variableCosts: recalculated.variableCosts,
        investorPayout: recalculated.investorPayout,
        updatedAt: serverTimestamp(),
      });
      updated += 1;
    }

    invalidateCache(CACHE_KEYS.SALES);

    return { success: true, data: { updated } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
