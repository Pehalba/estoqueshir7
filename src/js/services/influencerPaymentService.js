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
import {
  getPayoutPeriodKey,
  periodKeyToDocSegment,
  payoutPeriodsMatch,
  findPayoutInMap,
} from '../utils/payoutPeriod.js';

const COLLECTION = 'influencerPayouts';

export function buildInfluencerPayoutDocId(influencerId, dateFrom = '', dateTo = '') {
  const periodKey = getPayoutPeriodKey(dateFrom, dateTo);
  const segment = periodKeyToDocSegment(periodKey);
  return `${influencerId}_${segment}`;
}

function mapDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

async function fetchPayoutsFromFirestore() {
  const snapshot = await getDocs(collection(db, COLLECTION));
  return { success: true, data: snapshot.docs.map(mapDoc) };
}

export async function listInfluencerPayouts(options = {}) {
  try {
    return await cachedFetch(CACHE_KEYS.INFLUENCER_PAYOUTS, fetchPayoutsFromFirestore, options);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function influencerPayoutsToMap(payouts = []) {
  return new Map((payouts || []).map((p) => [p.id, p]));
}

export function getInfluencerPayoutRecord(payoutMap, influencerId, dateFrom, dateTo) {
  const id = buildInfluencerPayoutDocId(influencerId, dateFrom, dateTo);
  const direct = payoutMap.get(id);
  if (direct) return direct;

  return findPayoutInMap(payoutMap, (record) => (
    record.influencerId === influencerId
    && payoutPeriodsMatch(record.dateFrom, record.dateTo, dateFrom, dateTo)
  ));
}

async function resolveInfluencerPayoutDocId(influencerId, dateFrom, dateTo) {
  const primaryId = buildInfluencerPayoutDocId(influencerId, dateFrom, dateTo);
  const payoutsRes = await listInfluencerPayouts({ fresh: true });
  if (!payoutsRes.success) return primaryId;

  const existing = getInfluencerPayoutRecord(
    influencerPayoutsToMap(payoutsRes.data),
    influencerId,
    dateFrom,
    dateTo
  );
  return existing?.id || primaryId;
}

export function resolveInfluencerPayoutStatus(record, dueAmount = 0, manualOnly = false) {
  const due = manualOnly ? 0 : Math.max(0, Number(dueAmount) || 0);

  if (!record) {
    return {
      paidAmount: 0,
      dueAmount: due,
      remaining: due,
      status: due <= 0.02 ? 'paid' : 'pending',
      payments: [],
      manualOnly,
    };
  }

  if (Array.isArray(record.payments) && record.payments.length) {
    const paidAmount = Number(record.paidAmount) || record.payments.reduce(
      (sum, p) => sum + (Number(p.amount) || 0),
      0
    );
    const storedDue = Number(record.dueAmount) || due;
    const effectiveDue = manualOnly ? paidAmount : (due > 0 ? due : storedDue);
    const remaining = manualOnly ? 0 : Math.max(0, effectiveDue - paidAmount);
    let status = 'pending';
    if (manualOnly && paidAmount > 0) status = 'paid';
    else if (remaining <= 0.02) status = 'paid';
    else if (paidAmount > 0) status = 'partial';

    return {
      paidAmount,
      dueAmount: effectiveDue,
      remaining,
      status,
      payments: record.payments,
      manualOnly,
    };
  }

  const paidAmount = Number(record.paidAmount) || 0;
  const effectiveDue = manualOnly ? paidAmount : (due > 0 ? due : Number(record.dueAmount) || 0);
  const remaining = manualOnly ? 0 : Math.max(0, effectiveDue - paidAmount);
  let status = 'pending';
  if (manualOnly && paidAmount > 0) status = 'paid';
  else if (effectiveDue > 0 && remaining <= 0.02) status = 'paid';
  else if (paidAmount > 0) status = 'partial';

  return {
    paidAmount,
    dueAmount: effectiveDue,
    remaining,
    status,
    payments: record.payments || [],
    manualOnly,
  };
}

export async function registerInfluencerPayment({
  influencerId,
  influencerName,
  dateFrom = '',
  dateTo = '',
  dueAmount = 0,
  paymentAmount,
  markedBy = '',
  note = '',
  manualOnly = false,
}) {
  try {
    const amount = Number(paymentAmount) || 0;
    const due = manualOnly ? 0 : Number(dueAmount) || 0;

    if (amount <= 0) {
      return { success: false, error: 'Informe um valor maior que zero.' };
    }

    const id = await resolveInfluencerPayoutDocId(influencerId, dateFrom, dateTo);
    const ref = doc(db, COLLECTION, id);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    const current = resolveInfluencerPayoutStatus(existing, due, manualOnly);

    if (!manualOnly && current.remaining <= 0.02 && current.paidAmount > 0) {
      return { success: false, error: 'Este repasse já está quitado no período.' };
    }

    if (!manualOnly && amount > current.remaining + 0.02) {
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
    const effectiveDue = manualOnly ? newPaidAmount : due;
    const remaining = manualOnly ? 0 : Math.max(0, effectiveDue - newPaidAmount);
    const status = manualOnly
      ? 'paid'
      : remaining <= 0.02 ? 'paid' : 'partial';

    await setDoc(ref, {
      influencerId,
      influencerName: influencerName || '',
      dateFrom: dateFrom || '',
      dateTo: dateTo || '',
      dueAmount: effectiveDue,
      paidAmount: newPaidAmount,
      payments,
      paid: status === 'paid',
      status,
      manualOnly: !!manualOnly,
      updatedAt: serverTimestamp(),
    });

    invalidateCache(CACHE_KEYS.INFLUENCER_PAYOUTS);
    return { success: true, id, paidAmount: newPaidAmount, remaining, status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function clearInfluencerPayout(influencerId, dateFrom = '', dateTo = '') {
  try {
    const id = await resolveInfluencerPayoutDocId(influencerId, dateFrom, dateTo);
    await deleteDoc(doc(db, COLLECTION, id));
    invalidateCache(CACHE_KEYS.INFLUENCER_PAYOUTS);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
