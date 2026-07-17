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

/** @typedef {{ orderId: string, size: string, sizeLabel: string, name: string, number: string, productId?: string, placeholder?: boolean, disabled?: boolean, alert?: string, persSides?: string }} PersItem */

/** Pedidos com personalização — jul/2026 (lote vermelhas + 2 amarelas). */
/** @type {PersItem[]} */
const PERS_JUL_2026_ITEMS = [
  // 🔴 Vermelha torcedor
  { orderId: '#1870', size: 'GG', sizeLabel: 'GG (XL)', name: 'Luthiano R. Leite', number: '13', productId: 'br-tor-vermelha', disabled: true },
  { orderId: '#1866', size: 'XG', sizeLabel: 'XGG (XG)', name: 'Lula', number: '13', productId: 'br-tor-vermelha', disabled: true },
  { orderId: '#1758', size: 'P', sizeLabel: 'P (S)', name: 'KARYNI', number: '80', productId: 'br-tor-vermelha' },
  { orderId: '#1743', size: 'GG', sizeLabel: 'GG (XL)', name: 'Rafael', number: '10', productId: 'br-tor-vermelha', disabled: true },
  { orderId: '#1703', size: 'P', sizeLabel: 'P (S)', name: 'Nataly', number: '18', productId: 'br-tor-vermelha' },
  { orderId: '#1693', size: 'GG', sizeLabel: 'GG (XL)', name: 'João', number: '20', productId: 'br-tor-vermelha', disabled: true },
  { orderId: '#1686', size: 'GG', sizeLabel: 'GG (XL)', name: 'Matheus', number: '13', productId: 'br-tor-vermelha', disabled: true },
  { orderId: '#1684', size: 'P', sizeLabel: 'P (S)', name: 'Ana Kappi', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1681', size: 'GG', sizeLabel: 'GG (XL)', name: 'Caio', number: '15', productId: 'br-tor-vermelha', disabled: true },
  { orderId: '#1677', size: 'M', sizeLabel: 'M (M)', name: 'Carlos Brito', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1669', size: 'M', sizeLabel: 'M (M)', name: 'Thiago Tiganá', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1668', size: 'M', sizeLabel: 'M (M)', name: 'MH', number: '7', productId: 'br-tor-vermelha' },
  { orderId: '#1654', size: 'M', sizeLabel: 'M (M)', name: 'QUADROS', number: '9', productId: 'br-tor-vermelha' },
  { orderId: '#1650', size: 'GG', sizeLabel: 'GG (XL)', name: 'ANDRE', number: '12', productId: 'br-tor-vermelha', disabled: true },
  { orderId: '#1639', size: 'M', sizeLabel: 'M (M)', name: 'Alex', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1637', size: 'M', sizeLabel: 'M (M)', name: 'TONY', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1634', size: 'P', sizeLabel: 'P (S)', name: 'Ribeiro', number: '19', productId: 'br-tor-vermelha' },
  { orderId: '#1632', size: 'GG', sizeLabel: 'GG (XL)', name: 'Vitor', number: '13', productId: 'br-tor-vermelha', alert: 'Essa camisa é um pouco mais clara que as outras. Tem um bilhete na embalagem com o nome e o número.' },
  { orderId: '#1631', size: 'G', sizeLabel: 'G (L)', name: 'Pedro Plotz', number: '', productId: 'br-tor-vermelha' },
  { orderId: '#1629', size: 'GG', sizeLabel: 'GG (XL)', name: 'MARTA', number: '10', productId: 'br-tor-vermelha', disabled: true },
  { orderId: '#1620', size: 'G', sizeLabel: 'G (L)', name: '', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1618', size: 'GG', sizeLabel: 'GG (XL)', name: 'COELHO', number: '21', productId: 'br-tor-vermelha', disabled: true },
  { orderId: '#1614', size: 'GG', sizeLabel: 'GG (XL)', name: 'F A R i A S', number: '13', productId: 'br-tor-vermelha', disabled: true },
  { orderId: '#1612', size: 'GG', sizeLabel: 'GG (XL)', name: 'Ribas', number: '08', productId: 'br-tor-vermelha' },
  { orderId: '#1607', size: 'GG', sizeLabel: 'GG (XL)', name: 'Beto', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1597', size: 'G', sizeLabel: 'G (L)', name: 'Luciano Lima', number: '18', productId: 'br-tor-vermelha' },
  { orderId: '#1591', size: 'M', sizeLabel: 'M (M)', name: 'Vitor', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1579', size: 'M', sizeLabel: 'M (M)', name: '', number: '10', productId: 'br-tor-vermelha' },
  { orderId: '#1577', size: 'GG', sizeLabel: 'GG (XL)', name: 'Castro', number: '10', productId: 'br-tor-vermelha' },
  { orderId: '#1570', size: 'G', sizeLabel: 'G (L)', name: 'VINI JR', number: '7', productId: 'br-tor-vermelha' },
  { orderId: '#1568', size: 'G', sizeLabel: 'G (L)', name: 'Diego', number: '24', productId: 'br-tor-vermelha' },
  { orderId: '#1567', size: 'G', sizeLabel: 'G (L)', name: 'Flash tattoo', number: '43', productId: 'br-tor-vermelha' },
  { orderId: '#1563', size: 'G', sizeLabel: 'G (L)', name: 'Renato', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1563-2', size: 'M', sizeLabel: 'M (M)', name: 'Vanderlucia', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1561', size: 'G', sizeLabel: 'G (L)', name: 'Melgaço', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1560', size: 'P', sizeLabel: 'P (S)', name: 'Nara Costa', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1556', size: 'G', sizeLabel: 'G (L)', name: 'Barbosa', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1546', size: 'XG', sizeLabel: 'XGG (XG)', name: 'NAVARRESCH', number: '55', productId: 'br-tor-vermelha' },
  { orderId: '#1544', size: 'GG', sizeLabel: 'GG (XL)', name: 'THIAGO', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1540', size: 'G', sizeLabel: 'G (L)', name: 'ELENA', number: '10', productId: 'br-tor-vermelha' },
  { orderId: '#1530', size: 'G', sizeLabel: 'G (L)', name: 'Heloysa', number: '7', productId: 'br-tor-vermelha' },
  { orderId: '#1526', size: 'G', sizeLabel: 'G (L)', name: 'Lacerda', number: '13', productId: 'br-tor-vermelha' },
  { orderId: '#1523', size: 'P', sizeLabel: 'P (S)', name: 'Tony', number: '86', productId: 'br-tor-vermelha' },
  { orderId: '#1520', size: 'P', sizeLabel: 'P (S)', name: 'Rose', number: '9', productId: 'br-tor-vermelha' },
  { orderId: '#1515', size: 'G', sizeLabel: 'G (L)', name: 'Diego Correia', number: '10', productId: 'br-tor-vermelha' },
  { orderId: '#1510', size: 'G', sizeLabel: 'G (L)', name: 'Ederson', number: '10', productId: 'br-tor-vermelha' },
  { orderId: '#1509-2', size: 'P', sizeLabel: 'P (S)', name: 'Anna Thaís', number: '26', productId: 'br-tor-vermelha' },
  { orderId: '#1509', size: 'P', sizeLabel: 'P (S)', name: 'Maria Carolina', number: '13', productId: 'br-tor-vermelha' },
  // 🟡 Amarela jogador M (sem nº de pedido informado)
  { orderId: '#AMA-1', size: 'M', sizeLabel: 'M (M)', name: 'Domingos', number: '10', productId: 'br-home-amarela' },
  { orderId: '#AMA-2', size: 'M', sizeLabel: 'M (M)', name: 'Domingos', number: '10', productId: 'br-home-amarela' },
];

export const QUEUES = [
  {
    id: 'pers-jul-2026',
    title: 'Personalização — jul/2026',
    productId: 'br-tor-vermelha',
    items: PERS_JUL_2026_ITEMS,
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
      persSides: item.persSides ?? product.persSides ?? '',
      fontGuide: product.fontGuide || null,
    };
  }),
);

/** Compatibilidade */
export const LOT = QUEUES[0];
export const ITEMS = ALL_ITEMS;
