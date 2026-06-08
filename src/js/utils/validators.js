export function isRequired(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

import { importTaxPerUnit } from './calculations.js';

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const PRODUCT_REQUIRED = [
  'name', 'supplier', 'stockOrigin', 'costPrice',
  'suggestedSalePrice', 'minimumSalePrice', 'status',
];

const PRODUCT_LABELS = {
  name: 'Nome',
  supplier: 'Fornecedor',
  stockOrigin: 'Origem',
  costPrice: 'Preço de custo',
  suggestedSalePrice: 'Preço sugerido',
  minimumSalePrice: 'Preço mínimo',
  status: 'Status',
  investorId: 'ID do investidor',
};

export function parseSizesQuickInput(text) {
  if (!text?.trim()) return [];

  const results = [];
  const regex = /(\d+)\s*([PXMG]{1,2}|GG|XG)/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    results.push({
      size: match[2].toUpperCase(),
      quantity: Number(match[1]),
    });
  }

  return results;
}

export function validateSizes(sizes) {
  const errors = [];

  if (!sizes?.length) {
    errors.push('Informe pelo menos um tamanho com quantidade.');
    return errors;
  }

  const seen = new Set();

  for (const item of sizes) {
    if (!isRequired(item.size)) {
      errors.push('Selecione o tamanho em todas as linhas.');
      continue;
    }
    const qty = Number(item.quantity);
    if (isNaN(qty) || qty < 0) {
      errors.push(`Quantidade inválida para tamanho ${item.size}.`);
    }
    if (seen.has(item.size)) {
      errors.push(`Tamanho ${item.size} duplicado. Use uma linha por tamanho.`);
    }
    seen.add(item.size);
  }

  return errors;
}

export function validateProduct(data) {
  const errors = [];

  for (const field of PRODUCT_REQUIRED) {
    if (!isRequired(data[field]) && data[field] !== 0) {
      errors.push(`${PRODUCT_LABELS[field] || field} é obrigatório.`);
    }
  }

  if (data.stockOrigin === 'investidor' && !isRequired(data.investorId)) {
    errors.push('Investidor é obrigatório quando a origem é investidor.');
  }

  errors.push(...validateSizes(data.sizes));

  const cost = Number(data.costPrice);
  const finalUnitCost = cost + importTaxPerUnit(data.importTaxes, data.sizes || []);
  const suggested = Number(data.suggestedSalePrice);
  const minimum = Number(data.minimumSalePrice);

  if (!isNaN(minimum) && !isNaN(suggested) && minimum > suggested) {
    errors.push('Preço mínimo não pode ser maior que o preço sugerido.');
  }

  if (!isNaN(minimum) && minimum < finalUnitCost) {
    errors.push('Preço mínimo não pode ser menor que o custo final por peça (com impostos).');
  }

  const importTaxes = Number(data.importTaxes);
  if (data.importTaxes !== '' && data.importTaxes != null && (isNaN(importTaxes) || importTaxes < 0)) {
    errors.push('Impostos de importação deve ser zero ou maior.');
  }

  return { valid: errors.length === 0, errors };
}

const REPASSE_TYPES_NEED_VALUE = [
  'capital_mais_lucro',
  'percent_lucro',
  'percent_faturamento',
  'fixo_peca',
  'custo_comissao',
];

export function validateInvestor(data) {
  const errors = [];

  if (!isRequired(data.name)) {
    errors.push('Nome é obrigatório.');
  }

  if (!isRequired(data.repasseType)) {
    errors.push('Tipo de repasse é obrigatório.');
  }

  if (REPASSE_TYPES_NEED_VALUE.includes(data.repasseType)) {
    const val = Number(data.repasseValue);
    if (isNaN(val) || val < 0) {
      errors.push('Valor de repasse inválido.');
    }
    if (
      ['capital_mais_lucro', 'percent_lucro', 'percent_faturamento', 'custo_comissao'].includes(data.repasseType)
      && val > 100
    ) {
      errors.push('Percentual de repasse não pode ser maior que 100.');
    }
  }

  if (data.repasseType === 'personalizado' && !isRequired(data.notes)) {
    errors.push('Descreva a regra personalizada nas observações.');
  }

  if (data.email && !isValidEmail(data.email)) {
    errors.push('E-mail inválido.');
  }

  return { valid: errors.length === 0, errors };
}

export function validateSale(data, context = {}) {
  const errors = [];
  const {
    product,
    availableQty: stockAvailable,
    orderIdExists,
    financials,
  } = context;

  if (!isRequired(data.orderId)) {
    errors.push('Nº do pedido é obrigatório.');
  } else if (orderIdExists) {
    errors.push('Este número de pedido já foi registrado.');
  }

  if (!isRequired(data.productId)) {
    errors.push('Selecione o produto.');
  }

  if (!isRequired(data.size)) {
    errors.push('Selecione o tamanho.');
  }

  const qty = Number(data.quantity);
  if (!qty || qty < 1) {
    errors.push('Quantidade deve ser pelo menos 1.');
  } else if (stockAvailable != null && qty > stockAvailable) {
    errors.push(`Estoque disponível insuficiente (${stockAvailable} peça(s)).`);
  }

  const unitPrice = Number(data.unitPrice);
  if (!unitPrice || unitPrice <= 0) {
    errors.push('Preço unitário inválido.');
  } else if (product && unitPrice < Number(product.minimumSalePrice)) {
    errors.push(
      `Preço abaixo do mínimo (${Number(product.minimumSalePrice).toFixed(2)}).`
    );
  }

  const unitCost = Number(data.unitCost);
  if (!unitCost || unitCost <= 0) {
    errors.push('Custo do produto ausente ou inválido.');
  }

  if (financials?.netProfit < 0) {
    errors.push('Margem negativa: lucro líquido menor que zero.');
  }

  return { valid: errors.length === 0, errors };
}
