/** Cache em memória para reduzir leituras repetidas do Firestore entre páginas. */

const STORE = new Map();
const DEFAULT_TTL_MS = 90_000;

export const CACHE_KEYS = {
  STOCK_ENTRIES: 'stockEntries',
  SALES: 'sales',
  PRODUCTS: 'products',
  INVESTORS: 'investors',
  MOVEMENTS: 'stockMovements',
  PROFIT_PAYOUTS: 'profitPayouts',
  ESTABLISHMENTS: 'establishments',
  EXPENSES: 'expenses',
  INFLUENCERS: 'influencers',
  INFLUENCER_PAYOUTS: 'influencerPayouts',
  AD_CAMPAIGNS: 'adCampaigns',
};

export function readCache(key) {
  const entry = STORE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    STORE.delete(key);
    return null;
  }
  return entry.value;
}

export function writeCache(key, value, ttlMs = DEFAULT_TTL_MS) {
  STORE.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateCache(...keys) {
  if (!keys.length) {
    STORE.clear();
    return;
  }
  keys.forEach((key) => STORE.delete(key));
}

export async function cachedFetch(key, fetcher, options = {}) {
  const { fresh = false, ttlMs = DEFAULT_TTL_MS } = options;

  if (!fresh) {
    const cached = readCache(key);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  const result = await fetcher();
  if (result?.success) {
    writeCache(key, result, ttlMs);
  }
  return result;
}
