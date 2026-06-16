/** Normaliza #1163, 1163-2 → 1163 / 1163-2 */
export function normalizeShopOrderId(orderId) {
  return String(orderId || '')
    .trim()
    .replace(/^#/, '')
    .toUpperCase();
}

/** Pedidos da loja (#1163, 1177-2) e externos (#EXT-PE). Ignora IDs automáticos S20260611-123456. */
export function isShopOrderNumber(orderId) {
  const id = normalizeShopOrderId(orderId);
  if (!id) return false;
  if (/^S\d{8}-\d{6,}$/i.test(id)) return false;
  if (/^EXT-[A-Z0-9-]+$/i.test(id)) return true;
  return /^\d{3,}(-\d+)?$/i.test(id);
}

export function getSaleShippingStatus(sale) {
  if (sale?.shippingStatus === 'enviado') return 'enviado';
  if (sale?.trackingCode) return 'enviado';
  return 'nao_enviado';
}

/**
 * Extrai handle e ID interno de URLs como:
 * https://admin.shopify.com/store/shir7-2/orders/6545963941948
 */
export function parseShopifyAdminOrderUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;

  const adminMatch = raw.match(
    /admin\.shopify\.com\/store\/([^/?#]+)\/orders\/(\d+)/i
  );
  if (adminMatch) {
    return {
      storeHandle: adminMatch[1],
      shopifyOrderId: adminMatch[2],
    };
  }

  const legacyMatch = raw.match(
    /(?:https?:\/\/)?([^.]+\.myshopify\.com)\/admin\/orders\/(\d+)/i
  );
  if (legacyMatch) {
    return {
      storeHandle: legacyMatch[1].replace(/\.myshopify\.com$/i, ''),
      shopifyOrderId: legacyMatch[2],
      myshopifyDomain: legacyMatch[1],
    };
  }

  return null;
}

/** Aceita shir7-2, URL do admin ou domínio myshopify.com */
export function normalizeShopifyStoreHandle(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const parsed = parseShopifyAdminOrderUrl(raw.startsWith('http') ? raw : `https://${raw}`);
  if (parsed?.storeHandle) return parsed.storeHandle;

  const cleaned = raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const storeFromPath = cleaned.match(/admin\.shopify\.com\/store\/([^/?#]+)/i);
  if (storeFromPath) return storeFromPath[1];

  if (cleaned.includes('.myshopify.com')) {
    return cleaned.split('.myshopify.com')[0].replace(/^.*\//, '');
  }

  return cleaned.split('/')[0];
}

/**
 * Monta link do pedido na Shopify.
 * Com shopifyOrderId → abre o pedido direto (ex.: /orders/6545963941948).
 * Sem ID → busca pelo número (#1152, 1163-2, etc.).
 */
export function buildShopifyOrderUrl(orderId, config = {}) {
  const num = normalizeShopOrderId(orderId);
  const storeHandle = normalizeShopifyStoreHandle(
    config.shopifyStoreDomain || config.storeHandle || ''
  );
  const shopifyOrderId = String(config.shopifyOrderId || '').trim();

  if (!storeHandle) return '';

  if (shopifyOrderId) {
    return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/orders/${shopifyOrderId}`;
  }

  if (!num) return '';

  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/orders?query=${encodeURIComponent(num)}`;
}

/** Linhas: "1163\tBR123..." ou "1163 BR123..." ou "#1163-2 XX123" */
export function parseTrackingBatch(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results = [];

  for (const line of lines) {
    const tabCols = line.split(/\t+/).map((c) => c.trim()).filter(Boolean);
    let orderPart = '';
    let trackingPart = '';

    if (tabCols.length >= 2) {
      orderPart = tabCols[0];
      trackingPart = tabCols.slice(1).join(' ').trim();
    } else {
      const match = line.match(/^(#?\d{3,}(?:-\d+)?)\s+(.+)$/i);
      if (match) {
        orderPart = match[1];
        trackingPart = match[2].trim();
      }
    }

    const orderId = normalizeShopOrderId(orderPart);
    const trackingCode = String(trackingPart || '').trim();

    if (!orderId || !trackingCode) continue;

    results.push({ orderId, trackingCode });
  }

  return results;
}

/** Linhas: "1152 https://..." ou "#1152: https://..." */
export function parseShopifyLinkBatch(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results = [];

  for (const line of lines) {
    const tabCols = line.split(/\t+/).map((c) => c.trim()).filter(Boolean);
    let orderPart = '';
    let urlPart = '';

    if (tabCols.length >= 2) {
      orderPart = tabCols[0];
      urlPart = tabCols.slice(1).join(' ').trim();
    } else {
      const match = line.match(/^(#?\d{3,}(?:-\d+)?)\s*:?\s+(https?:\/\S+)/i);
      if (match) {
        orderPart = match[1];
        urlPart = match[2];
      } else if (/^https?:\/\//i.test(line)) {
        urlPart = line;
      }
    }

    const parsed = parseShopifyAdminOrderUrl(urlPart);
    if (!parsed?.shopifyOrderId) continue;

    results.push({
      orderId: orderPart ? normalizeShopOrderId(orderPart) : '',
      shopifyOrderId: parsed.shopifyOrderId,
      storeHandle: parsed.storeHandle,
      url: urlPart,
    });
  }

  return results;
}
