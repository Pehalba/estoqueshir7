import {
  listEstablishments,
  createEstablishment,
  updateEstablishment,
  deleteEstablishment,
  normalizeEstablishmentItems,
  markEstablishmentPieceSold,
  revertEstablishmentPieceSale,
} from '../services/establishmentService.js';
import { listStockEntries } from '../services/stockEntryService.js';
import { listSales } from '../services/salesService.js';
import { waitForAuth } from '../services/authService.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { availableQty } from '../utils/calculations.js';
import { SIZE_ORDER } from '../utils/sizes.js';
import {
  qs,
  showToast,
  openModal,
  closeModal,
  setupModalClose,
  setLoading,
} from '../utils/domHelpers.js';

let allEstablishments = [];
let allStockEntries = [];
let allSales = [];
let editingId = null;
let deletingId = null;
let sellingId = null;
let sellingPiece = null;
let stockLineCounter = 0;

const tbody = qs('#establishments-tbody');
const searchInput = qs('#search-input');
const countEl = qs('#establishments-count');
const form = qs('#establishment-form');
const formErrors = qs('#form-errors');
const sellFormErrors = qs('#sell-form-errors');
const stockLinesEl = qs('#establishment-stock-lines');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showFormErrors(errors) {
  if (!errors.length) {
    formErrors.classList.remove('form-errors--visible');
    formErrors.innerHTML = '';
    return;
  }
  formErrors.innerHTML = `<ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
  formErrors.classList.add('form-errors--visible');
}

function showSellFormErrors(errors) {
  if (!sellFormErrors) return;
  if (!errors.length) {
    sellFormErrors.classList.remove('form-errors--visible');
    sellFormErrors.innerHTML = '';
    return;
  }
  sellFormErrors.innerHTML = `<ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
  sellFormErrors.classList.add('form-errors--visible');
}

function stockOriginLabel(origin) {
  return origin === 'investidor' ? 'Investidor' : 'SHIR7';
}

function getEligibleStockEntries(extraIds = []) {
  const extraSet = new Set((extraIds || []).filter(Boolean));
  return allStockEntries.filter((e) => {
    if (e.status === 'inativo' && !extraSet.has(e.id)) return false;
    return true;
  });
}

function getSelectedStockEntryIds(exceptRow = null) {
  const ids = [];
  stockLinesEl.querySelectorAll('.establishment-stock-line').forEach((row) => {
    if (row === exceptRow) return;
    const id = row.querySelector('.establishment-stock-select')?.value || '';
    if (id) ids.push(id);
  });
  return ids;
}

function stockEntryOptionsHtml(selectedId = '', excludeIds = []) {
  const excludeSet = new Set((excludeIds || []).filter((id) => id && id !== selectedId));
  const entries = getEligibleStockEntries(selectedId ? [selectedId] : []);

  if (!entries.length) {
    return '<option value="" disabled>Nenhum estoque disponível</option>';
  }

  return entries
    .filter((entry) => !excludeSet.has(entry.id))
    .map((entry) => {
      const selected = entry.id === selectedId ? ' selected' : '';
      const tag = entry.status === 'esgotado' ? ' · esgotado' : '';
      const origin = stockOriginLabel(entry.stockOrigin);
      return `<option value="${entry.id}"${selected}>${escapeHtml(entry.name)} — ${escapeHtml(entry.productName)} · ${origin}${tag}</option>`;
    }).join('');
}

function refreshStockLineSelectOptions() {
  stockLinesEl.querySelectorAll('.establishment-stock-line').forEach((row) => {
    const select = row.querySelector('.establishment-stock-select');
    if (!select) return;
    const current = select.value;
    const exclude = getSelectedStockEntryIds(row);
    select.innerHTML = `<option value="">— Selecione —</option>${stockEntryOptionsHtml(current, exclude)}`;
    if (current && [...select.options].some((o) => o.value === current)) {
      select.value = current;
    }
  });
}

function collectSizesFromRow(row) {
  const sizes = [];
  row.querySelectorAll('.establishment-size-qty').forEach((input) => {
    const size = input.dataset.size || '';
    if (!size) return;
    sizes.push({
      size,
      quantity: Math.floor(Number(input.value) || 0),
    });
  });
  return sizes;
}

