import {
  listAdCampaigns,
  createAdCampaign,
  deleteAdCampaign,
  previewAdCampaignAssignment,
  getAdCampaignSales,
} from '../services/adCampaignService.js';
import { listSales } from '../services/salesService.js';
import { waitForAuth } from '../services/authService.js';
import { formatSaleDate } from '../utils/adCampaignUtils.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import {
  qs,
  showToast,
  openModal,
  closeModal,
  setupModalClose,
  setLoading,
} from '../utils/domHelpers.js';

let allCampaigns = [];
let allSales = [];
let deletingId = null;
let previewTimer = null;

const tbody = qs('#ads-tbody');
const form = qs('#campaign-form');
const formErrors = qs('#form-errors');
const previewEl = qs('#campaign-preview');

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
  formErrors.classList.add('form-errors--visible');
  formErrors.innerHTML = errors.map((e) => `<p>${escapeHtml(e)}</p>`).join('');
}

function getFormValues() {
  return {
    name: qs('#campaign-name')?.value?.trim() || '',
    platform: qs('#campaign-platform')?.value?.trim() || '',
    saleCount: qs('#campaign-sale-count')?.value,
    costPerSale: qs('#campaign-cost-per-sale')?.value,
    notes: qs('#campaign-notes')?.value?.trim() || '',
  };
}

function renderSummary() {
  const totalSpent = allCampaigns.reduce((sum, c) => sum + (Number(c.totalCost) || 0), 0);
  const totalSales = allCampaigns.reduce((sum, c) => sum + (Number(c.saleCount) || 0), 0);
  const available = allSales.filter(
    (s) => s.stockOrigin === 'investidor' && s.status !== 'cancelada' && !s.isSample && !s.adCampaignId
  ).length;

  qs('#summary-spent').textContent = formatCurrency(totalSpent);
  qs('#summary-sales').textContent = String(totalSales);
  qs('#summary-available').textContent = String(available);
}

function renderCampaignSalesHint(campaign) {
  const linked = getAdCampaignSales(campaign, allSales);
  if (!linked.length) return 'Vendas vinculadas indisponíveis no cache.';
  const sample = linked.slice(0, 3).map((s) => `#${escapeHtml(s.orderId || s.id.slice(0, 6))}`).join(', ');
  const extra = linked.length > 3 ? ` +${linked.length - 3}` : '';
  return `${linked.length} venda(s): ${sample}${extra}`;
}

function renderTable() {
  if (!tbody) return;

  if (!allCampaigns.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table__empty">Nenhuma campanha registrada.</td></tr>';
    return;
  }

  tbody.innerHTML = allCampaigns.map((campaign) => {
    const created = campaign.createdAt?.seconds
      ? new Date(campaign.createdAt.seconds * 1000).toLocaleDateString('pt-BR')
      : '—';

    return `
      <tr>
        <td>
          <strong>${escapeHtml(campaign.name)}</strong>
          ${campaign.notes ? `<br><span class="text-sm text-muted">${escapeHtml(campaign.notes)}</span>` : ''}
        </td>
        <td>${escapeHtml(campaign.platform || '—')}</td>
        <td>${Number(campaign.saleCount) || 0}</td>
        <td>${formatCurrency(campaign.costPerSale)}</td>
        <td><strong>${formatCurrency(campaign.totalCost)}</strong></td>
        <td>
          <span class="text-sm">${renderCampaignSalesHint(campaign)}</span>
        </td>
        <td class="table__actions ads-row__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-action="view" data-id="${campaign.id}">Ver</button>
          <button type="button" class="btn btn--ghost btn--sm btn--danger" data-action="delete" data-id="${campaign.id}">Excluir</button>
        </td>
      </tr>
      <tr class="ads-detail-row" id="detail-${campaign.id}" hidden>
        <td colspan="7">
          <div class="ads-campaign-meta">
            <span>Criada em <strong>${created}</strong></span>
            <span>Escopo: <strong>Estoque investidor</strong></span>
            <span>Custo por venda: <strong>${formatCurrency(campaign.costPerSale)}</strong></span>
          </div>
          <p class="text-sm text-muted" style="margin-top:0.75rem">Desconto aplicado só no lucro da camisa — personalização não entra.</p>
        </td>
      </tr>
    `;
  }).join('');
}

