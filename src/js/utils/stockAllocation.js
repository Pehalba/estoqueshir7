import { availableQty } from './calculations.js';
import { normalizeSaleText, validateOrderWithStockEntry } from './saleTextParser.js';

const PRIORITY_RULES = [
  { test: /fedex\s*0?3|\b03\b/i, priority: 1, label: 'Fedex 03' },
  { test: /fedex\s*0?4|\b04\b/i, priority: 2, label: 'Fedex 04' },
  { test: /fedex\s*0?5|\b05\b/i, priority: 3, label: 'Fedex 05' },
  { test: /\blz\b/i, priority: 4, label: 'LZ' },
];

export function normalizeOrderSize(size) {
  const value = String(size || '').trim().toUpperCase();
  if (value === 'XGG') return 'XG';
  return value;
}

export function normalizeOrderSizes(order) {
  const sizes = (order.sizes || []).map((line) => ({
    ...line,
    size: normalizeOrderSize(line.size),
  }));
  return { ...order, sizes };
}

export function getDeductionPriority(entry) {
  if (entry?.deductionPriority != null && entry.deductionPriority !== '') {
    return Number(entry.deductionPriority) || 999;
  }

  const name = `${entry?.name || ''} ${entry?.productName || ''}`;
  for (const rule of PRIORITY_RULES) {
    if (rule.test.test(name)) return rule.priority;
  }
  return 999;
}

export function sortStockEntriesByDeductionPriority(entries = []) {
  return [...entries].sort((a, b) => {
    const diff = getDeductionPriority(a) - getDeductionPriority(b);
    if (diff !== 0) return diff;
    return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
  });
}

export function getMatchingStockEntries(productHint, stockEntries = []) {
  const hint = normalizeSaleText(productHint || '');
  if (!hint) return [];

  const active = (stockEntries || []).filter((e) => e.status !== 'inativo');

  const matches = active.filter((entry) => {
    const hay = normalizeSaleText(`${entry.productName || ''} ${entry.name || ''}`);
    if (!hay) return false;
    if (hay.includes(hint) || hint.includes(hay)) return true;

    const words = hint.split(' ').filter((w) => w.length > 2);
    const score = words.filter((w) => hay.includes(w)).length;
    if (words.length === 1 && words[0].length >= 5 && score >= 1) return true;
    return score >= 2;
  });

  return sortStockEntriesByDeductionPriority(matches);
}

function buildStockBalanceMap(stockEntries) {
  const balances = new Map();

  for (const entry of stockEntries || []) {
    const sizes = {};
    for (const sizeEntry of entry.sizes || []) {
      const size = normalizeOrderSize(sizeEntry.size);
      if (!size) continue;
      sizes[size] = (sizes[size] || 0) + availableQty(sizeEntry);
    }
    balances.set(entry.id, sizes);
  }

  return balances;
}

function getBalanceForEntry(balances, entryId, size) {
  const bucket = balances.get(entryId) || {};
  return bucket[size] || 0;
}

function canFulfillOrder(order, entry, balances) {
  for (const line of order.sizes || []) {
    const size = normalizeOrderSize(line.size);
    const qty = Number(line.quantity) || 0;
    if (!size || qty <= 0) return false;
    if (getBalanceForEntry(balances, entry.id, size) < qty) return false;
  }
  return (order.sizes || []).length > 0;
}

function consumeOrderFromBalance(order, entry, balances) {
  const bucket = balances.get(entry.id);
  if (!bucket) return;

  for (const line of order.sizes || []) {
    const size = normalizeOrderSize(line.size);
    const qty = Number(line.quantity) || 0;
    if (!size || qty <= 0) continue;
    bucket[size] = Math.max(0, (bucket[size] || 0) - qty);
  }
}

