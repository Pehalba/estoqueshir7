import { parseSizesQuickInput } from './validators.js';

const SIZE_TOKEN = /(\d+)\s*([PXMG]{1,2}|GG|XG)\b/gi;

export function normalizeSaleText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractOrderId(text) {
  const raw = String(text || '');
  const hashOnly = raw.match(/^#\s*([a-z0-9-]+)\b/i);
  if (hashOnly) return hashOnly[1].toUpperCase();

  const labeled = raw.match(/(?:pedido|ped|order|#)\s*([a-z0-9-]+)/i);
  if (labeled) return labeled[1].toUpperCase();

  const leading = raw.match(/^\s*(\d{3,})\b/);
  if (leading) return leading[1];

  return '';
}

function matchCouponByToken(token, coupons = []) {
  const code = String(token || '').replace(/%/g, '').trim();
  if (!code) {
    return { couponId: '', couponName: '', couponPercent: 0 };
  }

  const upper = code.toUpperCase();
  const found = coupons.find((c) => {
    const name = String(c.name || '').toUpperCase();
    return name.includes(upper) || upper.includes(name.replace(/\s/g, ''));
  });

  return {
    couponId: found?.id || '',
    couponName: found?.name || code,
    couponPercent: found ? Number(found.percent) || 0 : 0,
  };
}

function parseCouponColumn(text, coupons = []) {
  const raw = String(text || '').trim();
  if (!raw) {
    return { couponId: '', couponName: '', couponPercent: 0 };
  }

  const normalized = normalizeSaleText(raw);

  if (
    normalized === 'nao'
    || normalized === 'n'
    || /^nao\b/.test(normalized)
    || /cupom\s*n[aã]o/.test(normalized)
    || /cupom\?\s*n[aã]o/.test(normalized)
  ) {
    return { couponId: '', couponName: '', couponPercent: 0 };
  }

  const simWithCode = raw.match(/^sim\s*\(([^)]+)\)/i);
  if (simWithCode) {
    return matchCouponByToken(simWithCode[1], coupons);
  }

  const parenCode = raw.match(/\(([^)]+)\)/);
  if (parenCode && !/^\d/.test(parenCode[1])) {
    return matchCouponByToken(parenCode[1], coupons);
  }

  if (normalized === 'sim' && !/\d/.test(raw)) {
    const defaultCoupon = coupons.find((c) => c.id === 'c-shir7-7')
      || coupons.find((c) => String(c.name).includes('7'));
    if (defaultCoupon) {
      return {
        couponId: defaultCoupon.id,
        couponName: defaultCoupon.name,
        couponPercent: Number(defaultCoupon.percent) || 0,
      };
    }
  }

  return extractCoupon(raw, coupons);
}

export function extractCoupon(text, coupons = []) {
  const raw = String(text || '');

  if (/cupom\?\s*n[aã]o/i.test(raw) || /\bcupom\b.*\bn[aã]o\b/i.test(raw)) {
    return { couponId: '', couponName: '', couponPercent: 0 };
  }

  const pctMatch = raw.match(/cupom\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*%/i)
    || raw.match(/\b(\d+(?:[.,]\d+)?)\s*%\s*(?:fixo|off)?/i);
  if (pctMatch) {
    const pct = Number(pctMatch[1].replace(',', '.'));
    const found = coupons.find((c) => Math.abs(Number(c.percent) - pct) < 0.01)
      || coupons.find((c) => String(c.name).includes(String(pct)));
    return found
      ? { couponId: found.id, couponName: found.name, couponPercent: Number(found.percent) || 0 }
      : { couponId: '', couponName: `${pct}%`, couponPercent: pct };
  }

  const nameMatch = raw.match(/cupom\s+([a-z0-9%]+)/i);
  if (nameMatch) {
    const token = nameMatch[1].replace(/%/g, '').toUpperCase();
    const found = coupons.find((c) => String(c.name).toUpperCase().includes(token));
    if (found) {
      return {
        couponId: found.id,
        couponName: found.name,
        couponPercent: Number(found.percent) || 0,
      };
    }
  }

  if (/sem\s+cupom/i.test(raw)) {
    return { couponId: '', couponName: '', couponPercent: 0 };
  }

  return { couponId: '', couponName: '', couponPercent: 0 };
}

/** Exibição: apenas Sim/Não, sem código do cupom. */
export function formatCouponUsedLabel(coupon = {}) {
  if (!coupon) return 'Não';
  const name = String(coupon.couponName || '').trim();
  const normalized = normalizeSaleText(name);
  if (normalized === 'nao' || normalized === 'n') return 'Não';
  if (coupon.couponId || Number(coupon.couponPercent) > 0 || name) return 'Sim';
  return 'Não';
}

/** Remove códigos entre parênteses na coluna cupom ao exibir a linha colada. */
export function sanitizeCouponTextInLine(text) {
  return String(text || '').replace(/\bSim\s*\([^)]+\)/gi, 'Sim');
}

