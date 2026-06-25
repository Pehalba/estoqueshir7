import { waitForAuth, getCurrentUser } from '../services/authService.js';
import { listSales } from '../services/salesService.js';
import { listStockEntries } from '../services/stockEntryService.js';
import { listInvestors } from '../services/investorService.js';
import {
  listProfitPayouts,
  payoutsToMap,
  getPayoutRecord,
  resolvePayoutStatus,
  registerProfitPayment,
  clearProfitPayout,
} from '../services/profitPayoutService.js';
import {
  calculatePartnerDistribution,
  getDefaultPeriodFilters,
  SHIR7_PARTNERS,
} from '../utils/partnerProfits.js';
import { applyPlatformSettingsToSales } from '../utils/analytics.js';
import { getGlobalSettings } from '../services/settingsService.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { qs, qsa, showToast, openModal, closeModal, setupModalClose } from '../utils/domHelpers.js';

const TAB_PANELS = {
  investidores: '#tab-investidores',
  'investidor-shir7': '#tab-investidor-shir7',
  proprio: '#tab-proprio',
  personalizacoes: '#tab-personalizacoes',
  'total-shir7': '#tab-total-shir7',
};

let allSales = [];
let allInvestors = [];
let allStockEntries = [];
let globalSettings = {};
let payoutMap = new Map();
let currentFilters = {};
let payoutBusy = false;
let payoutModalContext = null;

function getInvestorPayoutState(investorId, filters, dueAmount) {
  const record = getPayoutRecord(payoutMap, 'investor', investorId, filters.dateFrom, filters.dateTo);
  return resolvePayoutStatus(record, dueAmount);
}

function switchTab(tab) {
  qsa('.profits-tabs__btn').forEach((btn) => {
    btn.classList.toggle('profits-tabs__btn--active', btn.dataset.tab === tab);
  });
  Object.entries(TAB_PANELS).forEach(([key, selector]) => {
    const panel = qs(selector);
    if (panel) panel.hidden = key !== tab;
  });
}

function getFilters() {
  const period = qs('#profits-period')?.value || 'month';
  if (period === 'custom') {
    return {
      dateFrom: qs('#profits-date-from')?.value || '',
      dateTo: qs('#profits-date-to')?.value || '',
    };
  }
  return getDefaultPeriodFilters(period);
}

function toggleCustomDates() {
  const custom = qs('#profits-period')?.value === 'custom';
  qs('#profits-date-from-group').hidden = !custom;
  qs('#profits-date-to-group').hidden = !custom;
}

function formatPayoutDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.seconds
    ? new Date(timestamp.seconds * 1000)
    : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR');
}

function formatRepasseRuleHint(row) {
  if (row.repasseRule === 'capital_mais_lucro' && row.repassePercent != null) {
    return `capital + ${row.repassePercent}% lucro`;
  }
  if (row.repasseRule === 'percent_lucro' && row.repassePercent != null) {
    return `${row.repassePercent}% do lucro`;
  }
  return '';
}

function payoutStatusLabel(state) {
  if (state.status === 'paid') return 'Quitado';
  if (state.status === 'partial') {
    return `Parcial · ${formatCurrency(state.paidAmount)} de ${formatCurrency(state.dueAmount)}`;
  }
  return 'Pendente';
}

function renderPartnersForShare(containerId, amount, label) {
  const el = qs(containerId);
  if (!el) return;

  el.innerHTML = SHIR7_PARTNERS.map((partner) => `
    <div class="profits-partner">
      <p class="profits-partner__name">${partner.name}</p>
      <p class="profits-partner__share">50% · ${label}</p>
      <p class="profits-partner__value">${formatCurrency(amount * partner.share)}</p>
    </div>
  `).join('');
}

