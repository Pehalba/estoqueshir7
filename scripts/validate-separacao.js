const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../separacao_vermelhas_por_lote.txt');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

const LOTS = [
  { key: 'F03', name: 'Alba Fedex 03', cap: { P: 10, M: 30, G: 35, GG: 20, XG: 5 } },
  { key: 'F04', name: 'Fedex 04', cap: { P: 10, M: 20, G: 25, GG: 20, XG: 5 } },
  { key: 'F05', name: 'Fedex 05', cap: { P: 15, M: 25, G: 20, GG: 18, XG: 0 } },
  { key: 'LZ', name: 'LZ vermelhas', cap: { P: 26, M: 12, G: 4, GG: 4, XG: 8 } },
];
const lotIdx = Object.fromEntries(LOTS.map((l, i) => [l.key, i]));
const keyToName = Object.fromEntries(LOTS.map((l) => [l.key, l.name]));

function sortKey(id) {
  const raw = id.replace(/^#/, '');
  const [a, b] = raw.split('-');
  return Number(a) * 100 + (b ? Number(b) : 0);
}

function baseId(id) {
  return id.replace(/^#/, '').replace(/-\d+$/, '');
}

const orders = [];
let lot = null;
for (const line of lines) {
  if (/^Alba - Fedex 03/.test(line) && !line.includes('SOBRA')) lot = 'F03';
  else if (/^Fedex 04/.test(line) && !line.includes(':')) lot = 'F04';
  else if (/^Fedex 05/.test(line)) lot = 'F05';
  else if (/^LZ vermelhas/.test(line)) lot = 'LZ';
  else if (/^SEM ESTOQUE/.test(line)) lot = 'SEM';
  else if (/^SOBRA/.test(line)) lot = null;

  const m = line.match(/^#([\d-]+)\t/);
  if (m && lot) {
    orders.push({
      id: `#${m[1]}`,
      size: line.split('\t')[3],
      lot,
      line,
    });
  }
}

const saleOrders = orders.filter((o) => o.lot !== 'SEM');
const semOrders = orders.filter((o) => o.lot === 'SEM');

// --- 1) ESTOQUE vs LISTA ---
console.log('═══════════════════════════════════════');
console.log(' PROVA REAL — separacao_vermelhas_por_lote.txt');
console.log('═══════════════════════════════════════\n');

console.log('▶ TESTE 1: Tamanhos vs capacidade do estoque\n');

let stockOk = true;
for (const l of LOTS) {
  const used = { P: 0, M: 0, G: 0, GG: 0, XG: 0, total: 0 };
  saleOrders.filter((o) => o.lot === l.key).forEach((o) => {
    used[o.size]++;
    used.total++;
  });

  const problems = [];
  Object.keys(l.cap).forEach((s) => {
    if (used[s] > l.cap[s]) problems.push(`${s}: ${used[s]} usadas > ${l.cap[s]} cap.`);
  });

  const headerLine = lines.find((ln) => ln.startsWith('Total do lote usado') && lines.indexOf(ln) > lines.findIndex((x) => x.includes(l.name.split(' ')[0])));
  console.log(`${l.name}: ${used.total} peças | P${used.P} M${used.M} G${used.G} GG${used.GG} XG${used.XG || 0}`);
  console.log(`  Capacidade: P${l.cap.P} M${l.cap.M} G${l.cap.G} GG${l.cap.GG}${l.cap.XG ? ` XG${l.cap.XG}` : ''}`);

  if (problems.length) {
    stockOk = false;
    problems.forEach((p) => console.log(`  ❌ ${p}`));
  } else {
    console.log('  ✅ Nenhum tamanho estoura a capacidade');
  }

  const sobra = {};
  Object.keys(l.cap).forEach((s) => {
    sobra[s] = l.cap[s] - (used[s] || 0);
  });
  console.log(`  Sobra: ${Object.entries(sobra).filter(([, v]) => v).map(([s, v]) => `${s}:${v}`).join(' ') || '0'}`);
  console.log('');
}

const totalCap = LOTS.reduce((s, l) => s + Object.values(l.cap).reduce((a, b) => a + b, 0), 0);
const totalUsed = saleOrders.length;
const totalSem = semOrders.length;
console.log(`Total vendido nos lotes: ${totalUsed}`);
console.log(`Total sem estoque: ${totalSem}`);
console.log(`Capacidade total: ${totalCap} | Demanda: ${totalUsed + totalSem}`);
console.log(totalUsed + totalSem <= totalCap ? '✅ Demanda cabe no estoque total (+ faltantes)\n' : '❌ Demanda excede estoque total\n');

// --- 2) ORDEM DE COMPRA ---
console.log('▶ TESTE 2: Ordem de compra (menor → maior pedido)\n');
console.log('Regra: só vai pro próximo lote quando o tamanho acabou no lote anterior.');
console.log('Exceção permitida: pedido multi-peça inteiro no mesmo lote.\n');

const groups = new Map();
saleOrders.forEach((o) => {
  const base = baseId(o.id);
  if (!groups.has(base)) groups.set(base, []);
  groups.get(base).push(o);
});
groups.forEach((arr) => arr.sort((a, b) => sortKey(a.id) - sortKey(b.id)));

function sizeNeeds(group) {
  const need = {};
  group.forEach((o) => {
    need[o.size] = (need[o.size] || 0) + 1;
  });
  return need;
}

function freshRem() {
  return LOTS.map((l) => ({ key: l.key, left: { ...l.cap } }));
}

function canFit(rem, lotKey, need) {
  const lot = rem.find((l) => l.key === lotKey);
  return Object.entries(need).every(([s, n]) => (lot.left[s] || 0) >= n);
}

function consume(rem, lotKey, need) {
  const lot = rem.find((l) => l.key === lotKey);
  Object.entries(need).forEach(([s, n]) => {
    lot.left[s] -= n;
  });
}

function expectedLot(rem, need) {
  for (const l of rem) {
    if (canFit(rem, l.key, need)) return l.key;
  }
  return null;
}

const processed = new Set();
const groupOrder = [];
for (const o of [...saleOrders].sort((a, b) => sortKey(a.id) - sortKey(b.id))) {
  const base = baseId(o.id);
  if (processed.has(base)) continue;
  processed.add(base);
  groupOrder.push({ base, group: groups.get(base) });
}

const rem = freshRem();
const orderViolations = [];
const expectedAssign = new Map();

groupOrder.forEach(({ base, group }) => {
  const need = sizeNeeds(group);
  const exp = expectedLot(rem, need);
  const actual = group[0].lot;
  group.forEach((o) => expectedAssign.set(o.id, exp));

  if (exp !== actual) {
    orderViolations.push({
      base,
      ids: group.map((o) => o.id).join(', '),
      sizes: group.map((o) => `${o.id} ${o.size}`).join(' | '),
      expected: keyToName[exp] || exp,
      actual: keyToName[actual] || actual,
      need,
    });
  }
  if (exp) consume(rem, exp, need);
});

// Inversões: pedido antigo em lote posterior vs pedido novo em lote anterior (mesmo tamanho)
const inversions = [];
['P', 'M', 'G', 'GG', 'XG'].forEach((size) => {
  const list = saleOrders.filter((o) => o.size === size);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const older = list[i];
      const newer = list[j];
      if (sortKey(older.id) >= sortKey(newer.id)) continue;
      if (lotIdx[older.lot] > lotIdx[newer.lot]) {
        inversions.push({
          size,
          older: `${older.id} (${keyToName[older.lot]})`,
          newer: `${newer.id} (${keyToName[newer.lot]})`,
        });
      }
    }
  }
});

// Multi-peça dividida
const splitGroups = [...groups.entries()].filter(([, g]) => new Set(g.map((o) => o.lot)).size > 1);

console.log(`Grupos processados: ${groupOrder.length}`);
console.log(`Batem com regra estrita: ${groupOrder.length - orderViolations.length}/${groupOrder.length}`);
console.log(`Inversões de ordem (mesmo tamanho): ${inversions.length}`);
console.log(`Pedidos multi-peça em lotes diferentes: ${splitGroups.length}\n`);

if (orderViolations.length === 0 && inversions.length === 0 && splitGroups.length === 0) {
  console.log('✅ ORDEM: planilha 100% conforme a regra.\n');
} else {
  if (orderViolations.length) {
    console.log(`❌ ${orderViolations.length} grupo(s) em lote diferente do esperado pela regra:\n`);
    orderViolations.slice(0, 25).forEach((v) => {
      console.log(`  #${v.base}: ${v.sizes}`);
      console.log(`    Planilha: ${v.actual} | Regra estrita: ${v.expected}\n`);
    });
    if (orderViolations.length > 25) console.log(`  ... +${orderViolations.length - 25} casos\n`);
  }
  if (inversions.length) {
    console.log(`❌ ${inversions.length} inversão(ões) — pedido antigo atrás do novo:\n`);
    inversions.slice(0, 15).forEach((v) => {
      console.log(`  ${v.size}: ${v.older} vem ANTES de ${v.newer}, mas está em lote posterior`);
    });
    if (inversions.length > 15) console.log(`  ... +${inversions.length - 15} casos\n`);
  }
  if (splitGroups.length) {
    console.log('❌ Pedidos multi-peça divididos:');
    splitGroups.forEach(([b, g]) => console.log(`  #${b}: ${g.map((o) => `${o.id}→${o.lot}`).join(', ')}`));
  }
}

// --- 3) Cabeçalho vs contagem ---
console.log('\n▶ TESTE 3: Totais do cabeçalho batem com as linhas?\n');
let headerOk = true;
for (const l of LOTS) {
  const used = { P: 0, M: 0, G: 0, GG: 0, XG: 0, total: 0 };
  saleOrders.filter((o) => o.lot === l.key).forEach((o) => {
    used[o.size]++;
    used.total++;
  });
  const sectionStart = lines.findIndex((ln) => ln.includes(l.name === 'Alba Fedex 03' ? 'Alba - Fedex 03' : l.name));
  const totalLine = lines.slice(sectionStart, sectionStart + 5).find((ln) => ln.startsWith('Total do lote usado'));
  const match = totalLine && totalLine.includes(` ${used.total} peças`);
  if (!match) {
    headerOk = false;
    console.log(`❌ ${l.name}: cabeçalho não bate (contado ${used.total})`);
  } else {
    console.log(`✅ ${l.name}: ${used.total} peças — cabeçalho OK`);
  }
}

console.log('\n═══════════════════════════════════════');
const allOk = stockOk && orderViolations.length === 0 && inversions.length === 0 && splitGroups.length === 0 && headerOk;
console.log(allOk ? ' RESULTADO FINAL: ✅ APROVADO' : ' RESULTADO FINAL: ❌ COM RESSALVAS (ver acima)');
console.log('═══════════════════════════════════════');
