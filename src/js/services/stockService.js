import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  runTransaction,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';
import { getCurrentUser } from './authService.js';
import { getProductById, updateProduct } from './productService.js';
import {
  buildStockEntryPayload,
  createStockEntry,
  listStockEntries,
} from './stockEntryService.js';
import { applyMovement, totalQuantity, unitCostWithImportTax } from '../utils/calculations.js';

const MOVEMENTS = 'stockMovements';
const STOCK_ENTRIES = 'stockEntries';
const PRODUCTS = 'products';
const DEFAULT_LOW_STOCK = 5;

function mapMovement(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

export async function getLowStockThreshold() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'global'));
    if (snap.exists() && snap.data().lowStockThreshold != null) {
      return Number(snap.data().lowStockThreshold) || DEFAULT_LOW_STOCK;
    }
  } catch {
    // settings ainda não existe
  }
  return DEFAULT_LOW_STOCK;
}

function findSizeIndex(sizes, size) {
  return sizes.findIndex((s) => s.size === size);
}

function entryStatusFromQty(qty, currentStatus) {
  if (qty === 0) return 'esgotado';
  if (currentStatus === 'esgotado') return 'ativo';
  return currentStatus || 'ativo';
}

/**
 * Migra estoque legado que ainda está no documento do produto para stockEntries.
 */
export async function migrateLegacyProductStock(products) {
  const entriesResult = await listStockEntries();
  if (!entriesResult.success) return entriesResult;

  const existing = entriesResult.data;
  let migrated = 0;

  for (const product of products) {
    const qty = totalQuantity(product.sizes);
    if (qty <= 0) continue;
    if (existing.some((e) => e.productId === product.id)) continue;

    const unitFinal = unitCostWithImportTax(
      product.costPrice,
      product.importTaxes,
      product.sizes
    );

    const createResult = await createStockEntry({
      name: `${product.name} — estoque legado`,
      productId: product.id,
      productName: product.name,
      stockOrigin: product.stockOrigin || 'proprio',
      investorId: product.investorId || '',
      sizes: product.sizes,
      costPrice: unitFinal,
      importTaxes: 0,
      importTaxesPaidAt: product.importTaxesPaidAt || '',
      suggestedSalePrice: product.suggestedSalePrice,
      minimumSalePrice: product.minimumSalePrice,
      status: product.status === 'inativo' ? 'inativo' : 'ativo',
      notes: 'Migrado automaticamente do cadastro antigo de produto.',
    });

    if (!createResult.success) continue;

    await updateProduct(product.id, {
      name: product.name,
      sku: product.sku,
      category: product.category,
      imageUrl: product.imageUrl,
      supplier: product.supplier,
      status: product.status,
      notes: product.notes,
      sizes: [],
      costPrice: 0,
      importTaxes: 0,
      importTaxesPaidAt: '',
      suggestedSalePrice: 0,
      minimumSalePrice: 0,
      stockOrigin: 'proprio',
      investorId: '',
    });

    migrated += 1;
  }

  return { success: true, migrated };
}

