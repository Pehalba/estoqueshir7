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
import { getCurrentUser } from './authService.js';
import { registerMovement } from './stockService.js';
import { getStockEntryById } from './stockEntryService.js';
import { createQuickSale, resolveShopOrderIdSuffix, orderIdExists, getSaleById } from './salesService.js';
import { getGlobalSettings } from './settingsService.js';
import { availableQty } from '../utils/calculations.js';
import { normalizeOrderSize } from '../utils/stockAllocation.js';
import { cachedFetch, invalidateCache, CACHE_KEYS } from '../utils/dataCache.js';

const COLLECTION = 'establishments';

function mapDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function normalizeSizeLine(line) {
  const size = normalizeOrderSize(line?.size);
  const quantity = Math.floor(Number(line?.quantity) || 0);
  if (!size || quantity <= 0) return null;
  return { size, quantity };
}

/** Normaliza itens do formulário (por lote de estoque). */
export function normalizeEstablishmentItems(items = []) {
  return (items || [])
    .map((item) => {
      const stockEntryId = String(item.stockEntryId || '').trim();
      if (!stockEntryId) return null;

      const sizes = (item.sizes || [])
        .map(normalizeSizeLine)
        .filter(Boolean);

      if (!sizes.length) return null;

      return {
        stockEntryId,
        stockEntryName: String(item.stockEntryName || '').trim(),
        productName: String(item.productName || '').trim(),
        sizes,
      };
    })
    .filter(Boolean);
}

function flattenPlacementMap(items = []) {
  const map = new Map();

  for (const item of normalizeEstablishmentItems(items)) {
    for (const line of item.sizes) {
      const key = `${item.stockEntryId}|${line.size}`;
      map.set(key, (map.get(key) || 0) + line.quantity);
    }
  }

  return map;
}

function totalPieces(items = []) {
  return normalizeEstablishmentItems(items).reduce(
    (sum, item) => sum + item.sizes.reduce((s, line) => s + line.quantity, 0),
    0
  );
}

async function validateReservationCapacity(newItems, oldItems = []) {
  const oldMap = flattenPlacementMap(oldItems);
  const newMap = flattenPlacementMap(newItems);
  const keys = new Set([...oldMap.keys(), ...newMap.keys()]);
  const errors = [];

  for (const key of keys) {
    const [stockEntryId, size] = key.split('|');
    const oldQty = oldMap.get(key) || 0;
    const newQty = newMap.get(key) || 0;
    const diff = newQty - oldQty;
    if (diff <= 0) continue;

    const entryResult = await getStockEntryById(stockEntryId);
    if (!entryResult.success) {
      errors.push(`Estoque não encontrado (${stockEntryId}).`);
      continue;
    }

    const sizeEntry = (entryResult.data.sizes || []).find(
      (s) => normalizeOrderSize(s.size) === size
    );
    if (!sizeEntry) {
      errors.push(`${size}: tamanho inexistente em "${entryResult.data.name}".`);
      continue;
    }

    const avail = availableQty(sizeEntry);
    if (diff > avail) {
      errors.push(
        `${size} em "${entryResult.data.name}": só há ${avail} disponível(is) (pedido +${diff}).`
      );
    }
  }

  return errors;
}