export function extractPersonalization(text) {
  const raw = String(text || '');
  if (/sem\s+(?:pers(?:onaliza\w*)?|personalizacao)/i.test(raw)) return false;
  if (/com\s+(?:pers(?:onaliza\w*)?|personalizacao)/i.test(raw)) return true;
  if (/\bpers\b/i.test(raw) && !/sem\s+pers/i.test(raw)) return true;
  return false;
}

export function extractFreight(text, defaultFreight = 0) {
  const match = String(text || '').match(/frete\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/i);
  if (!match) return Number(defaultFreight) || 0;
  return Number(match[1].replace(',', '.')) || 0;
}

export function extractSizes(text) {
  const parsed = parseSizesQuickInput(text);
  if (parsed.length) return parsed;

  const results = [];
  let match;
  const regex = new RegExp(SIZE_TOKEN.source, SIZE_TOKEN.flags);
  while ((match = regex.exec(text)) !== null) {
    results.push({
      size: match[2].toUpperCase(),
      quantity: Number(match[1]),
    });
  }

  if (!results.length) {
    const trimmed = String(text || '').trim();
    if (/^([PXMG]{1,2}|GG|XG)$/i.test(trimmed)) {
      results.push({ size: trimmed.toUpperCase(), quantity: 1 });
      return results;
    }

    const single = String(text || '').match(/\btamanho\s+([PXMG]{1,2}|GG|XG)\b/i)
      || String(text || '').match(/\b(?:tam\.?|tamanho)\s*([PXMG]{1,2}|GG|XG)\b/i)
      || String(text || '').match(/\b([PXMG]{1,2}|GG|XG)\b(?=\s*(?:sem|com|cupom|frete|$))/i);
    if (single) {
      results.push({ size: single[1].toUpperCase(), quantity: 1 });
    }
  }

  return results;
}

function splitStructuredColumns(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;

  if (raw.includes('\t')) {
    return raw.split('\t').map((part) => part.trim());
  }

  const spaced = raw.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
  if (spaced.length >= 4) return spaced;

  return null;
}

function isStructuredHeaderRow(cols) {
  const joined = normalizeSaleText(cols.join(' '));
  const first = normalizeSaleText(cols[0] || '');
  return (
    (first === 'pedido' || first === '#' || first === 'numero' || first === 'n')
    && (
      joined.includes('produto')
      || joined.includes('modelo')
      || joined.includes('tamanho')
      || joined.includes('personaliz')
    )
  );
}

const SIZE_ONLY = /^(PP|P|M|G|GG|XG|XGG)$/i;

const COMPACT_PERS_MARKERS = /^(cp|sp|c\s*p|com\s*pers?|pers?|personalizacao|personalização)$/i;

const COMPACT_EXT_MARKERS = /^(ext|externo|externa)$/i;

export const EXT_AUTO_ORDER_ID = '__EXT_AUTO__';

const COMPACT_PRODUCT_HINTS = [
  'amarela',
  'vermelha',
  'azul',
  'feminina',
  'masculina',
  'torcedor',
  'jogador',
  'brasil',
  'copa',
];

