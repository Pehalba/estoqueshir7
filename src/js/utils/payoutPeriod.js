/**
 * Chave estável de período para pagamentos (lucros, influencers).
 * "Este mês" usa YYYY-MM — não muda quando dateTo avança a cada dia.
 */
export function getPayoutPeriodKey(dateFrom = '', dateTo = '') {
  const from = String(dateFrom || '').trim();
  const to = String(dateTo || '').trim();

  if (!from && !to) return 'all';

  if (from && to && from.slice(0, 7) === to.slice(0, 7)) {
    return from.slice(0, 7);
  }

  return `${from || 'all'}_${to || 'all'}`;
}

export function periodKeyToDocSegment(periodKey) {
  if (periodKey === 'all') return 'all';
  return String(periodKey).replace(/[^a-zA-Z0-9]/g, '_');
}

export function payoutPeriodsMatch(recordFrom, recordTo, queryFrom, queryTo) {
  const rFrom = String(recordFrom || '').trim();
  const rTo = String(recordTo || '').trim();
  const qFrom = String(queryFrom || '').trim();
  const qTo = String(queryTo || '').trim();

  if (!qFrom && !qTo) {
    return !rFrom && !rTo;
  }

  if (getPayoutPeriodKey(rFrom, rTo) === getPayoutPeriodKey(qFrom, qTo)) {
    return true;
  }

  return rFrom === qFrom && rTo === qTo;
}

export function findPayoutInMap(payoutMap, matcher) {
  if (!payoutMap?.size) return null;

  for (const record of payoutMap.values()) {
    if (matcher(record)) return record;
  }
  return null;
}