async function syncReservations(oldItems, newItems, establishmentName) {
  const oldMap = flattenPlacementMap(oldItems);
  const newMap = flattenPlacementMap(newItems);
  const keys = new Set([...oldMap.keys(), ...newMap.keys()]);
  const label = String(establishmentName || 'Estabelecimento').trim() || 'Estabelecimento';

  const toRelease = [];
  const toReserve = [];

  for (const key of keys) {
    const [stockEntryId, size] = key.split('|');
    const oldQty = oldMap.get(key) || 0;
    const newQty = newMap.get(key) || 0;
    const diff = newQty - oldQty;

    if (diff < 0) {
      toRelease.push({ stockEntryId, size, quantity: -diff });
    } else if (diff > 0) {
      toReserve.push({ stockEntryId, size, quantity: diff });
    }
  }

  for (const op of toRelease) {
    const entryResult = await getStockEntryById(op.stockEntryId);
    if (!entryResult.success) {
      return { success: false, error: entryResult.error || 'Estoque não encontrado.' };
    }

    const result = await registerMovement({
      stockEntryId: op.stockEntryId,
      productId: entryResult.data.productId,
      size: op.size,
      type: 'devolucao',
      quantity: op.quantity,
      observation: `Estabelecimento "${label}" — devolução de consignado`,
      stockEntryName: entryResult.data.name,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }
  }

  for (const op of toReserve) {
    const entryResult = await getStockEntryById(op.stockEntryId);
    if (!entryResult.success) {
      return { success: false, error: entryResult.error || 'Estoque não encontrado.' };
    }

    const result = await registerMovement({
      stockEntryId: op.stockEntryId,
      productId: entryResult.data.productId,
      size: op.size,
      type: 'reserva',
      quantity: op.quantity,
      observation: `Estabelecimento "${label}" — consignado para venda física`,
      stockEntryName: entryResult.data.name,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }
  }

  invalidateCache(CACHE_KEYS.STOCK_ENTRIES, CACHE_KEYS.MOVEMENTS);
  return { success: true };
}

async function fetchEstablishmentsFromFirestore() {
  let snapshot;
  try {
    snapshot = await getDocs(
      query(collection(db, COLLECTION), orderBy('name', 'asc'))
    );
  } catch {
    snapshot = await getDocs(collection(db, COLLECTION));
  }

  const data = snapshot.docs.map(mapDoc);
  data.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
  return { success: true, data };
}

export async function listEstablishments(options = {}) {
  try {
    return await cachedFetch(CACHE_KEYS.ESTABLISHMENTS, fetchEstablishmentsFromFirestore, options);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getEstablishmentById(id) {
  try {
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (!snap.exists()) {
      return { success: false, error: 'Estabelecimento não encontrado.' };
    }
    return { success: true, data: mapDoc(snap) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function createEstablishment(input = {}) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const name = String(input.name || '').trim();
  if (!name) {
    return { success: false, error: 'Informe o nome do estabelecimento.' };
  }

  const items = normalizeEstablishmentItems(input.items);
  if (!items.length) {
    return { success: false, error: 'Informe ao menos uma peça (estoque + tamanho + qtd).' };
  }

  const capacityErrors = await validateReservationCapacity(items, []);
  if (capacityErrors.length) {
    return { success: false, error: capacityErrors.join(' ') };
  }

  const syncResult = await syncReservations([], items, name);
  if (!syncResult.success) {
    return syncResult;
  }

  try {
    const payload = {
      name,
      phone: String(input.phone || '').trim(),
      items,
      totalPieces: totalPieces(items),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: user.email || user.uid,
    };

    const ref = await addDoc(collection(db, COLLECTION), payload);
    invalidateCache(CACHE_KEYS.ESTABLISHMENTS);

    return {
      success: true,
      data: { id: ref.id, ...payload, totalPieces: totalPieces(items) },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateEstablishment(id, input = {}) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const existingResult = await getEstablishmentById(id);
  if (!existingResult.success) {
    return existingResult;
  }

  const existing = existingResult.data;
  const name = String(input.name ?? existing.name ?? '').trim();
  if (!name) {
    return { success: false, error: 'Informe o nome do estabelecimento.' };
  }

  const items = normalizeEstablishmentItems(input.items ?? existing.items);
  if (!items.length) {
    return { success: false, error: 'Informe ao menos uma peça (estoque + tamanho + qtd).' };
  }

  const capacityErrors = await validateReservationCapacity(items, existing.items || []);
  if (capacityErrors.length) {
    return { success: false, error: capacityErrors.join(' ') };
  }

  const syncResult = await syncReservations(existing.items || [], items, name);
  if (!syncResult.success) {
    return syncResult;
  }

  try {
    const payload = {
      name,
      phone: String(input.phone ?? existing.phone ?? '').trim(),
      items,
      totalPieces: totalPieces(items),
      updatedAt: serverTimestamp(),
    };

    await updateDoc(doc(db, COLLECTION, id), payload);
    invalidateCache(CACHE_KEYS.ESTABLISHMENTS);

    return { success: true, data: { id, ...existing, ...payload } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function deleteEstablishment(id) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const existingResult = await getEstablishmentById(id);
  if (!existingResult.success) {
    return existingResult;
  }

  const existing = existingResult.data;
  const syncResult = await syncReservations(existing.items || [], [], existing.name);
  if (!syncResult.success) {
    return syncResult;
  }

  try {
    await deleteDoc(doc(db, COLLECTION, id));
    invalidateCache(CACHE_KEYS.ESTABLISHMENTS);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function summarizeEstablishmentItems(items = []) {
  return normalizeEstablishmentItems(items).map((item) => {
    const sizesText = item.sizes.map((s) => `${s.quantity} ${s.size}`).join(', ');
    return `${item.stockEntryName || item.productName || 'Estoque'}: ${sizesText}`;
  });
}

/** Lista peças consignadas para o modal "marcar vendida". */
export function listConsignmentPieces(items = []) {
  const pieces = [];
  for (const item of normalizeEstablishmentItems(items)) {
    for (const line of item.sizes) {
      pieces.push({
        stockEntryId: item.stockEntryId,
        stockEntryName: item.stockEntryName,
        productName: item.productName,
        size: line.size,
        quantity: line.quantity,
        key: `${item.stockEntryId}|${line.size}`,
        label: `${item.stockEntryName || item.productName} — ${line.size} (${line.quantity} un.)`,
      });
    }
  }
  return pieces;
}

function decrementEstablishmentItem(items, stockEntryId, size) {
  const targetId = String(stockEntryId || '').trim();
  const targetSize = normalizeOrderSize(size);
  let found = false;

  const next = normalizeEstablishmentItems(items)
    .map((item) => {
      if (item.stockEntryId !== targetId) return item;

      const sizes = item.sizes
        .map((line) => {
          if (line.size !== targetSize) return line;
          if (line.quantity <= 0) return line;
          found = true;
          return { ...line, quantity: line.quantity - 1 };
        })
        .filter((line) => line.quantity > 0);

      return { ...item, sizes };
    })
    .filter((item) => item.sizes.length > 0);

  return { items: next, found };
}

function incrementEstablishmentItem(items, stockEntryId, size, meta = {}) {
  const targetId = String(stockEntryId || '').trim();
  const targetSize = normalizeOrderSize(size);
  if (!targetId || !targetSize) return normalizeEstablishmentItems(items);

  const next = normalizeEstablishmentItems(items);
  const itemIndex = next.findIndex((item) => item.stockEntryId === targetId);

  if (itemIndex >= 0) {
    const item = next[itemIndex];
    const sizes = [...item.sizes];
    const sizeIndex = sizes.findIndex((line) => line.size === targetSize);
    if (sizeIndex >= 0) {
      sizes[sizeIndex] = { ...sizes[sizeIndex], quantity: sizes[sizeIndex].quantity + 1 };
    } else {
      sizes.push({ size: targetSize, quantity: 1 });
    }
    next[itemIndex] = { ...item, sizes };
    return next;
  }

  next.push({
    stockEntryId: targetId,
    stockEntryName: String(meta.stockEntryName || '').trim(),
    productName: String(meta.productName || '').trim(),
    sizes: [{ size: targetSize, quantity: 1 }],
  });
  return next;
}

function getSalePieceFromEstablishmentSale(sale) {
  const lines = Array.isArray(sale.lines) ? sale.lines : [];
  if (lines.length === 1) {
    return {
      stockEntryId: sale.stockEntryId,
      size: normalizeOrderSize(lines[0].size),
      quantity: Number(lines[0].quantity) || 1,
    };
  }

  const size = normalizeOrderSize(String(sale.size || '').split(',')[0].trim());
  return {
    stockEntryId: sale.stockEntryId,
    size,
    quantity: Number(sale.quantity) || 1,
  };
}

function buildEstablishmentOrderId(establishment, soldCount) {
  const base = String(establishment.id || 'loja').slice(0, 8).toUpperCase();
  return `LOJA-${base}-${soldCount + 1}`;
}

/**
 * Venda de peça consignada: libera reserva, registra venda e baixa estoque.
 */
export async function markEstablishmentPieceSold(establishmentId, input = {}) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const stockEntryId = String(input.stockEntryId || '').trim();
  const size = normalizeOrderSize(input.size);
  const unitPrice = Number(input.unitPrice) || 0;

  if (!stockEntryId || !size) {
    return { success: false, error: 'Selecione a peça vendida.' };
  }
  if (unitPrice <= 0) {
    return { success: false, error: 'Informe o valor da venda.' };
  }

  const existingResult = await getEstablishmentById(establishmentId);
  if (!existingResult.success) {
    return existingResult;
  }

  const establishment = existingResult.data;
  const { items: nextItems, found } = decrementEstablishmentItem(
    establishment.items || [],
    stockEntryId,
    size
  );

  if (!found) {
    return { success: false, error: 'Peça não encontrada neste estabelecimento.' };
  }

  const entryResult = await getStockEntryById(stockEntryId);
  if (!entryResult.success) {
    return { success: false, error: entryResult.error || 'Estoque não encontrado.' };
  }

  const stockEntry = entryResult.data;
  const label = establishment.name || 'Estabelecimento';

  const releaseResult = await registerMovement({
    stockEntryId,
    productId: stockEntry.productId,
    size,
    type: 'devolucao',
    quantity: 1,
    observation: `Estabelecimento "${label}" — vendida (libera consignado)`,
    stockEntryName: stockEntry.name,
  });

  if (!releaseResult.success) {
    return { success: false, error: releaseResult.error };
  }

  const settingsResult = await getGlobalSettings();
  const settings = settingsResult.success ? settingsResult.data : {};
  const soldCount = Number(establishment.soldCount) || 0;
  let orderId = buildEstablishmentOrderId(establishment, soldCount);
  if (await orderIdExists(orderId)) {
    orderId = await resolveShopOrderIdSuffix(orderId);
  }

  const saleResult = await createQuickSale({
    stockEntryId,
    productId: stockEntry.productId,
    orderId,
    lines: [{
      size,
      quantity: 1,
      unitPrice,
      freight: 0,
      ads: 0,
      otherCosts: 0,
      isPersonalized: false,
    }],
    channel: 'loja_fisica',
    paymentMethod: input.paymentMethod || 'pix',
    customer: label,
    establishmentId,
    establishmentName: label,
    allowBelowMinimum: true,
    platformCosts: (settings.platformCosts || []).filter((c) => c.active !== false),
    defaultPersonalizationCostPerPiece: settings.personalizationCostPerPiece,
    defaultPersonalizationPrice: settings.defaultPersonalizationPrice,
  });

  if (!saleResult.success) {
    return {
      success: false,
      error: `${saleResult.error} (A reserva foi liberada — tente registrar a venda de novo ou ajuste o estoque.)`,
    };
  }

  try {
    await updateDoc(doc(db, COLLECTION, establishmentId), {
      items: nextItems,
      totalPieces: totalPieces(nextItems),
      soldCount: soldCount + 1,
      updatedAt: serverTimestamp(),
    });
    invalidateCache(
      CACHE_KEYS.ESTABLISHMENTS,
      CACHE_KEYS.STOCK_ENTRIES,
      CACHE_KEYS.SALES,
      CACHE_KEYS.MOVEMENTS
    );

    return {
      success: true,
      data: {
        orderId: saleResult.data?.orderId || orderId,
        saleId: saleResult.data?.id,
        establishmentId,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Venda registrada (${orderId}), mas falhou ao atualizar o estabelecimento: ${error.message}`,
    };
  }
}

/**
 * Desfaz venda de peça consignada: cancela a venda, devolve ao estoque e reconsigna na loja.
 */
export async function revertEstablishmentPieceSale(establishmentId, saleId) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const saleResult = await getSaleById(saleId);
  if (!saleResult.success) {
    return saleResult;
  }

  const sale = saleResult.data;
  if (sale.status === 'cancelada') {
    return { success: false, error: 'Esta venda já foi cancelada.' };
  }
  if (String(sale.establishmentId || '') !== String(establishmentId || '')) {
    return { success: false, error: 'Esta venda não pertence a este estabelecimento.' };
  }

  const piece = getSalePieceFromEstablishmentSale(sale);
  if (!piece.stockEntryId || !piece.size) {
    return { success: false, error: 'Não foi possível identificar a peça desta venda.' };
  }
  if (piece.quantity !== 1) {
    return { success: false, error: 'Só é possível desmarcar vendas de 1 peça por vez.' };
  }

  const existingResult = await getEstablishmentById(establishmentId);
  if (!existingResult.success) {
    return existingResult;
  }

  const establishment = existingResult.data;
  const entryResult = await getStockEntryById(piece.stockEntryId);
  if (!entryResult.success) {
    return { success: false, error: entryResult.error || 'Estoque não encontrado.' };
  }

  const stockEntry = entryResult.data;
  const label = establishment.name || 'Estabelecimento';

  const restoreResult = await registerMovement({
    stockEntryId: piece.stockEntryId,
    productId: stockEntry.productId,
    size: piece.size,
    type: 'entrada',
    quantity: 1,
    observation: `Estorno venda ${sale.orderId || saleId} — estabelecimento "${label}"`,
    stockEntryName: stockEntry.name,
    relatedSaleId: saleId,
  });

  if (!restoreResult.success) {
    return { success: false, error: restoreResult.error };
  }

  const reserveResult = await registerMovement({
    stockEntryId: piece.stockEntryId,
    productId: stockEntry.productId,
    size: piece.size,
    type: 'reserva',
    quantity: 1,
    observation: `Estorno venda ${sale.orderId || saleId} — reconsignado em "${label}"`,
    stockEntryName: stockEntry.name,
    relatedSaleId: saleId,
  });

  if (!reserveResult.success) {
    return { success: false, error: reserveResult.error };
  }

  const nextItems = incrementEstablishmentItem(
    establishment.items || [],
    piece.stockEntryId,
    piece.size,
    {
      stockEntryName: sale.stockEntryName || stockEntry.name,
      productName: sale.productName || stockEntry.productName,
    }
  );

  try {
    await updateDoc(doc(db, 'sales', saleId), {
      status: 'cancelada',
      cancelledAt: serverTimestamp(),
      cancelReason: `Estorno consignado — ${label}`,
      updatedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, COLLECTION, establishmentId), {
      items: nextItems,
      totalPieces: totalPieces(nextItems),
      soldCount: Math.max(0, (Number(establishment.soldCount) || 0) - 1),
      updatedAt: serverTimestamp(),
    });

    invalidateCache(
      CACHE_KEYS.ESTABLISHMENTS,
      CACHE_KEYS.STOCK_ENTRIES,
      CACHE_KEYS.SALES,
      CACHE_KEYS.MOVEMENTS
    );

    return {
      success: true,
      data: { saleId, establishmentId, orderId: sale.orderId || '' },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
