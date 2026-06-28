import {
  listEstablishments,
  createEstablishment,
  updateEstablishment,
  deleteEstablishment,
  summarizeEstablishmentItems,
  listConsignmentPieces,
  markEstablishmentPieceSold,
} from '../services/establishmentService.js';
import { listStockEntries } from '../services/stockEntryService.js';
import { waitForAuth } from '../services/authService.js';
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
let editingId = null;
let deletingId = null;
let sellingId = null;
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

function getEligibleStockEntries(extraIds = []) {
  const extraSet = new Set((extraIds || []).filter(Boolean));
  return allStockEntries.filter((e) => {
    if (e.status === 'inativo') return false;
    if (e.stockOrigin === 'investidor') return true;
    return extraSet.has(e.id);
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
    return '<option value="" disabled>Nenhum estoque de investidor disponível</option>';
  }

  return entries
    .filter((entry) => !excludeSet.has(entry.id))
    .map((entry) => {
      const selected = entry.id === selectedId ? ' selected' : '';
      const tag = entry.status === 'esgotado' ? ' · esgotado' : '';
      return `<option value="${entry.id}"${selected}>${escapeHtml(entry.name)} — ${escapeHtml(entry.productName)}${tag}</option>`;
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
    const summary = summarizeEstablishmentItems(est.items || []);
    const phone = est.phone
      ? `<a href="tel:${escapeHtml(est.phone.replace(/\D/g, ''))}">${escapeHtml(est.phone)}</a>`
      : '<span class="text-muted">—</span>';
    const pieces = Number(est.totalPieces) || 0;
    const soldCount = Number(est.soldCount) || 0;
    const sellBtn = pieces > 0
      ? `<button type="button" class="btn btn--primary btn--sm" data-sell="${est.id}">Marcar vendida</button>`
      : '';

    return `
      <tr>
        <td><strong>${escapeHtml(est.name)}</strong>${soldCount ? `<br><span class="text-sm text-muted">${soldCount} vendida(s) da loja</span>` : ''}</td>
        <td>${phone}</td>
        <td><span class="badge badge--info">${pieces} peça(s)</span></td>
        <td class="establishment-summary">${summary.map((s) => `<span class="text-sm">${escapeHtml(s)}</span>`).join('<br>') || '—'}</td>
        <td class="table__actions">
          ${sellBtn}
          <button type="button" class="btn btn--ghost btn--sm" data-edit="${est.id}">Editar</button>
          <button type="button" class="btn btn--danger btn--sm" data-delete="${est.id}">Excluir</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadData() {
  const [estResult, stockResult] = await Promise.all([
    listEstablishments({ fresh: true }),
    listStockEntries(),
  ]);

  if (stockResult.success) {
    allStockEntries = stockResult.data;
  }

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

  const investorCount = getEligibleStockEntries().length;
  if (!investorCount && !est?.items?.length) {
    showFormErrors(['Não há estoque de investidor cadastrado. Cadastre um lote com origem "Investidor" no Estoque.']);
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
    showFormErrors(['Informe ao menos uma peça com quantidade maior que zero em um lote de investidor.']);
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

function openSellModal(id) {
  const est = allEstablishments.find((e) => e.id === id);
  if (!est) return;

  const pieces = listConsignmentPieces(est.items || []);
  if (!pieces.length) {
    showToast('Não há peças consignadas para marcar como vendida.', 'warning');
    return;
  }

  sellingId = id;
  qs('#sell-establishment-label').textContent = `Estabelecimento: ${est.name}`;

  const select = qs('#field-sell-piece');
  select.innerHTML = [
    '<option value="">— Selecione —</option>',
    ...pieces.map((p) => `<option value="${escapeHtml(p.key)}">${escapeHtml(p.label)}</option>`),
  ].join('');

  const first = pieces[0];
  qs('#field-sell-price').value = getSuggestedPriceForPiece(first.stockEntryId) || '';
  showSellFormErrors([]);

  select.onchange = () => {
    const key = select.value;
    const piece = pieces.find((p) => p.key === key);
    if (piece) {
      const price = getSuggestedPriceForPiece(piece.stockEntryId);
      if (price > 0) qs('#field-sell-price').value = price;
    }
  };

  openModal('sell-establishment-modal');
}

async function handleSellSubmit(event) {
  event.preventDefault();
  if (!sellingId) return;
  showSellFormErrors([]);

  const est = allEstablishments.find((e) => e.id === sellingId);
  if (!est) return;

  const select = qs('#field-sell-piece');
  const key = select?.value || '';
  const piece = listConsignmentPieces(est.items || []).find((p) => p.key === key);
  const unitPrice = Number(qs('#field-sell-price')?.value) || 0;

  if (!piece) {
    showSellFormErrors(['Selecione a peça vendida.']);
    return;
  }
  if (unitPrice <= 0) {
    showSellFormErrors(['Informe o valor da venda.']);
    return;
  }

  const btn = qs('#btn-sell-confirm');
  setLoading(btn, true);

  const result = await markEstablishmentPieceSold(sellingId, {
    stockEntryId: piece.stockEntryId,
    size: piece.size,
    unitPrice,
  });

  setLoading(btn, false);

  if (!result.success) {
    showSellFormErrors([result.error]);
    return;
  }

  showToast(`Venda registrada · pedido ${result.data?.orderId || ''}`, 'success');
  sellingId = null;
  closeModal('sell-establishment-modal');
  await loadData();
}

function bindEvents() {
  qs('#btn-new-establishment')?.addEventListener('click', () => openFormModal());
  qs('#btn-add-stock-line')?.addEventListener('click', () => addStockLine());
  form?.addEventListener('submit', handleFormSubmit);
  searchInput?.addEventListener('input', renderTable);

  tbody?.addEventListener('click', (event) => {
    const sellBtn = event.target.closest('[data-sell]');
    const editBtn = event.target.closest('[data-edit]');
    const deleteBtn = event.target.closest('[data-delete]');
    if (sellBtn) {
      openSellModal(sellBtn.dataset.sell);
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
