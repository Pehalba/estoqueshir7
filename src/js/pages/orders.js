import { listSales, updateSaleShipping, applyTrackingBatch, updateSaleShopifyLink, applyShopifyLinkBatch, updateSaleOrder, deleteSale } from '../services/salesService.js';
import { listInvestors } from '../services/investorService.js';
import { listStockEntries } from '../services/stockEntryService.js';
import {
  getGlobalSettings,
  saveGlobalSettings,
  DEFAULT_SETTINGS,
} from '../services/settingsService.js';
import { waitForAuth } from '../services/authService.js';
import {
  calculateQuickSaleFinancials,
  formatSaleLinesSummary,
  formatRepasseRule,
  recalculateSaleWithPlatformSettings,
  buildSaleFinancialsFromSale,
  calculateShir7ShirtShareForInvestor,
  resolveSaleUnitCost,
  resolveInvestorCapitalUnitCost,
  resolveSaleLotImportCostPerUnit,
  resolveSaleLotFreightCostPerUnit,
} from '../utils/calculations.js';
import { applyPlatformSettingsToSales, getSalePersonalizationStats } from '../utils/analytics.js';
import {
  buildShopifyOrderUrl,
  getSaleShippingStatus,
  isShopOrderNumber,
  normalizeShopOrderId,
  parseTrackingBatch,
  parseShopifyLinkBatch,
  normalizeShopifyStoreHandle,
} from '../utils/orderShipping.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { qs, qsa, showToast, setLoading, openModal, closeModal, setupModalClose } from '../utils/domHelpers.js';

let allSales = [];
let allInvestors = [];
let allStockEntries = [];
let globalSettings = { ...DEFAULT_SETTINGS };
let ordersShippingFilter = 'all';
let ordersPersFilter = 'all';
let ordersStockFilter = '';
let ordersSortDir = 'desc';
let editingSaleId = null;
let deletingSaleId = null;

function getSaleLines(sale) {
  if (sale?.lines?.length) {
    return sale.lines.map((line) => ({ ...line }));
  }

  return [{
    size: sale.size || '',
    quantity: Number(sale.quantity) || 1,
    unitPrice: Number(sale.unitPrice) || 0,
    freight: Number(sale.freight) || 0,
    ads: Number(sale.adsCost ?? sale.poolCost) || 0,
    otherCosts: Number(sale.fees) || 0,
    couponId: sale.couponId || '',
    couponName: sale.couponName || '',
    couponPercent: Number(sale.couponPercent) || 0,
    isPersonalized: !!sale.isPersonalized,
    personalizationPerPiece: Number(sale.personalizationPerPiece) || 0,
    personalizationCostPerPiece: Number(sale.personalizationCost) || 0,
  }];
}

function couponSelectHtml(selectedId = '') {
  const coupons = globalSettings.coupons || [];
  const options = ['<option value="">Sem cupom</option>']
    .concat(coupons.map((c) => {
      const selected = c.id === selectedId ? ' selected' : '';
      return `<option value="${escapeHtml(c.id)}"${selected}>${escapeHtml(c.name)} (${c.percent}%)</option>`;
    }));
  return options.join('');
}

function getLineCoupon(couponId) {
  if (!couponId) {
    return { couponId: '', couponName: '', couponPercent: 0 };
  }
  const coupon = (globalSettings.coupons || []).find((c) => c.id === couponId);
  return {
    couponId,
    couponName: coupon?.name || '',
    couponPercent: coupon?.percent || 0,
  };
}

function getDefaultPersValues() {
  return {
    personalizationPerPiece: Number(globalSettings.defaultPersonalizationPrice) || 50,
    personalizationCostPerPiece: Number(globalSettings.personalizationCostPerPiece) || 10,
  };
}

function isSalePersonalized(sale) {
  if (sale?.isPersonalized) return true;
  return (sale?.lines || []).some((line) => line.isPersonalized);
}

function formatDate(timestamp) {
  if (!timestamp?.seconds) return '—';
  return new Date(timestamp.seconds * 1000).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function getShopOrders() {
  return allSales.filter((sale) => isShopOrderNumber(sale.orderId));
}

function parseOrderSortKey(orderId) {
  const id = normalizeShopOrderId(orderId);
  const match = id.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    return { base: 0, suffix: 0, raw: id };
  }
  return {
    base: Number(match[1]),
    suffix: Number(match[2] || 0),
    raw: id,
  };
}

function sortOrders(orders, direction = ordersSortDir) {
  const mult = direction === 'asc' ? 1 : -1;
  return [...orders].sort((a, b) => {
    const ka = parseOrderSortKey(a.orderId);
    const kb = parseOrderSortKey(b.orderId);
    if (ka.base !== kb.base) return (ka.base - kb.base) * mult;
    if (ka.suffix !== kb.suffix) return (ka.suffix - kb.suffix) * mult;
    return ka.raw.localeCompare(kb.raw, undefined, { numeric: true }) * mult;
  });
}

