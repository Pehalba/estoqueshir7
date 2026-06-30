import { normalizeSaleText } from './saleTextParser.js';

const SHIRT_COLOR_RULES = [
  { test: /\bvermelh/i, tone: 'vermelha', label: 'Vermelha', emoji: '🔴' },
  { test: /\bamarel/i, tone: 'amarela', label: 'Amarela', emoji: '🟡' },
  { test: /\bazul/i, tone: 'azul', label: 'Azul', emoji: '🔵' },
  { test: /\bpret/i, tone: 'preta', label: 'Preta', emoji: '⚫' },
];

export function inferShirtColor(entry) {
  const hay = normalizeSaleText(`${entry?.productName || ''} ${entry?.name || ''}`);
  for (const rule of SHIRT_COLOR_RULES) {
    if (rule.test.test(hay)) {
      return { tone: rule.tone, label: rule.label, emoji: rule.emoji };
    }
  }
  return { tone: 'neutral', label: 'Outra', emoji: '⚪' };
}

export function isProprioStockEntry(entry) {
  if (!entry) return false;
  if (entry.stockOrigin === 'proprio') return true;
  return /\bshir7\b/i.test(`${entry.name || ''} ${entry.productName || ''}`);
}

export function formatPasteStockOptionLabel(entry) {
  const color = inferShirtColor(entry);
  const proprioMark = isProprioStockEntry(entry) ? '🟣 ' : '';
  const statusTag = entry.status === 'esgotado' ? ' · esgotado' : '';
  return `${color.emoji} ${proprioMark}${entry.name}${statusTag}`;
}

export function pasteStockOptionAttrs(entry) {
  const color = inferShirtColor(entry);
  const classes = [
    'paste-stock-opt',
    `paste-stock-opt--${color.tone}`,
    isProprioStockEntry(entry) ? 'paste-stock-opt--proprio' : '',
  ].filter(Boolean).join(' ');
  return { class: classes, 'data-tone': color.tone };
}
