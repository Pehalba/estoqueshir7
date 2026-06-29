import {
  listInfluencers,
  createInfluencer,
  updateInfluencer,
  deleteInfluencer,
  formatCommissionRule,
  COMMISSION_TYPES,
  DEFAULT_COMMISSION_TYPE,
  DEFAULT_COMMISSION_VALUE,
} from '../services/influencerService.js';
import {
  listInfluencerPayouts,
  influencerPayoutsToMap,
  getInfluencerPayoutRecord,
  resolveInfluencerPayoutStatus,
  registerInfluencerPayment,
  clearInfluencerPayout,
} from '../services/influencerPaymentService.js';
import { listSales } from '../services/salesService.js';
import { waitForAuth, getCurrentUser } from '../services/authService.js';
import { calculateInfluencerDue, getDefaultInfluencerPeriodFilters } from '../utils/influencerStats.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import {
  qs,
  showToast,
  openModal,
  closeModal,
  setupModalClose,
  setLoading,
} from '../utils/domHelpers.js';

const COMMISSION_VALUE_LABELS = {
  percent_lucro: '% do lucro',
  percent_faturamento: '% do faturamento',
  fixo_peca: 'Valor (R$) por peça',
  fixo_venda: 'Valor (R$) por venda',
  valor_fixo: 'Valor fixo do período (R$)',
  personalizado: '',
};

const COMMISSION_HINTS = {
  percent_lucro: 'Ex.: 10 = 10% do lucro líquido em vendas que usaram o cupom/código do influencer.',
  percent_faturamento: 'Ex.: 5 = 5% do valor da venda com o cupom do influencer.',
  fixo_peca: 'Ex.: 15 = R$ 15,00 por peça vendida com o cupom.',
  fixo_venda: 'Ex.: 20 = R$ 20,00 por venda com o cupom.',
  valor_fixo: 'Valor fixo acordado para o período (ex.: mensal), independente de vendas.',
  personalizado: 'Sem cálculo automático — registre os pagamentos manualmente.',
};

let allInfluencers = [];
let allSales = [];
let payoutMap = new Map();
let currentFilters = {};
let editingId = null;
let deletingId = null;
let payoutModalContext = null;
let payoutBusy = false;

const tbody = qs('#influencers-tbody');
const searchInput = qs('#search-input');
const form = qs('#influencer-form');
const formErrors = qs('#form-errors');
const commissionTypeField = qs('#field-commissionType');
const commissionValueGroup = qs('#commission-value-group');
const couponCodesGroup = qs('#coupon-codes-group');

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

function getFilters() {
  const period = qs('#influencers-period')?.value || 'month';
  if (period === 'custom') {
    return {
      dateFrom: qs('#influencers-date-from')?.value || '',
      dateTo: qs('#influencers-date-to')?.value || '',
    };
  }
  return getDefaultInfluencerPeriodFilters(period);
}

function toggleCustomDates() {
  const custom = qs('#influencers-period')?.value === 'custom';
  qs('#influencers-date-from-group').hidden = !custom;
  qs('#influencers-date-to-group').hidden = !custom;
}

function getPayoutState(influencer, dueInfo) {
  const record = getInfluencerPayoutRecord(
    payoutMap,
    influencer.id,
    currentFilters.dateFrom,
    currentFilters.dateTo
  );
  return resolveInfluencerPayoutStatus(record, dueInfo.due, dueInfo.manualOnly);
}

function payoutStatusLabel(state) {
  if (state.manualOnly) {
    return state.paidAmount > 0 ? `Pago · ${formatCurrency(state.paidAmount)}` : 'Manual';
  }
  if (state.status === 'paid') return 'Quitado';
  if (state.status === 'partial') {
    return `Parcial · ${formatCurrency(state.paidAmount)} de ${formatCurrency(state.dueAmount)}`;
  }
  if (state.dueAmount <= 0.02) return 'Sem valor';
  return 'Pendente';
}

function formatPayoutDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.seconds
    ? new Date(timestamp.seconds * 1000)
    : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR');
}

