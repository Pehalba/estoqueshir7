import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';
import { getCurrentUser } from './authService.js';

const COLLECTION = 'expenses';

function mapDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

export async function listExpenses() {
  try {
    let snapshot;
    try {
      snapshot = await getDocs(query(collection(db, COLLECTION), orderBy('createdAt', 'desc')));
    } catch {
      snapshot = await getDocs(collection(db, COLLECTION));
    }
    const data = snapshot.docs.map(mapDoc);
    data.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function createExpense({ description, amount, category = 'geral', date = '' }) {
  const user = getCurrentUser();
  if (!user) return { success: false, error: 'Usuário não autenticado.' };

  const value = Number(amount);
  if (!description?.trim()) return { success: false, error: 'Informe a descrição.' };
  if (!value || value <= 0) return { success: false, error: 'Informe um valor válido.' };

  try {
    const payload = {
      description: description.trim(),
      amount: value,
      category: category || 'geral',
      date: date || new Date().toISOString().slice(0, 10),
      userId: user.uid,
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, COLLECTION), payload);
    return { success: true, data: { id: ref.id, ...payload } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deleteExpense(id) {
  try {
    await deleteDoc(doc(db, COLLECTION, id));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
