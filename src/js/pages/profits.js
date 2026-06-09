import { waitForAuth } from '../services/authService.js';
import { listSales } from '../services/salesService.js';
import { listInvestors } from '../services/investorService.js';
import {
  calculatePartnerDistribution,
  getDefaultPeriodFilters,
} from '../utils/partnerProfits.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { qs, qsa, showToast } from '../utils/domHelpers.js';

let allSales = [];
let allInvestors = [];
let shir7DetailOpen = false;

function switchTab(tab) {
  qsa('.profits-tabs__btn').forEach((btn) => {
    btn.classList.toggle('profits-tabs__btn--active', btn.dataset.tab === tab);
  });
  qs('#tab-overview').hidden = tab !== 'overview';
  qs('#tab-investors').hidden = tab !== 'investors';
  qs('#tab-partners').hidden = tab !== 'partners';
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

function renderPartners(containerId, data) {
  const el = qs(containerId);
  if (!el) return;

  el.innerHTML = data.partners.map((p) => `
    <div class="profits-partner">
      <p class="profits-partner__name">${p.name}</p>
      <p class="profits-partner__share">50% do lucro SHIR7</p>
      <p class="profits-partner__value">${formatCurrency(p.amount)}</p>
      <p class="profits-partner__breakdown">
        Próprio: ${formatCurrency(p.fromProprio)}<br>
        Investidor: ${formatCurrency(p.fromInvestor)}
      </p>
    </div>
  `).join('');
}

function renderBreakdown(containerId, data) {
  const el = qs(containerId);
  if (!el) return;

  el.innerHTML = `
    <div><dt>Total lucro SHIR7</dt><dd>${formatCurrency(data.shir7Total)}</dd></div>
    <div><dt>Do estoque próprio</dt><dd>${formatCurrency(data.shir7FromProprio)}</dd></div>
    <div><dt>Do estoque investidor</dt><dd>${formatCurrency(data.shir7FromInvestor)}</dd></div>
    <div><dt>Lucro bruto total (vendas)</dt><dd>${formatCurrency(data.totalNetProfit)}</dd></div>
    <div><dt>Repasse investidores</dt><dd>${formatCurrency(data.investorRepasseTotal)}</dd></div>
    <div><dt>Vendas no período</dt><dd>${data.saleCount}</dd></div>
  `;
}

function renderInvestorsTable(data) {
  const tbody = qs('#investors-profits-tbody');
  if (!data.byInvestor.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table__empty">Nenhuma venda de estoque investidor no período.</td></tr>';
    return;
  }

  tbody.innerHTML = data.byInvestor.map((row) => `
    <tr>
      <td><strong>${row.investorName}</strong></td>
      <td>${row.sales}</td>
      <td>${row.pieces}</td>
      <td>${formatCurrency(row.netProfit)}</td>
      <td>${formatCurrency(row.repasse)}</td>
      <td>${formatCurrency(row.shir7Share)}</td>
    </tr>
  `).join('');
}

function renderOverview(data, filters) {
  qs('#sum-investor-repasse').textContent = formatCurrency(data.investorRepasseTotal);
  qs('#sum-investor-hint').textContent =
    `${data.investorSalesCount} venda(s) · capital + 40% lucro (sem pers.)`;

  qs('#sum-shir7-total').textContent = formatCurrency(data.shir7Total);
  qs('#sum-proprio').textContent = formatCurrency(data.shir7FromProprio);
  qs('#sum-proprio-hint').textContent =
    `${data.proprioSalesCount} venda(s) · 50% Pedro · 50% Eduardo`;

  renderPartners('#partners-overview', data);
  renderBreakdown('#shir7-breakdown', data);
  renderPartners('#partners-tab', data);
  renderBreakdown('#partners-breakdown', data);
  renderInvestorsTable(data);

  const periodLabel = filters.dateFrom && filters.dateTo
    ? `${filters.dateFrom} a ${filters.dateTo}`
    : 'todo o histórico';
  qs('#profits-meta').textContent =
    `${data.saleCount} venda(s) · ${periodLabel === 'todo o histórico' ? periodLabel : `período ${periodLabel}`}`;
}

function toggleShir7Detail() {
  shir7DetailOpen = !shir7DetailOpen;
  const detail = qs('#shir7-detail');
  const card = qs('#card-shir7');
  const chevron = qs('#shir7-chevron');
  if (detail) detail.hidden = !shir7DetailOpen;
  if (card) {
    card.classList.toggle('profits-card--open', shir7DetailOpen);
    card.setAttribute('aria-expanded', String(shir7DetailOpen));
  }
  if (chevron) chevron.textContent = shir7DetailOpen ? '▲' : '▼';
}

function refresh() {
  const filters = getFilters();
  const data = calculatePartnerDistribution(allSales, allInvestors, filters);
  renderOverview(data, filters);
}

async function loadData() {
  const [salesRes, investorsRes] = await Promise.all([
    listSales(),
    listInvestors(),
  ]);

  if (!salesRes.success) {
    showToast(salesRes.error, 'error');
    qs('#profits-meta').textContent = 'Erro ao carregar vendas.';
    return;
  }

  allSales = salesRes.data;
  allInvestors = investorsRes.success ? investorsRes.data : [];
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
  qs('#card-shir7')?.addEventListener('click', toggleShir7Detail);

  qs('#card-shir7')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleShir7Detail();
    }
  });
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
