import { waitForAuth } from '../services/authService.js';
import { listSales } from '../services/salesService.js';
import { listStockEntries } from '../services/stockEntryService.js';
import { listInvestors } from '../services/investorService.js';
import {
  calculatePartnerDistribution,
  getDefaultPeriodFilters,
  SHIR7_PARTNERS,
} from '../utils/partnerProfits.js';
import { applyPlatformSettingsToSales } from '../utils/analytics.js';
import { getGlobalSettings } from '../services/settingsService.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { qs, qsa, showToast } from '../utils/domHelpers.js';

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

function renderInvestidoresTab(data, shirts) {
  qs('#tab-inv-total').textContent = formatCurrency(shirts.investorRepasseTotal);
  qs('#tab-inv-hint').textContent =
    `${shirts.investorSalesCount} venda(s) · capital + 40% do lucro em camisas`;

  const tbody = qs('#tbody-investidores');
  if (!data.byInvestor.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="table__empty">Nenhuma venda de estoque investidor no período.</td></tr>';
    return;
  }

  tbody.innerHTML = data.byInvestor.map((row) => `
    <tr>
      <td><strong>${row.investorName}</strong></td>
      <td>${row.sales}</td>
      <td>${row.pieces}</td>
      <td>${formatCurrency(row.repasse)}</td>
    </tr>
  `).join('');
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

  renderInvestidoresTab(data, shirts);
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
  const data = calculatePartnerDistribution(allSales, allInvestors, filters, globalSettings, allStockEntries);
  renderAll(data, filters);
}

async function loadData() {
  const [salesRes, investorsRes, settingsRes, stockEntriesRes] = await Promise.all([
    listSales(),
    listInvestors(),
    getGlobalSettings(),
    listStockEntries(),
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