function appendStockAvailabilityErrors(stockEntry, order, balances, errors) {
  if (!stockEntry || !order?.sizes?.length) return;

  for (const line of order.sizes) {
    const size = normalizeOrderSize(line.size);
    const qty = Number(line.quantity) || 0;
    if (!size || qty <= 0) continue;

    const sizeEntry = (stockEntry.sizes || []).find(
      (s) => normalizeOrderSize(s.size) === size
    );
    if (!sizeEntry) continue;

    const available = balances
      ? getBalanceForEntry(balances, stockEntry.id, size)
      : availableQty(sizeEntry);

    if (available <= 0) {
      errors.push(`${size}: sem estoque disponível em "${stockEntry.name}".`);
    } else if (qty > available) {
      errors.push(
        `${size}: só há ${available} disponível(is) em "${stockEntry.name}".`
      );
    }
  }
}

/** Verifica saldo real (Firestore ou simulação em lote). */
export function collectStockAvailabilityErrors(stockEntry, sizes = [], balances = null) {
  const errors = [];
  appendStockAvailabilityErrors(stockEntry, { sizes }, balances, errors);
  return errors;
}

function buildAllocationHint(entry, order, balances) {
  if (!entry || !balances) return '';

  return (order.sizes || [])
    .map((line) => {
      const size = normalizeOrderSize(line.size);
      const available = getBalanceForEntry(balances, entry.id, size);
      return `${size}: ${available} disp.`;
    })
    .join(' · ');
}

function finalizeAllocatedOrder(order, entry, balances, consume = true) {
  const result = validateOrderWithStockEntry(order, entry);

  if (entry) {
    appendStockAvailabilityErrors(entry, order, balances, result.errors);
    result.allocationHint = buildAllocationHint(entry, order, balances);
    result.valid = result.errors.length === 0
      && !!order.orderId
      && (order.sizes || []).length > 0;
  }

  if (result.valid && entry && consume) {
    consumeOrderFromBalance(order, entry, balances);
  }

  return result;
}

/**
 * Distribui pedidos pelos lotes na ordem Fedex 03 → 04 → 05 → LZ.
 * Respeita overrides manuais por índice de linha.
 */
export function allocateOrdersByPriority(orders = [], stockEntries = [], overrides = {}) {
  const balances = buildStockBalanceMap(stockEntries);

  return orders.map((order, index) => {
    const normalized = normalizeOrderSizes(order);
    const overrideId = overrides[index];

    if (overrideId) {
      const entry = stockEntries.find((e) => e.id === overrideId) || null;
      if (!entry) {
        const missing = validateOrderWithStockEntry(normalized, null);
        missing.errors.push('Estoque selecionado não encontrado.');
        missing.valid = false;
        return missing;
      }
      return finalizeAllocatedOrder(normalized, entry, balances, true);
    }

    const candidates = getMatchingStockEntries(
      normalized.productName || normalized.raw,
      stockEntries
    );

    for (const entry of candidates) {
      if (!canFulfillOrder(normalized, entry, balances)) continue;
      return finalizeAllocatedOrder(normalized, entry, balances, true);
    }

    const fallback = validateOrderWithStockEntry(normalized, null);
    if ((normalized.sizes || []).length) {
      fallback.errors.push(
        'Sem estoque disponível na ordem Fedex 03 → Fedex 04 → Fedex 05 → LZ.'
      );
      fallback.valid = false;
    }
    return fallback;
  });
}

export function summarizeAllocationByStock(orders = []) {
  const summary = new Map();

  for (const order of orders) {
    const key = order.stockEntryId || '__none__';
    if (!summary.has(key)) {
      summary.set(key, {
        stockEntryId: order.stockEntryId || '',
        label: order.stockLabel || 'Sem estoque',
        count: 0,
        valid: 0,
        pieces: 0,
      });
    }
    const row = summary.get(key);
    row.count += 1;
    if (order.valid) row.valid += 1;
    row.pieces += (order.sizes || []).reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
  }

  return [...summary.values()].sort((a, b) => b.count - a.count);
}
