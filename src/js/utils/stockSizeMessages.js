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
  return `Tamanho ${normalized} não existe no lote "${lot}". Tamanhos neste lote: ${options}. Selecione outro estoque em lote ou cadastre ${normalized} em Estoque.`;
}

export function formatUnavailableSizeInStockError(stockEntry, size, available = 0) {
  const lot = stockEntry?.name || 'estoque selecionado';
  const normalized = normalizeStockSize(size) || String(size || '').trim();
  const hint = formatStockEntrySizesHint(stockEntry);
  if (available <= 0) {
    return `Tamanho ${normalized} esgotado no lote "${lot}". Saldo: ${hint}. Troque o estoque ou repor peças ${normalized} em Estoque.`;
  }
  return `Tamanho ${normalized}: só há ${available} disponível(is) no lote "${lot}". Saldo: ${hint}.`;
}

export function isStockSizeErrorMessage(message) {
  const text = String(message || '');
  return /não existe no lote|esgotado no lote|só há \d+ disponível/i.test(text);
}
