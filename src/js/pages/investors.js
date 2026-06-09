import {
  listInvestors,
  getInvestorById,
  createInvestor,
  updateInvestor,
  deleteInvestor,
} from '../services/investorService.js';
import { listStockEntries, entriesAsStockItems } from '../services/stockEntryService.js';
import { listSales } from '../services/salesService.js';
import { waitForAuth } from '../services/authService.js';
import {
  investorStockTotals,
  formatRepasseRule,
  totalQuantity,
  estimateRepasseAtPrice,
  investorSalesTotals,
  DEFAULT_REPASSE_TYPE,
  DEFAULT_REPASSE_VALUE,
} from '../utils/calculations.js';
import { validateInvestor } from '../utils/validators.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import {
  qs,
  showToast,
  openModal,
  closeModal,
  setupModalClose,
  setLoading,
} from '../utils/domHelpers.js';

const REPASSE_HINTS = {
  capital_mais_lucro: 'Padrão SHIR7: custo das peças + % do lucro líquido (ex.: 40). Lucro de personalização fica 100% com a loja.',
  percent_lucro: 'Ex.: 50 = investidor recebe 50% do lucro de cada venda.',
  percent_faturamento: 'Ex.: 30 = investidor recebe 30% do valor da venda.',
  fixo_peca: 'Ex.: 25 = investidor recebe R$ 25,00 por peça vendida.',
  custo_comissao: 'Ex.: 20 = investidor recebe o custo da peça + 20% de comissão.',
  personalizado: 'Descreva a regra completa no campo Observações.',
};

const REPASSE_VALUE_LABELS = {
  capital_mais_lucro: '% do lucro líquido',
  percent_lucro: '% do lucro',
  percent_faturamento: '% do faturamento',
  fixo_peca: 'Valor (R$) por peça',
  custo_comissao: '% de comissão sobre o custo',
};

let allInvestors = [];
let allStockItems = [];
let allSales = [];
let editingId = null;
let viewingId = null;
let deletingId = null;

const tbody = qs('#investors-tbody');
const searchInput = qs('#search-input');
const investorsCount = qs('#investors-count');
const investorForm = qs('#investor-form');
const formErrors = qs('#form-errors');
const repasseTypeField = qs('#field-repasseType');
const repasseValueGroup = qs('#repasse-value-group');

function getInvestorStats(investorId) {
  return investorStockTotals(allStockItems, investorId);
}