function filterOrders() {
  const search = (qs('#orders-search-input')?.value || '').trim().toLowerCase();
  let orders = getShopOrders();

  if (ordersShippingFilter !== 'all') {
    orders = orders.filter((sale) => getSaleShippingStatus(sale) === ordersShippingFilter);
  }

  if (ordersPersFilter === 'personalized') {
    orders = orders.filter(isSalePersonalized);
  } else if (ordersPersFilter === 'not_personalized') {
    orders = orders.filter((sale) => !isSalePersonalized(sale));
  }

  if (ordersStockFilter === '__none__') {
    orders = orders.filter((sale) => !sale.stockEntryId);
  } else if (ordersStockFilter) {
    orders = orders.filter((sale) => sale.stockEntryId === ordersStockFilter);
  }

  if (search) {
    orders = orders.filter((sale) => {
      const hay = [
        sale.orderId,
        sale.productName,
        sale.stockEntryName,
        sale.trackingCode,
        formatSaleLinesSummary(sale),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(search);
    });
  }

  return sortOrders(orders);
}

function getStockEntryForSale(sale) {
  if (!sale?.stockEntryId) return null;
  return allStockEntries.find((entry) => entry.id === sale.stockEntryId) || null;
}

function getRecalculatedSale(sale) {
  const investor = sale.investorId
    ? allInvestors.find((i) => i.id === sale.investorId) || null
    : null;
  const stockEntry = getStockEntryForSale(sale);
  return recalculateSaleWithPlatformSettings(sale, globalSettings, investor, stockEntry);
}

function getOrderFinancialBreakdown(sale) {
  const stockEntry = getStockEntryForSale(sale);
  const recalc = getRecalculatedSale(sale);
  const investor = recalc.investorId
    ? allInvestors.find((i) => i.id === recalc.investorId) || null
    : null;
  const financials = buildSaleFinancialsFromSale(recalc, globalSettings, stockEntry);
  const unitCost = resolveSaleUnitCost(recalc, stockEntry);
  const pers = getSalePersonalizationStats(recalc, globalSettings);
  const persProfit = pers.revenue - pers.cost;
  const netProfit = Number(recalc.netProfit) || 0;
  const shirtNetProfit = Math.max(0, netProfit - persProfit);
  const shirtRevenue = Math.max(0, financials.totalRevenue - pers.revenue);
  const investorPayout = recalc.stockOrigin === 'investidor'
    ? Number(recalc.investorPayout) || 0
    : 0;
  const shir7ShirtShare = recalc.stockOrigin === 'investidor' && investor
    ? calculateShir7ShirtShareForInvestor(investor, {
      unitCost,
      quantity: recalc.quantity,
      financials,
      persProfit,
      sale: recalc,
      stockEntry,
    })
    : recalc.stockOrigin === 'investidor'
      ? 0
      : shirtNetProfit;

  return {
    recalc,
    financials,
    pers,
    persProfit,
    netProfit,
    shirtNetProfit,
    shirtRevenue,
    investorPayout,
    shir7ShirtShare,
    shir7Total: shir7ShirtShare + persProfit,
    unitCost,
    stockEntry,
  };
}

function renderDetailField(label, value, className = '') {
  return `
    <div class="order-detail-field ${className}">
      <dt>${escapeHtml(label)}</dt>
      <dd>${value}</dd>
    </div>
  `;
}

function renderOrderDetailSection(title, fieldsHtml, note = '') {
  return `
    <section class="order-detail-section">
      <h4 class="order-detail-section__title">${escapeHtml(title)}</h4>
      <dl class="order-detail-grid">${fieldsHtml}</dl>
      ${note ? `<p class="order-detail-note">${note}</p>` : ''}
    </section>
  `;
}

function buildOrderDetailHtml(sale) {
  const orderLabel = normalizeShopOrderId(sale.orderId);
  const breakdown = getOrderFinancialBreakdown(sale);
  const { recalc, financials, pers, persProfit, netProfit, shirtNetProfit, shirtRevenue, investorPayout, shir7ShirtShare, shir7Total, unitCost, stockEntry } = breakdown;
  const investor = recalc.investorId
    ? allInvestors.find((i) => i.id === recalc.investorId)
    : null;
  const isInvestorStock = recalc.stockOrigin === 'investidor';
  const hasPers = isSalePersonalized(recalc);
  const shippingStatus = getSaleShippingStatus(recalc);
  const shippingLabel = shippingStatus === 'enviado' ? 'Enviado' : 'Não enviado';
  const originLabel = isInvestorStock
    ? `Estoque investidor${investor ? ` · ${investor.name}` : ''}`
    : 'Estoque próprio SHIR7';
  const couponLabel = recalc.couponName || (Number(recalc.couponPercent) > 0 ? `${recalc.couponPercent}%` : 'Sem cupom');
  const platformFees = (recalc.platformFees || [])
    .filter((f) => Number(f.amount) > 0)
    .map((f) => `${f.name}: ${formatCurrency(f.amount)}`)
    .join(' · ');

  const pedidoSection = renderOrderDetailSection('Pedido', [
    renderDetailField('Número', `#${orderLabel}`),
    renderDetailField('Data', formatDate(recalc.createdAt)),
    renderDetailField('Envio', shippingLabel),
    renderDetailField('Rastreio', recalc.trackingCode || '—'),
    renderDetailField('Cupom', couponLabel),
    renderDetailField('Pagamento', recalc.paymentMethod || '—'),
  ].join(''));

  const costUnitLabel = formatCurrency(unitCost);
  const capitalUnitCost = resolveInvestorCapitalUnitCost(recalc, stockEntry);
  const capitalTotal = capitalUnitCost * (Number(recalc.quantity) || 1);

  const estoqueSection = renderOrderDetailSection('Produto e lote', [
    renderDetailField('Produto', recalc.productName || '—'),
    renderDetailField('Lote / estoque', recalc.stockEntryName || '—'),
    renderDetailField('Peças', formatSaleLinesSummary(recalc)),
    renderDetailField('Origem', originLabel),
    renderDetailField('Custo unitário (mercadoria)', costUnitLabel),
    renderDetailField('Custo total peças', formatCurrency(financials.productCost)),
    renderDetailField('Personalização', hasPers ? 'Sim' : 'Não'),
  ].join(''));

  const faturamentoFields = [
    renderDetailField('Total pago', formatCurrency(financials.totalRevenue), 'order-detail-field--highlight'),
    renderDetailField('Camisa', formatCurrency(shirtRevenue)),
  ];
  if (hasPers) {
    faturamentoFields.push(renderDetailField('Personalização', formatCurrency(pers.revenue)));
  }
  if (financials.discount > 0) {
    faturamentoFields.push(renderDetailField('Desconto (só camisa)', formatCurrency(financials.discount)));
  }
  const faturamentoSection = renderOrderDetailSection(
    'Faturamento',
    faturamentoFields.join(''),
    hasPers ? 'Desconto de cupom incide apenas no valor da camisa; personalização mantém valor cheio.' : ''
  );

  const custosFields = [
    renderDetailField('Custo das peças (mercadoria)', formatCurrency(financials.productCost), 'order-detail-field--cost'),
  ];
  if (financials.lotImportCostTotal > 0) {
    custosFields.push(renderDetailField('Imposto importação (operacional)', formatCurrency(financials.lotImportCostTotal), 'order-detail-field--cost'));
  }
  if (financials.lotFreightCostTotal > 0) {
    custosFields.push(renderDetailField('Frete internacional (operacional)', formatCurrency(financials.lotFreightCostTotal), 'order-detail-field--cost'));
  }
  if (pers.cost > 0) {
    custosFields.push(renderDetailField('Custo personalização', formatCurrency(pers.cost), 'order-detail-field--cost'));
  }
  if (financials.freightCost > 0) {
    custosFields.push(renderDetailField('Frete', formatCurrency(financials.freightCost), 'order-detail-field--cost'));
  }
  if (financials.platformCost > 0) {
    custosFields.push(renderDetailField('Taxas plataforma', formatCurrency(financials.platformCost), 'order-detail-field--cost'));
  }
  if (financials.adsCostTotal > 0) {
    custosFields.push(renderDetailField('Ads', formatCurrency(financials.adsCostTotal), 'order-detail-field--cost'));
  }
  if (financials.extraFees > 0) {
    custosFields.push(renderDetailField('Outros', formatCurrency(financials.extraFees), 'order-detail-field--cost'));
  }
  const custosSection = renderOrderDetailSection(
    'Custos',
    custosFields.join(''),
    platformFees || ''
  );

  const lucroFields = [
    renderDetailField('Lucro líquido total', formatCurrency(netProfit), 'order-detail-field--profit'),
    renderDetailField('Lucro líquido camisa', formatCurrency(shirtNetProfit), 'order-detail-field--profit'),
  ];
  if (hasPers) {
    lucroFields.push(renderDetailField('Lucro personalização', formatCurrency(persProfit), 'order-detail-field--profit'));
  }
  const lucroSection = renderOrderDetailSection('Lucro', lucroFields.join(''));

  let repasseSection = '';
  if (isInvestorStock) {
    repasseSection = `
      <section class="order-detail-section">
        <h4 class="order-detail-section__title">Repasse e SHIR7</h4>
        <div class="order-detail-split">
          <div class="order-detail-split__card order-detail-split__card--investor">
            <h4>${escapeHtml(investor?.name || 'Investidor')}</h4>
            <dl>
              <dt>Capital devolvido (só mercadoria)</dt>
              <dd>${formatCurrency(capitalTotal)}</dd>
              <dt>Repasse neste pedido</dt>
              <dd>${formatCurrency(investorPayout)}</dd>
              <dt>Regra</dt>
              <dd>${escapeHtml(investor ? formatRepasseRule(investor) : 'Capital + % do lucro (sem personalização)')}</dd>
            </dl>
          </div>
          <div class="order-detail-split__card order-detail-split__card--shir7">
            <h4>SHIR7</h4>
            <dl>
              <dt>Parte camisa (60% do lucro líquido)</dt>
              <dd>${formatCurrency(shir7ShirtShare)}</dd>
              ${hasPers ? `<dt>Personalização (100%)</dt><dd>${formatCurrency(persProfit)}</dd>` : ''}
              <dt>Total SHIR7 neste pedido</dt>
              <dd>${formatCurrency(shir7Total)}</dd>
            </dl>
          </div>
        </div>
        <p class="order-detail-note">Imposto e frete internacional são custos operacionais (como Yampi/Appmax): abatem o lucro, mas não entram no custo do produto nem no capital do investidor. Personalização não entra no repasse — fica 100% com a SHIR7.</p>
      </section>
    `;
  } else {
    repasseSection = renderOrderDetailSection('SHIR7', [
      renderDetailField('Lucro camisa', formatCurrency(shir7ShirtShare), 'order-detail-field--profit'),
      ...(hasPers ? [renderDetailField('Lucro personalização', formatCurrency(persProfit), 'order-detail-field--profit')] : []),
      renderDetailField('Total SHIR7 neste pedido', formatCurrency(shir7Total), 'order-detail-field--highlight'),
    ].join(''), 'Estoque próprio — lucro integral da operação fica com a SHIR7.');
  }

  return pedidoSection + estoqueSection + faturamentoSection + custosSection + lucroSection + repasseSection;
}

function openOrderDetailModal(saleId) {
  const sale = allSales.find((s) => s.id === saleId);
  if (!sale) return;

  const orderLabel = normalizeShopOrderId(sale.orderId);
  const shopifyDomain = normalizeShopifyStoreHandle(globalSettings.shopifyStoreDomain || '');
  const shopifyUrl = buildShopifyOrderUrl(orderLabel, {
    shopifyStoreDomain: shopifyDomain,
    shopifyOrderId: sale.shopifyOrderId,
  });

  qs('#order-detail-title').textContent = `Pedido #${orderLabel}`;
  qs('#order-detail-body').innerHTML = buildOrderDetailHtml(sale);

  const shopifyBtn = qs('#order-detail-shopify');
  if (shopifyBtn) {
    if (shopifyUrl) {
      shopifyBtn.href = shopifyUrl;
      shopifyBtn.hidden = false;
    } else {
      shopifyBtn.hidden = true;
    }
  }

  const editBtn = qs('#order-detail-edit-btn');
  if (editBtn) {
    editBtn.hidden = false;
    editBtn.dataset.saleId = saleId;
  }

  const deleteBtn = qs('#order-detail-delete-btn');
  if (deleteBtn) {
    deleteBtn.hidden = false;
    deleteBtn.dataset.saleId = saleId;
  }

  openModal('order-detail-modal');
}

function renderShippingBadge(sale) {
  const status = getSaleShippingStatus(sale);
  if (status === 'enviado') {
    return '<span class="badge badge--success">Enviado</span>';
  }
  return '<span class="badge badge--warning">Não enviado</span>';
}

function renderOrdersStats(orders, shopOrders) {
  const pending = shopOrders.filter((s) => getSaleShippingStatus(s) === 'nao_enviado').length;
  const shipped = shopOrders.length - pending;
  const personalized = shopOrders.filter(isSalePersonalized).length;

  const set = (id, value) => {
    const el = qs(id);
    if (el) el.textContent = String(value);
  };

  set('#stat-filtered', orders.length);
  set('#stat-pending', pending);
  set('#stat-shipped', shipped);
  set('#stat-personalized', personalized);

  const countEl = qs('#orders-count');
  if (countEl) {
    countEl.textContent = shopOrders.length
      ? `${shopOrders.length} pedido(s) cadastrado(s) · mostrando ${orders.length}`
      : 'Nenhum pedido cadastrado ainda';
  }

  const preview = qs('#shopify-handle-preview');
  if (preview) {
    preview.textContent = normalizeShopifyStoreHandle(globalSettings.shopifyStoreDomain || '') || '—';
  }
}

function renderOrdersTable() {
  const tbodyEl = qs('#orders-tbody');
  if (!tbodyEl) return;

  const orders = filterOrders();
  const shopOrders = getShopOrders();
  const shopifyDomain = normalizeShopifyStoreHandle(globalSettings.shopifyStoreDomain || '');

  renderOrdersStats(orders, shopOrders);

  if (!orders.length) {
    tbodyEl.innerHTML = '<tr><td colspan="6" class="table__empty">Nenhum pedido encontrado com estes filtros. Cadastre em Vendas → Colar pedidos.</td></tr>';
    return;
  }

  tbodyEl.innerHTML = orders.map((sale) => {
    const orderLabel = normalizeShopOrderId(sale.orderId);
    const shopifyUrl = buildShopifyOrderUrl(orderLabel, {
      shopifyStoreDomain: shopifyDomain,
      shopifyOrderId: sale.shopifyOrderId,
    });
    const trackingValue = escapeHtml(sale.trackingCode || '');
    const shopifyLinkValue = escapeHtml(sale.shopifyAdminUrl || '');
    const hasDirectLink = !!sale.shopifyOrderId;
    const linkTag = hasDirectLink
      ? '<span class="orders-link-tag">Link direto</span>'
      : '<span class="orders-link-tag orders-link-tag--search">Busca</span>';

    const shopifyBtn = shopifyUrl
      ? `<a class="btn btn--secondary btn--sm orders-actions__shopify" href="${escapeHtml(shopifyUrl)}" target="_blank" rel="noopener noreferrer" title="Abrir na Shopify">
          Shopify
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>`
      : '';

    const actionsCell = `
      <div class="orders-actions">
        <div class="orders-actions__top">
          <button type="button" class="btn btn--ghost btn--sm orders-edit-btn" data-sale-id="${sale.id}">Editar</button>
          <button type="button" class="btn btn--danger btn--sm orders-delete-btn" data-sale-id="${sale.id}">Excluir</button>
          ${shopifyDomain ? `${linkTag}${shopifyBtn}` : '<span class="text-sm text-muted">Configure a loja acima</span>'}
        </div>
        ${shopifyDomain ? `
          <input
            type="url"
            class="form-input orders-link-input orders-shopify-url"
            data-sale-id="${sale.id}"
            value="${shopifyLinkValue}"
            placeholder="Colar URL do admin..."
            aria-label="Vincular URL Shopify pedido ${orderLabel}"
          >` : ''}
      </div>`;

    const orderLink = `
      <button type="button" class="orders-order-link orders-order-detail-btn" data-sale-id="${sale.id}" title="Ver detalhes do pedido">
        #${orderLabel}
      </button>`;

    const hasPers = isSalePersonalized(sale);

    return `
      <tr data-sale-id="${sale.id}">
        <td>
          <div class="orders-row-order">
            ${orderLink}
            <span class="orders-row-date">${formatDate(sale.createdAt)}</span>
          </div>
        </td>
        <td class="orders-row-product">
          <span class="orders-row-product__name">${escapeHtml(sale.productName)}</span>
          <div class="orders-row-product__meta">
            <span>${escapeHtml(formatSaleLinesSummary(sale))}</span>
            ${hasPers ? '<span class="badge badge--info">Pers.</span>' : ''}
          </div>
        </td>
        <td class="orders-row-total">${formatCurrency(sale.totalRevenue)}</td>
        <td class="orders-row-status">${renderShippingBadge(sale)}</td>
        <td class="orders-tracking-wrap">
          <input
            type="text"
            class="form-input orders-tracking"
            data-sale-id="${sale.id}"
            value="${trackingValue}"
            placeholder="Cole o rastreio..."
            aria-label="Rastreio pedido ${orderLabel}"
          >
        </td>
        <td>${actionsCell}</td>
      </tr>
    `;
  }).join('');
}

async function openOrderEditModal(saleId) {
  const sale = allSales.find((s) => s.id === saleId);
  if (!sale) return;

  editingSaleId = saleId;
  const orderLabel = normalizeShopOrderId(sale.orderId);
  const titleEl = qs('#order-edit-title');
  const metaEl = qs('#order-edit-meta');

  if (titleEl) titleEl.textContent = `Editar pedido #${orderLabel}`;
  if (metaEl) {
    metaEl.textContent = [
      sale.productName,
      sale.stockEntryName,
      formatSaleLinesSummary(sale),
    ].filter(Boolean).join(' · ');
  }

  renderOrderEditLines(sale);
  updateOrderEditPreview();
  openModal('order-edit-modal');
}

function renderOrderEditLineRow(line, index) {
  const defaults = getDefaultPersValues();
  const persPrice = line.isPersonalized ? (Number(line.personalizationPerPiece) || 0) : 0;
  const persCost = line.isPersonalized
    ? (Number(line.personalizationCostPerPiece) || defaults.personalizationCostPerPiece)
    : defaults.personalizationCostPerPiece;

  return `
    <div class="order-edit-line" data-line-index="${index}">
      <div class="order-edit-line__head">
        <strong>${escapeHtml(line.size)}</strong>
        <span class="text-sm text-muted">${line.quantity} peça(s)</span>
      </div>
      <div class="order-edit-line__grid">
        <label class="order-edit-field">
          <span class="order-edit-field__label">Preço peça (R$)</span>
          <input class="form-input order-edit-price" type="number" min="0" step="0.01" value="${Number(line.unitPrice) || 0}">
        </label>
        <label class="order-edit-field">
          <span class="order-edit-field__label">Cupom</span>
          <select class="form-input form-select order-edit-coupon">${couponSelectHtml(line.couponId || '')}</select>
        </label>
        <label class="order-edit-field">
          <span class="order-edit-field__label">Frete (R$)</span>
          <input class="form-input order-edit-freight" type="number" min="0" step="0.01" value="${Number(line.freight) || 0}">
        </label>
        <label class="order-edit-field">
          <span class="order-edit-field__label">Ads (R$)</span>
          <input class="form-input order-edit-ads" type="number" min="0" step="0.01" value="${Number(line.ads) || 0}">
        </label>
        <label class="order-edit-field">
          <span class="order-edit-field__label">Outros (R$)</span>
          <input class="form-input order-edit-other" type="number" min="0" step="0.01" value="${Number(line.otherCosts) || 0}">
        </label>
      </div>
      <div class="order-edit-line__pers">
        <label class="order-edit-pers-check">
          <input type="checkbox" class="order-edit-pers-toggle" ${line.isPersonalized ? 'checked' : ''}>
          <span>Com personalização</span>
        </label>
        <div class="order-edit-line__pers-fields" ${line.isPersonalized ? '' : 'hidden'}>
          <label class="order-edit-field">
            <span class="order-edit-field__label">Venda pers. (R$/peça)</span>
            <input class="form-input order-edit-pers-value" type="number" min="0" step="0.01" value="${persPrice}">
          </label>
          <label class="order-edit-field">
            <span class="order-edit-field__label">Custo pers. (R$/peça)</span>
            <input class="form-input order-edit-pers-cost" type="number" min="0" step="0.01" value="${persCost}">
          </label>
        </div>
      </div>
      <input type="hidden" class="order-edit-size" value="${escapeHtml(line.size)}">
      <input type="hidden" class="order-edit-qty" value="${Number(line.quantity) || 1}">
    </div>
  `;
}

function renderOrderEditLines(sale) {
  const container = qs('#order-edit-lines');
  if (!container) return;

  const lines = getSaleLines(sale);
  container.innerHTML = lines.map((line, index) => renderOrderEditLineRow(line, index)).join('');

  container.querySelectorAll('.order-edit-pers-toggle').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const row = event.target.closest('.order-edit-line');
      const fields = row?.querySelector('.order-edit-line__pers-fields');
      if (fields) fields.hidden = !event.target.checked;
      if (event.target.checked) {
        const defaults = getDefaultPersValues();
        const costInput = row?.querySelector('.order-edit-pers-cost');
        if (costInput && !Number(costInput.value)) costInput.value = defaults.personalizationCostPerPiece;
      }
      updateOrderEditPreview();
    });
  });

  container.querySelectorAll('input, select').forEach((input) => {
    input.addEventListener('input', updateOrderEditPreview);
    input.addEventListener('change', updateOrderEditPreview);
  });
}

