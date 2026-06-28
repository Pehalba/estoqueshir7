import {
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  EXPENSE_CATEGORIES,
} from '../services/expenseService.js';
import { waitForAuth } from '../services/authService.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import {
  qs,
  showToast,
  openModal,
  closeModal,
  setupModalClose,
  setLoading,
} from '../utils/domHelpers.js';

let allExpenses = [];
let editingId = null;
let deletingId = null;

const tbody = qs('#expenses-tbody');
const searchInput = qs('#search-input');
const categoryFilter = qs('#filter-category');
const monthFilter = qs('#filter-month');
const form = qs('#expense-form');
const formErrors = qs('#form-errors');

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

function formatExpenseDate(exp) {
  if (exp.date) return new Date(`${exp.date}T12:00:00`).toLocaleDateString('pt-BR');
  if (exp.createdAt?.seconds) {
    return new Date(exp.createdAt.seconds * 1000).toLocaleDateString('pt-BR');
  }
  return '—';
}

function getExpenseMonthKey(exp) {
  if (exp.date) return exp.date.slice(0, 7);
  if (exp.createdAt?.seconds) {
    const d = new Date(exp.createdAt.seconds * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return '';
}

function getCategoryLabel(category) {
  return EXPENSE_CATEGORIES[category] || category || 'Geral';
}

function categoryOptionsHtml(selected = '') {
  return Object.entries(EXPENSE_CATEGORIES).map(([value, label]) => {
    const sel = value === selected ? ' selected' : '';
    return `<option value="${value}"${sel}>${label}</option>`;
  }).join('');
}

function getFilteredExpenses() {
  const term = (searchInput?.value || '').trim().toLowerCase();
  const category = categoryFilter?.value || '';
  const month = monthFilter?.value || '';

  return allExpenses.filter((exp) => {
    if (category && exp.category !== category) return false;
    if (month && getExpenseMonthKey(exp) !== month) return false;
    if (!term) return true;
    const hay = [
      exp.description,
      exp.notes,
      getCategoryLabel(exp.category),
    ].join(' ').toLowerCase();
    return hay.includes(term);
  });
}

function renderSummary(filtered) {
  const total = filtered.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthTotal = allExpenses
    .filter((exp) => getExpenseMonthKey(exp) === currentMonth)
    .reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);

  qs('#summary-total').textContent = formatCurrency(total);
  qs('#summary-count').textContent = `${filtered.length} despesa(s)`;
  qs('#summary-month').textContent = formatCurrency(monthTotal);
}

function renderTable() {
  const filtered = getFilteredExpenses();
  renderSummary(filtered);

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table__empty">Nenhum gasto registrado.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((exp) => `
    <tr>
      <td>${formatExpenseDate(exp)}</td>
      <td>
        <strong>${escapeHtml(exp.description)}</strong>
        ${exp.notes ? `<br><span class="text-sm text-muted">${escapeHtml(exp.notes)}</span>` : ''}
      </td>
      <td><span class="badge badge--neutral">${escapeHtml(getCategoryLabel(exp.category))}</span></td>
      <td><strong>${formatCurrency(exp.amount)}</strong></td>
      <td class="table__actions">
        <button type="button" class="btn btn--ghost btn--sm" data-edit="${exp.id}">Editar</button>
        <button type="button" class="btn btn--danger btn--sm" data-delete="${exp.id}">Excluir</button>
      </td>
    </tr>
  `).join('');
}

async function loadData() {
  const result = await listExpenses({ fresh: true });
  if (!result.success) {
    showToast(result.error, 'error');
    tbody.innerHTML = `<tr><td colspan="5" class="table__empty">${escapeHtml(result.error)}</td></tr>`;
    return;
  }
  allExpenses = result.data;
  renderTable();
}

function resetFormFields(exp = null) {
  qs('#field-description').value = exp?.description || '';
  qs('#field-amount').value = exp?.amount ?? '';
  qs('#field-category').innerHTML = categoryOptionsHtml(exp?.category || 'geral');
  qs('#field-date').value = exp?.date || new Date().toISOString().slice(0, 10);
  qs('#field-notes').value = exp?.notes || '';
}

function openFormModal(exp = null) {
  editingId = exp?.id || null;
  qs('#expense-modal-title').textContent = exp ? 'Editar gasto' : 'Novo gasto';
  resetFormFields(exp);
  showFormErrors([]);
  openModal('expense-modal');
}

async function handleFormSubmit(event) {
  event.preventDefault();
  showFormErrors([]);

  const payload = {
    description: qs('#field-description').value,
    amount: qs('#field-amount').value,
    category: qs('#field-category').value,
    date: qs('#field-date').value,
    notes: qs('#field-notes').value,
  };

  const btn = qs('#btn-save-expense');
  setLoading(btn, true);

  const result = editingId
    ? await updateExpense(editingId, payload)
    : await createExpense(payload);

  setLoading(btn, false);

  if (!result.success) {
    showFormErrors([result.error]);
    return;
  }

  showToast(editingId ? 'Gasto atualizado.' : 'Gasto registrado!', 'success');
  editingId = null;
  closeModal('expense-modal');
  await loadData();
}

function openDeleteModal(id) {
  const exp = allExpenses.find((e) => e.id === id);
  if (!exp) return;
  deletingId = id;
  qs('#delete-expense-desc').textContent = exp.description;
  qs('#delete-expense-amount').textContent = formatCurrency(exp.amount);
  openModal('delete-expense-modal');
}

async function confirmDelete() {
  if (!deletingId) return;
  const btn = qs('#btn-delete-expense-confirm');
  setLoading(btn, true);
  const result = await deleteExpense(deletingId);
  setLoading(btn, false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  showToast('Gasto removido.', 'success');
  deletingId = null;
  closeModal('delete-expense-modal');
  await loadData();
}

function bindEvents() {
  qs('#btn-new-expense')?.addEventListener('click', () => openFormModal());
  form?.addEventListener('submit', handleFormSubmit);
  searchInput?.addEventListener('input', renderTable);
  categoryFilter?.addEventListener('change', renderTable);
  monthFilter?.addEventListener('change', renderTable);

  qs('#btn-clear-filters')?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = '';
    if (monthFilter) monthFilter.value = '';
    renderTable();
  });

  tbody?.addEventListener('click', (event) => {
    const editBtn = event.target.closest('[data-edit]');
    const deleteBtn = event.target.closest('[data-delete]');
    if (editBtn) {
      const exp = allExpenses.find((e) => e.id === editBtn.dataset.edit);
      if (exp) openFormModal(exp);
    }
    if (deleteBtn) {
      openDeleteModal(deleteBtn.dataset.delete);
    }
  });

  qs('#btn-delete-expense-confirm')?.addEventListener('click', confirmDelete);
  setupModalClose('expense-modal');
  setupModalClose('delete-expense-modal');
}

async function init() {
  await waitForAuth();
  if (categoryFilter) {
    categoryFilter.innerHTML = `<option value="">Todas as categorias</option>${categoryOptionsHtml()}`;
  }
  bindEvents();
  await loadData();
}

init();