function showFormErrors(errors) {
  if (!errors.length) {
    formErrors.classList.remove('form-errors--visible');
    formErrors.innerHTML = '';
    return;
  }
  formErrors.innerHTML = `<ul>${errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;
  formErrors.classList.add('form-errors--visible');
}

function toggleRepasseFields() {
  const type = repasseTypeField.value;
  const isPersonalizado = type === 'personalizado';
  const hint = qs('#repasse-value-hint');
  const valueLabel = qs('#repasse-value-label');

  repasseValueGroup.style.display = isPersonalizado ? 'none' : '';
  if (hint) {
    hint.textContent = REPASSE_HINTS[type] || '';
  }
  if (valueLabel) {
    valueLabel.textContent = REPASSE_VALUE_LABELS[type] || 'Valor do repasse';
  }
}

function getFormData() {
  return {
    name: qs('#field-name').value,
    phone: qs('#field-phone').value,
    email: qs('#field-email').value,
    repasseType: repasseTypeField.value,
    repasseValue: qs('#field-repasseValue').value,
    notes: qs('#field-notes').value,
  };
}

function filterInvestors(investors) {
  const term = searchInput.value.trim().toLowerCase();
  if (!term) return investors;

  return investors.filter((i) => {
    const haystack = [i.name, i.phone, i.email, i.notes].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(term);
  });
}

function renderTable() {
  const filtered = filterInvestors(allInvestors);

  investorsCount.textContent = filtered.length === allInvestors.length
    ? `${allInvestors.length} investidor(es)`
    : `${filtered.length} de ${allInvestors.length} investidor(es)`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table__empty">Nenhum investidor encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((inv) => {
    const stats = getInvestorStats(inv.id);
    return `
      <tr data-id="${inv.id}">
        <td><strong>${inv.name}</strong></td>
        <td>
          ${inv.phone ? `<div>${inv.phone}</div>` : ''}
          ${inv.email ? `<div class="text-sm text-muted">${inv.email}</div>` : '<span class="text-muted">—</span>'}
        </td>
        <td><span class="badge badge--info">${formatRepasseRule(inv)}</span></td>
        <td>${stats.productCount}</td>
        <td>${stats.pieces}</td>
        <td>${formatCurrency(stats.investedValue)}</td>
        <td>
          <div class="table__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-action="view" data-id="${inv.id}">Painel</button>
            <button type="button" class="btn btn--secondary btn--sm" data-action="edit" data-id="${inv.id}">Editar</button>
            <button type="button" class="btn btn--danger btn--sm" data-action="delete" data-id="${inv.id}">Excluir</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadData() {
  investorsCount.textContent = 'Carregando investidores...';

  const [invResult, stockResult, salesResult] = await Promise.all([
    listInvestors(),
    listStockEntries(),
    listSales(),
  ]);

  if (!invResult.success) {
    investorsCount.textContent = 'Erro ao carregar investidores.';
    showToast(invResult.error, 'error');
    return;
  }

  allInvestors = invResult.data;
  allStockItems = stockResult.success ? entriesAsStockItems(stockResult.data) : [];
  allSales = salesResult.success ? salesResult.data : [];
  renderTable();
}

function resetForm() {
  investorForm.reset();
  editingId = null;
  formErrors.classList.remove('form-errors--visible');
  qs('#investor-modal-title').textContent = 'Novo investidor';
  repasseTypeField.value = DEFAULT_REPASSE_TYPE;
  qs('#field-repasseValue').value = String(DEFAULT_REPASSE_VALUE);
  toggleRepasseFields();
}

function fillForm(investor) {
  qs('#field-name').value = investor.name || '';
  qs('#field-phone').value = investor.phone || '';
  qs('#field-email').value = investor.email || '';
  repasseTypeField.value = investor.repasseType || '';
  qs('#field-repasseValue').value = investor.repasseValue ?? '';
  qs('#field-notes').value = investor.notes || '';
  toggleRepasseFields();
}

function openCreateModal() {
  resetForm();
  openModal('investor-modal');
}

async function openEditModal(id) {
  const result = await getInvestorById(id);
  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  editingId = id;
  qs('#investor-modal-title').textContent = 'Editar investidor';
  fillForm(result.data);
  openModal('investor-modal');
}

function renderViewPanel(investor) {
  const stats = getInvestorStats(investor.id);
  const salesStats = investorSalesTotals(allSales, investor.id);
  let potentialRepasse = 0;
  if (stats.products.length) {
    potentialRepasse = stats.products.reduce((sum, p) => {
      const qty = totalQuantity(p.sizes);
      return sum + estimateRepasseAtPrice(investor, p, qty);
    }, 0);
  }

  const repasseExample = investor.repasseType === 'capital_mais_lucro' && stats.products.length
    ? `<p class="investor-panel__note">
        <strong>Exemplo da regra:</strong> ao vender todo o estoque ao preço sugerido,
        o repasse estimado seria <strong>${formatCurrency(potentialRepasse)}</strong>
        (capital de volta + ${investor.repasseValue ?? DEFAULT_REPASSE_VALUE}% do lucro líquido por venda).
      </p>`
    : '';

  const productsList = stats.products.length
    ? `<ul class="investor-panel__products">${stats.products.map((p) => {
      const qty = totalQuantity(p.sizes);
      return `<li><strong>${p.name}</strong> — ${qty} peça(s)</li>`;
    }).join('')}</ul>`
    : '<p class="text-muted">Nenhum produto vinculado ainda.</p>';

  qs('#view-modal-title').textContent = investor.name;
  qs('#view-modal-body').innerHTML = `
    <div class="investor-panel__grid">
      <div class="investor-panel__card investor-panel__card--highlight">
        <p class="investor-panel__label">Produtos vinculados</p>
        <p class="investor-panel__value">${stats.productCount}</p>
      </div>
      <div class="investor-panel__card investor-panel__card--highlight">
        <p class="investor-panel__label">Peças em estoque</p>
        <p class="investor-panel__value">${stats.pieces}</p>
      </div>
      <div class="investor-panel__card investor-panel__card--highlight">
        <p class="investor-panel__label">Valor investido (custo)</p>
        <p class="investor-panel__value">${formatCurrency(stats.investedValue)}</p>
      </div>
      <div class="investor-panel__card">
        <p class="investor-panel__label">Receita potencial</p>
        <p class="investor-panel__value">${formatCurrency(stats.potentialRevenue)}</p>
      </div>
      <div class="investor-panel__card">
        <p class="investor-panel__label">Lucro potencial</p>
        <p class="investor-panel__value">${formatCurrency(stats.potentialProfit)}</p>
      </div>
      <div class="investor-panel__card investor-panel__card--highlight">
        <p class="investor-panel__label">Vendido</p>
        <p class="investor-panel__value">${formatCurrency(salesStats.soldValue)}</p>
      </div>
      <div class="investor-panel__card">
        <p class="investor-panel__label">Lucro das vendas</p>
        <p class="investor-panel__value">${formatCurrency(salesStats.profit)}</p>
      </div>
      <div class="investor-panel__card investor-panel__card--highlight">
        <p class="investor-panel__label">Repasse pago</p>
        <p class="investor-panel__value">${formatCurrency(salesStats.repassePaid)}</p>
      </div>
    </div>

    <div class="investor-panel__section">
      <h4 class="investor-panel__section-title">Dados do investidor</h4>
      <dl class="investor-panel__fields">
        <div class="investor-panel__field">
          <dt>Telefone</dt>
          <dd>${investor.phone || '—'}</dd>
        </div>
        <div class="investor-panel__field">
          <dt>E-mail</dt>
          <dd>${investor.email || '—'}</dd>
        </div>
        <div class="investor-panel__field">
          <dt>Regra de repasse</dt>
          <dd>${formatRepasseRule(investor)}</dd>
        </div>
        <div class="investor-panel__field">
          <dt>Observações</dt>
          <dd>${investor.notes || '—'}</dd>
        </div>
      </dl>
    </div>

    <div class="investor-panel__section">
      <h4 class="investor-panel__section-title">Produtos vinculados</h4>
      ${productsList}
    </div>

    ${repasseExample}
    <p class="investor-panel__note">
      ${salesStats.saleCount} venda(s) registrada(s).
      Repasse não inclui lucro de personalização — esse valor fica integralmente com a SHIR7.
    </p>
  `;
}

async function openViewModal(id) {
  const result = await getInvestorById(id);
  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  viewingId = id;
  renderViewPanel(result.data);
  openModal('view-modal');
}

function openDeleteModal(id, name) {
  deletingId = id;
  qs('#delete-investor-name').textContent = name;
  openModal('delete-modal');
}

async function handleSave(e) {
  e.preventDefault();
  const data = getFormData();
  const { valid, errors } = validateInvestor(data);
  showFormErrors(errors);
  if (!valid) return;

  const btn = qs('#btn-save-investor');
  setLoading(btn, true);

  const result = editingId
    ? await updateInvestor(editingId, data)
    : await createInvestor(data);

  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  showToast(editingId ? 'Investidor atualizado!' : 'Investidor criado!', 'success');
  closeModal('investor-modal');
  await loadData();
}

async function handleDelete() {
  if (!deletingId) return;

  const btn = qs('#btn-confirm-delete');
  setLoading(btn, true);

  const result = await deleteInvestor(deletingId);
  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  showToast('Investidor excluído.', 'success');
  closeModal('delete-modal');
  deletingId = null;
  await loadData();
}

function initEvents() {
  setupModalClose('investor-modal');
  setupModalClose('view-modal');
  setupModalClose('delete-modal');

  qs('#btn-new-investor')?.addEventListener('click', openCreateModal);
  investorForm?.addEventListener('submit', handleSave);
  repasseTypeField?.addEventListener('change', toggleRepasseFields);
  searchInput?.addEventListener('input', renderTable);

  tbody?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const investor = allInvestors.find((i) => i.id === btn.dataset.id);
    if (!investor) return;

    if (btn.dataset.action === 'view') openViewModal(btn.dataset.id);
    if (btn.dataset.action === 'edit') openEditModal(btn.dataset.id);
    if (btn.dataset.action === 'delete') openDeleteModal(btn.dataset.id, investor.name);
  });

  qs('#btn-edit-from-view')?.addEventListener('click', () => {
    if (viewingId) {
      closeModal('view-modal');
      openEditModal(viewingId);
    }
  });

  qs('#btn-confirm-delete')?.addEventListener('click', handleDelete);
}

async function init() {
  initEvents();
  toggleRepasseFields();
  await waitForAuth();
  await loadData();
}

init();
