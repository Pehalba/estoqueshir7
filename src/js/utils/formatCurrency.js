export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value) || 0);
}

export const formatBRL = formatCurrency;

export function formatPercent(value, decimals = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(decimals)}%`;
}