function collectOrderEditLinesFromDOM() {
  return qsa('.order-edit-line', qs('#order-edit-lines')).map((row) => {
    const couponId = row.querySelector('.order-edit-coupon')?.value || '';
    const coupon = getLineCoupon(couponId);
    const isPersonalized = row.querySelector('.order-edit-pers-toggle')?.checked || false;

    return {
      size: row.querySelector('.order-edit-size')?.value || '',
      quantity: Number(row.querySelector('.order-edit-qty')?.value) || 0,
      unitPrice: Number(row.querySelector('.order-edit-price')?.value) || 0,
      ...coupon,
      freight: Number(row.querySelector('.order-edit-freight')?.value) || 0,
      ads: Number(row.querySelector('.order-edit-ads')?.value) || 0,
      otherCosts: Number(row.querySelector('.order-edit-other')?.value) || 0,
      isPersonalized,
      personalizationPerPiece: isPersonalized
        ? Number(row.querySelector('.order-edit-pers-value')?.value) || 0
        : 0,
      personalizationCostPerPiece: isPersonalized
        ? Number(row.querySelector('.order-edit-pers-cost')?.value) || 0
        : 0,
    };
  }).filter((line) => line.size && line.quantity > 0);
}

function updateOrderEditPreview() {
  const previewEl = qs('#order-edit-preview');
  const sale = allSales.find((s) => s.id === editingSaleId);
  if (!previewEl || !sale) return;

  const lines = collectOrderEditLinesFromDOM();
  const financials = calculateQuickSaleFinancials({
    lines,
    unitCost: Number(sale.unitCost) || 0,
    lotImportCostPerUnit: resolveSaleLotImportCostPerUnit(sale),
    lotFreightCostPerUnit: resolveSaleLotFreightCostPerUnit(sale),
    defaultPersonalizationCostPerPiece: globalSettings.personalizationCostPerPiece,
    defaultPersonalizationPrice: globalSettings.defaultPersonalizationPrice,
    platformCosts: globalSettings.platformCosts || [],
    isSample: !!sale.isSample,
  });

  const parts = [
    `<strong>Faturamento:</strong> ${formatCurrency(financials.totalRevenue)}`,
  ];

  if (financials.personalizationTotal > 0) {
    parts.push(`Pers. +${formatCurrency(financials.personalizationTotal)}`);
  }
  if (financials.personalizationCostTotal > 0) {
    parts.push(`Custo pers. −${formatCurrency(financials.personalizationCostTotal)}`);
  }
  if (financials.discount > 0) {
    parts.push(`Cupom −${formatCurrency(financials.discount)}`);
  }
  if (financials.platformCost > 0) {
    parts.push(`Taxas −${formatCurrency(financials.platformCost)}`);
  }
  if (financials.lotOperationalCostTotal > 0) {
    parts.push(`Imp.+frete lote −${formatCurrency(financials.lotOperationalCostTotal)}`);
  }

  parts.push(`<strong>Lucro líquido:</strong> ${formatCurrency(financials.netProfit)}`);

  previewEl.innerHTML = parts.join(' · ');
  previewEl.classList.toggle('order-edit-preview--negative', financials.netProfit < 0);
}

