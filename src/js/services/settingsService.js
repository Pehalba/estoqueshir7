import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';

const SETTINGS_DOC = 'settings';
const GLOBAL_ID = 'global';

export const DEFAULT_COUPON_ID = 'c-shir7-7';

export const DEFAULT_COUPONS = [
  { id: DEFAULT_COUPON_ID, name: 'FIXO 7%', percent: 7 },
];

export const DEFAULT_PLATFORMS = [
  { id: 'shopify', name: 'Shopify', role: 'Sistema da loja', percent: 2, fixedPerOrder: 0 },
  { id: 'yampi', name: 'Yampi', role: 'Checkout', percent: 0, fixedPerOrder: 0 },
  { id: 'appmax', name: 'Appmax', role: 'Gateway de pagamento', percent: 0, fixedPerOrder: 0 },
];

export const DEFAULT_SETTINGS = {
  defaultFreight: 20,
  adsPool: 0,
  otherPoolCosts: 0,
  platformCosts: [...DEFAULT_PLATFORMS],
  defaultPersonalizationPrice: 50,
  personalizationCostPerPiece: 10,
  personalizationTypes: [],
  coupons: [...DEFAULT_COUPONS],
  lowStockThreshold: 5,
  minMarginPercent: 10,
  defaultFees: 0,
};

function normalizePersonalizationTypes(types) {
  return (types || []).map((t, i) => ({
    id: t.id || `p${i}`,
    name: String(t.name || '').trim(),
    price: Number(t.price) || 0,
    cost: Number(t.cost) || 0,
  })).filter((t) => t.name);
}

function normalizeCoupons(coupons) {
  return (coupons || []).map((c, i) => ({
    id: c.id || `c${i}`,
    name: String(c.name || '').trim(),
    percent: Number(c.percent) || 0,
  })).filter((c) => c.name && c.percent > 0);
}

function normalizePlatformCosts(platforms) {
  const list = (platforms || []).map((p, i) => ({
    id: p.id || DEFAULT_PLATFORMS[i]?.id || `platform-${i}`,
    name: String(p.name || DEFAULT_PLATFORMS.find((d) => d.id === p.id)?.name || '').trim(),
    role: String(p.role || DEFAULT_PLATFORMS.find((d) => d.id === p.id)?.role || '').trim(),
    percent: Math.max(0, Number(p.percent) || 0),
    fixedPerOrder: Math.max(0, Number(p.fixedPerOrder) || 0),
  }));

  return DEFAULT_PLATFORMS.map((def) => {
    const found = list.find((p) => p.id === def.id);
    return found ? { ...def, ...found, name: def.name, role: def.role } : { ...def };
  });
}

/** Garante cupons padrão do sistema (ex.: FIXO 7%). */
function mergeDefaultCoupons(coupons) {
  const normalized = normalizeCoupons(coupons);
  const missing = DEFAULT_COUPONS.filter(
    (def) => !normalized.some((c) => c.id === def.id)
  );
  return [...normalized, ...missing];
}

export function normalizeSettings(data = {}) {
  return {
    defaultFreight: data.defaultFreight != null && data.defaultFreight !== ''
      ? Number(data.defaultFreight)
      : DEFAULT_SETTINGS.defaultFreight,
    adsPool: Number(data.adsPool) || 0,
    otherPoolCosts: Number(data.otherPoolCosts) || 0,
    defaultPersonalizationPrice: data.defaultPersonalizationPrice != null && data.defaultPersonalizationPrice !== ''
      ? Number(data.defaultPersonalizationPrice)
      : DEFAULT_SETTINGS.defaultPersonalizationPrice,
    personalizationCostPerPiece: Number(data.personalizationCostPerPiece) || 0,
    personalizationTypes: normalizePersonalizationTypes(data.personalizationTypes),
    coupons: mergeDefaultCoupons(data.coupons),
    platformCosts: normalizePlatformCosts(data.platformCosts),
    lowStockThreshold: data.lowStockThreshold != null && data.lowStockThreshold !== ''
      ? Number(data.lowStockThreshold)
      : DEFAULT_SETTINGS.lowStockThreshold,
    minMarginPercent: data.minMarginPercent != null && data.minMarginPercent !== ''
      ? Number(data.minMarginPercent)
      : DEFAULT_SETTINGS.minMarginPercent,
    defaultFees: Number(data.defaultFees) || 0,
  };
}

export async function getGlobalSettings() {
  try {
    const ref = doc(db, SETTINGS_DOC, GLOBAL_ID);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return { success: true, data: { ...DEFAULT_SETTINGS } };
    }

    const raw = snap.data();
    const data = normalizeSettings(raw);
    const hadFixedCoupon = normalizeCoupons(raw.coupons).some((c) => c.id === DEFAULT_COUPON_ID);

    if (!hadFixedCoupon) {
      await setDoc(ref, {
        coupons: data.coupons,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function saveGlobalSettings(data) {
  try {
    const payload = {
      ...normalizeSettings(data),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, SETTINGS_DOC, GLOBAL_ID), payload, { merge: true });
    return { success: true, data: payload };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
