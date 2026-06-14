const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../separacao_vermelhas_por_lote.txt');
const text = fs.readFileSync(filePath, 'utf8');

const lineById = new Map();
for (const line of text.split(/\n/)) {
  const m = line.match(/^#([\d-]+)\t/);
  if (m) lineById.set(`#${m[1]}`, line);
}

const LOTS = [
  { key: 'Alba Fedex 03', cap: { P: 10, M: 30, G: 35, GG: 20, XG: 5 } },
  { key: 'Fedex 04', cap: { P: 10, M: 20, G: 25, GG: 20, XG: 5 } },
  { key: 'Fedex 05', cap: { P: 15, M: 25, G: 20, GG: 18, XG: 0 } },
  { key: 'LZ vermelhas', cap: { P: 26, M: 12, G: 4, GG: 4, XG: 8 } },
];

const SEM_IDS = [
  '#1376', '#1397', '#1439', '#1453', '#1468', '#1472', '#1481', '#1484', '#1502',
];

/** Pedidos já enviados do Alba Fedex 03 — ficam fixos nesse lote. */
const PINNED_F03 = new Set([
  '#1153',
  '#1166', '#1167', '#1168', '#1173', '#1175',
  '#1177', '#1177-2', '#1178', '#1179',
  '#1181', '#1182', '#1182-2', '#1187', '#1189', '#1190',
  '#1197', '#1198', '#1202', '#1203',
  '#1210', '#1219', '#1221', '#1223', '#1224', '#1224-2', '#1225', '#1226',
  '#1234', '#1242', '#1249', '#1250', '#1250-2', '#1251', '#1252', '#1255', '#1256',
  '#1260', '#1263', '#1263-2',
]);

function sortKey(id) {
  const raw = id.replace(/^#/, '');
  const [a, b] = raw.split('-');
  return Number(a) * 100 + (b ? Number(b) : 0);
}

function baseId(id) {
  return id.replace(/^#/, '').replace(/-\d+$/, '');
}

function parseSize(id) {
  return lineById.get(id).split('\t')[3];
}

function freshRem() {
  return LOTS.map((l) => ({ key: l.key, left: { ...l.cap } }));
}

function sizeNeeds(ids) {
  const need = {};
  ids.forEach((id) => {
    const s = parseSize(id);
    need[s] = (need[s] || 0) + 1;
  });
  return need;
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

function rebuildRem(currentAssign) {
  const next = freshRem();
  saleIds.forEach((id) => {
    const lot = currentAssign.get(id);
    if (!lot || lot === 'SEM ESTOQUE') return;
    const s = parseSize(id);
    next.find((l) => l.key === lot).left[s]--;
  });
  return next;
}

function firstLotForNeed(rem, need) {
  for (const lot of rem) {
    if (canFit(rem, lot.key, need)) return lot.key;
  }
  return null;
}

function bumpNewestFromLot(currentAssign, fromLotKey, size, beforeKey) {
  const fromIdx = LOTS.findIndex((l) => l.key === fromLotKey);
  const candidates = saleIds
    .filter((id) => {
      if (currentAssign.get(id) !== fromLotKey) return false;
      if (PINNED_F03.has(id)) return false;
      if (sortKey(id) >= beforeKey) return false;
      return parseSize(id) === size;
    })
    .sort((a, b) => sortKey(b) - sortKey(a));

  const seen = new Set();
  for (const id of candidates) {
    const base = baseId(id);
    if (seen.has(base)) continue;
    seen.add(base);

    const groupIds = groups.get(base);
    const need = sizeNeeds(groupIds);

    for (let i = fromIdx + 1; i < LOTS.length; i++) {
      const dest = LOTS[i].key;
      const rem = rebuildRem(currentAssign);
      if (groupIds.every((gid) => currentAssign.get(gid) === fromLotKey)) {
        groupIds.forEach((gid) => {
          rem.find((l) => l.key === fromLotKey).left[parseSize(gid)]++;
        });
      }
      if (canFit(rem, dest, need)) {
        groupIds.forEach((gid) => currentAssign.set(gid, dest));
        return true;
      }
    }
  }
  return false;
}

function makeRoomInLot(currentAssign, lotKey, need, beforeKey) {
  let guard = 0;
  while (!canFit(rebuildRem(currentAssign), lotKey, need)) {
    if (guard++ > 300) return false;
    const rem = rebuildRem(currentAssign);
    const lot = rem.find((l) => l.key === lotKey);
    const lacking = Object.entries(need).find(([s, n]) => (lot.left[s] || 0) < n);
    if (!lacking) break;
    const moved = bumpNewestFromLot(currentAssign, lotKey, lacking[0], beforeKey);
    if (!moved) return false;
  }
  return canFit(rebuildRem(currentAssign), lotKey, need);
}

function makeRoomInF03(currentAssign, need, beforeKey) {
  if (!makeRoomInLot(currentAssign, 'Alba Fedex 03', need, beforeKey)) {
    throw new Error(`Nao foi possivel abrir espaco no Alba Fedex 03 antes de #${beforeKey / 100}`);
  }
}

function placeGroup(currentAssign, groupIds, beforeKey) {
  const need = sizeNeeds(groupIds);
  const direct = firstLotForNeed(rebuildRem(currentAssign), need);
  if (direct) {
    groupIds.forEach((gid) => currentAssign.set(gid, direct));
    return direct;
  }
  for (const lot of LOTS) {
    const draft = new Map(currentAssign);
    if (!makeRoomInLot(draft, lot.key, need, beforeKey)) continue;
    groupIds.forEach((gid) => draft.set(gid, lot.key));
    draft.forEach((value, key) => currentAssign.set(key, value));
    return lot.key;
  }
  return null;
}

const saleIds = [...lineById.keys()]
  .filter((id) => !SEM_IDS.includes(id))
  .sort((a, b) => sortKey(a) - sortKey(b));

const groups = new Map();
saleIds.forEach((id) => {
  const base = baseId(id);
  if (!groups.has(base)) groups.set(base, []);
  groups.get(base).push(id);
});
groups.forEach((ids) => ids.sort((a, b) => sortKey(a) - sortKey(b)));

const assign = new Map();
SEM_IDS.forEach((id) => assign.set(id, 'SEM ESTOQUE'));

let rem = freshRem();
const processed = new Set();

for (const id of saleIds) {
  const base = baseId(id);
  if (processed.has(base)) continue;
  processed.add(base);

  rem = rebuildRem(assign);
  const groupIds = groups.get(base);
  const need = sizeNeeds(groupIds);
  const forceF03 = groupIds.some((gid) => PINNED_F03.has(gid));

  const beforeKey = sortKey(groupIds[0]);
  let lot;
  if (forceF03) {
    makeRoomInF03(assign, need, beforeKey);
    groupIds.forEach((gid) => assign.set(gid, 'Alba Fedex 03'));
    lot = 'Alba Fedex 03';
  } else {
    lot = placeGroup(assign, groupIds, beforeKey);
    if (!lot) throw new Error(`Sem estoque para grupo #${base}`);
  }

  rem = rebuildRem(assign);
}

function countLot(key) {
  const c = { P: 0, M: 0, G: 0, GG: 0, XG: 0, total: 0 };
  [...assign.entries()]
    .filter(([, l]) => l === key)
    .forEach(([id]) => {
      const s = parseSize(id);
      c[s]++;
      c.total++;
    });
  return c;
}

const sections = [
  {
    key: 'Alba Fedex 03',
    header: (c) => [
      'Alba - Fedex 03',
      `Capacidade: 100 peças | P: 10 | M: 30 | G: 35 | GG: 20 | XG: 5`,
      `Total do lote usado: ${c.total} peças | P: ${c.P} | M: ${c.M} | G: ${c.G} | GG: ${c.GG} | XG: ${c.XG}`,
    ],
  },
  {
    key: 'Fedex 04',
    header: (c) => [
      'Fedex 04',
      `Capacidade: 80 peças | P: 10 | M: 20 | G: 25 | GG: 20 | XG: 5`,
      `Total do lote usado: ${c.total} peças | P: ${c.P} | M: ${c.M} | G: ${c.G} | GG: ${c.GG} | XG: ${c.XG}`,
    ],
  },
  {
    key: 'Fedex 05',
    header: (c) => [
      'Fedex 05',
      `Capacidade: 78 peças | P: 15 | M: 25 | G: 20 | GG: 18 | XG: 0`,
      `Total do lote usado: ${c.total} peças | P: ${c.P} | M: ${c.M} | G: ${c.G} | GG: ${c.GG}`,
    ],
  },
  {
    key: 'LZ vermelhas',
    header: (c) => [
      'LZ vermelhas',
      `Capacidade: 54 peças | P: 26 | M: 12 | G: 4 | GG: 4 | XG: 8`,
      `Total do lote usado: ${c.total} peças | P: ${c.P} | M: ${c.M} | XG: ${c.XG}`,
    ],
  },
];

const out = [
  'SEPARAÇÃO CAMISAS VERMELHAS POR LOTE',
  'Ordem usada: Alba - Fedex 03 > Fedex 04 > Fedex 05 > LZ vermelhas',
  'Regra: esgota cada lote (por tamanho) antes de usar o próximo.',
  'Pedidos multi-peça ficam no mesmo lote. Pedidos já enviados do Alba Fedex 03 permanecem fixos nele.',
  'Tamanho XGG da planilha = XG no estoque.',
  '',
];

sections.forEach((sec) => {
  const c = countLot(sec.key);
  out.push(...sec.header(c));
  saleIds
    .filter((id) => assign.get(id) === sec.key)
    .forEach((id) => out.push(lineById.get(id)));
  out.push('');
});

const semC = countLot('SEM ESTOQUE');
out.push('SEM ESTOQUE / FALTANTES');
out.push(`Total faltante: ${semC.total} peças | P: ${semC.P} | XG: ${semC.XG}`);
SEM_IDS.sort((a, b) => sortKey(a) - sortKey(b)).forEach((id) => out.push(lineById.get(id)));
out.push('');
out.push('SOBRA APÓS ABATER AS VENDAS');

const finalRem = freshRem();
sections.forEach((sec) => {
  const used = countLot(sec.key);
  const cap = LOTS.find((l) => l.key === sec.key).cap;
  const left = {};
  let totalLeft = 0;
  Object.keys(cap).forEach((s) => {
    left[s] = cap[s] - (used[s] || 0);
    totalLeft += left[s];
  });
  const parts = Object.keys(cap).map((s) => `${s}: ${left[s]}`);
  out.push(`${sec.key === 'Alba Fedex 03' ? 'Alba - Fedex 03' : sec.key}: ${parts.join(' | ')} | Total ${totalLeft}`);
});
out.push('');

fs.writeFileSync(filePath, out.join('\n'), 'utf8');

const byBase = new Map();
for (const [id, l] of assign) {
  if (l === 'SEM ESTOQUE') continue;
  const base = baseId(id);
  if (!byBase.has(base)) byBase.set(base, new Set());
  byBase.get(base).add(l);
}
const splits = [...byBase.entries()].filter(([, s]) => s.size > 1);

console.log('Pedidos divididos entre lotes:', splits.length);
sections.forEach((sec) => console.log(sec.key + ':', countLot(sec.key).total));

const pinnedMissing = [...PINNED_F03].filter((id) => assign.get(id) !== 'Alba Fedex 03');
console.log('Fixos F03 fora do lugar:', pinnedMissing.length, pinnedMissing.join(', '));