async function handleOrderEditSubmit(event) {
  event.preventDefault();
  if (!editingSaleId) return;

  const btn = qs('#btn-order-edit-save');
  const lines = collectOrderEditLinesFromDOM();

  setLoading(btn, true);
  const result = await updateSaleOrder(editingSaleId, {
    lines,
    defaultPersonalizationCostPerPiece: globalSettings.personalizationCostPerPiece,
    defaultPersonalizationPrice: globalSettings.defaultPersonalizationPrice,
    platformCosts: globalSettings.platformCosts || [],
  });
  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  const sale = allSales.find((s) => s.id === editingSaleId);
  if (sale) {
    Object.assign(sale, result.data);
    const [recalculated] = applyPlatformSettingsToSales([sale], globalSettings, allInvestors, allStockEntries);
    Object.assign(sale, recalculated);
  }

  editingSaleId = null;
  closeModal('order-edit-modal');
  renderOrdersTable();
  showToast('Pedido atualizado.', 'success');
}

async function saveOrderTracking(saleId, trackingCode) {
  const sale = allSales.find((s) => s.id === saleId);
  if (!sale) return;

  const trimmed = String(trackingCode || '').trim();
  const current = String(sale.trackingCode || '').trim();

  if (trimmed === current) return;

  const result = await updateSaleShipping(saleId, {
    trackingCode: trimmed,
    shippingStatus: trimmed ? 'enviado' : 'nao_enviado',
  });

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  sale.trackingCode = trimmed;
  sale.shippingStatus = trimmed ? 'enviado' : 'nao_enviado';
  renderOrdersTable();
  showToast(trimmed ? 'Pedido marcado como enviado.' : 'Rastreio removido.', 'success');
}

