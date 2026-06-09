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
import { cachedFetch, invalidateCache, CACHE_KEYS } from '../utils/dataCache.js';

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
    baseCostPrice: data.baseCostPrice != null
      ? Number(data.baseCostPrice) || 0
      : (data.importTaxPerUnit != null ? Number(data.costPrice) - Number(data.importTaxPerUnit) : Number(data.costPrice)) || 0,
    costPrice: Number(data.costPrice) || 0,
    importTaxes: Number(data.importTaxes) || 0,
    ...(data.importTaxPerUnit != null ? { importTaxPerUnit: Number(data.importTaxPerUnit) || 0 } : {}),
    ...(data.entryQuantity != null ? { entryQuantity: Number(data.entryQuantity) || qty } : {}),
    importTaxesPaidAt: data.importTaxesPaidAt || '',
    suggestedSalePrice: Number(data.suggestedSalePrice) || 0,
    minimumSalePrice: Number(data.minimumSalePrice) || 0,
    status: qty === 0 ? 'esgotado' : (data.status || 'ativo'),
    notes: data.notes || '',
  };
}

async function fetchStockEntriesFromFirestore() {
  const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  const data = snapshot.docs.map(mapDoc);
  data.sort((a, b) => {
    const ta = a.createdAt?.seconds ?? 0;
    const tb = b.createdAt?.seconds ?? 0;
    return tb - ta;
  });
  return { success: true, data };
}

export async function listStockEntries(filters = {}, options = {}) {
  try {
    const result = await cachedFetch(
      CACHE_KEYS.STOCK_ENTRIES,
      fetchStockEntriesFromFirestore,
      options
    );
    if (!result.success) return result;

    let data = [...result.data];

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

    return { success: true, data, fromCache: result.fromCache };
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
    invalidateCache(CACHE_KEYS.STOCK_ENTRIES);
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
    invalidateCache(CACHE_KEYS.STOCK_ENTRIES);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deleteStockEntry(id) {
  try {
    await deleteDoc(doc(db, COLLECTION, id));
    invalidateCache(CACHE_KEYS.STOCK_ENTRIES);
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
    baseCostPrice: e.baseCostPrice,
    costPrice: e.costPrice,
    importTaxes: e.importTaxes,
    importTaxPerUnit: e.importTaxPerUnit,
    entryQuantity: e.entryQuantity,
    suggestedSalePrice: e.suggestedSalePrice,
    minimumSalePrice: e.minimumSalePrice,
    stockOrigin: e.stockOrigin,
    investorId: e.investorId,
    status: e.status,
  }));
}
