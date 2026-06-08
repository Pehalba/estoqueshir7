import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';
import { getCurrentUser } from './authService.js';
import { applyMovement, totalQuantity } from '../utils/calculations.js';

const MOVEMENTS = 'stockMovements';
const PRODUCTS = 'products';
const DEFAULT_LOW_STOCK = 5;

function mapMovement(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

export async function getLowStockThreshold() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'global'));
    if (snap.exists() && snap.data().lowStockThreshold != null) {
      return Number(snap.data().lowStockThreshold) || DEFAULT_LOW_STOCK;
    }
  } catch {
    // settings ainda não existe
  }
  return DEFAULT_LOW_STOCK;
}

function findSizeIndex(sizes, size) {
  return sizes.findIndex((s) => s.size === size);
}

export async function registerMovement({
  productId,
  size,
  type,
  quantity,
  adjustTo,
  observation,
  relatedSaleId,
}) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  if (!productId || !size) {
    return { success: false, error: 'Selecione o produto e o tamanho.' };
  }

  try {
    const movementRef = doc(collection(db, MOVEMENTS));
    const productRef = doc(db, PRODUCTS, productId);

    const result = await runTransaction(db, async (transaction) => {
      const productSnap = await transaction.get(productRef);
      if (!productSnap.exists()) {
        throw new Error('Produto não encontrado.');
      }

      const product = productSnap.data();
      const sizes = (product.sizes || []).map((s) => ({
        size: s.size,
        quantity: Number(s.quantity) || 0,
        reserved: Number(s.reserved) || 0,
      }));

      let sizeIndex = findSizeIndex(sizes, size);

      if (sizeIndex === -1 && type === 'entrada') {
        sizes.push({ size, quantity: 0, reserved: 0 });
        sizeIndex = sizes.length - 1;
      }

      if (sizeIndex === -1) {
        throw new Error(`Tamanho ${size} não encontrado neste produto.`);
      }

      const current = sizes[sizeIndex];
      const previousQty = current.quantity;
      const previousReserved = current.reserved;

      const applied = applyMovement(current, type, quantity, adjustTo);
      if (applied.error) {
        throw new Error(applied.error);
      }

      sizes[sizeIndex] = {
        size,
        quantity: applied.quantity,
        reserved: applied.reserved,
      };

      const newTotal = totalQuantity(sizes);

      transaction.update(productRef, {
        sizes,
        quantity: newTotal,
        updatedAt: serverTimestamp(),
        status: newTotal === 0 ? 'esgotado' : product.status === 'esgotado' ? 'ativo' : product.status,
      });

      transaction.set(movementRef, {
        productId,
        productName: product.name || '',
        size,
        type,
        quantity: type === 'ajuste' ? adjustTo : Number(quantity),
        previousQty,
        newQty: applied.quantity,
        previousReserved,
        newReserved: applied.reserved,
        observation: observation || '',
        stockOrigin: product.stockOrigin || 'proprio',
        investorId: product.investorId || '',
        userId: user.uid,
        userEmail: user.email || '',
        relatedSaleId: relatedSaleId || '',
        createdAt: serverTimestamp(),
      });

      return {
        previousQty,
        newQty: applied.quantity,
        movementId: movementRef.id,
      };
    });

    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getMovementHistory(filters = {}) {
  try {
    let snapshot;
    try {
      const q = query(collection(db, MOVEMENTS), orderBy('createdAt', 'desc'));
      snapshot = await getDocs(q);
    } catch {
      snapshot = await getDocs(collection(db, MOVEMENTS));
    }

    let movements = snapshot.docs.map(mapMovement);

    movements.sort((a, b) => {
      const ta = a.createdAt?.seconds ?? 0;
      const tb = b.createdAt?.seconds ?? 0;
      return tb - ta;
    });

    if (filters.productId) {
      movements = movements.filter((m) => m.productId === filters.productId);
    }
    if (filters.type) {
      movements = movements.filter((m) => m.type === filters.type);
    }
    if (filters.size) {
      movements = movements.filter((m) => m.size === filters.size);
    }
    if (filters.origin) {
      movements = movements.filter((m) => m.stockOrigin === filters.origin);
    }
    if (filters.investor) {
      movements = movements.filter((m) => m.investorId === filters.investor);
    }

    return { success: true, data: movements };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function getLowStockItems(products, threshold) {
  const items = [];

  for (const product of products) {
    for (const s of product.sizes || []) {
      const available = (Number(s.quantity) || 0) - (Number(s.reserved) || 0);
      if (available <= threshold) {
        items.push({
          productId: product.id,
          productName: product.name,
          size: s.size,
          quantity: s.quantity,
          reserved: s.reserved || 0,
          available,
          stockOrigin: product.stockOrigin,
        });
      }
    }
  }

  return items.sort((a, b) => a.available - b.available);
}

export function getStockSummary(products) {
  const summary = {
    proprio: { pieces: 0, products: 0 },
    investidor: { pieces: 0, products: 0 },
  };

  const seen = { proprio: new Set(), investidor: new Set() };

  for (const p of products) {
    const origin = p.stockOrigin === 'investidor' ? 'investidor' : 'proprio';
    const total = totalQuantity(p.sizes);
    summary[origin].pieces += total;
    seen[origin].add(p.id);
  }

  summary.proprio.products = seen.proprio.size;
  summary.investidor.products = seen.investidor.size;

  return summary;
}