async function updatePreview() {
  if (!previewEl) return;

  const { saleCount, costPerSale } = getFormValues();
  const count = Math.max(0, Math.floor(Number(saleCount) || 0));
  const cost = Math.max(0, Number(costPerSale) || 0);

  if (!count || !cost) {
    previewEl.innerHTML = '<p class="ads-preview--empty">Informe quantidade de vendas e custo por venda para ver a prévia.</p>';
    return;
  }

  previewEl.innerHTML = '<p class="ads-preview--empty">Calculando prévia…</p>';
  const result = await previewAdCampaignAssignment(count);
  if (!result.success) {
    previewEl.innerHTML = `<p class="ads-preview--empty">${escapeHtml(result.error)}</p>`;
    return;
  }

  const { picked, available } = result.data;
  const total = count * cost;

  if (picked.length < count) {
    previewEl.innerHTML = `
      <p><strong>Atenção:</strong> só ${picked.length} venda(s) disponível(is) de ${available} no estoque investidor sem campanha.</p>
      <p>Reduza a quantidade ou exclua uma campanha que já usou essas vendas.</p>
    `;
    return;
  }

  const list = picked.slice(0, 8).map((sale) => (
    `<li>#${escapeHtml(sale.orderId || sale.id.slice(0, 8))} · ${formatSaleDate(sale)} · ${escapeHtml(sale.productName || '—')}</li>`
  )).join('');
  const more = picked.length > 8 ? `<li>… e mais ${picked.length - 8} venda(s)</li>` : '';

  previewEl.innerHTML = `
    <p><strong>Últimas ${count} vendas</strong> do estoque investidor (sem campanha anterior).</p>
    <p>Total de ads: <strong>${formatCurrency(total)}</strong> (${formatCurrency(cost)} × ${count} vendas)</p>
    <p class="text-sm text-muted">Esse valor será descontado do lucro da camisa antes de dividir investidor e SHIR7. Personalização não é afetada.</p>
    <ul class="ads-preview__list">${list}${more}</ul>
  `;
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 250);
}

function resetForm() {
  form?.reset();
  showFormErrors([]);
  updatePreview();
}

function openCreateModal() {
  resetForm();
  openModal('campaign-modal');
}

function openViewCampaign(id) {
  const row = qs(`#detail-${id}`);
  if (row) row.hidden = !row.hidden;
}

function openDeleteModal(id) {
  const campaign = allCampaigns.find((c) => c.id === id);
  if (!campaign) return;
  deletingId = id;
  qs('#delete-campaign-name').textContent = campaign.name;
  qs('#delete-campaign-detail').textContent =
    `${campaign.saleCount} venda(s) · ${formatCurrency(campaign.costPerSale)}/venda · total ${formatCurrency(campaign.totalCost)}`;
  openModal('delete-modal');
}

async function loadData() {
  const [campaignsResult, salesResult] = await Promise.all([
    listAdCampaigns({ fresh: true }),
    listSales({}, { fresh: true }),
  ]);

  if (!campaignsResult.success) {
    showToast(campaignsResult.error, 'error');
    return;
  }
  if (!salesResult.success) {
    showToast(salesResult.error, 'error');
    return;
  }

  allCampaigns = campaignsResult.data;
  allSales = salesResult.data;
  renderSummary();
  renderTable();
}

async function handleSubmit(event) {
  event.preventDefault();
  const values = getFormValues();
  const errors = [];
  if (!values.name) errors.push('Informe o nome da campanha.');
  if (!Number(values.saleCount) || Number(values.saleCount) < 1) {
    errors.push('Informe quantas vendas a campanha gerou (mínimo 1).');
  }
  if (!Number(values.costPerSale) || Number(values.costPerSale) <= 0) {
    errors.push('Informe o custo por venda maior que zero.');
  }
  if (errors.length) {
    showFormErrors(errors);
    return;
  }

  setLoading(qs('#btn-save-campaign'), true, 'Salvando…');
  const result = await createAdCampaign(values);
  setLoading(qs('#btn-save-campaign'), false);

  if (!result.success) {
    showFormErrors([result.error]);
    return;
  }

  showToast('Campanha registrada e vendas vinculadas.', 'success');
  closeModal('campaign-modal');
  await loadData();
}

async function confirmDelete() {
  if (!deletingId) return;
  setLoading(qs('#btn-confirm-delete'), true, 'Excluindo…');
  const result = await deleteAdCampaign(deletingId);
  setLoading(qs('#btn-confirm-delete'), false);

  if (!result.success) {
    showToast(result.error, 'error');
    return;
  }

  showToast('Campanha excluída. Ads removidos das vendas.', 'success');
  deletingId = null;
  closeModal('delete-modal');
  await loadData();
}

function initEvents() {
  qs('#btn-new-campaign')?.addEventListener('click', openCreateModal);
  qs('#campaign-form')?.addEventListener('submit', handleSubmit);
  qs('#btn-confirm-delete')?.addEventListener('click', confirmDelete);

  ['#campaign-sale-count', '#campaign-cost-per-sale'].forEach((selector) => {
    qs(selector)?.addEventListener('input', schedulePreview);
  });

  tbody?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'view') openViewCampaign(id);
    if (action === 'delete') openDeleteModal(id);
  });

  setupModalClose('campaign-modal');
  setupModalClose('delete-modal');
}

async function init() {
  initEvents();
  await waitForAuth();
  await loadData();
}

init();