export async function registerMovement({
  stockEntryId,
  productId,
  size,
  type,
  quantity,
  adjustTo,
  observation,
  stockEntryName,
  relatedSaleId,
}) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  if (!stockEntryId || !size) {
    return { success: false, error: 'Selecione o estoque e o tamanho.' };
  }

  try {
    const movementRef = doc(collection(db, MOVEMENTS));
    const entryRef = doc(db, STOCK_ENTRIES, stockEntryId);

    const result = await runTransaction(db, async (transaction) => {
      const entrySnap = await transaction.get(entryRef);
      if (!entrySnap.exists()) {
        throw new Error('Estoque não encontrado.');
      }

      const entry = entrySnap.data();
      const sizes = (entry.sizes || []).map((s) => ({
        size: s.size,
        quantity: Number(s.quantity) || 0,
        reserved: Number(s.reserved) || 0,
      }));

      let sizeIndex = findSizeIndex(sizes, size);

      if (sizeIndex === -1 && type === 'entrada') {
        sizes.push({ size, quantity: 0, reserved: 0 });
        sizeIndex = sizes.length - 1;
      }

      if (sizeIndex === -1) {
        throw new Error(`Tamanho ${size} não encontrado neste estoque.`);
      }

      const current = sizes[sizeIndex];
      const previousQty = current.quantity;
      const previousReserved = current.reserved;

      const applied = applyMovement(current, type, quantity, adjustTo);
      if (applied.error) {
        throw new Error(applied.error);
      }

      sizes[sizeIndex] = {
        size,
        quantity: applied.quantity,
        reserved: applied.reserved,
      };

      const newTotal = totalQuantity(sizes);

      transaction.update(entryRef, {
        sizes,
        quantity: newTotal,
        updatedAt: serverTimestamp(),
        status: entryStatusFromQty(newTotal, entry.status),
      });

      transaction.set(movementRef, {
        stockEntryId,
        productId: productId || entry.productId || '',
        productName: entry.productName || '',
        size,
        type,
        quantity: type === 'ajuste' ? adjustTo : Number(quantity),
        previousQty,
        newQty: applied.quantity,
        previousReserved,
        newReserved: applied.reserved,
        observation: observation || '',
        stockEntryName: stockEntryName || entry.name || '',
        stockOrigin: entry.stockOrigin || 'proprio',
        investorId: entry.investorId || '',
        userId: user.uid,
        userEmail: user.email || '',
        relatedSaleId: relatedSaleId || '',
        createdAt: serverTimestamp(),
      });

      return {
        previousQty,
        newQty: applied.quantity,
        movementId: movementRef.id,
      };
    });

    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Cadastra um lote de estoque (documento em stockEntries).
 * Não altera quantidades no catálogo de produtos.
 */
export async function registerStockEntry({
  productId,
  stockEntryName,
  stockOrigin,
  investorId,
  lines,
  observation,
  pricing = {},
}) {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Usuário não autenticado.' };
  }

  const safeLines = (lines || [])
    .filter((l) => l.size && Number(l.quantity) > 0)
    .map((l) => ({ size: l.size, quantity: Number(l.quantity) }));

  if (!productId || !safeLines.length) {
    return { success: false, error: 'Produto e peças são obrigatórios.' };
  }

  const costPrice = Number(pricing.costPrice) || 0;
  const suggestedSalePrice = Number(pricing.suggestedSalePrice) || 0;
  const minimumSalePrice = Number(pricing.minimumSalePrice) || 0;
  const importTaxes = Number(pricing.importTaxes) || 0;
  const importTaxesPaidAt = pricing.importTaxesPaidAt || '';
  const entryUnitFinal = unitCostWithImportTax(costPrice, importTaxes, safeLines);
  const origin = stockOrigin === 'investidor' ? 'investidor' : 'proprio';

  try {
    const productResult = await getProductById(productId);
    if (!productResult.success) {
      return { success: false, error: productResult.error };
    }

    const product = productResult.data;
    const entryRef = doc(collection(db, STOCK_ENTRIES));
    const movementIds = [];
    const entryPieces = safeLines.reduce((sum, l) => sum + l.quantity, 0);

    const sizes = safeLines.map((l) => ({
      size: l.size,
      quantity: l.quantity,
      reserved: 0,
    }));

    await runTransaction(db, async (transaction) => {
      transaction.set(entryRef, {
        ...buildStockEntryPayload({
          name: stockEntryName,
          productId,
          productName: product.name,
          stockOrigin: origin,
          investorId: origin === 'investidor' ? investorId : '',
          sizes,
          costPrice: entryUnitFinal,
          importTaxes: 0,
          importTaxesPaidAt,
          suggestedSalePrice,
          minimumSalePrice,
          status: 'ativo',
          notes: observation || '',
        }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (const line of safeLines) {
        const movementRef = doc(collection(db, MOVEMENTS));
        movementIds.push(movementRef.id);

        transaction.set(movementRef, {
          stockEntryId: entryRef.id,
          productId,
          productName: product.name || '',
          size: line.size,
          type: 'entrada',
          quantity: line.quantity,
          previousQty: 0,
          newQty: line.quantity,
          previousReserved: 0,
          newReserved: 0,
          observation: observation || 'Entrada de estoque',
          stockEntryName: stockEntryName || '',
          stockOrigin: origin,
          investorId: origin === 'investidor' ? investorId : '',
          costPrice,
          suggestedSalePrice,
          minimumSalePrice,
          importTaxes,
          importTaxesPaidAt,
          entryUnitFinal,
          userId: user.uid,
          userEmail: user.email || '',
          relatedSaleId: '',
          createdAt: serverTimestamp(),
        });
      }
    });

    return {
      success: true,
      data: {
        stockEntryId: entryRef.id,
        movementIds,
        entryPieces,
        entryUnitFinal,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getMovementHistory(filters = {}) {
  try {
    let snapshot;
    try {
      const q = query(collection(db, MOVEMENTS), orderBy('createdAt', 'desc'));
      snapshot = await getDocs(q);
    } catch {
      snapshot = await getDocs(collection(db, MOVEMENTS));
    }

    let movements = snapshot.docs.map(mapMovement);

    movements.sort((a, b) => {
      const ta = a.createdAt?.seconds ?? 0;
      const tb = b.createdAt?.seconds ?? 0;
      return tb - ta;
    });

    if (filters.productId) {
      movements = movements.filter((m) => m.productId === filters.productId);
    }
    if (filters.stockEntryId) {
      movements = movements.filter((m) => m.stockEntryId === filters.stockEntryId);
    }
    if (filters.type) {
      movements = movements.filter((m) => m.type === filters.type);
    }
    if (filters.size) {
      movements = movements.filter((m) => m.size === filters.size);
    }
    if (filters.origin) {
      movements = movements.filter((m) => m.stockOrigin === filters.origin);
    }
    if (filters.investor) {
      movements = movements.filter((m) => m.investorId === filters.investor);
    }

    return { success: true, data: movements };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function getLowStockItems(stockEntries, threshold) {
  const items = [];

  for (const entry of stockEntries) {
    if (entry.status === 'inativo') continue;
    for (const s of entry.sizes || []) {
      const available = (Number(s.quantity) || 0) - (Number(s.reserved) || 0);
      if (available <= threshold) {
        items.push({
          stockEntryId: entry.id,
          stockEntryName: entry.name,
          productId: entry.productId,
          productName: entry.productName,
          size: s.size,
          quantity: s.quantity,
          reserved: s.reserved || 0,
          available,
          stockOrigin: entry.stockOrigin,
          investorId: entry.investorId,
        });
      }
    }
  }

  return items.sort((a, b) => a.available - b.available);
}

export function getStockSummary(stockEntries) {
  const summary = {
    proprio: { pieces: 0, entries: 0 },
    investidor: { pieces: 0, entries: 0 },
  };

  const seen = { proprio: new Set(), investidor: new Set() };

  for (const entry of stockEntries) {
    if (entry.status === 'inativo') continue;
    const origin = entry.stockOrigin === 'investidor' ? 'investidor' : 'proprio';
    const total = totalQuantity(entry.sizes);
    if (total <= 0) continue;
    summary[origin].pieces += total;
    seen[origin].add(entry.id);
  }

  summary.proprio.entries = seen.proprio.size;
  summary.investidor.entries = seen.investidor.size;

  return summary;
}
