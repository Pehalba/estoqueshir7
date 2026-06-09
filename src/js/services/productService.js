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
import { cachedFetch, invalidateCache, CACHE_KEYS } from '../utils/dataCache.js';

const COLLECTION = 'products';

function totalQuantity(sizes) {
  return (sizes || []).reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
}

function mapDoc(snapshot) {
  const data = snapshot.data();
  const sizes = (data.sizes || (data.size ? [{ size: data.size, quantity: data.quantity || 0 }] : []))
    .map((s) => ({ ...s, reserved: Number(s.reserved) || 0 }));
  return {
    id: snapshot.id,
    ...data,
    sizes,
    quantity: data.quantity ?? totalQuantity(sizes),
  };
}

function buildPayload(data) {
  const sizes = (data.sizes || []).map((s) => ({
    size: s.size,
    quantity: Number(s.quantity) || 0,
    reserved: Number(s.reserved) || 0,
  }));

  return {
    name: data.name,
    sku: data.sku || '',
    category: data.category || '',
    imageUrl: data.imageUrl || '',
    sizes,
    quantity: totalQuantity(sizes),
    supplier: data.supplier,
    stockOrigin: 'proprio',
    investorId: '',
    costPrice: Number(data.costPrice) || 0,
    importTaxes: Number(data.importTaxes) || 0,
    importTaxesPaidAt: data.importTaxesPaidAt || '',
    suggestedSalePrice: Number(data.suggestedSalePrice) || 0,
    minimumSalePrice: Number(data.minimumSalePrice) || 0,
    // Precificação ativa é definida nas entradas de estoque (registerStockEntry).
    status: data.status,
    notes: data.notes || '',
  };
}

async function fetchProductsFromFirestore() {
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

export async function listProducts(options = {}) {
  try {
    return await cachedFetch(CACHE_KEYS.PRODUCTS, fetchProductsFromFirestore, options);
  } catch (error) {
    const msg = error.code === 'permission-denied'
      ? 'Sem permissão. Verifique se está logado e se as regras do Firestore foram publicadas.'
      : error.message;
    return { success: false, error: msg };
  }
}

export async function getProductById(id) {
  try {
    const snapshot = await getDoc(doc(db, COLLECTION, id));
    if (!snapshot.exists()) {
      return { success: false, error: 'Produto não encontrado.' };
    }
    return { success: true, data: mapDoc(snapshot) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function createProduct(data) {
  try {
    const docRef = await addDoc(collection(db, COLLECTION), {
      ...buildPayload(data),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    invalidateCache(CACHE_KEYS.PRODUCTS);
    return { success: true, data: { id: docRef.id } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateProduct(id, data) {
  try {
    await updateDoc(doc(db, COLLECTION, id), {
      ...buildPayload(data),
      updatedAt: serverTimestamp(),
    });
    invalidateCache(CACHE_KEYS.PRODUCTS);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deleteProduct(id) {
  try {
    await deleteDoc(doc(db, COLLECTION, id));
    invalidateCache(CACHE_KEYS.PRODUCTS);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
