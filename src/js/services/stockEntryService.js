import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';
import { totalQuantity } from '../utils/calculations.js';

const COLLECTION = 'stockEntries';

function mapDoc(snapshot) {
  const data = snapshot.data();
  const sizes = (data.sizes || []).map((s) => ({
    ...s,
    quantity: Number(s.quantity) || 0,
    reserved: Number(s.reserved) || 0,
  }));
  return {
    id: snapshot.id,
    ...data,
    sizes,
    quantity: data.quantity ?? totalQuantity(sizes),
  };
}

export function buildStockEntryPayload(data) {
  const sizes = (data.sizes || []).map((s) => ({
    size: s.size,
    quantity: Number(s.quantity) || 0,
    reserved: Number(s.reserved) || 0,
  }));

  const qty = totalQuantity(sizes);

  return {
    name: data.name || data.stockEntryName || '',
    productId: data.productId || '',
    productName: data.productName || '',
    stockOrigin: data.stockOrigin === 'investidor' ? 'investidor' : 'proprio',
    investorId: data.stockOrigin === 'investidor' ? (data.investorId || '') : '',
    sizes,
    quantity: qty,
    costPrice: Number(data.costPrice) || 0,
    importTaxes: Number(data.importTaxes) || 0,
    importTaxesPaidAt: data.importTaxesPaidAt || '',
    suggestedSalePrice: Number(data.suggestedSalePrice) || 0,
    minimumSalePrice: Number(data.minimumSalePrice) || 0,
    status: qty === 0 ? 'esgotado' : (data.status || 'ativo'),
    notes: data.notes || '',
  };
}

export async function listStockEntries(filters = {}) {
  try {
    let snapshot;
    try {
      const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
      snapshot = await getDocs(q);
    } catch {
      snapshot = await getDocs(collection(db, COLLECTION));
    }

    let data = snapshot.docs.map(mapDoc);
    data.sort((a, b) => {
      const ta = a.createdAt?.seconds ?? 0;
      const tb = b.createdAt?.seconds ?? 0;
      return tb - ta;
    });

    if (filters.productId) {
      data = data.filter((e) => e.productId === filters.productId);
    }
    if (filters.origin) {
      data = data.filter((e) => e.stockOrigin === filters.origin);
    }
    if (filters.investor) {
      data = data.filter((e) => e.investorId === filters.investor);
    }
    if (filters.status) {
      data = data.filter((e) => e.status === filters.status);
    }
    if (filters.search) {
      const term = filters.search.toLowerCase();
      data = data.filter((e) =>
        [e.name, e.productName].filter(Boolean).join(' ').toLowerCase().includes(term)
      );
    }

    return { success: true, data };
  } catch (error) {
    const msg = error.code === 'permission-denied'
      ? 'Sem permissão. Verifique se está logado.'
      : error.message;
    return { success: false, error: msg };
  }
}

export async function getStockEntryById(id) {
  try {
    const snapshot = await getDoc(doc(db, COLLECTION, id));
    if (!snapshot.exists()) {
      return { success: false, error: 'Estoque não encontrado.' };
    }
    return { success: true, data: mapDoc(snapshot) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function createStockEntry(data) {
  try {
    const docRef = await addDoc(collection(db, COLLECTION), {
      ...buildStockEntryPayload(data),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { success: true, data: { id: docRef.id } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateStockEntry(id, data) {
  try {
    await updateDoc(doc(db, COLLECTION, id), {
      ...buildStockEntryPayload(data),
      updatedAt: serverTimestamp(),
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deleteStockEntry(id) {
  try {
    await deleteDoc(doc(db, COLLECTION, id));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** Converte entradas de estoque para formato usado por analytics/investidores. */
export function entriesAsStockItems(entries) {
  return (entries || []).map((e) => ({
    id: e.id,
    stockEntryName: e.name,
    name: e.productName || e.name,
    productId: e.productId,
    productName: e.productName || e.name,
    sizes: e.sizes,
    quantity: e.quantity,
    costPrice: e.costPrice,
    importTaxes: e.importTaxes,
    suggestedSalePrice: e.suggestedSalePrice,
    minimumSalePrice: e.minimumSalePrice,
    stockOrigin: e.stockOrigin,
    investorId: e.investorId,
    status: e.status,
  }));
}