function toggleCommissionFields() {
  const type = commissionTypeField?.value || DEFAULT_COMMISSION_TYPE;
  const isPersonalizado = type === 'personalizado';
  const isValorFixo = type === 'valor_fixo';
  const needsCoupon = !isPersonalizado && !isValorFixo;

  if (commissionValueGroup) {
    commissionValueGroup.hidden = isPersonalizado;
  }
  if (couponCodesGroup) {
    couponCodesGroup.hidden = !needsCoupon;
  }

  const hint = qs('#commission-value-hint');
  if (hint) hint.textContent = COMMISSION_HINTS[type] || '';

  const valueLabel = qs('#commission-value-label');
  if (valueLabel) {
    valueLabel.textContent = COMMISSION_VALUE_LABELS[type] || 'Valor';
  }
}

function commissionTypeOptionsHtml(selected = DEFAULT_COMMISSION_TYPE) {
  return Object.entries(COMMISSION_TYPES).map(([value, label]) => {
    const sel = value === selected ? ' selected' : '';
    return `<option value="${value}"${sel}>${label}</option>`;
  }).join('');
}

function filterInfluencers() {
  const term = (searchInput?.value || '').trim().toLowerCase();
  const activeOnly = qs('#filter-active')?.value === 'active';

  return allInfluencers.filter((inf) => {
    if (activeOnly && inf.active === false) return false;
    if (!term) return true;
    const hay = [
      inf.name,
      inf.instagram,
      inf.phone,
      inf.email,
      inf.couponCodes,
      inf.notes,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(term);
  });
}

function renderSummary(filtered) {
  let dueTotal = 0;
  let paidTotal = 0;
  let pendingTotal = 0;

  for (const inf of filtered) {
    const dueInfo = calculateInfluencerDue(inf, allSales, currentFilters);
    const state = getPayoutState(inf, dueInfo);
    dueTotal += dueInfo.manualOnly ? 0 : dueInfo.due;
    paidTotal += state.paidAmount;
    pendingTotal += state.manualOnly ? 0 : state.remaining;
  }

  qs('#summary-due').textContent = formatCurrency(dueTotal);
  qs('#summary-paid').textContent = formatCurrency(paidTotal);
  qs('#summary-pending').textContent = formatCurrency(pendingTotal);

  const periodLabel = currentFilters.dateFrom && currentFilters.dateTo
    ? `${currentFilters.dateFrom} a ${currentFilters.dateTo}`
    : 'todo o histórico';
  qs('#influencers-period-label').textContent = periodLabel;
}

function renderTable() {
  const filtered = filterInfluencers();
  renderSummary(filtered);

  qs('#influencers-count').textContent =
    `${filtered.length} influencer(s) · ${allInfluencers.length} cadastrado(s)`;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="table__empty">Nenhum influencer cadastrado.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((inf) => {
    const dueInfo = calculateInfluencerDue(inf, allSales, currentFilters);
    const state = getPayoutState(inf, dueInfo);
    const statusClass = state.status === 'paid'
      ? 'paid'
      : state.status === 'partial'
        ? 'partial'
        : 'pending';
    const rowClass = state.status === 'paid'
      ? 'profits-row--paid'
      : state.status === 'partial'
        ? 'profits-row--partial'
        : '';
    const instagram = inf.instagram ? `@${escapeHtml(inf.instagram)}` : '';
    const codes = String(inf.couponCodes || '').trim();
    const salesHint = dueInfo.manualOnly
      ? 'Pagamento manual'
      : dueInfo.salesCount > 0
        ? `${dueInfo.salesCount} venda(s) · ${dueInfo.pieces} peça(s)`
        : codes
          ? 'Nenhuma venda com cupom no período'
          : 'Sem cupom vinculado';

    return `
    <tr class="${rowClass}">
      <td>
        <strong>${escapeHtml(inf.name)}</strong>
        ${instagram ? `<span class="influencers-row__handle">${instagram}</span>` : ''}
        ${codes ? `<span class="influencers-row__codes">Cupons: ${escapeHtml(codes)}</span>` : ''}
        ${inf.active === false ? '<br><span class="badge badge--neutral">Inativo</span>' : ''}
      </td>
      <td>${formatCommissionRule(inf)}</td>
      <td class="text-sm text-muted">${salesHint}</td>
      <td>${dueInfo.manualOnly ? '—' : `<strong>${formatCurrency(dueInfo.due)}</strong>`}</td>
      <td>${formatCurrency(state.paidAmount)}</td>
      <td>${dueInfo.manualOnly ? '—' : formatCurrency(state.remaining)}</td>
      <td><span class="profits-status profits-status--${statusClass}">${payoutStatusLabel(state)}</span></td>
      <td class="table__actions profits-row__actions">
        <button type="button" class="btn btn--sm btn--secondary" data-payout-action="open" data-id="${inf.id}" ${payoutBusy ? 'disabled' : ''}>Pagar</button>
        <button type="button" class="btn btn--ghost btn--sm" data-edit="${inf.id}">Editar</button>
        ${state.paidAmount > 0 ? `<button type="button" class="btn btn--ghost btn--sm" data-payout-action="clear" data-id="${inf.id}" ${payoutBusy ? 'disabled' : ''}>Zerar</button>` : ''}
        <button type="button" class="btn btn--danger btn--sm" data-delete="${inf.id}">Excluir</button>
      </td>
    </tr>
  `;
  }).join('');
}

function refresh() {
  currentFilters = getFilters();
  renderTable();
}

async function loadData() {
  const [infResult, salesResult, payoutsResult] = await Promise.all([
    listInfluencers({ fresh: true }),
    listSales(),
    listInfluencerPayouts(),
  ]);

  if (!infResult.success) {
    showToast(infResult.error, 'error');
    tbody.innerHTML = `<tr><td colspan="8" class="table__empty">${escapeHtml(infResult.error)}</td></tr>`;
    return;
  }

  allInfluencers = infResult.data;
  allSales = salesResult.success ? salesResult.data : [];
  payoutMap = payoutsResult.success ? influencerPayoutsToMap(payoutsResult.data) : new Map();
  refresh();
}

function openFormModal(influencer = null) {
  editingId = influencer?.id || null;
  qs('#influencer-modal-title').textContent = influencer ? 'Editar influencer' : 'Novo influencer';
  qs('#field-name').value = influencer?.name || '';
  qs('#field-instagram').value = influencer?.instagram || '';
  qs('#field-phone').value = influencer?.phone || '';
  qs('#field-email').value = influencer?.email || '';
  commissionTypeField.innerHTML = commissionTypeOptionsHtml(influencer?.commissionType || DEFAULT_COMMISSION_TYPE);
  qs('#field-commissionValue').value = influencer?.commissionValue ?? DEFAULT_COMMISSION_VALUE;
  qs('#field-couponCodes').value = influencer?.couponCodes || '';
  qs('#field-notes').value = influencer?.notes || '';
  qs('#field-active').checked = influencer?.active !== false;
  toggleCommissionFields();
  showFormErrors([]);
  openModal('influencer-modal');
}

async function handleFormSubmit(event) {
  event.preventDefault();
  showFormErrors([]);

  const payload = {
    name: qs('#field-name').value,
    instagram: qs('#field-instagram').value,
    phone: qs('#field-phone').value,
    email: qs('#field-email').value,
    commissionType: commissionTypeField.value,
    commissionValue: qs('#field-commissionValue').value,
    couponCodes: qs('#field-couponCodes').value,
    notes: qs('#field-notes').value,
    active: qs('#field-active').checked,
  };

  const btn = qs('#btn-save-influencer');
  setLoading(btn, true);

  const result = editingId
    ? await updateInfluencer(editingId, payload)
    : await createInfluencer(payload);

  setLoading(btn, false);

  if (!result.success) {
    showFormErrors([result.error]);
    return;
  }

  showToast(editingId ? 'Influencer atualizado.' : 'Influencer cadastrado!', 'success');
  editingId = null;
  closeModal('influencer-modal');
  await loadData();
}

function openPayoutModal(influencerId) {
  const influencer = allInfluencers.find((i) => i.id === influencerId);
  if (!influencer) return;

  const dueInfo = calculateInfluencerDue(influencer, allSales, currentFilters);
  const state = getPayoutState(influencer, dueInfo);
  payoutModalContext = { influencer, dueInfo, state };

  qs('#payout-modal-title').textContent = `Pagamento — ${influencer.name}`;
  qs('#payout-modal-intro').textContent = dueInfo.manualOnly
    ? 'Registre quanto foi pago a este influencer no período.'
    : 'Registre quanto você pagou agora. Pode ser parcial — o restante fica pendente.';

  qs('#payout-due').textContent = dueInfo.manualOnly ? '—' : formatCurrency(state.dueAmount);
  qs('#payout-paid').textContent = formatCurrency(state.paidAmount);
  qs('#payout-remaining').textContent = dueInfo.manualOnly
    ? '—'
    : formatCurrency(state.remaining);

  const amountInput = qs('#payout-amount');
  amountInput.value = !dueInfo.manualOnly && state.remaining > 0
    ? state.remaining.toFixed(2)
    : '';
  amountInput.removeAttribute('max');
  if (!dueInfo.manualOnly && state.remaining > 0) {
    amountInput.max = state.remaining.toFixed(2);
  }
  qs('#payout-note').value = '';

  const historyWrap = qs('#payout-history');
  const historyList = qs('#payout-history-list');
  if (state.payments.length) {
    historyWrap.hidden = false;
    historyList.innerHTML = [...state.payments].reverse().map((payment) => {
      const date = formatPayoutDate(payment.paidAt);
      const note = payment.note ? ` · ${escapeHtml(payment.note)}` : '';
      return `<li>${date ? `${date} · ` : ''}${formatCurrency(payment.amount)}${note}</li>`;
    }).join('');
  } else {
    historyWrap.hidden = true;
    historyList.innerHTML = '';
  }

  openModal('payout-modal');
  amountInput.focus();
}

async function reloadPayoutsAndRefresh() {
  const payoutsRes = await listInfluencerPayouts({ fresh: true });
  if (payoutsRes.success) {
    payoutMap = influencerPayoutsToMap(payoutsRes.data);
  }
  refresh();
}

async function handlePayoutAction(button) {
  if (payoutBusy) return;

  const action = button.dataset.payoutAction;
  const influencerId = button.dataset.id;
  if (!influencerId || !action) return;

  const influencer = allInfluencers.find((i) => i.id === influencerId);
  if (!influencer) return;

  if (action === 'open') {
    openPayoutModal(influencerId);
    return;
  }

  if (action === 'clear') {
    const confirmed = window.confirm(
      `Zerar todos os pagamentos de ${influencer.name} neste período?`
    );
    if (!confirmed) return;

    payoutBusy = true;
    button.disabled = true;
    const result = await clearInfluencerPayout(
      influencerId,
      currentFilters.dateFrom || '',
      currentFilters.dateTo || ''
    );
    payoutBusy = false;

    if (!result.success) {
      showToast(result.error || 'Não foi possível zerar os pagamentos.', 'error');
      refresh();
      return;
    }

    showToast(`Pagamentos de ${influencer.name} zerados.`, 'success');
    await reloadPayoutsAndRefresh();
  }
}

async function submitPayoutForm(event) {
  event.preventDefault();
  if (payoutBusy || !payoutModalContext) return;

  const amount = Number(qs('#payout-amount')?.value) || 0;
  const note = qs('#payout-note')?.value || '';
  const { influencer, dueInfo, state } = payoutModalContext;

  if (amount <= 0) {
    showToast('Informe um valor maior que zero.', 'error');
    return;
  }

  if (!dueInfo.manualOnly && amount > state.remaining + 0.02) {
    showToast(`O valor não pode passar de ${formatCurrency(state.remaining)}.`, 'error');
    return;
  }

  payoutBusy = true;
  qs('#btn-payout-submit').disabled = true;

  const user = getCurrentUser();
  const result = await registerInfluencerPayment({
    influencerId: influencer.id,
    influencerName: influencer.name,
    dateFrom: currentFilters.dateFrom || '',
    dateTo: currentFilters.dateTo || '',
    dueAmount: dueInfo.due,
    paymentAmount: amount,
    markedBy: user?.email || '',
    note,
    manualOnly: dueInfo.manualOnly,
  });

  payoutBusy = false;
  qs('#btn-payout-submit').disabled = false;

  if (!result.success) {
    showToast(result.error || 'Não foi possível registrar o pagamento.', 'error');
    return;
  }

  closeModal('payout-modal');
  payoutModalContext = null;

  if (result.status === 'paid' && !dueInfo.manualOnly) {
    showToast(`${influencer.name} quitado (${formatCurrency(result.paidAmount)}).`, 'success');
  } else {
    showToast(
      `Pagamento de ${formatCurrency(amount)} registrado.${!dueInfo.manualOnly ? ` Restante: ${formatCurrency(result.remaining)}.` : ''}`,
      'success'
    );
  }

  await reloadPayoutsAndRefresh();
}

function openDeleteModal(id) {
  const influencer = allInfluencers.find((i) => i.id === id);
  if (!influencer) return;
  deletingId = id;
  qs('#delete-influencer-name').textContent = influencer.name;
  openModal('delete-influencer-modal');
}

async function confirmDelete() {
  if (!deletingId) return;
  const btn = qs('#btn-delete-influencer-confirm');
  setLoading(btn, true);
  const result = await deleteInfluencer(deletingId);
  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  showToast('Influencer removido.', 'success');
  deletingId = null;
  closeModal('delete-influencer-modal');
  await loadData();
}

function bindEvents() {
  qs('#btn-new-influencer')?.addEventListener('click', () => openFormModal());
  form?.addEventListener('submit', handleFormSubmit);
  searchInput?.addEventListener('input', renderTable);
  qs('#filter-active')?.addEventListener('change', renderTable);

  qs('#influencers-period')?.addEventListener('change', () => {
    toggleCustomDates();
    if (qs('#influencers-period').value !== 'custom') refresh();
  });
  ['#influencers-date-from', '#influencers-date-to'].forEach((sel) => {
    qs(sel)?.addEventListener('change', refresh);
  });
  qs('#btn-influencers-refresh')?.addEventListener('click', refresh);

  commissionTypeField?.addEventListener('change', toggleCommissionFields);

  tbody?.addEventListener('click', (event) => {
    const payoutBtn = event.target.closest('[data-payout-action]');
    const editBtn = event.target.closest('[data-edit]');
    const deleteBtn = event.target.closest('[data-delete]');
    if (payoutBtn) handlePayoutAction(payoutBtn);
    if (editBtn) {
      const inf = allInfluencers.find((i) => i.id === editBtn.dataset.edit);
      if (inf) openFormModal(inf);
    }
    if (deleteBtn) openDeleteModal(deleteBtn.dataset.delete);
  });

  qs('#payout-form')?.addEventListener('submit', submitPayoutForm);
  qs('#btn-payout-fill-remaining')?.addEventListener('click', () => {
    if (!payoutModalContext || payoutModalContext.dueInfo.manualOnly) return;
    const remaining = payoutModalContext.state.remaining;
    if (remaining > 0) {
      qs('#payout-amount').value = remaining.toFixed(2);
    }
  });

  qs('#btn-delete-influencer-confirm')?.addEventListener('click', confirmDelete);
  setupModalClose('influencer-modal');
  setupModalClose('payout-modal');
  setupModalClose('delete-influencer-modal');
}

async function init() {
  await waitForAuth();
  toggleCustomDates();
  const defaults = getDefaultInfluencerPeriodFilters('month');
  qs('#influencers-date-from').value = defaults.dateFrom;
  qs('#influencers-date-to').value = defaults.dateTo;
  bindEvents();
  await loadData();
}

init();
