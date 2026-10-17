export const SIZE_ORDER = ['P', 'M', 'G', 'GG', 'XG', '3XL'];

/** Rótulos exibidos (variantes internacionais / loja). */
export const SIZE_DISPLAY = {
  P: 'P (S)',
  M: 'M (M)',
  G: 'G (L)',
  GG: 'GG (XL)',
  XG: 'XGG (XG / 2XL / XXL)',
  '3XL': '3XL',
};

export function displaySizeLabel(size) {
  return SIZE_DISPLAY[size] || size;
}

/** Normaliza XGG / 2XL / XXL → XG. */
export function normalizeSize(value) {
  const v = String(value || '').trim().toUpperCase();
  if (v === 'XGG' || v === '2XL' || v === 'XXL') return 'XG';
  return v;
}

export function sortSizes(sizes) {
  return [...(sizes || [])].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a.size);
    const ib = SIZE_ORDER.indexOf(b.size);
    if (ia === -1 && ib === -1) return String(a.size).localeCompare(String(b.size), 'pt-BR');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}