function renderInvestidoresTab(data, shirts, filters) {
  qs('#tab-inv-total').textContent = formatCurrency(shirts.investorRepasseTotal);
  qs('#tab-inv-hint').textContent =
    `${shirts.investorSalesCount} venda(s) · capital + 40% do lucro em camisas`;

  const breakdown = qs('#tab-inv-breakdown');
  if (breakdown) {
    breakdown.innerHTML = `
      <div><dt>Capital devolvido</dt><dd>${formatCurrency(shirts.investorCapitalTotal || 0)}</dd></div>
      <div><dt>Parte do lucro</dt><dd>${formatCurrency(shirts.investorProfitShareTotal || 0)}</dd></div>
    `;
  }

  let paidTotal = 0;
  let pendingTotal = 0;
  for (const row of data.byInvestor) {
    const state = getInvestorPayoutState(row.investorId, filters, row.repasse);
    paidTotal += state.paidAmount;
    pendingTotal += state.remaining;
  }

  const statusEl = qs('#tab-inv-payment-status');
  if (statusEl) {
    if (!data.byInvestor.length) {
      statusEl.textContent = '';
    } else if (pendingTotal <= 0.02) {
      statusEl.textContent = `Tudo quitado (${formatCurrency(paidTotal)}).`;
    } else {
      statusEl.textContent =
        `Pendente: ${formatCurrency(pendingTotal)} · Pago: ${formatCurrency(paidTotal)}`;
    }
  }

  const tbody = qs('#tbody-investidores');
  if (!data.byInvestor.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="table__empty">Nenhuma venda de estoque investidor no período.</td></tr>';
    return;
  }

  tbody.innerHTML = data.byInvestor.map((row) => {
    const ruleHint = formatRepasseRuleHint(row);
    const state = getInvestorPayoutState(row.investorId, filters, row.repasse);
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

    return `
    <tr class="${rowClass}">
      <td>
        <strong>${row.investorName}</strong>
        ${ruleHint ? `<span class="profits-row__rule">${ruleHint}</span>` : ''}
      </td>
      <td>${row.sales}</td>
      <td>${row.pieces}</td>
      <td>${formatCurrency(row.capital || 0)}</td>
      <td>${formatCurrency(row.profitShare || 0)}</td>
      <td><strong>${formatCurrency(row.repasse)}</strong></td>
      <td>${formatCurrency(state.paidAmount)}</td>
      <td>${formatCurrency(state.remaining)}</td>
      <td><span class="profits-status profits-status--${statusClass}">${payoutStatusLabel(state)}</span></td>
      <td class="table__actions profits-row__actions">
        ${state.remaining > 0.02 ? `
        <button
          type="button"
          class="btn btn--sm btn--secondary"
          data-payout-action="open"
          data-investor-id="${row.investorId}"
          data-investor-name="${row.investorName.replace(/"/g, '&quot;')}"
          data-amount="${row.repasse}"
          ${payoutBusy ? 'disabled' : ''}
        >Pagar</button>` : ''}
        ${state.paidAmount > 0 ? `
        <button
          type="button"
          class="btn btn--sm btn--ghost"
          data-payout-action="clear"
          data-investor-id="${row.investorId}"
          data-investor-name="${row.investorName.replace(/"/g, '&quot;')}"
          ${payoutBusy ? 'disabled' : ''}
        >Zerar</button>` : ''}
      </td>
    </tr>
  `;
  }).join('');
}

function renderInvestidorShir7Tab(data, shirts) {
  qs('#tab-split-inv').textContent = formatCurrency(shirts.investorRepasseTotal);
  qs('#tab-split-inv-hint').textContent = `${shirts.investorSalesCount} venda(s) do estoque investidor`;
  qs('#tab-split-shir7').textContent = formatCurrency(shirts.shir7FromInvestor);
  qs('#tab-split-shir7-hint').textContent = 'Restante do lucro em camisas fica com a SHIR7';

  const tbody = qs('#tbody-investidor-shir7');
  if (!data.byInvestor.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table__empty">Nenhuma venda de estoque investidor no período.</td></tr>';
    return;
  }

  tbody.innerHTML = data.byInvestor.map((row) => `
    <tr>
      <td><strong>${row.investorName}</strong></td>
      <td>${row.sales}</td>
      <td>${row.pieces}</td>
      <td>${formatCurrency(row.shirtNetProfit ?? row.netProfit)}</td>
      <td>${formatCurrency(row.repasse)}</td>
      <td>${formatCurrency(row.shir7Share)}</td>
    </tr>
  `).join('');
}

function renderProprioTab(shirts) {
  qs('#tab-proprio-total').textContent = formatCurrency(shirts.shir7FromProprio);
  qs('#tab-proprio-hint').textContent =
    `${shirts.proprioSalesCount} venda(s) · ${shirts.proprioPieces || 0} peça(s)`;

  renderPartnersForShare(
    '#partners-proprio',
    shirts.shir7FromProprio,
    'estoque próprio'
  );
}

function renderPartnersFull(containerId, data) {
  const el = qs(containerId);
  if (!el) return;

  el.innerHTML = data.partners.map((p) => `
    <div class="profits-partner">
      <p class="profits-partner__name">${p.name}</p>
      <p class="profits-partner__share">50% do total SHIR7</p>
      <p class="profits-partner__value">${formatCurrency(p.amount)}</p>
      <p class="profits-partner__breakdown">
        SHIR7 investidor: ${formatCurrency(p.fromInvestor)}<br>
        SHIR7 estoque: ${formatCurrency(p.fromProprio)}<br>
        SHIR7 personalização: ${formatCurrency(p.fromPersonalization)}
      </p>
    </div>
  `).join('');
}

