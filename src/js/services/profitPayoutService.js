import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';
import { cachedFetch, invalidateCache, CACHE_KEYS } from '../utils/dataCache.js';

const COLLECTION = 'profitPayouts';

export function buildPayoutDocId(type, recipientId, dateFrom = '', dateTo = '') {
  const from = dateFrom || 'all';
  const to = dateTo || 'all';
  return `${type}_${recipientId}_${from}_${to}`;
}

function mapDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

async function fetchPayoutsFromFirestore() {
  const snapshot = await getDocs(collection(db, COLLECTION));
  return { success: true, data: snapshot.docs.map(mapDoc) };
}

export async function listProfitPayouts(options = {}) {
  try {
    return await cachedFetch(CACHE_KEYS.PROFIT_PAYOUTS, fetchPayoutsFromFirestore, options);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function payoutsToMap(payouts = []) {
  return new Map((payouts || []).map((p) => [p.id, p]));
}

export function getPayoutRecord(payoutMap, type, recipientId, dateFrom, dateTo) {
  const id = buildPayoutDocId(type, recipientId, dateFrom, dateTo);
  return payoutMap.get(id) || null;
}

/** Normaliza registro legado (paid boolean) e parcial (paidAmount + payments). */
export function resolvePayoutStatus(record, dueAmount = 0) {
  const due = Math.max(0, Number(dueAmount) || 0);

  if (!record) {
    return {
      paidAmount: 0,
      dueAmount: due,
      remaining: due,
      status: 'pending',
      payments: [],
    };
  }

  if (Array.isArray(record.payments) && record.payments.length) {
    const paidAmount = Number(record.paidAmount) || record.payments.reduce(
      (sum, p) => sum + (Number(p.amount) || 0),
      0
    );
    const storedDue = Number(record.dueAmount) || due;
    const effectiveDue = due > 0 ? due : storedDue;
    const remaining = Math.max(0, effectiveDue - paidAmount);
    let status = 'pending';
    if (remaining <= 0.02) status = 'paid';
    else if (paidAmount > 0) status = 'partial';

    return {
      paidAmount,
      dueAmount: effectiveDue,
      remaining,
      status,
      payments: record.payments,
    };
  }

  if (record.paid === true) {
    const paidAmount = Number(record.amount) || Number(record.paidAmount) || 0;
    const effectiveDue = due > 0 ? due : paidAmount;
    const remaining = Math.max(0, effectiveDue - paidAmount);
    return {
      paidAmount,
      dueAmount: effectiveDue,
      remaining,
      status: remaining <= 0.02 ? 'paid' : 'partial',
      payments: paidAmount > 0
        ? [{ amount: paidAmount, paidAt: record.paidAt, paidBy: record.paidBy || '' }]
        : [],
    };
  }

  const paidAmount = Number(record.paidAmount) || 0;
  const effectiveDue = due > 0 ? due : Number(record.dueAmount) || 0;
  const remaining = Math.max(0, effectiveDue - paidAmount);
  let status = 'pending';
  if (effectiveDue > 0 && remaining <= 0.02) status = 'paid';
  else if (paidAmount > 0) status = 'partial';

  return {
    paidAmount,
    dueAmount: effectiveDue,
    remaining,
    status,
    payments: record.payments || [],
  };
}

export async function registerProfitPayment({
  type,
  recipientId,
  recipientName,
  dateFrom = '',
  dateTo = '',
  dueAmount,
  paymentAmount,
  markedBy = '',
  note = '',
}) {
  try {
    const amount = Number(paymentAmount) || 0;
    const due = Number(dueAmount) || 0;

    if (amount <= 0) {
      return { success: false, error: 'Informe um valor maior que zero.' };
    }

    const id = buildPayoutDocId(type, recipientId, dateFrom, dateTo);
    const ref = doc(db, COLLECTION, id);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    const current = resolvePayoutStatus(existing, due);

    if (current.remaining <= 0.02) {
      return { success: false, error: 'Este repasse já está quitado.' };
    }

    if (amount > current.remaining + 0.02) {
      return {
        success: false,
        error: `O valor excede o restante (${current.remaining.toFixed(2).replace('.', ',')}).`,
      };
    }

    const newPaidAmount = current.paidAmount + amount;
    const payments = [
      ...current.payments,
      {
        amount,
        paidAt: Timestamp.now(),
        paidBy: markedBy || '',
        note: String(note || '').trim(),
      },
    ];
    const remaining = Math.max(0, due - newPaidAmount);
    const status = remaining <= 0.02 ? 'paid' : 'partial';

    await setDoc(ref, {
      type,
      recipientId,
      recipientName: recipientName || '',
      dateFrom: dateFrom || '',
      dateTo: dateTo || '',
      dueAmount: due,
      paidAmount: newPaidAmount,
      payments,
      paid: status === 'paid',
      status,
      updatedAt: serverTimestamp(),
    });

    invalidateCache(CACHE_KEYS.PROFIT_PAYOUTS);
    return { success: true, id, paidAmount: newPaidAmount, remaining, status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function clearProfitPayout(type, recipientId, dateFrom = '', dateTo = '') {
  try {
    const id = buildPayoutDocId(type, recipientId, dateFrom, dateTo);
    await deleteDoc(doc(db, COLLECTION, id));
    invalidateCache(CACHE_KEYS.PROFIT_PAYOUTS);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function unmarkProfitPayoutPaid(type, recipientId, dateFrom = '', dateTo = '') {
  return clearProfitPayout(type, recipientId, dateFrom, dateTo);
}