async function handleApplyTrackingBatch() {
  const text = qs('#orders-tracking-batch')?.value || '';
  const entries = parseTrackingBatch(text);

  if (!entries.length) {
    showToast('Cole pedido e rastreio (ex.: 1163	BR123456789BR).', 'warning');
    return;
  }

  const btn = qs('#btn-orders-apply-tracking');
  setLoading(btn, true);
  const result = await applyTrackingBatch(entries);
  setLoading(btn, false);

  if (!result.success && !result.data?.applied?.length) {
    showToast(result.error || 'Nenhum pedido atualizado.', 'error');
    return;
  }

  const applied = result.data?.applied?.length || 0;
  const missing = result.data?.missing || [];
  showToast(
    `${applied} pedido(s) marcado(s) como enviado.${missing.length ? ` Não encontrados: ${missing.slice(0, 3).join(', ')}` : ''}`,
    missing.length ? 'warning' : 'success'
  );

  if (applied > 0) {
    qs('#orders-tracking-batch').value = '';
    await loadData();
  }
}

async function saveShopifyLink(saleId, url) {
  const sale = allSales.find((s) => s.id === saleId);
  if (!sale) return;

  const trimmed = String(url || '').trim();
  const current = String(sale.shopifyAdminUrl || '').trim();

  if (trimmed === current) return;

  const result = await updateSaleShopifyLink(saleId, { shopifyUrl: trimmed });

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  sale.shopifyOrderId = result.data.shopifyOrderId || '';
  sale.shopifyAdminUrl = result.data.shopifyAdminUrl || '';

  if (result.data.storeHandle && !globalSettings.shopifyStoreDomain) {
    globalSettings.shopifyStoreDomain = result.data.storeHandle;
    if (qs('#set-shopify-domain')) {
      qs('#set-shopify-domain').value = result.data.storeHandle;
    }
  }

  renderOrdersTable();
  showToast(trimmed ? 'Link Shopify salvo — abre direto no pedido.' : 'Link Shopify removido.', 'success');
}

