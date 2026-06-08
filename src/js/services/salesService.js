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
  calculateInvestorRepasse,
} from '../utils/calculations.js';
import { validateSale } from '../utils/validators.js';

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
