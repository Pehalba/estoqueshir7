import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';
import { getCurrentUser } from './authService.js';
import { cachedFetch, invalidateCache, CACHE_KEYS } from '../utils/dataCache.js';

const COLLECTION = 'expenses';

export const EXPENSE_CATEGORIES = {
  geral: 'Geral',
  embalagem: 'Embalagem',
  marketing: 'Marketing',
  operacional: 'Operacional',
  fornecedor: 'Fornecedor',
  pessoal: 'Pessoal',
  transporte: 'Transporte',
  impostos: 'Impostos',
};

function mapDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

async function fetchExpensesFromFirestore() {
  let snapshot;
  try {
    snapshot = await getDocs(query(collection(db, COLLECTION), orderBy('createdAt', 'desc')));
  } catch {
    snapshot = await getDocs(collection(db, COLLECTION));
  }
  const data = snapshot.docs.map(mapDoc);
  data.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
  return { success: true, data };
}

export async function listExpenses(options = {}) {
  try {
    return await cachedFetch(CACHE_KEYS.EXPENSES, fetchExpensesFromFirestore, options);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function normalizeExpenseInput(input = {}) {
  const value = Number(input.amount);
  const description = String(input.description || '').trim();
  const category = input.category || 'geral';

  if (!description) return { error: 'Informe a descrição.' };
  if (!value || value <= 0) return { error: 'Informe um valor válido.' };

  return {
    payload: {
      description,
      amount: value,
      category: EXPENSE_CATEGORIES[category] ? category : 'geral',
      date: input.date || new Date().toISOString().slice(0, 10),
      notes: String(input.notes || '').trim(),
    },
  };
}

export async function createExpense(input = {}) {
  const user = getCurrentUser();
  if (!user) return { success: false, error: 'Usuário não autenticado.' };

  const normalized = normalizeExpenseInput(input);
  if (normalized.error) return { success: false, error: normalized.error };

  try {
    const payload = {
      ...normalized.payload,
      userId: user.uid,
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, COLLECTION), payload);
    invalidateCache(CACHE_KEYS.EXPENSES);
    return { success: true, data: { id: ref.id, ...payload } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateExpense(id, input = {}) {
  const user = getCurrentUser();
  if (!user) return { success: false, error: 'Usuário não autenticado.' };
  if (!id) return { success: false, error: 'Despesa não informada.' };

  const normalized = normalizeExpenseInput(input);
  if (normalized.error) return { success: false, error: normalized.error };

  try {
    await updateDoc(doc(db, COLLECTION, id), {
      ...normalized.payload,
      updatedAt: serverTimestamp(),
    });
    invalidateCache(CACHE_KEYS.EXPENSES);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deleteExpense(id) {
  if (!id) return { success: false, error: 'Despesa não informada.' };

  try {
    await deleteDoc(doc(db, COLLECTION, id));
    invalidateCache(CACHE_KEYS.EXPENSES);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