function renderTotalShir7Tab(data, shirts, pers) {
  qs('#tab-total-inv-stock').textContent = formatCurrency(shirts.shir7FromInvestor);
  qs('#tab-total-inv-hint').textContent =
    `${shirts.investorSalesCount} venda(s) do estoque investidor`;

  qs('#tab-total-proprio').textContent = formatCurrency(shirts.shir7FromProprio);
  qs('#tab-total-proprio-hint').textContent =
    `${shirts.proprioSalesCount} venda(s) do estoque próprio`;

  qs('#tab-total-pers').textContent = formatCurrency(pers.netProfit);
  qs('#tab-total-pers-hint').textContent =
    pers.orderCount > 0
      ? `${pers.orderCount} pedido(s) · faturamento ${formatCurrency(pers.revenue)}`
      : 'Sem personalizações no período';

  qs('#tab-total-shir7').textContent = formatCurrency(data.shir7Total);

  renderPartnersFull('#partners-total', data);
}

function renderPersonalizacoesTab(pers) {
  qs('#tab-pers-revenue').textContent = formatCurrency(pers.revenue);
  qs('#tab-pers-revenue-hint').textContent =
    `${pers.orderCount} pedido(s) · ${pers.pieces} peça(s) personalizada(s)`;
  qs('#tab-pers-profit').textContent = formatCurrency(pers.netProfit);
  qs('#tab-pers-profit-hint').textContent =
    pers.cost > 0
      ? `Custo do serviço: ${formatCurrency(pers.cost)}`
      : 'Faturamento − custo do serviço';

  renderPartnersForShare('#partners-pers', pers.netProfit, 'personalizações');

  const breakdown = qs('#pers-breakdown');
  if (breakdown) {
    breakdown.innerHTML = `
      <div><dt>Faturamento total</dt><dd>${formatCurrency(pers.revenue)}</dd></div>
      <div><dt>Custo do serviço</dt><dd>${formatCurrency(pers.cost)}</dd></div>
      <div><dt>Lucro líquido</dt><dd>${formatCurrency(pers.netProfit)}</dd></div>
      <div><dt>Pedidos com personalização</dt><dd>${pers.orderCount}</dd></div>
    `;
  }
}

function renderAll(data, filters) {
  const shirts = data.shirts || {};
  const pers = data.personalization || {};

  renderInvestidoresTab(data, shirts, filters);
  renderInvestidorShir7Tab(data, shirts);
  renderProprioTab(shirts);
  renderPersonalizacoesTab(pers);
  renderTotalShir7Tab(data, shirts, pers);

  const periodLabel = filters.dateFrom && filters.dateTo
    ? `${filters.dateFrom} a ${filters.dateTo}`
    : 'todo o histórico';
  qs('#profits-meta').textContent =
    `${data.saleCount} venda(s) · ${periodLabel === 'todo o histórico' ? periodLabel : `período ${periodLabel}`}`;
}

function refresh() {
  const filters = getFilters();
  currentFilters = filters;
  const data = calculatePartnerDistribution(allSales, allInvestors, filters, globalSettings, allStockEntries);
  renderAll(data, filters);
}