async function handleApplyShopifyLinkBatch() {
  const text = qs('#orders-shopify-batch')?.value || '';
  const entries = parseShopifyLinkBatch(text);

  if (!entries.length) {
    showToast('Cole pedido e URL (ex.: #1152: https://admin.shopify.com/store/shir7-2/orders/...).', 'warning');
    return;
  }

  const btn = qs('#btn-orders-apply-shopify');
  setLoading(btn, true);
  const result = await applyShopifyLinkBatch(entries);
  setLoading(btn, false);

  if (!result.success && !result.data?.applied?.length) {
    showToast(result.error || 'Nenhum link aplicado.', 'error');
    return;
  }

  const applied = result.data?.applied?.length || 0;
  const missing = result.data?.missing || [];
  showToast(
    `${applied} link(s) vinculado(s).${missing.length ? ` Não encontrados: ${missing.slice(0, 3).join(', ')}` : ''}`,
    missing.length ? 'warning' : 'success'
  );

  if (applied > 0) {
    qs('#orders-shopify-batch').value = '';
    await loadData();
  }
}

async function handleSaveShopifyDomain() {
  const domain = normalizeShopifyStoreHandle(qs('#set-shopify-domain')?.value || '');
  const btn = qs('#btn-save-shopify-domain');
  setLoading(btn, true);

  const result = await saveGlobalSettings({
    ...globalSettings,
    shopifyStoreDomain: domain,
  });

  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  globalSettings = result.data;
  if (qs('#set-shopify-domain')) {
    qs('#set-shopify-domain').value = normalizeShopifyStoreHandle(globalSettings.shopifyStoreDomain || '');
  }
  renderOrdersTable();
  showToast('Loja Shopify salva!', 'success');
}

