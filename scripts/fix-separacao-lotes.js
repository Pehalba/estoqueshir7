const fs = require('fs');
const path = 'c:/Users/PC Pedro Alba/Desktop/Programação/Gerenciados de estoque SHIR7/separacao_vermelhas_por_lote.txt';
const upload = fs.readFileSync(
  'C:/Users/PC Pedro Alba/.cursor/projects/c-Users-PC-Pedro-Alba-Desktop-Programa-o-Gerenciados-de-estoque-SHIR7/uploads/c__Users_PC_Pedro_Alba_Desktop_Programa__o_Gerenciados_de_estoque_SHIR7_separacao_vermelhas_por_lote-L1-L304-0.txt',
  'utf8',
);

const lineById = new Map();
for (const line of upload.split(/\r?\n/)) {
  const m = line.match(/^#([\d-]+)\t/);
  if (m) lineById.set(`#${m[1]}`, line);
}

const overrides = {
  '#1275': '#1275\t03/06/2026\tVermelha\tG\t1\tSem personalização\tSim\tR$ 229,90\tR$ 196,57',
  '#1275-2': '#1275-2\t03/06/2026\tVermelha\tG\t1\tSem personalização\tSim\tR$ 229,90\tR$ 196,57',
  '#1275-3': '#1275-3\t03/06/2026\tVermelha\tGG\t1\tSem personalização\tSim\tR$ 229,90\tR$ 196,57',
  '#1288-2': '#1288-2\t04/06/2026\tVermelha\tM\t1\tCom personalização\tSim\tR$ 279,90\tR$ 244,81',
  '#1288-3': '#1288-3\t04/06/2026\tVermelha\tM\t1\tCom personalização\tSim\tR$ 279,90\tR$ 244,81',
  '#1294': '#1294\t04/06/2026\tVermelha\tP\t1\tCom personalização\tSim\tR$ 279,90\tR$ 254,90',
  '#1294-2': '#1294-2\t04/06/2026\tVermelha\tP\t1\tCom personalização\tSim\tR$ 279,90\tR$ 254,90',
  '#1403': '#1403\t07/06/2026\tVermelha\tGG\t1\tCom personalização\tSim\tR$ 279,90\tR$ 237,05',
  '#1403-2': '#1403-2\t07/06/2026\tVermelha\tGG\t1\tCom personalização\tSim\tR$ 279,90\tR$ 237,05',
  '#1431': '#1431\t08/06/2026\tVermelha\tM\t1\tSem personalização\tSim\tR$ 229,90\tR$ 190,56',
  '#1431-2': '#1431-2\t08/06/2026\tVermelha\tM\t1\tSem personalização\tSim\tR$ 229,90\tR$ 190,56',
  '#1450': '#1450\t09/06/2026\tVermelha\tM\t1\tSem personalização\tSim\tR$ 229,90\tR$ 204,90',
  '#1450-2': '#1450-2\t09/06/2026\tVermelha\tM\t1\tSem personalização\tSim\tR$ 229,90\tR$ 204,90',
  '#1492': '#1492\t11/06/2026\tVermelha\tG\t1\tCom personalização\tSim\tR$ 279,90\tR$ 246,57',
  '#1492-2': '#1492-2\t11/06/2026\tVermelha\tG\t1\tCom personalização\tSim\tR$ 279,90\tR$ 246,57',
  '#1492-3': '#1492-3\t11/06/2026\tVermelha\tM\t1\tCom personalização\tSim\tR$ 279,90\tR$ 246,57',
  '#1206-2': '#1206-2\t31/05/2026\tVermelha\tP\t1\tCom personalização\tSim\tR$ 279,90\tR$ 237,05',
  '#1250-2': '#1250-2\t02/06/2026\tVermelha\tP\t1\tSem personalização\tSim\tR$ 229,90\tR$ 204,90',
  '#1377-2': '#1377-2\t07/06/2026\tVermelha\tM\t1\tCom personalização\tSim\tR$ 279,90\tR$ 254,90',
  '#1464-2': '#1464-2\t10/06/2026\tVermelha\tP\t1\tCom personalização\tSim\tR$ 279,90\tR$ 252,45',
  '#1487-2': '#1487-2\t11/06/2026\tVermelha\tP\t1\tSem personalização\tSim\tR$ 229,90\tR$ 204,90',
  '#1497-2': '#1497-2\t11/06/2026\tVermelha\tM\t1\tSem personalização\tSim\tR$ 229,90\tR$ 204,90',
  '#1493-2': '#1493-2\t11/06/2026\tVermelha\tP\t1\tSem personalização\tSim\tR$ 229,90\tR$ 204,90',
};
Object.entries(overrides).forEach(([id, line]) => lineById.set(id, line));

function sortKey(id) {
  const raw = id.replace(/^#/, '');
  const [a, b] = raw.split('-');
  return Number(a) * 100 + (b ? Number(b) : 0);
}

const assign = new Map();
let lot = '';
for (const line of upload.split(/\r?\n/)) {
  if (/^Alba - Fedex 03/.test(line)) lot = 'Alba Fedex 03';
  else if (/^Fedex 04/.test(line)) lot = 'Fedex 04';
  else if (/^Fedex 05/.test(line)) lot = 'Fedex 05';
  else if (/^LZ vermelhas/.test(line)) lot = 'LZ vermelhas';
  else if (/^SEM ESTOQUE/.test(line)) lot = 'SEM ESTOQUE';
  const m = line.match(/^#([\d-]+)\t/);
  if (m && lot) assign.set(`#${m[1]}`, lot);
}

// Linhas extras criadas ao dividir quantidade > 1
['#1288-3', '#1294-2', '#1403-2', '#1431-2', '#1450-2', '#1275-3'].forEach((id) => {
  if (!assign.has(id)) assign.set(id, assign.get(id.replace(/-3$/, '-2').replace(/-2$/, '')) || 'Fedex 04');
});
assign.set('#1288-3', 'Alba Fedex 03');
assign.set('#1294-2', 'Fedex 04');
assign.set('#1403-2', 'Fedex 04');
assign.set('#1431-2', 'Fedex 05');
assign.set('#1450-2', 'Fedex 05');

// #1275: 3 peças no Alba Fedex 03; #1273 vai para Fedex 04
assign.set('#1275', 'Alba Fedex 03');
assign.set('#1275-2', 'Alba Fedex 03');
assign.set('#1275-3', 'Alba Fedex 03');
assign.set('#1273', 'Fedex 04');

// Consolidar pedidos no lote da peça principal
[
  ['#1206-2', 'Alba Fedex 03'],
  ['#1250-2', 'Alba Fedex 03'],
  ['#1288-2', 'Alba Fedex 03'],
  ['#1288-3', 'Alba Fedex 03'],
  ['#1377-2', 'Fedex 04'],
  ['#1464-2', 'Fedex 04'],
  ['#1487-2', 'Fedex 04'],
  ['#1492-3', 'Fedex 04'],
  ['#1497-2', 'Fedex 04'],
  ['#1493-2', 'Fedex 05'],
].forEach(([id, l]) => assign.set(id, l));

assign.set('#1492', 'Fedex 04');
assign.set('#1492-2', 'Fedex 04');
assign.set('#1492-3', 'Fedex 04');

// Trocas para equilibrar lotes (mesmo tamanho)
// #1153, #1168, #1173, #1178 ficam no Alba Fedex 03 (enviados de la).
// Compensacao no Fedex 04: #1175, #1198, #1274, #1276
[
  ['#1175', 'Fedex 04'],
  ['#1198', 'Fedex 04'],
  ['#1274', 'Fedex 04'],
  ['#1276', 'Fedex 04'],
  ['#1293', 'Fedex 05'],
  ['#1205', 'LZ vermelhas'],
  ['#1213', 'LZ vermelhas'],
  ['#1295', 'LZ vermelhas'],
  ['#1300', 'LZ vermelhas'],
  ['#1317', 'LZ vermelhas'],
].forEach(([id, l]) => assign.set(id, l));

assign.set('#1177-2', 'Alba Fedex 03');

const sections = [
  {
    key: 'Alba Fedex 03',
    header: [
      'Alba - Fedex 03',
      'Capacidade: 100 peças | P: 10 | M: 30 | G: 35 | GG: 20 | XG: 5',
      'Total do lote usado: 100 peças | P: 10 | M: 30 | G: 35 | GG: 20 | XG: 5',
    ],
  },
  {
    key: 'Fedex 04',
    header: [
      'Fedex 04',
      'Capacidade: 80 peças | P: 10 | M: 20 | G: 25 | GG: 20 | XG: 5',
      'Total do lote usado: 80 peças | P: 10 | M: 20 | G: 25 | GG: 20 | XG: 5',
    ],
  },
  {
    key: 'Fedex 05',
    header: [
      'Fedex 05',
      'Capacidade: 78 peças | P: 15 | M: 25 | G: 20 | GG: 18 | XG: 0',
      'Total do lote usado: 51 peças | P: 15 | M: 25 | G: 2 | GG: 9',
    ],
  },
  {
    key: 'LZ vermelhas',
    header: [
      'LZ vermelhas',
      'Capacidade: 54 peças | P: 26 | M: 12 | G: 4 | GG: 4 | XG: 8',
      'Total do lote usado: 41 peças | P: 26 | M: 7 | XG: 8',
    ],
  },
];

const out = [
  'SEPARAÇÃO CAMISAS VERMELHAS POR LOTE',
  'Ordem usada: Alba - Fedex 03 > Fedex 04 > Fedex 05 > LZ vermelhas',
  'Regra: esgota cada lote (por tamanho) antes de usar o próximo.',
  'Tamanho XGG da planilha = XG no estoque.',
  '',
];

for (const sec of sections) {
  out.push(...sec.header);
  [...assign.entries()]
    .filter(([, l]) => l === sec.key)
    .map(([id]) => id)
    .filter((id) => lineById.has(id))
    .sort((a, b) => sortKey(a) - sortKey(b))
    .forEach((id) => out.push(lineById.get(id)));
  out.push('');
}

out.push('SEM ESTOQUE / FALTANTES');
out.push('Total faltante: 9 peças | P: 1 | XG: 8');
[...assign.entries()]
  .filter(([, l]) => l === 'SEM ESTOQUE')
  .map(([id]) => id)
  .filter((id) => lineById.has(id))
  .sort((a, b) => sortKey(a) - sortKey(b))
  .forEach((id) => out.push(lineById.get(id)));
out.push('');
out.push('SOBRA APÓS ABATER AS VENDAS');
out.push('Alba - Fedex 03: P: 0 | M: 0 | G: 0 | GG: 0 | XG: 0 | Total 0');
out.push('Fedex 04: P: 0 | M: 0 | G: 0 | GG: 0 | XG: 0 | Total 0');
out.push('Fedex 05: P: 0 | M: 0 | G: 18 | GG: 9 | XG: 0 | Total 27');
out.push('LZ vermelhas: P: 0 | M: 5 | G: 4 | GG: 4 | XG: 0 | Total 13');
out.push('');

const byBase = new Map();
for (const [id, l] of assign) {
  if (l === 'SEM ESTOQUE' || !lineById.has(id)) continue;
  const base = id.replace(/^#/, '').replace(/-\d+$/, '');
  if (!byBase.has(base)) byBase.set(base, new Set());
  byBase.get(base).add(l);
}
const splits = [...byBase.entries()].filter(([, s]) => s.size > 1);
console.log('Pedidos ainda divididos:', splits.length);
splits.forEach(([b, s]) => console.log(`#${b}`, [...s].join(' + ')));
sections.forEach((sec) => {
  const n = [...assign.entries()].filter(([id, l]) => l === sec.key && lineById.has(id)).length;
  console.log(`${sec.key}: ${n} peças`);
});

fs.writeFileSync(path, out.join('\n'), 'utf8');
console.log('Arquivo gravado com', out.length, 'linhas');
