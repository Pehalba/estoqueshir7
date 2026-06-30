/**
 * Filas de personalização (dados estáticos, sem vínculo com vendas).
 * Edite os arrays abaixo quando chegarem novos pedidos.
 *
 * Formato:
 * { orderId: '#1234', size: 'G', sizeLabel: 'G (L)', name: 'NOME', number: '10', productId: 'br-home-amarela' }
 *
 * productId opcional se a fila tiver productId padrão.
 * Pedidos com 2 peças: #1234 e #1234-2
 */

const IMG = {
  amarela: '../src/assets/images/products/brasil-home-amarela-jogador-2026.png',
  azulJogador: '../src/assets/images/products/brasil-away-azul-jogador-ii-2026.png',
  azulTorcedor: '../src/assets/images/products/brasil-torcedor-ii-azul-preta-2026.png',
  retro2002: '../src/assets/images/products/brasil-retro-2002-penta.png',
  retro98: '../src/assets/images/products/brasil-retro-98-amarela.png',
  vermelha: '../src/assets/images/products/brasil-torcedor-vermelha-copa-2026.png',
};

const FONT_IMG = '../src/assets/images/personalization/fonts';

/** @param {string} slug @param {string} label @param {{ hint?: string }} [options] */
function createFontGuide(slug, label, options = {}) {
  const hint = options.hint ?? 'Personalização na frente (nome) e atrás (número).';
  return {
    title: `Fonte — ${label}`,
    hint,
    images: [
      { label: 'Alfabeto e números', src: `${FONT_IMG}/${slug}.png` },
    ],
  };
}

export const PRODUCTS = {
  'br-home-amarela': {
    id: 'br-home-amarela',
    label: 'Amarela jogador',
    productName: 'Camisa Jogador Seleção Brasileira Amarela Copa do mundo home 2026/2027',
    imageUrl: IMG.amarela,
    accent: 'yellow',
    kitType: 'jogador',
    fontGuide: {
      title: 'Fonte — Amarela jogador',
      hint: 'Personalização na frente (nome) e atrás (número).',
      images: [
        { label: 'Alfabeto e números', src: `${FONT_IMG}/amarela-jogador.png` },
      ],
    },
  },
  'br-away-azul': {
    id: 'br-away-azul',
    label: 'Azul jogador',
    productName: 'Camisa Jogador Seleção Brasileira Azul Copa do mundo away II 2026/2027',
    imageUrl: IMG.azulJogador,
    accent: 'blue',
    kitType: 'jogador',
    fontGuide: createFontGuide('azul-jogador', 'Azul jogador'),
  },
  'br-retro-2002': {
    id: 'br-retro-2002',
    label: 'Retro 02',
    productName: 'Camisa Brasil retro 2002 amarela penta campeão',
    imageUrl: IMG.retro2002,
    accent: 'yellow',
    kitType: 'retro',
    persSides: 'frente e atrás',
    fontGuide: createFontGuide('retro-02', 'Retro 02'),
  },
  'br-retro-98': {
    id: 'br-retro-98',
    label: 'Retro 98',
    productName: 'Camisa Brasil Retrô 98 Amarela',
    imageUrl: IMG.retro98,
    accent: 'yellow',
    kitType: 'retro',
    persSides: 'frente e atrás',
    fontGuide: createFontGuide('retro-98', 'Retro 98'),
  },
  'br-tor-ii': {
    id: 'br-tor-ii',
    label: 'Azul torcedor',
    productName: 'Camisa Torcedor Brasil II COPA 2026 Masculina - Azul e Preta',
    imageUrl: IMG.azulTorcedor,
    accent: 'blue',
    kitType: 'torcedor',
    fontGuide: createFontGuide('azul-torcedor', 'Azul torcedor'),
  },
  'br-tor-vermelha': {
    id: 'br-tor-vermelha',
    label: 'Vermelha torcedor',
    productName: 'Camisa Torcedor Brasil - Vermelha - Copa 2026',
    imageUrl: IMG.vermelha,
    accent: 'purple',
    kitType: 'torcedor',
    fontGuide: createFontGuide('vermelha', 'Vermelha'),
  },
};

/** @typedef {{ orderId: string, size: string, sizeLabel: string, name: string, number: string, productId?: string, placeholder?: boolean }} PersItem */

/** Pedidos com personalização — jun/2026 (Yampi). */
/** @type {PersItem[]} */
const PERS_JUN_2026_ITEMS = [
  // #1687 — azul P + amarela P
  { orderId: '#1687', size: 'P', sizeLabel: 'P (S)', name: 'Vini jr.', number: '7', productId: 'br-away-azul' },
  { orderId: '#1687-2', size: 'P', sizeLabel: 'P (S)', name: 'Neymar jr.', number: '10', productId: 'br-home-amarela' },
  // #1688
  { orderId: '#1688', size: 'M', sizeLabel: 'M (M)', name: 'Neymar Jr', number: '10', productId: 'br-home-amarela' },
  // #1689 — 2× amarela P
  { orderId: '#1689', size: 'P', sizeLabel: 'P (S)', name: 'Neymar Jr', number: '10', productId: 'br-home-amarela' },
  { orderId: '#1689-2', size: 'P', sizeLabel: 'P (S)', name: 'Neymar Jr', number: '10', productId: 'br-home-amarela' },
  // #1691 — retro 2002 GG
  { orderId: '#1691', size: 'GG', sizeLabel: 'GG (XL)', name: 'Ronaldo', number: '9', productId: 'br-retro-2002' },
  // #1692 — torcedor II (nº inferido; confira no Yampi se diferente)
  { orderId: '#1692', size: 'P', sizeLabel: 'P (S)', name: 'Rafael', number: '10', productId: 'br-tor-ii' },
  // #1695 — azul M
  { orderId: '#1695', size: 'M', sizeLabel: 'M (M)', name: 'VINI JR.', number: '7', productId: 'br-away-azul' },
  // #1698
  { orderId: '#1698', size: 'M', sizeLabel: 'M (M)', name: 'Neymar Jr', number: '10', productId: 'br-home-amarela' },
  // #1701 — retro 2002 G (só a peça com personalização)
  { orderId: '#1701', size: 'G', sizeLabel: 'G (L)', name: 'RONALDINHO', number: '11', productId: 'br-retro-2002' },
  // #1706 — azul jogador P
  { orderId: '#1706', size: 'P', sizeLabel: 'P (S)', name: 'Nina', number: '27', productId: 'br-away-azul' },
  // Retro 98 — avulso (informe o # do pedido quando tiver)
  { orderId: '#RETRO98', size: 'G', sizeLabel: 'G (L)', name: 'Ronaldo', number: '9', productId: 'br-retro-98' },
];

export const QUEUES = [
  {
    id: 'pers-jun-2026',
    title: 'Personalização — jun/2026',
    productId: 'br-home-amarela',
    items: PERS_JUN_2026_ITEMS,
  },
];

export const ALL_ITEMS = QUEUES.flatMap((queue) =>
  queue.items.map((item) => {
    const productId = item.productId || queue.productId;
    const product = PRODUCTS[productId] || PRODUCTS['br-home-amarela'];
    return {
      ...item,
      queueId: queue.id,
      queueTitle: queue.title,
      productId,
      productLabel: product.label,
      productName: item.productName || product.productName,
      imageUrl: item.imageUrl || product.imageUrl,
      productAccent: product.accent,
      kitType: product.kitType || 'jogador',
      persSides: product.persSides || '',
      fontGuide: product.fontGuide || null,
    };
  }),
);

/** Compatibilidade */
export const LOT = QUEUES[0];
export const ITEMS = ALL_ITEMS;