function sizeInputsHtml(sizes = [], stockEntryId = '') {
  const entry = allStockEntries.find((e) => e.id === stockEntryId);
  const sizeMap = new Map((entry?.sizes || []).map((s) => [s.size, s]));
  const qtyMap = new Map((sizes || []).map((s) => [s.size, Number(s.quantity) || 0]));

  const ordered = SIZE_ORDER.filter((size) => sizeMap.has(size) || qtyMap.get(size) > 0);
  const extras = [...sizeMap.keys()].filter((s) => !SIZE_ORDER.includes(s));
  const allSizes = [...ordered, ...extras];

  if (!allSizes.length) {
    return '<p class="text-muted text-sm">Selecione um estoque para ver os tamanhos.</p>';
  }

  return `
    <div class="establishment-size-grid">
      ${allSizes.map((size) => {
        const entrySize = sizeMap.get(size);
        const avail = entrySize ? availableQty(entrySize) : 0;
        const val = qtyMap.get(size) || 0;
        return `
          <label class="establishment-size-cell">
            <span class="establishment-size-cell__label">${escapeHtml(size)}</span>
            <input type="number" class="form-input establishment-size-qty" data-size="${escapeHtml(size)}" min="0" step="1" value="${val}" placeholder="0">
            <span class="establishment-size-cell__hint">${avail} disp.</span>
          </label>
        `;
      }).join('')}
    </div>
  `;
}

function createStockLineElement(data = {}) {
  const id = `stock-line-${stockLineCounter += 1}`;
  const wrapper = document.createElement('div');
  wrapper.className = 'establishment-stock-line';
  wrapper.dataset.lineId = id;

  wrapper.innerHTML = `
    <div class="establishment-stock-line__header">
      <div class="form-group establishment-stock-line__select">
        <label class="form-group__label">Estoque / lote</label>
        <select class="form-input form-select establishment-stock-select" required>
          <option value="">— Selecione —</option>
          ${stockEntryOptionsHtml(data.stockEntryId || '')}
        </select>
      </div>
      <button type="button" class="btn btn--ghost btn--sm establishment-stock-remove" title="Remover lote">Remover</button>
    </div>
    <div class="establishment-stock-line__sizes"></div>
  `;

  const select = wrapper.querySelector('.establishment-stock-select');
  const sizesEl = wrapper.querySelector('.establishment-stock-line__sizes');

  const renderSizes = (sizesOverride = null) => {
    const sizes = sizesOverride !== null
      ? sizesOverride
      : collectSizesFromRow(wrapper);
    sizesEl.innerHTML = sizeInputsHtml(sizes, select.value);
  };

  select.addEventListener('change', () => {
    renderSizes([]);
    refreshStockLineSelectOptions();
  });
  wrapper.querySelector('.establishment-stock-remove').addEventListener('click', () => {
    wrapper.remove();
    if (!stockLinesEl.querySelector('.establishment-stock-line')) {
      addStockLine();
    } else {
      refreshStockLineSelectOptions();
    }
  });

  if (data.stockEntryId) {
    select.value = data.stockEntryId;
  }
  renderSizes(data.sizes || []);
  return wrapper;
}

function addStockLine(data = {}) {
  stockLinesEl.appendChild(createStockLineElement(data));
  refreshStockLineSelectOptions();
}

function resetStockLines(items = []) {
  stockLineCounter = 0;
  stockLinesEl.innerHTML = '';
  if (items.length) {
    items.forEach((item) => addStockLine(item));
  } else {
    addStockLine();
  }
  refreshStockLineSelectOptions();
}

function collectStockLinesFromForm() {
  const lines = [];

  stockLinesEl.querySelectorAll('.establishment-stock-line').forEach((row) => {
    const select = row.querySelector('.establishment-stock-select');
    const stockEntryId = select?.value || '';
    if (!stockEntryId) return;

    const entry = allStockEntries.find((e) => e.id === stockEntryId);
    const sizes = [];

    row.querySelectorAll('.establishment-size-qty').forEach((input) => {
      const qty = Math.floor(Number(input.value) || 0);
      if (qty > 0) {
        sizes.push({ size: input.dataset.size, quantity: qty });
      }
    });

    if (sizes.length) {
      lines.push({
        stockEntryId,
        stockEntryName: entry?.name || '',
        productName: entry?.productName || '',
        sizes,
      });
    }
  });

  return lines;
}

