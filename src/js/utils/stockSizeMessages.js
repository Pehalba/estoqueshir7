import { availableQty } from './calculations.js';
import { SIZE_ORDER } from './sizes.js';

export function normalizeStockSize(size) {
  const value = String(size || '').trim().toUpperCase();
  return value === 'XGG' ? 'XG' : value;
}

/** Tamanhos cadastrados no lote, ordenados (P → XG). */
export function listStockEntrySizes(stockEntry) {
  const rows = (stockEntry?.sizes || [])
    .map((row) => ({
      size: normalizeStockSize(row.size),
      available: availableQty(row),
    }))
    .filter((row) => row.size);

  return rows.sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a.size);
    const ib = SIZE_ORDER.indexOf(b.size);
    if (ia === -1 && ib === -1) return a.size.localeCompare(b.size, 'pt-BR');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export function formatStockEntrySizesHint(stockEntry) {
  const rows = listStockEntrySizes(stockEntry);
  if (!rows.length) return 'nenhum tamanho cadastrado neste lote';
  return rows.map((row) => `${row.size} (${row.available} disp.)`).join(', ');
}

export function formatStockEntrySizeOptions(stockEntry) {
  const rows = listStockEntrySizes(stockEntry);
  if (!rows.length) return '—';
  return rows.map((row) => row.size).join(', ');
}

export function formatMissingSizeInStockError(stockEntry, size) {
  const lot = stockEntry?.name || 'estoque selecionado';
  const normalized = normalizeStockSize(size) || String(size || '').trim();
  const options = formatStockEntrySizeOptions(stockEntry);
  return `Este tamanho não tem no lote "${lot}": você pediu ${normalized}, mas aqui só há ${options}. Troque o tamanho, escolha outro lote ou cadastre ${normalized} em Estoque.`;
}

export function formatUnavailableSizeInStockError(stockEntry, size, available = 0, requestedQty = 1) {
  const lot = stockEntry?.name || 'estoque selecionado';
  const normalized = normalizeStockSize(size) || String(size || '').trim();
  const hint = formatStockEntrySizesHint(stockEntry);
  const qty = Number(requestedQty) || 1;

  if (available <= 0) {
    return `Tamanho ${normalized} acabou no lote "${lot}". Saldo neste lote: ${hint}. Troque o lote ou repor ${normalized} em Estoque.`;
  }

  return `Só há ${available} peça(s) ${normalized} no lote "${lot}" (pedido: ${qty}). Saldo neste lote: ${hint}.`;
}

export function isStockSizeErrorMessage(message) {
  const text = String(message || '');
  return /não tem no lote|não existe no lote|acabou no lote|esgotado no lote|só há \d+ peça/i.test(text);
}

export function getStockSizeErrorTitle(message) {
  const text = String(message || '');
  if (/não tem no lote|não existe no lote/i.test(text)) return 'Este tamanho não tem neste lote';
  if (/acabou no lote|esgotado no lote/i.test(text)) return 'Tamanho esgotado neste lote';
  if (/só há \d+ peça/i.test(text)) return 'Quantidade maior que o saldo';
  return 'Problema no estoque';
}
