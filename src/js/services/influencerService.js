import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';
import { cachedFetch, invalidateCache, CACHE_KEYS } from '../utils/dataCache.js';

const COLLECTION = 'influencers';

export const COMMISSION_TYPES = {
  percent_lucro: '% do lucro nas vendas com cupom',
  percent_faturamento: '% do faturamento nas vendas com cupom',
  fixo_peca: 'Valor fixo por peça vendida',
  fixo_venda: 'Valor fixo por venda',
  valor_fixo: 'Valor fixo no período (mensal)',
  personalizado: 'Personalizado — registrar pagamentos manualmente',
};

export const DEFAULT_COMMISSION_TYPE = 'percent_lucro';
export const DEFAULT_COMMISSION_VALUE = 10;

function mapDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function buildPayload(data) {
  return {
    name: String(data.name || '').trim(),
    instagram: String(data.instagram || '').trim().replace(/^@/, ''),
    phone: String(data.phone || '').trim(),
    email: String(data.email || '').trim(),
    commissionType: COMMISSION_TYPES[data.commissionType]
      ? data.commissionType
      : DEFAULT_COMMISSION_TYPE,
    commissionValue: data.commissionValue != null && data.commissionValue !== ''
      ? Number(data.commissionValue)
      : DEFAULT_COMMISSION_VALUE,
    couponCodes: String(data.couponCodes || '').trim(),
    active: data.active !== false,
    notes: String(data.notes || '').trim(),
  };
}

async function fetchInfluencersFromFirestore() {
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

export async function listInfluencers(options = {}) {
  try {
    return await cachedFetch(CACHE_KEYS.INFLUENCERS, fetchInfluencersFromFirestore, options);
  } catch (error) {
    const msg = error.code === 'permission-denied'
      ? 'Sem permissão. Verifique se está logado e se as regras do Firestore foram publicadas.'
      : error.message;
    return { success: false, error: msg };
  }
}

export async function getInfluencerById(id) {
  try {
    const snapshot = await getDoc(doc(db, COLLECTION, id));
    if (!snapshot.exists()) {
      return { success: false, error: 'Influencer não encontrado.' };
    }
    return { success: true, data: mapDoc(snapshot) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function createInfluencer(data) {
  try {
    const payload = buildPayload(data);
    if (!payload.name) {
      return { success: false, error: 'Informe o nome do influencer.' };
    }

    const docRef = await addDoc(collection(db, COLLECTION), {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    invalidateCache(CACHE_KEYS.INFLUENCERS);
    return { success: true, data: { id: docRef.id } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateInfluencer(id, data) {
  try {
    const payload = buildPayload(data);
    if (!payload.name) {
      return { success: false, error: 'Informe o nome do influencer.' };
    }

    await updateDoc(doc(db, COLLECTION, id), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    invalidateCache(CACHE_KEYS.INFLUENCERS);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deleteInfluencer(id) {
  try {
    await deleteDoc(doc(db, COLLECTION, id));
    invalidateCache(CACHE_KEYS.INFLUENCERS);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function formatCommissionRule(influencer) {
  if (!influencer) return '—';
  const type = influencer.commissionType || DEFAULT_COMMISSION_TYPE;
  const value = Number(influencer.commissionValue) || 0;

  if (type === 'personalizado') return 'Personalizado';
  if (type === 'valor_fixo') return `${value.toFixed(2).replace('.', ',')} / período`;
  if (type === 'fixo_peca' || type === 'fixo_venda') {
    return `R$ ${value.toFixed(2).replace('.', ',')} ${type === 'fixo_peca' ? '/ peça' : '/ venda'}`;
  }
  return `${value}% ${type === 'percent_faturamento' ? 'faturamento' : 'lucro'}`;
}