function openPayoutModal(investorId, investorName, dueAmount) {
  const state = getInvestorPayoutState(investorId, currentFilters, dueAmount);
  payoutModalContext = { investorId, investorName, dueAmount, state };

  qs('#payout-modal-title').textContent = `Pagamento — ${investorName}`;
  qs('#payout-modal-intro').textContent =
    'Registre quanto você pagou agora. Pode ser parcial — o restante fica pendente.';
  qs('#payout-due').textContent = formatCurrency(state.dueAmount);
  qs('#payout-paid').textContent = formatCurrency(state.paidAmount);
  qs('#payout-remaining').textContent = formatCurrency(state.remaining);

  const amountInput = qs('#payout-amount');
  amountInput.value = state.remaining > 0 ? state.remaining.toFixed(2) : '';
  amountInput.max = state.remaining > 0 ? state.remaining.toFixed(2) : '';
  qs('#payout-note').value = '';

  const historyWrap = qs('#payout-history');
  const historyList = qs('#payout-history-list');
  if (state.payments.length) {
    historyWrap.hidden = false;
    historyList.innerHTML = [...state.payments].reverse().map((payment) => {
      const date = formatPayoutDate(payment.paidAt);
      const note = payment.note ? ` · ${payment.note}` : '';
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
  const payoutsRes = await listProfitPayouts({ fresh: true });
  if (payoutsRes.success) {
    payoutMap = payoutsToMap(payoutsRes.data);
  }
  refresh();
}

async function handlePayoutAction(button) {
  if (payoutBusy) return;

  const action = button.dataset.payoutAction;
  const investorId = button.dataset.investorId;
  const investorName = button.dataset.investorName;
  const dueAmount = Number(button.dataset.amount) || 0;

  if (!investorId || !action) return;

  if (action === 'open') {
    openPayoutModal(investorId, investorName, dueAmount);
    return;
  }

  if (action === 'clear') {
    const confirmed = window.confirm(
      `Zerar todos os pagamentos registrados de ${investorName} neste período?`
    );
    if (!confirmed) return;

    payoutBusy = true;
    button.disabled = true;
    const result = await clearProfitPayout(
      'investor',
      investorId,
      currentFilters.dateFrom || '',
      currentFilters.dateTo || ''
    );
    payoutBusy = false;

    if (!result.success) {
      showToast(result.error || 'Não foi possível zerar os pagamentos.', 'error');
      refresh();
      return;
    }

    showToast(`Pagamentos de ${investorName} zerados.`, 'success');
    await reloadPayoutsAndRefresh();
  }
}

async function submitPayoutForm(event) {
  event.preventDefault();
  if (payoutBusy || !payoutModalContext) return;

  const amount = Number(qs('#payout-amount')?.value) || 0;
  const note = qs('#payout-note')?.value || '';
  const { investorId, investorName, dueAmount, state } = payoutModalContext;

  if (amount <= 0) {
    showToast('Informe um valor maior que zero.', 'error');
    return;
  }

  if (amount > state.remaining + 0.02) {
    showToast(`O valor não pode passar de ${formatCurrency(state.remaining)}.`, 'error');
    return;
  }

  payoutBusy = true;
  qs('#btn-payout-submit').disabled = true;

  const user = getCurrentUser();
  const result = await registerProfitPayment({
    type: 'investor',
    recipientId: investorId,
    recipientName: investorName,
    dateFrom: currentFilters.dateFrom || '',
    dateTo: currentFilters.dateTo || '',
    dueAmount,
    paymentAmount: amount,
    markedBy: user?.email || '',
    note,
  });

  payoutBusy = false;
  qs('#btn-payout-submit').disabled = false;

  if (!result.success) {
    showToast(result.error || 'Não foi possível registrar o pagamento.', 'error');
    return;
  }

  closeModal('payout-modal');
  payoutModalContext = null;

  if (result.status === 'paid') {
    showToast(`${investorName} quitado (${formatCurrency(result.paidAmount)}).`, 'success');
  } else {
    showToast(
      `Pagamento de ${formatCurrency(amount)} registrado. Restante: ${formatCurrency(result.remaining)}.`,
      'success'
    );
  }

  await reloadPayoutsAndRefresh();
}

async function loadData() {
  const [salesRes, investorsRes, settingsRes, stockEntriesRes, payoutsRes] = await Promise.all([
    listSales(),
    listInvestors(),
    getGlobalSettings(),
    listStockEntries(),
    listProfitPayouts(),
  ]);

  if (!salesRes.success) {
    showToast(salesRes.error, 'error');
    qs('#profits-meta').textContent = 'Erro ao carregar vendas.';
    return;
  }

  const settings = settingsRes.success ? settingsRes.data : {};
  const investors = investorsRes.success ? investorsRes.data : [];
  allStockEntries = stockEntriesRes.success ? stockEntriesRes.data : [];
  globalSettings = settings;
  allSales = applyPlatformSettingsToSales(salesRes.data, settings, investors, allStockEntries);
  allInvestors = investors;
  payoutMap = payoutsRes.success ? payoutsToMap(payoutsRes.data) : new Map();
  refresh();
}

function initEvents() {
  qsa('.profits-tabs__btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  qs('#profits-period')?.addEventListener('change', () => {
    toggleCustomDates();
    if (qs('#profits-period').value !== 'custom') refresh();
  });

  ['#profits-date-from', '#profits-date-to'].forEach((sel) => {
    qs(sel)?.addEventListener('change', refresh);
  });

  qs('#btn-profits-refresh')?.addEventListener('click', refresh);

  qs('#tbody-investidores')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-payout-action]');
    if (button) handlePayoutAction(button);
  });

  qs('#payout-form')?.addEventListener('submit', submitPayoutForm);
  qs('#btn-payout-fill-remaining')?.addEventListener('click', () => {
    if (!payoutModalContext) return;
    const remaining = payoutModalContext.state.remaining;
    if (remaining > 0) {
      qs('#payout-amount').value = remaining.toFixed(2);
    }
  });

  setupModalClose('payout-modal');
}

async function init() {
  initEvents();
  toggleCustomDates();
  const defaults = getDefaultPeriodFilters('month');
  qs('#profits-date-from').value = defaults.dateFrom;
  qs('#profits-date-to').value = defaults.dateTo;
  await waitForAuth();
  await loadData();
}

init();