function isCompactProductHint(token) {
  const norm = normalizeSaleText(token || '');
  if (!norm || SIZE_ONLY.test(token) || COMPACT_PERS_MARKERS.test(token)) return false;
  if (/^\d+(?:[.,]\d+)?$/.test(String(token || '').trim())) return false;
  return COMPACT_PRODUCT_HINTS.some((hint) => norm.includes(hint));
}

function looksLikeCompactSaleLine(raw) {
  const text = String(raw || '').trim();
  if (!text || text.includes('\t')) return false;

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 3 || tokens.length > 6) return false;

  const last = tokens[tokens.length - 1];
  const hasPrice = /^amostra$/i.test(last) || last === '0' || parseMoneyValue(last) > 0;
  if (!hasPrice) return false;

  if (COMPACT_EXT_MARKERS.test(tokens[0])) {
    return tokens.length >= 3;
  }

  return true;
}

/**
 * Formato curto (um por linha):
 *   1682 p 229
 *   1678 amarela p 229
 *   1678 p cp 300
 *   ext p 0          → amostra externa (0 = amostra; ID automático EXT-AMOSTRA-…)
 * O último número é o valor pago. Com CP, usa o preço fixo de personalização das configurações.
 */
export function parseCompactSaleLine(lineText, context = {}) {
  const raw = String(lineText || '').trim();
  if (!looksLikeCompactSaleLine(raw)) return null;

  const tokens = raw.split(/\s+/).filter(Boolean);
  let idx = 0;
  let orderId = '';
  let productName = '';

  if (COMPACT_EXT_MARKERS.test(tokens[0])) {
    orderId = EXT_AUTO_ORDER_ID;
    idx = 1;
  } else {
    orderId = extractOrderId(tokens[0]) || tokens[0].replace(/^#/, '').trim().toUpperCase();
    idx = 1;
  }

  if (tokens[idx] && isCompactProductHint(tokens[idx])) {
    productName = tokens[idx];
    idx += 1;
  }

  const sizeToken = tokens[idx];
  const size = parseSizeOnly(sizeToken);
  if (!size) return null;
  idx += 1;

  let isPersonalized = false;
  if (tokens[idx] && COMPACT_PERS_MARKERS.test(tokens[idx])) {
    const marker = normalizeSaleText(tokens[idx]);
    isPersonalized = marker !== 'sp';
    idx += 1;
  }

  const priceToken = tokens[idx];
  if (!priceToken) return null;

  const isSample = /^amostra$/i.test(priceToken) || priceToken === '0';
  const paid = isSample ? 0 : parseMoneyValue(priceToken);
  if (!isSample && paid <= 0) return null;
  if (tokens.length > idx + 1) return null;

  const sizes = [{ size, quantity: 1 }];
  const matchText = productName || raw;
  const { entry: stockEntry, error: stockError } = resolveStockEntry(context, matchText);

  const errors = [];
  if (!orderId) errors.push('Número do pedido inválido.');
  if (stockError) errors.push(stockError);
  appendSizeErrors(stockEntry, sizes, errors);

  return {
    valid: errors.length === 0,
    errors,
    raw,
    format: 'compact',
    orderId: String(orderId).toUpperCase(),
    saleDate: '',
    productName,
    stockEntry,
    stockEntryId: stockEntry?.id || '',
    stockLabel: stockEntry
      ? `${stockEntry.name} — ${stockEntry.productName}`
      : (productName || '—'),
    coupon: { couponId: '', couponName: '', couponPercent: 0 },
    isPersonalized,
    freight: extractFreight(raw, context.defaultFreight),
    unitPrice: paid,
    listPrice: 0,
    discountedPrice: isSample ? 0 : paid,
    isSample,
    sizes,
  };
}

export function parseMoneyValue(text) {
  const raw = String(text || '').trim();
  if (!raw) return 0;
  let num = raw.replace(/[^\d,.-]/g, '');
  if (num.includes(',')) {
    num = num.replace(/\./g, '').replace(',', '.');
  }
  return Number(num) || 0;
}

function parseSizeOnly(sizeText) {
  const trimmed = String(sizeText || '').trim();
  if (/^XGG$/i.test(trimmed)) return 'XG';
  if (SIZE_ONLY.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return '';
}

function buildSizesFromColumns(sizeText, qtyText) {
  const size = parseSizeOnly(sizeText);
  const qty = Number(String(qtyText || '').trim()) || 0;

  if (size && qty > 0) {
    return [{ size, quantity: qty }];
  }

  if (size) {
    return [{ size, quantity: 1 }];
  }

  return extractSizes(sizeText);
}

function isExtendedSpreadsheetFormat(cols) {
  if (cols.length >= 9) return true;
  if (cols.length < 7) return false;

  const sizeCol = String(cols[3] || '').trim();
  const qtyCol = String(cols[4] || '').trim();
  return SIZE_ONLY.test(sizeCol) && /^\d+$/.test(qtyCol);
}

function parseExtendedStructuredLine(cols, context, raw) {
  const orderId = extractOrderId(cols[0]) || cols[0].replace(/^#/, '').trim();
  const saleDate = cols[1] || '';
  const productName = cols[2] || '';
  const sizeText = cols[3] || '';
  const qtyText = cols[4] || '1';
  const persText = cols[5] || '';
  const couponText = cols[6] || '';
  const listPrice = parseMoneyValue(cols[7]);
  const discountedPrice = parseMoneyValue(cols[8]);
  const isSample = listPrice === 0 && discountedPrice === 0;
  const unitPrice = isSample ? 0 : (discountedPrice > 0 ? discountedPrice : listPrice);

  const sizes = buildSizesFromColumns(sizeText, qtyText);
  const isPersonalized = extractPersonalization(persText || raw);
  const coupon = parseCouponColumn(couponText, context.coupons || []);
  const freight = extractFreight(raw, context.defaultFreight);
  const { entry: stockEntry, error: stockError } = resolveStockEntry(context, productName);

  const errors = [];
  if (!orderId) errors.push('Número do pedido inválido.');
  if (!sizes.length) errors.push(`Tamanho inválido: "${sizeText}".`);
  if (stockError) errors.push(stockError);
  appendSizeErrors(stockEntry, sizes, errors);

  return {
    valid: errors.length === 0,
    errors,
    raw,
    format: 'structured-extended',
    orderId: String(orderId).toUpperCase(),
    saleDate,
    productName,
    stockEntry,
    stockEntryId: stockEntry?.id || '',
    stockLabel: stockEntry ? `${stockEntry.name} — ${stockEntry.productName}` : productName || '—',
    coupon,
    isPersonalized,
    freight,
    unitPrice,
    listPrice,
    discountedPrice,
    isSample,
    sizes,
  };
}

function parseLegacyStructuredLine(cols, context, raw) {
  const orderId = extractOrderId(cols[0]) || cols[0].replace(/^#/, '').trim();
  const saleDate = cols[1] || '';
  const productName = cols[2] || '';
  const sizeText = cols[3] || '';
  const persText = cols.length >= 6 ? cols[4] : '';
  const couponText = cols.length >= 6 ? cols[5] : (cols[4] || '');

  const sizes = extractSizes(sizeText);
  const isPersonalized = persText
    ? extractPersonalization(persText)
    : extractPersonalization(raw);
  const coupon = parseCouponColumn(couponText, context.coupons || []);
  const freight = extractFreight(raw, context.defaultFreight);
  const { entry: stockEntry, error: stockError } = resolveStockEntry(context, productName);

  const errors = [];
  if (!orderId) errors.push('Número do pedido inválido.');
  if (!sizes.length) errors.push(`Tamanho inválido: "${sizeText}".`);
  if (stockError) errors.push(stockError);
  appendSizeErrors(stockEntry, sizes, errors);

  return {
    valid: errors.length === 0,
    errors,
    raw,
    format: 'structured',
    orderId: String(orderId).toUpperCase(),
    saleDate,
    productName,
    stockEntry,
    stockEntryId: stockEntry?.id || '',
    stockLabel: stockEntry ? `${stockEntry.name} — ${stockEntry.productName}` : productName || '—',
    coupon,
    isPersonalized,
    freight,
    unitPrice: 0,
    listPrice: 0,
    discountedPrice: 0,
    sizes,
  };
}

/**
 * Planilha / colunas separadas por tab:
 * Legado: #1160  data  Produto  G  Pers  Cupom
 * Nova:   #1152  data  Modelo  GG  Qtd  Pers  Cupom?  Valor  Valor c/ desconto
 */
export function parseStructuredSaleLine(lineText, context = {}) {
  const raw = String(lineText || '').trim();
  const cols = splitStructuredColumns(raw);
  if (!cols || cols.length < 4) return null;
  if (isStructuredHeaderRow(cols)) return { skip: true, raw };

  if (isExtendedSpreadsheetFormat(cols)) {
    return parseExtendedStructuredLine(cols, context, raw);
  }

  return parseLegacyStructuredLine(cols, context, raw);
}

function stripMetaForProductMatch(text) {
  return normalizeSaleText(text)
    .replace(/(?:pedido|ped|order|#)\s*[a-z0-9-]+/g, '')
    .replace(/cupom\s*(?:de\s*)?\d+(?:[.,]\d+)?\s*%/g, '')
    .replace(/cupom\s+[a-z0-9%]+/g, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*%\b/g, '')
    .replace(/sem\s+(?:cupom|pers(?:onaliza\w*)?|personalizacao)/g, '')
    .replace(/com\s+(?:pers(?:onaliza\w*)?|personalizacao)/g, '')
    .replace(/frete\s*(?:de\s*)?\d+(?:[.,]\d+)?/g, '')
    .replace(/\d+\s*[pxmg]{1,2}\b/g, '')
    .replace(/\b(?:tam\.?|tamanho)\s*[pxmg]{1,2}\b/g, '')
    .replace(/\b[pxmg]{1,2}\b/g, '')
    .replace(/\bgg\b/g, '')
    .replace(/\bxg\b/g, '')
    .trim();
}

function resolveStockEntry(context, matchText) {
  if (context.stockMatchMode === 'defer') {
    return { entry: null, error: null };
  }

  if (context.stockMatchMode === 'fixed' && context.fixedStockEntryId) {
    const entry = (context.stockEntries || []).find((e) => e.id === context.fixedStockEntryId);
    if (!entry) {
      return { entry: null, error: 'Estoque selecionado inválido.' };
    }
    return { entry, error: null };
  }

  const entry = matchStockEntry(matchText, context.stockEntries || []);
  if (!entry) {
    const hint = String(matchText || '').trim() || 'modelo';
    return {
      entry: null,
      error: `Estoque não encontrado para "${hint}". Escolha manualmente abaixo.`,
    };
  }
  return { entry, error: null };
}

function normalizeOrderSizeLocal(size) {
  const value = String(size || '').trim().toUpperCase();
  if (value === 'XGG') return 'XG';
  return value;
}

function appendSizeErrors(stockEntry, sizes, errors) {
  if (!stockEntry || !sizes.length) return;
  for (const sizeLine of sizes) {
    const size = normalizeOrderSizeLocal(sizeLine.size);
    const sizeEntry = (stockEntry.sizes || []).find(
      (s) => normalizeOrderSizeLocal(s.size) === size
    );
    if (!sizeEntry) {
      errors.push(`Tamanho ${sizeLine.size} não existe neste estoque.`);
    }
  }
}

export function matchStockEntry(lineText, stockEntries = []) {
  const normLine = normalizeSaleText(lineText);
  const active = (stockEntries || []).filter(
    (e) => e.status !== 'inativo' && e.status !== 'esgotado'
  );

  let best = null;
  let bestLen = 0;

  for (const entry of active) {
    for (const label of [entry.productName, entry.name, `${entry.productName || ''} ${entry.name || ''}`.trim()]) {
      if (!label) continue;
      const normLabel = normalizeSaleText(label);
      if (normLabel.length < 3) continue;
      if (normLine.includes(normLabel) && normLabel.length > bestLen) {
        bestLen = normLabel.length;
        best = entry;
      }
    }
  }

  if (best) return best;

  const productHint = stripMetaForProductMatch(lineText);
  if (!productHint) return null;

  let bestScore = 0;
  for (const entry of active) {
    const hay = normalizeSaleText(`${entry.productName || ''} ${entry.name || ''}`);
    const words = productHint.split(' ').filter((w) => w.length > 2);
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return bestScore >= 2 ? best : null;
}

export function validateOrderWithStockEntry(order, stockEntry) {
  const errors = (order.errors || []).filter((e) => (
    !/estoque/i.test(e)
    && !/Selecione o estoque/i.test(e)
    && !/Tamanho .+ não existe neste estoque/.test(e)
    && !/só há \d+ disponível/.test(e)
    && !/sem estoque disponível/.test(e)
  ));

  if (!stockEntry) {
    errors.push('Selecione o estoque para este pedido.');
  } else {
    appendSizeErrors(stockEntry, order.sizes || [], errors);
  }

  const hasOrderId = !!order.orderId;
  const hasSizes = (order.sizes || []).length > 0;

  return {
    ...order,
    stockEntry: stockEntry || null,
    stockEntryId: stockEntry?.id || '',
    stockLabel: stockEntry
      ? `${stockEntry.name} — ${stockEntry.productName}`
      : (order.productName ? `${order.productName} (sem estoque)` : '—'),
    errors,
    valid: errors.length === 0 && hasOrderId && hasSizes,
  };
}

export function parseSaleTextLine(lineText, context = {}) {
  const structured = parseStructuredSaleLine(lineText, context);
  if (structured?.skip) {
    return { valid: false, errors: [], raw: structured.raw, skip: true };
  }
  if (structured) return structured;

  const compact = parseCompactSaleLine(lineText, context);
  if (compact) return compact;

  const errors = [];
  const raw = String(lineText || '').trim();
  if (!raw) {
    return { valid: false, errors: ['Linha vazia.'], raw };
  }

  const orderId = extractOrderId(raw);
  const coupon = extractCoupon(raw, context.coupons || []);
  const isPersonalized = extractPersonalization(raw);
  const freight = extractFreight(raw, context.defaultFreight);
  const sizes = extractSizes(raw);
  const { entry: stockEntry, error: stockError } = resolveStockEntry(context, raw);

  if (!sizes.length) {
    errors.push('Informe quantidade e tamanho (ex.: 1 G ou 2 M).');
  }
  if (stockError) {
    errors.push(stockError);
  }
  appendSizeErrors(stockEntry, sizes, errors);

  return {
    valid: errors.length === 0,
    errors,
    raw,
    format: 'free',
    orderId,
    saleDate: '',
    productName: '',
    stockEntry,
    stockEntryId: stockEntry?.id || '',
    stockLabel: stockEntry ? `${stockEntry.name} — ${stockEntry.productName}` : '—',
    coupon,
    isPersonalized,
    freight,
    unitPrice: 0,
    listPrice: 0,
    discountedPrice: 0,
    sizes,
  };
}

/**
 * Qty > 1 no mesmo tamanho vira vários pedidos (#1275 ×2 → #1275 e #1275-2).
 * Se o ID já tiver sufixo (#1177-2), continua a sequência (#1177-2, #1177-3…).
 */
export function splitSingleOrderByQuantity(order) {
  if (order?.skip) return [order];

  const sizes = order.sizes || [];
  if (sizes.length !== 1) return [order];

  const line = sizes[0];
  const qty = Math.floor(Number(line.quantity) || 0);
  if (qty <= 1) return [order];

  const rawId = String(order.orderId || '').trim().toUpperCase().replace(/^#/, '');
  if (!rawId) return [order];

  const suffixMatch = rawId.match(/^(\d+)-(\d+)$/);
  const baseNum = suffixMatch ? suffixMatch[1] : (rawId.match(/^(\d+)/)?.[1] || rawId);

  return Array.from({ length: qty }, (_, index) => {
    let orderId;
    if (index === 0) {
      orderId = rawId;
    } else if (suffixMatch) {
      const startSuffix = Number(suffixMatch[2]) || 2;
      orderId = `${baseNum}-${startSuffix + index}`;
    } else {
      orderId = `${baseNum}-${index + 1}`;
    }

    return {
      ...order,
      orderId,
      sizes: [{ ...line, quantity: 1 }],
      splitFromQuantity: qty,
      splitPart: index + 1,
    };
  });
}

export function splitOrdersByQuantity(orders = []) {
  return orders.flatMap((order) => splitSingleOrderByQuantity(order));
}

/**
 * 1 pedido = 1 peça. Vários tamanhos ou qtd > 1 viram linhas separadas (sem renumerar ainda).
 */
export function expandOrdersToOnePiece(orders = []) {
  const pieces = [];

  for (const order of orders || []) {
    if (!order || order.skip) continue;

    const sizes = order.sizes?.length
      ? order.sizes
      : [{ size: '', quantity: 1 }];

    for (const sizeLine of sizes) {
      const qty = Math.max(1, Math.floor(Number(sizeLine.quantity) || 1));
      for (let q = 0; q < qty; q += 1) {
        pieces.push({
          ...order,
          sizes: [{ ...sizeLine, quantity: 1 }],
        });
      }
    }
  }

  return pieces;
}

/** @deprecated Use expandOrdersToOnePiece + assignSequentialOrderIdSuffixes */
export function splitOrdersOnePieceEach(orders = []) {
  return assignSequentialOrderIdSuffixes(expandOrdersToOnePiece(orders));
}

/** Numeração #1678, #1678-2 quando o mesmo pedido aparece mais de uma vez no lote. */
export function assignSequentialOrderIdSuffixes(orders = []) {
  const counters = new Map();

  return orders.map((order) => {
    const rawId = String(order.orderId || '').trim().toUpperCase().replace(/^#/, '');
    if (
      !rawId
      || rawId === EXT_AUTO_ORDER_ID
      || /^EXT-(AMOSTRA|VENDA)-/i.test(rawId)
    ) {
      return order;
    }

    const baseMatch = rawId.match(/^(\d+)(?:-(\d+))?$/);
    const baseNum = baseMatch ? baseMatch[1] : rawId;

    const n = (counters.get(baseNum) || 0) + 1;
    counters.set(baseNum, n);

    const orderId = n === 1 ? baseNum : `${baseNum}-${n}`;
    if (orderId === rawId) return order;
    return { ...order, orderId };
  });
}

/** Gera IDs para linhas curtas `ext p 0` → EXT-AMOSTRA-P, EXT-AMOSTRA-P-2… */
export function assignExtOrderIds(orders = []) {
  const counters = new Map();

  return orders.map((order) => {
    if (order.orderId !== EXT_AUTO_ORDER_ID) return order;

    const size = order.sizes?.[0]?.size || 'P';
    const prefix = order.isSample ? 'EXT-AMOSTRA' : 'EXT-VENDA';
    const key = `${prefix}-${size}`;
    const n = (counters.get(key) || 0) + 1;
    counters.set(key, n);

    return {
      ...order,
      orderId: n === 1 ? key : `${key}-${n}`,
    };
  });
}

/** Várias linhas = vários pedidos (um por linha, uma peça por pedido). */
export function parseSalesBatchText(text, context = {}) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const orders = assignSequentialOrderIdSuffixes(
    assignExtOrderIds(
      expandOrdersToOnePiece(
        lines
          .map((line) => parseSaleTextLine(line, context))
          .filter((order) => !order.skip)
      )
    )
  );

  const valid = orders.filter((o) => o.valid);
  const invalid = orders.filter((o) => !o.valid);

  return {
    orders,
    valid,
    invalid,
    total: orders.length,
  };
}
