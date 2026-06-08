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
import { listProducts } from './productService.js';

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

export async function listInvestors() {
  try {
    let snapshot;
    try {
      const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
      snapshot = await getDocs(q);
    } catch {
      snapshot = await getDocs(collection(db, COLLECTION));
    }

    const data = snapshot.docs.map(mapDoc);
    data.sort((a, b) => {
      const ta = a.createdAt?.seconds ?? 0;
      const tb = b.createdAt?.seconds ?? 0;
      return tb - ta;
    });

    return { success: true, data };
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
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function countProductsByInvestor(investorId) {
  const result = await listProducts();
  if (!result.success) return 0;
  return result.data.filter(
    (p) => p.stockOrigin === 'investidor' && p.investorId === investorId
  ).length;
}

export async function deleteInvestor(id) {
  try {
    const linked = await countProductsByInvestor(id);
    if (linked > 0) {
      return {
        success: false,
        error: `Este investidor está vinculado a ${linked} produto(s). Altere a origem ou o investidor nos produtos antes de excluir.`,
      };
    }

    await deleteDoc(doc(db, COLLECTION, id));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