function getEstablishmentSales(establishmentId) {
  return allSales
    .filter((sale) => sale.establishmentId === establishmentId && sale.status !== 'cancelada')
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
}

function sortSizeLines(sizes = []) {
  const order = (size) => {
    const idx = SIZE_ORDER.indexOf(size);
    return idx >= 0 ? idx : SIZE_ORDER.length + 1;
  };
  return [...sizes].sort((a, b) => order(a.size) - order(b.size));
}

function renderEstablishmentUnitsHtml(est) {
  const items = normalizeEstablishmentItems(est.items || []);
  if (!items.length) {
    return '<span class="text-muted text-sm">Sem peças consignadas</span>';
  }

  const lotsHtml = items.map((item) => {
    const lotName = item.stockEntryName || item.productName || 'Estoque';
    const columns = sortSizeLines(item.sizes).map((line) => {
      const qty = Number(line.quantity) || 0;
      if (qty <= 0) return '';

      const chips = Array.from({ length: qty }, () => `
        <button
          type="button"
          class="establishment-unit-chip"
          title="Marcar ${lotName} ${line.size} como vendida"
          data-sell-unit
          data-est-id="${est.id}"
          data-stock-entry-id="${item.stockEntryId}"
          data-size="${escapeHtml(line.size)}"
        >${escapeHtml(line.size)}</button>
      `).join('');

      return `
        <div class="establishment-units__col" aria-label="Tamanho ${escapeHtml(line.size)}">
          ${chips}
        </div>
      `;
    }).filter(Boolean).join('');

    if (!columns) return '';

    return `
      <div class="establishment-units__lot">
        <span class="establishment-units__lot-name">${escapeHtml(lotName)}</span>
        <div class="establishment-units__grid">${columns}</div>
      </div>
    `;
  }).filter(Boolean).join('');

  const recentSales = getEstablishmentSales(est.id);
  const soldHtml = recentSales.length
    ? `
      <div class="establishment-units__sold">
        <span class="establishment-units__sold-label">Vendidas — clique para desmarcar</span>
        <div class="establishment-units__chips">
          ${recentSales.map((sale) => {
            const size = sale.lines?.[0]?.size || String(sale.size || '').split(',')[0].trim();
            const lot = sale.stockEntryName || sale.productName || 'Peça';
            const price = Number(sale.totalRevenue) || 0;
            const orderLabel = sale.orderId || 'venda';
            return `
              <button
                type="button"
                class="establishment-unit-chip establishment-unit-chip--sold"
                title="Desmarcar ${orderLabel} · ${lot}${price > 0 ? ` · ${formatCurrency(price)}` : ''}"
                data-revert-sale
                data-est-id="${est.id}"
                data-sale-id="${sale.id}"
              >
                <span class="establishment-unit-chip__size">${escapeHtml(size)}</span>
                <span class="establishment-unit-chip__meta">↩</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `
    : '';

  return `
    <div class="establishment-units">
      ${lotsHtml || '<span class="text-muted text-sm">Sem peças consignadas</span>'}
      ${soldHtml}
    </div>
  `;
}

function renderTable() {
  const term = (searchInput?.value || '').trim().toLowerCase();
  const filtered = allEstablishments.filter((est) => {
    if (!term) return true;
    const hay = [
      est.name,
      est.phone,
      ...(est.items || []).flatMap((i) => [i.stockEntryName, i.productName]),
    ].join(' ').toLowerCase();
    return hay.includes(term);
  });

  if (countEl) {
    const totalPieces = filtered.reduce((s, e) => s + (Number(e.totalPieces) || 0), 0);
    countEl.textContent = `${filtered.length} estabelecimento(s) · ${totalPieces} peça(s) consignada(s)`;
  }

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table__empty">Nenhum estabelecimento cadastrado.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((est) => {
    const phone = est.phone
      ? `<a href="tel:${escapeHtml(est.phone.replace(/\D/g, ''))}">${escapeHtml(est.phone)}</a>`
      : '<span class="text-muted">—</span>';
    const pieces = Number(est.totalPieces) || 0;

    return `
      <tr>
        <td><strong>${escapeHtml(est.name)}</strong></td>
        <td>${phone}</td>
        <td><span class="badge badge--info">${pieces} peça(s)</span></td>
        <td class="establishment-units-cell">${renderEstablishmentUnitsHtml(est)}</td>
        <td class="table__actions establishment-actions-cell">
          <button type="button" class="btn btn--ghost btn--sm" data-edit="${est.id}">Editar</button>
          <button type="button" class="btn btn--danger btn--sm" data-delete="${est.id}">Excluir</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadData() {
  const [estResult, stockResult, salesResult] = await Promise.all([
    listEstablishments({ fresh: true }),
    listStockEntries(),
    listSales(),
  ]);

  if (stockResult.success) {
    allStockEntries = stockResult.data;
  }
  allSales = salesResult.success ? salesResult.data : [];

  if (!estResult.success) {
    showToast(estResult.error, 'error');
    tbody.innerHTML = `<tr><td colspan="5" class="table__empty">${escapeHtml(estResult.error)}</td></tr>`;
    return;
  }

  allEstablishments = estResult.data;
  renderTable();
}

function openFormModal(est = null) {
  editingId = est?.id || null;
  qs('#establishment-modal-title').textContent = est ? 'Editar estabelecimento' : 'Novo estabelecimento';
  qs('#field-name').value = est?.name || '';
  qs('#field-phone').value = est?.phone || '';
  resetStockLines(est?.items || []);

  const stockCount = getEligibleStockEntries().length;
  if (!stockCount && !est?.items?.length) {
    showFormErrors(['Não há estoque cadastrado. Cadastre um lote na página Estoque.']);
  } else {
    showFormErrors([]);
  }

  openModal('establishment-modal');
}

async function handleFormSubmit(event) {
  event.preventDefault();
  showFormErrors([]);

  const payload = {
    name: qs('#field-name').value.trim(),
    phone: qs('#field-phone').value.trim(),
    items: collectStockLinesFromForm(),
  };

  if (!payload.items.length) {
    showFormErrors(['Informe ao menos uma peça com quantidade maior que zero em um lote.']);
    return;
  }

  const seenStockIds = new Set();
  for (const item of payload.items) {
    if (seenStockIds.has(item.stockEntryId)) {
      showFormErrors(['Cada lote só pode aparecer uma vez. Use o mesmo bloco para vários tamanhos do mesmo lote.']);
      return;
    }
    seenStockIds.add(item.stockEntryId);
  }

  const btn = qs('#btn-establishment-save');
  setLoading(btn, true);

  const result = editingId
    ? await updateEstablishment(editingId, payload)
    : await createEstablishment(payload);

  setLoading(btn, false);

  if (!result.success) {
    showFormErrors([result.error]);
    return;
  }

  showToast(editingId ? 'Estabelecimento atualizado.' : 'Estabelecimento cadastrado · estoque reservado.', 'success');
  closeModal('establishment-modal');
  editingId = null;
  await loadData();
}

function openDeleteModal(id) {
  const est = allEstablishments.find((e) => e.id === id);
  if (!est) return;
  deletingId = id;
  qs('#delete-establishment-name').textContent = est.name;
  qs('#delete-establishment-pieces').textContent = `${Number(est.totalPieces) || 0} peça(s) voltarão ao estoque disponível.`;
  openModal('delete-establishment-modal');
}

async function confirmDelete() {
  if (!deletingId) return;
  const btn = qs('#btn-delete-establishment-confirm');
  setLoading(btn, true);
  const result = await deleteEstablishment(deletingId);
  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  showToast('Estabelecimento removido · reservas liberadas.', 'success');
  deletingId = null;
  closeModal('delete-establishment-modal');
  await loadData();
}

function getSuggestedPriceForPiece(stockEntryId) {
  const entry = allStockEntries.find((e) => e.id === stockEntryId);
  return Number(entry?.suggestedSalePrice) || 0;
}

function openSellModalForUnit(establishmentId, stockEntryId, size) {
  const est = allEstablishments.find((e) => e.id === establishmentId);
  if (!est) return;

  const items = normalizeEstablishmentItems(est.items || []);
  const item = items.find((i) => i.stockEntryId === stockEntryId);
  const line = item?.sizes.find((s) => s.size === size);
  if (!item || !line || line.quantity <= 0) {
    showToast('Esta peça não está mais consignada na loja.', 'warning');
    return;
  }

  sellingId = establishmentId;
  sellingPiece = {
    stockEntryId,
    size,
    stockEntryName: item.stockEntryName,
    productName: item.productName,
  };

  const lotName = item.stockEntryName || item.productName || 'Estoque';
  qs('#sell-establishment-label').textContent = `Estabelecimento: ${est.name}`;
  qs('#sell-piece-display').textContent = `${lotName} — tamanho ${size}`;
  qs('#field-sell-price').value = getSuggestedPriceForPiece(stockEntryId) || '';
  showSellFormErrors([]);
  openModal('sell-establishment-modal');
  qs('#field-sell-price')?.focus();
}

async function handleRevertSale(establishmentId, saleId) {
  const est = allEstablishments.find((e) => e.id === establishmentId);
  const sale = allSales.find((s) => s.id === saleId);
  if (!est || !sale) return;

  const confirmed = window.confirm(
    `Desmarcar a venda ${sale.orderId || ''} (${sale.lines?.[0]?.size || sale.size})?\n\nA peça volta para o consignado deste estabelecimento e a venda é cancelada.`
  );
  if (!confirmed) return;

  const result = await revertEstablishmentPieceSale(establishmentId, saleId);
  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  showToast('Venda desmarcada · peça de volta na loja.', 'success');
  await loadData();
}

async function handleSellSubmit(event) {
  event.preventDefault();
  if (!sellingId || !sellingPiece) return;
  showSellFormErrors([]);

  const unitPrice = Number(qs('#field-sell-price')?.value) || 0;

  if (unitPrice <= 0) {
    showSellFormErrors(['Informe o valor da venda.']);
    return;
  }

  const btn = qs('#btn-sell-confirm');
  setLoading(btn, true);

  const result = await markEstablishmentPieceSold(sellingId, {
    stockEntryId: sellingPiece.stockEntryId,
    size: sellingPiece.size,
    unitPrice,
  });

  setLoading(btn, false);

  if (!result.success) {
    showSellFormErrors([result.error]);
    return;
  }

  showToast(`Venda registrada · pedido ${result.data?.orderId || ''}`, 'success');
  sellingId = null;
  sellingPiece = null;
  closeModal('sell-establishment-modal');
  await loadData();
}

function bindEvents() {
  qs('#btn-new-establishment')?.addEventListener('click', () => openFormModal());
  qs('#btn-add-stock-line')?.addEventListener('click', () => addStockLine());
  form?.addEventListener('submit', handleFormSubmit);
  searchInput?.addEventListener('input', renderTable);

  tbody?.addEventListener('click', (event) => {
    const sellUnitBtn = event.target.closest('[data-sell-unit]');
    const revertBtn = event.target.closest('[data-revert-sale]');
    const editBtn = event.target.closest('[data-edit]');
    const deleteBtn = event.target.closest('[data-delete]');

    if (sellUnitBtn) {
      openSellModalForUnit(
        sellUnitBtn.dataset.estId,
        sellUnitBtn.dataset.stockEntryId,
        sellUnitBtn.dataset.size
      );
    }
    if (revertBtn) {
      handleRevertSale(revertBtn.dataset.estId, revertBtn.dataset.saleId);
    }
    if (editBtn) {
      const est = allEstablishments.find((e) => e.id === editBtn.dataset.edit);
      if (est) openFormModal(est);
    }
    if (deleteBtn) {
      openDeleteModal(deleteBtn.dataset.delete);
    }
  });

  qs('#sell-establishment-form')?.addEventListener('submit', handleSellSubmit);
  qs('#btn-delete-establishment-confirm')?.addEventListener('click', confirmDelete);
  setupModalClose('establishment-modal');
  setupModalClose('sell-establishment-modal');
  setupModalClose('delete-establishment-modal');
}

async function init() {
  await waitForAuth();
  bindEvents();
  await loadData();
}

init();