function setOrdersShippingFilter(filter) {
  ordersShippingFilter = filter;
  qsa('[data-orders-filter]').forEach((btn) => {
    btn.classList.toggle('orders-pill--active', btn.dataset.ordersFilter === filter);
  });
  renderOrdersTable();
}

function setOrdersPersFilter(filter) {
  ordersPersFilter = filter;
  qsa('[data-orders-pers-filter]').forEach((btn) => {
    btn.classList.toggle('orders-pill--active', btn.dataset.ordersPersFilter === filter);
  });
  renderOrdersTable();
}

function populateOrdersStockFilter() {
  const select = qs('#orders-stock-filter');
  if (!select) return;

  const previous = ordersStockFilter;
  const shopOrders = getShopOrders();
  const countByEntry = new Map();
  let withoutStock = 0;

  shopOrders.forEach((sale) => {
    if (!sale.stockEntryId) {
      withoutStock += 1;
      return;
    }
    countByEntry.set(
      sale.stockEntryId,
      (countByEntry.get(sale.stockEntryId) || 0) + 1
    );
  });

  const entries = allStockEntries
    .filter((entry) => countByEntry.has(entry.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));

  const options = ['<option value="">Todos os estoques</option>'];
  entries.forEach((entry) => {
    const count = countByEntry.get(entry.id);
    options.push(
      `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name || 'Sem nome')} (${count})</option>`
    );
  });

  if (withoutStock > 0) {
    options.push(`<option value="__none__">Sem lote vinculado (${withoutStock})</option>`);
  }

  select.innerHTML = options.join('');
  select.value = previous;
  if (select.value !== previous) {
    ordersStockFilter = '';
  }
}

function setOrdersStockFilter(stockEntryId) {
  ordersStockFilter = stockEntryId || '';
  renderOrdersTable();
}

function updateSortButtonUI() {
  const btn = qs('#btn-orders-sort');
  if (!btn) return;

  const isAsc = ordersSortDir === 'asc';
  btn.dataset.sort = ordersSortDir;
  btn.classList.toggle('orders-sort-btn--asc', isAsc);
  btn.classList.toggle('orders-sort-btn--desc', !isAsc);
  btn.title = isAsc ? 'Ordem crescente (# menor → maior)' : 'Ordem decrescente (# maior → menor)';
  btn.setAttribute('aria-label', btn.title);
}

function toggleOrdersSort() {
  ordersSortDir = ordersSortDir === 'asc' ? 'desc' : 'asc';
  updateSortButtonUI();
  renderOrdersTable();
}

function openDeleteOrderModal(saleId) {
  const sale = allSales.find((s) => s.id === saleId);
  if (!sale) return;

  deletingSaleId = saleId;
  const orderLabel = normalizeShopOrderId(sale.orderId);
  const pieces = getSaleLines(sale).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);

  qs('#delete-order-label').textContent = `o pedido #${orderLabel}`;
  const warning = qs('#delete-order-warning');
  if (warning) {
    const stockName = sale.stockEntryName || 'do lote vinculado';
    warning.textContent = `${pieces} peça(s) voltarão ao estoque "${stockName}".`;
    warning.hidden = false;
  }

  openModal('order-delete-modal');
}

