import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';
import { getCurrentUser } from './authService.js';
import { getProductById } from './productService.js';
import { getInvestorById } from './investorService.js';
import { registerMovement } from './stockService.js';
import {
  availableQty,
  unitCostWithImportTax,
  calculateSaleFinancials,
  calculateQuickSaleFinancials,
  calculateInvestorRepasse,
  calculateInvestorRepasseForSale,
  totalSaleLinesQuantity,
} from '../utils/calculations.js';
import { validateSale, validateQuickSale } from '../utils/validators.js';

const COLLECTION = 'sales';
const MOVEMENTS = 'stockMovements';

function mapSale(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

export async function listSales(filters = {}) {
  try {
    let snapshot;
    try {
      const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
      snapshot = await getDocs(q);
    } catch {
      snapshot = await getDocs(collection(db, COLLECTION));
    }

    let sales = snapshot.docs.map(mapSale);
    sales.sort((a, b) => {
      const ta = a.createdAt?.seconds ?? 0;
      const tb = b.createdAt?.seconds ?? 0;
      return tb - ta;
    });

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
        [s.orderId, s.productName, s.customer].filter(Boolean).join(' ').toLowerCase().includes(term)
      );
    }

    return { success: true, data: sales };
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
    const q = query(collection(db, COLLECTION), where('orderId', '==', orderId.trim()));
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch {
    const result = await listSales();
    if (!result.success) return false;
    return result.data.some((s) => s.orderId === orderId.trim());
  }
}

export async function createSale(input) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const orderId = String(input.orderId || '').trim();
  const productId = input.productId;
  const size = input.size;
  const quantity = Number(input.quantity) || 0;

  try {
    const [productResult, duplicate] = await Promise.all([
      getProductById(productId),
      orderIdExists(orderId),
    ]);

    if (!productResult.success) {
      return { success: false, error: productResult.error };
    }

    const product = productResult.data;
    const sizeEntry = (product.sizes || []).find((s) => s.size === size);
    const stockAvailable = sizeEntry ? availableQty(sizeEntry) : 0;
    const unitCost = unitCostWithImportTax(
      product.costPrice,
      product.importTaxes,
      product.sizes
    );

    const financials = calculateSaleFinancials({
      quantity,
      unitPrice: input.unitPrice,
      unitCost,
      discount: input.discount,
      fees: input.fees,
      trafficCost: input.trafficCost,
    });

    const validation = validateSale(
      { ...input, orderId, unitCost },
      { product, availableQty: stockAvailable, orderIdExists: duplicate, financials }
    );

    if (!validation.valid) {
      return { success: false, error: validation.errors.join(' ') };
    }

    let investor = null;
    let investorPayout = 0;

    if (product.stockOrigin === 'investidor' && product.investorId) {
      const invResult = await getInvestorById(product.investorId);
      if (invResult.success) {
        investor = invResult.data;
        investorPayout = calculateInvestorRepasse(investor, {
          unitCost,
          quantity,
          netProfit: financials.netProfit,
          grossRevenue: financials.totalRevenue,
        });
      }
    }

    const movementResult = await registerMovement({
      productId,
      size,
      type: 'saida',
      quantity,
      observation: `Venda pedido ${orderId}`,
    });

    if (!movementResult.success) {
      return { success: false, error: movementResult.error };
    }

    const salePayload = {
      orderId,
      productId,
      productName: product.name || '',
      size,
      quantity,
      unitPrice: Number(input.unitPrice) || 0,
      unitCost,
      discount: Number(input.discount) || 0,
      fees: Number(input.fees) || 0,
      trafficCost: Number(input.trafficCost) || 0,
      channel: input.channel || '',
      paymentMethod: input.paymentMethod || '',
      customer: input.customer?.trim() || '',
      stockOrigin: product.stockOrigin || 'proprio',
      investorId: product.investorId || '',
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
      userId: user.uid,
      userEmail: user.email || '',
      createdAt: serverTimestamp(),
    };

    const saleRef = await addDoc(collection(db, COLLECTION), salePayload);

    await updateDoc(doc(db, MOVEMENTS, movementResult.data.movementId), {
      relatedSaleId: saleRef.id,
    });

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

  const productId = input.productId;
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
    const productResult = await getProductById(productId);
    if (!productResult.success) {
      return { success: false, error: productResult.error };
    }

    const product = productResult.data;
    const unitCost = unitCostWithImportTax(
      product.costPrice,
      product.importTaxes,
      product.sizes
    );

    const linesWithStock = lines.map((line) => {
      const sizeEntry = (product.sizes || []).find((s) => s.size === line.size);
      return {
        ...line,
        available: sizeEntry ? availableQty(sizeEntry) : 0,
      };
    });

    const financials = calculateQuickSaleFinancials({
      lines,
      unitCost,
      defaultPersonalizationCostPerPiece: input.defaultPersonalizationCostPerPiece,
    });

    const validation = validateQuickSale(
      { ...input, unitCost },
      { product, lines: linesWithStock, financials }
    );

    if (!validation.valid) {
      return { success: false, error: validation.errors.join(' ') };
    }

    let investor = null;
    let investorPayout = 0;

    if (product.stockOrigin === 'investidor' && product.investorId) {
      const invResult = await getInvestorById(product.investorId);
      if (invResult.success) {
        investor = invResult.data;
        investorPayout = calculateInvestorRepasseForSale(investor, {
          unitCost,
          quantity: financials.totalQty,
          financials,
        });
      }
    }

    const orderId = generateQuickOrderId();
    const movementIds = [];

    for (const line of lines) {
      const movementResult = await registerMovement({
        productId,
        size: line.size,
        type: 'saida',
        quantity: line.quantity,
        observation: `Venda rápida ${orderId}`,
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
      productId,
      productName: product.name || '',
      lines,
      size: lines.map((l) => l.size).join(', '),
      quantity: totalQty,
      unitPrice: avgUnitPrice,
      unitCost,
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
      variableCosts: financials.variableCosts,
      trafficCost: 0,
      channel: input.channel || 'presencial',
      paymentMethod: input.paymentMethod || 'pix',
      customer: '',
      stockOrigin: product.stockOrigin || 'proprio',
      investorId: product.investorId || '',
      investorPayout,
      grossRevenue: financials.grossRevenue,
      totalRevenue: financials.totalRevenue,
      grossProfit: financials.grossProfit,
      netProfit: financials.netProfit,
      margin: financials.margin,
      roi: null,
      movementIds,
      movementId: movementIds[0] || '',
      status: 'concluida',
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

    return { success: true, data: { id: saleRef.id, ...salePayload } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
