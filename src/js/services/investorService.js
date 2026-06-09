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
import { listStockEntries } from './stockEntryService.js';
import { cachedFetch, invalidateCache, CACHE_KEYS } from '../utils/dataCache.js';

const COLLECTION = 'investors';

export const REPASSE_TYPES = {
  capital_mais_lucro: 'Capital de volta + % do lucro líquido',
  percent_lucro: 'Percentual sobre lucro',
  percent_faturamento: 'Percentual sobre faturamento',
  fixo_peca: 'Valor fixo por peça',
  custo_comissao: 'Custo + comissão (%)',
  personalizado: 'Regra personalizada',
};

export const DEFAULT_REPASSE_TYPE = 'capital_mais_lucro';
export const DEFAULT_REPASSE_VALUE = 40;

function mapDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function buildPayload(data) {
  return {
    name: data.name.trim(),
    phone: data.phone?.trim() || '',
    email: data.email?.trim() || '',
    repasseType: data.repasseType || DEFAULT_REPASSE_TYPE,
    repasseValue: data.repasseValue != null && data.repasseValue !== ''
      ? Number(data.repasseValue)
      : DEFAULT_REPASSE_VALUE,
    notes: data.notes?.trim() || '',
  };
}

async function fetchInvestorsFromFirestore() {
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

export async function listInvestors(options = {}) {
  try {
    return await cachedFetch(CACHE_KEYS.INVESTORS, fetchInvestorsFromFirestore, options);
  } catch (error) {
    const msg = error.code === 'permission-denied'
      ? 'Sem permissão. Verifique se está logado e se as regras do Firestore foram publicadas.'
      : error.message;
    return { success: false, error: msg };
  }
}

export async function getInvestorById(id) {
  try {
    const snapshot = await getDoc(doc(db, COLLECTION, id));
    if (!snapshot.exists()) {
      return { success: false, error: 'Investidor não encontrado.' };
    }
    return { success: true, data: mapDoc(snapshot) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function createInvestor(data) {
  try {
    const docRef = await addDoc(collection(db, COLLECTION), {
      ...buildPayload(data),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    invalidateCache(CACHE_KEYS.INVESTORS);
    return { success: true, data: { id: docRef.id } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateInvestor(id, data) {
  try {
    await updateDoc(doc(db, COLLECTION, id), {
      ...buildPayload(data),
      updatedAt: serverTimestamp(),
    });
    invalidateCache(CACHE_KEYS.INVESTORS);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function countProductsByInvestor(investorId) {
  const result = await listStockEntries();
  if (!result.success) return 0;
  return result.data.filter(
    (e) => e.stockOrigin === 'investidor' && e.investorId === investorId
  ).length;
}

export async function deleteInvestor(id) {
  try {
    const linked = await countProductsByInvestor(id);
    if (linked > 0) {
      return {
        success: false,
        error: `Este investidor está vinculado a ${linked} lote(s) de estoque. Altere a origem ou o investidor nos estoques antes de excluir.`,
      };
    }

    await deleteDoc(doc(db, COLLECTION, id));
    invalidateCache(CACHE_KEYS.INVESTORS);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