async function handleDeleteOrder() {
  if (!deletingSaleId) return;

  const sale = allSales.find((s) => s.id === deletingSaleId);
  const btn = qs('#btn-confirm-delete-order');
  setLoading(btn, true);

  const result = await deleteSale(deletingSaleId);

  setLoading(btn, false);

  if (result.success) {
    const orderLabel = normalizeShopOrderId(sale?.orderId || '');
    showToast(`Pedido #${orderLabel} excluído. Estoque atualizado.`, 'success');
    closeModal('order-delete-modal');
    closeModal('order-detail-modal');
    deletingSaleId = null;
    await loadData();
    return;
  }

  showToast(result.error, 'error');
}

async function loadSettings() {
  const result = await getGlobalSettings();
  if (result.success) {
    globalSettings = result.data;
    if (qs('#set-shopify-domain')) {
      qs('#set-shopify-domain').value = normalizeShopifyStoreHandle(globalSettings.shopifyStoreDomain || '');
    }
    const preview = qs('#shopify-handle-preview');
    if (preview) {
      preview.textContent = normalizeShopifyStoreHandle(globalSettings.shopifyStoreDomain || '') || '—';
    }
  }
}

async function loadData() {
  const [salesResult, investorsResult, stockEntriesResult] = await Promise.all([
    listSales(),
    listInvestors(),
    listStockEntries(),
  ]);

  allInvestors = investorsResult.success ? investorsResult.data : [];
  allStockEntries = stockEntriesResult.success ? stockEntriesResult.data : [];
  const rawSales = salesResult.success ? salesResult.data : [];
  allSales = applyPlatformSettingsToSales(rawSales, globalSettings, allInvestors, allStockEntries);

  if (!salesResult.success) {
    showToast(salesResult.error, 'error');
  }

  populateOrdersStockFilter();
  renderOrdersTable();
}

function initEvents() {
  qs('#orders-search-input')?.addEventListener('input', renderOrdersTable);
  qs('#btn-orders-sort')?.addEventListener('click', toggleOrdersSort);
  updateSortButtonUI();

  qsa('[data-orders-filter]').forEach((btn) => {
    btn.addEventListener('click', () => setOrdersShippingFilter(btn.dataset.ordersFilter));
  });

  qsa('[data-orders-pers-filter]').forEach((btn) => {
    btn.addEventListener('click', () => setOrdersPersFilter(btn.dataset.ordersPersFilter));
  });

  qs('#orders-stock-filter')?.addEventListener('change', (event) => {
    setOrdersStockFilter(event.target.value);
  });

  qs('#orders-tbody')?.addEventListener('click', (event) => {
    const detailBtn = event.target.closest('.orders-order-detail-btn');
    if (detailBtn) {
      openOrderDetailModal(detailBtn.dataset.saleId);
      return;
    }

    const editBtn = event.target.closest('.orders-edit-btn');
    if (editBtn) {
      openOrderEditModal(editBtn.dataset.saleId);
      return;
    }

    const deleteBtn = event.target.closest('.orders-delete-btn');
    if (deleteBtn) {
      openDeleteOrderModal(deleteBtn.dataset.saleId);
    }
  });

  qs('#order-detail-delete-btn')?.addEventListener('click', (event) => {
    const saleId = event.currentTarget.dataset.saleId;
    if (!saleId) return;
    openDeleteOrderModal(saleId);
  });

  qs('#btn-confirm-delete-order')?.addEventListener('click', handleDeleteOrder);
  setupModalClose('order-delete-modal');

  qs('#order-detail-edit-btn')?.addEventListener('click', (event) => {
    const saleId = event.currentTarget.dataset.saleId;
    if (!saleId) return;
    closeModal('order-detail-modal');
    openOrderEditModal(saleId);
  });

  setupModalClose('order-detail-modal');

  qs('#order-edit-form')?.addEventListener('submit', handleOrderEditSubmit);
  setupModalClose('order-edit-modal');

  qs('#orders-tbody')?.addEventListener('blur', (event) => {
    const input = event.target.closest('.orders-tracking');
    if (!input) return;
    saveOrderTracking(input.dataset.saleId, input.value);
  }, true);

  qs('#orders-tbody')?.addEventListener('keydown', (event) => {
    const input = event.target.closest('.orders-tracking');
    if (!input || event.key !== 'Enter') return;
    event.preventDefault();
    input.blur();
  });

  qs('#orders-tbody')?.addEventListener('paste', (event) => {
    const input = event.target.closest('.orders-tracking, .orders-shopify-url');
    if (!input) return;
    setTimeout(() => {
      if (input.classList.contains('orders-tracking')) {
        saveOrderTracking(input.dataset.saleId, input.value);
      } else {
        saveShopifyLink(input.dataset.saleId, input.value);
      }
    }, 0);
  });

  qs('#orders-tbody')?.addEventListener('blur', (event) => {
    const shopifyInput = event.target.closest('.orders-shopify-url');
    if (!shopifyInput) return;
    saveShopifyLink(shopifyInput.dataset.saleId, shopifyInput.value);
  }, true);

  qs('#btn-orders-apply-tracking')?.addEventListener('click', handleApplyTrackingBatch);
  qs('#btn-orders-apply-shopify')?.addEventListener('click', handleApplyShopifyLinkBatch);
  qs('#btn-save-shopify-domain')?.addEventListener('click', handleSaveShopifyDomain);
}

async function init() {
  initEvents();
  await waitForAuth();
  await loadSettings();
  await loadData();
}

init();
