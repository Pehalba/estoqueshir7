import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  serverTimestamp,
  deleteField,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';
import { cachedFetch, invalidateCache, CACHE_KEYS } from '../utils/dataCache.js';
import { pickInvestorSalesForCampaign } from '../utils/adCampaignUtils.js';
import { listSales } from './salesService.js';

const COLLECTION = 'adCampaigns';
const SALES_COLLECTION = 'sales';

function mapDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function buildPayload(data) {
  const saleCount = Math.max(1, Math.floor(Number(data.saleCount) || 0));
  const costPerSale = Math.max(0, Number(data.costPerSale) || 0);

  return {
    name: String(data.name || '').trim(),
    platform: String(data.platform || '').trim(),
    saleCount,
    costPerSale,
    totalCost: saleCount * costPerSale,
    stockScope: 'investidor',
    notes: String(data.notes || '').trim(),
  };
}

async function fetchCampaignsFromFirestore() {
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

export async function listAdCampaigns(options = {}) {
  try {
    return await cachedFetch(CACHE_KEYS.AD_CAMPAIGNS, fetchCampaignsFromFirestore, options);
  } catch (error) {
    const msg = error.code === 'permission-denied'
      ? 'Sem permissão. Verifique se está logado e se as regras do Firestore foram publicadas.'
      : error.message;
    return { success: false, error: msg };
  }
}

export async function previewAdCampaignAssignment(saleCount) {
  const salesResult = await listSales({}, { fresh: true });
  if (!salesResult.success) return salesResult;

  const picked = pickInvestorSalesForCampaign(salesResult.data, saleCount);
  return {
    success: true,
    data: {
      picked,
      available: pickInvestorSalesForCampaign(salesResult.data, 99999).length,
    },
  };
}

export async function createAdCampaign(data) {
  try {
    const payload = buildPayload(data);
    if (!payload.name) {
      return { success: false, error: 'Informe o nome da campanha.' };
    }
    if (payload.costPerSale <= 0) {
      return { success: false, error: 'Informe o custo por venda maior que zero.' };
    }

    const preview = await previewAdCampaignAssignment(payload.saleCount);
    if (!preview.success) return preview;

    const picked = preview.data.picked;
    if (picked.length < payload.saleCount) {
      return {
        success: false,
        error: `Só há ${picked.length} venda(s) do estoque investidor disponível(is) (sem campanha). Reduza a quantidade ou exclua uma campanha antiga.`,
      };
    }

    const campaignRef = await addDoc(collection(db, COLLECTION), {
      ...payload,
      saleIds: picked.map((s) => s.id),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const batch = writeBatch(db);
    picked.forEach((sale) => {
      batch.update(doc(db, SALES_COLLECTION, sale.id), {
        campaignAdsCost: payload.costPerSale,
        adCampaignId: campaignRef.id,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();

    invalidateCache(CACHE_KEYS.AD_CAMPAIGNS, CACHE_KEYS.SALES);
    return { success: true, data: { id: campaignRef.id, saleIds: picked.map((s) => s.id) } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deleteAdCampaign(id) {
  try {
    const snapshot = await getDoc(doc(db, COLLECTION, id));
    if (!snapshot.exists()) {
      return { success: false, error: 'Campanha não encontrada.' };
    }

    const campaign = mapDoc(snapshot);
    const saleIds = campaign.saleIds || [];
    const batch = writeBatch(db);

    saleIds.forEach((saleId) => {
      batch.update(doc(db, SALES_COLLECTION, saleId), {
        campaignAdsCost: 0,
        adCampaignId: deleteField(),
        updatedAt: serverTimestamp(),
      });
    });

    batch.delete(doc(db, COLLECTION, id));
    await batch.commit();

    invalidateCache(CACHE_KEYS.AD_CAMPAIGNS, CACHE_KEYS.SALES);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getAdCampaignSales(campaign, sales = []) {
  const ids = new Set(campaign?.saleIds || []);
  return (sales || []).filter((s) => ids.has(s.id));
}
