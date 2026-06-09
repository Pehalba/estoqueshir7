import {
  collection,
  addDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from '../config/firebase.js';
import { getCurrentUser } from './authService.js';
import {
  filterSalesByPeriod,
  aggregateStock,
  getTopSellingProducts,
  getLossSales,
  getStagnantProducts,
  buildInvestorReport,
  saleDate,
  isSaleActive,
} from '../utils/analytics.js';
import {
  totalQuantity,
  getStockEntryUnitCost,
  availableQty,
  formatSaleLinesSummary,
} from '../utils/calculations.js';
import { formatCurrency, formatPercent } from '../utils/formatCurrency.js';

export const REPORT_TYPES = [
  { id: 'estoque', label: 'Posição de estoque' },
  { id: 'vendas', label: 'Vendas' },
  { id: 'lucro', label: 'Lucro por venda' },
  { id: 'investidor', label: 'Desempenho investidores' },
  { id: 'mais_vendidos', label: 'Mais vendidos' },
  { id: 'parados', label: 'Produtos parados' },
  { id: 'prejuizo', label: 'Vendas com prejuízo' },
  { id: 'repasse', label: 'Repasse investidores' },
];

function formatDateValue(sale) {
  const d = saleDate(sale);
  return d ? d.toLocaleString('pt-BR') : '—';
}

function applyExtraFilters(items, filters, type) {
  let result = items;
  if (filters.stockOrigin) {
    result = result.filter((i) => i.stockOrigin === filters.stockOrigin);
  }
  if (filters.investorId && type !== 'investidor') {
    result = result.filter((i) => i.investorId === filters.investorId);
  }
  if (filters.status && type === 'vendas') {
    result = result.filter((i) => i.status === filters.status);
  }
  if (filters.productId) {
    result = result.filter((i) => i.productId === filters.productId);
  }
  return result;
}

export function buildReport(type, filters, { products = [], sales = [], investors = [] } = {}) {
  const columns = [];
  const rows = [];

  switch (type) {
    case 'estoque': {
      columns.push(
        { key: 'stockEntryName', label: 'Estoque' },
        { key: 'productName', label: 'Produto' },
        { key: 'size', label: 'Tamanho' },
        { key: 'quantity', label: 'Quantidade' },
        { key: 'available', label: 'Disponível' },
        { key: 'unitCost', label: 'Custo unit.' },
        { key: 'stockOrigin', label: 'Origem' },
        { key: 'investorName', label: 'Investidor' },
      );
      const investorMap = new Map(investors.map((i) => [i.id, i.name]));
      for (const p of products) {
        if (p.status === 'inativo') continue;
        if (filters.productId && p.productId !== filters.productId) continue;
        if (filters.stockOrigin && p.stockOrigin !== filters.stockOrigin) continue;
        if (filters.investorId && p.investorId !== filters.investorId) continue;
        const unitCost = getStockEntryUnitCost(p);
        for (const s of p.sizes || []) {
          rows.push({
            productId: p.productId,
            stockEntryName: p.stockEntryName || p.name,
            productName: p.productName || p.name,
            size: s.size,
            quantity: Number(s.quantity) || 0,
            available: availableQty(s),
            unitCost: formatCurrency(unitCost),
            stockOrigin: p.stockOrigin === 'investidor' ? 'Investidor' : 'Próprio',
            investorId: p.investorId,
            investorName: investorMap.get(p.investorId) || '—',
          });
        }
      }
      break;
    }

    case 'vendas':
    case 'lucro':
    case 'prejuizo': {
      const isLucro = type === 'lucro';
      const isPrejuizo = type === 'prejuizo';
      columns.push(
        { key: 'date', label: 'Data' },
        { key: 'orderId', label: 'Pedido' },
        { key: 'productName', label: 'Produto' },
        { key: 'pieces', label: 'Peças' },
        { key: 'revenue', label: 'Faturamento' },
        { key: 'profit', label: 'Lucro' },
        { key: 'margin', label: 'Margem' },
        { key: 'origin', label: 'Origem' },
      );

      let filtered = filterSalesByPeriod(sales, filters);
      filtered = applyExtraFilters(filtered, filters, 'vendas');
      if (isPrejuizo) {
        filtered = filtered.filter((s) => isSaleActive(s) && (Number(s.netProfit) || 0) < 0);
      } else {
        filtered = filtered.filter(isSaleActive);
      }

      filtered.forEach((s) => {
        rows.push({
          date: formatDateValue(s),
          orderId: s.orderId || '—',
          productId: s.productId,
          productName: s.productName,
          pieces: `${s.quantity} (${formatSaleLinesSummary(s)})`,
          revenue: formatCurrency(s.totalRevenue),
          profit: formatCurrency(s.netProfit),
          margin: formatPercent(s.margin),
          origin: s.stockOrigin === 'investidor' ? 'Investidor' : 'Próprio',
          investorId: s.investorId,
          stockOrigin: s.stockOrigin,
          status: s.status,
        });
      });

      if (isLucro) {
        rows.sort((a, b) => {
          const parse = (v) => Number(String(v.profit).replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
          return parse(b) - parse(a);
        });
      }
      break;
    }

    case 'mais_vendidos': {
      columns.push(
        { key: 'productName', label: 'Produto' },
        { key: 'quantity', label: 'Peças vendidas' },
        { key: 'revenue', label: 'Faturamento' },
      );
      const filtered = filterSalesByPeriod(sales, filters);
      getTopSellingProducts(filtered, 50).forEach((item) => {
        if (filters.productId && item.productId !== filters.productId) return;
        rows.push({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          revenue: formatCurrency(item.revenue),
        });
      });
      break;
    }

    case 'parados': {
      columns.push(
        { key: 'productName', label: 'Produto' },
        { key: 'pieces', label: 'Peças em estoque' },
        { key: 'origin', label: 'Origem' },
      );
      getStagnantProducts(products, sales, filters).forEach((p) => {
        if (filters.stockOrigin && p.stockOrigin !== filters.stockOrigin) return;
        rows.push({
          productId: p.productId,
          productName: p.productName,
          pieces: p.pieces,
          origin: p.stockOrigin === 'investidor' ? 'Investidor' : 'Próprio',
          stockOrigin: p.stockOrigin,
        });
      });
      break;
    }

    case 'investidor':
    case 'repasse': {
      columns.push(
        { key: 'investorName', label: 'Investidor' },
        { key: 'saleCount', label: 'Vendas' },
        { key: 'soldPieces', label: 'Peças vendidas' },
        { key: 'revenue', label: 'Faturamento' },
        { key: 'profit', label: 'Lucro' },
        { key: 'repasse', label: 'Repasse' },
        { key: 'piecesInStock', label: 'Peças em estoque' },
      );
      const filteredSales = filterSalesByPeriod(sales, filters);
      buildInvestorReport(filteredSales, investors, products).forEach((row) => {
        if (filters.investorId && row.investorId !== filters.investorId) return;
        rows.push({
          investorId: row.investorId,
          investorName: row.investorName,
          saleCount: row.saleCount,
          soldPieces: row.soldPieces,
          revenue: formatCurrency(row.revenue),
          profit: formatCurrency(row.profit),
          repasse: formatCurrency(row.repasse),
          piecesInStock: row.piecesInStock,
        });
      });
      break;
    }

    default:
      return { success: false, error: 'Tipo de relatório inválido.' };
  }

  return { success: true, data: { type, columns, rows, generatedAt: new Date().toISOString() } };
}

export function exportToCsv(report, filename = 'relatorio-shir7.csv') {
  if (!report?.columns?.length) return { success: false, error: 'Relatório vazio.' };

  const header = report.columns.map((c) => c.label).join(';');
  const body = (report.rows || []).map((row) =>
    report.columns.map((col) => {
      let value = row[col.key];
      if (value == null) value = '';
      value = String(value).replace(/"/g, '""');
      if (/[;"\n]/.test(value)) value = `"${value}"`;
      return value;
    }).join(';')
  ).join('\n');

  const blob = new Blob([`\uFEFF${header}\n${body}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return { success: true };
}

export async function saveReportSnapshot(report, filters) {
  const user = getCurrentUser();
  if (!user) return { success: false, error: 'Usuário não autenticado.' };

  try {
    const ref = await addDoc(collection(db, 'reports'), {
      type: report.type,
      filters,
      rowCount: report.rows?.length || 0,
      generatedAt: serverTimestamp(),
      userId: user.uid,
    });
    return { success: true, data: { id: ref.id } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function getStockSummary(products) {
  return aggregateStock(products);
}
