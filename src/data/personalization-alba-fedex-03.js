/**
 * Filas de personalização (dados estáticos, sem vínculo com vendas).
 * Edite os arrays `items` quando chegarem novos pedidos.
 */

const VERMELHA = {
  productName: 'Camisa Torcedor Brasil - Vermelha - Copa 2026',
  imageUrl: '../src/assets/images/products/brasil-torcedor-vermelha-copa-2026.png',
};

const AMARELA = {
  productName: 'Camisa Jogador Seleção Brasileira Amarela Copa do mundo home 2026/2027',
  imageUrl: '../src/assets/images/products/brasil-home-amarela-jogador-2026.png',
};

export const PRODUCTS = {
  'br-tor-vermelha': {
    id: 'br-tor-vermelha',
    label: 'Vermelha',
    ...VERMELHA,
    accent: 'purple',
  },
  'br-home-amarela': {
    id: 'br-home-amarela',
    label: 'Amarela',
    ...AMARELA,
    accent: 'yellow',
  },
};

/** @typedef {{ orderId: string, size: string, sizeLabel: string, name: string, number: string, placeholder?: boolean }} PersItem */

/** @type {PersItem[]} */
const ALBA_FEDEX_03_ITEMS = [
  { orderId: '#1152', size: 'GG', sizeLabel: 'GG (XL)', name: 'LULA', number: '13' },
  { orderId: '#1153', size: 'M', sizeLabel: 'M (M)', name: 'TETRA', number: '13' },
  { orderId: '#1155', size: 'GG', sizeLabel: 'GG (XL)', name: 'SÓCRATES', number: '8' },
  { orderId: '#1156', size: 'XG', sizeLabel: 'XGG (2XL)', name: 'Democracia', number: '13' },
  { orderId: '#1160', size: 'G', sizeLabel: 'G (L)', name: 'Sidarta', number: '13' },
  { orderId: '#1163', size: 'GG', sizeLabel: 'GG (XL)', name: 'Michael', number: '13' },
  { orderId: '#1172', size: 'GG', sizeLabel: 'GG (XL)', name: 'ALBERNAZ', number: '13' },
  { orderId: '#1174', size: 'G', sizeLabel: 'G (L)', name: 'Velton', number: '46' },
  { orderId: '#1176', size: 'G', sizeLabel: 'G (L)', name: 'Sthone', number: '13' },
  { orderId: '#1180', size: 'XG', sizeLabel: 'XGG (2XL)', name: 'Nina', number: '04' },
  { orderId: '#1183', size: 'P', sizeLabel: 'P (S)', name: 'Lou', number: '13' },
  { orderId: '#1183-2', size: 'M', sizeLabel: 'M (M)', name: 'HB', number: '13' },
  { orderId: '#1185', size: 'GG', sizeLabel: 'GG (XL)', name: 'LULA', number: '13' },
  { orderId: '#1194', size: 'M', sizeLabel: 'M (M)', name: 'Larissa', number: '13' },
  { orderId: '#1199', size: 'XG', sizeLabel: 'XGG (2XL)', name: 'BECH', number: '26' },
  { orderId: '#1200', size: 'P', sizeLabel: 'P (S)', name: 'Thauana', number: '10' },
  { orderId: '#1201', size: 'P', sizeLabel: 'P (S)', name: 'K. Spósito', number: '9' },
  { orderId: '#1204', size: 'G', sizeLabel: 'G (L)', name: 'Guidi', number: '12' },
  { orderId: '#1207', size: 'M', sizeLabel: 'M (M)', name: 'J.iMports', number: '71' },
  { orderId: '#1208', size: 'M', sizeLabel: 'M (M)', name: 'Bru', number: '2' },
  { orderId: '#1212', size: 'G', sizeLabel: 'G (L)', name: 'LULA', number: '13' },
  { orderId: '#1215', size: 'G', sizeLabel: 'G (L)', name: 'Thales', number: '13' },
  { orderId: '#1218', size: 'G', sizeLabel: 'G (L)', name: '', number: '13' },
  { orderId: '#1220', size: 'M', sizeLabel: 'M (M)', name: 'HELENA', number: '10' },
  { orderId: '#1231', size: 'GG', sizeLabel: 'GG (XL)', name: 'Dos Anjos', number: '66' },
  { orderId: '#1232', size: 'G', sizeLabel: 'G (L)', name: 'Madson', number: '18' },
  { orderId: '#1237', size: 'M', sizeLabel: 'M (M)', name: '', number: '13' },
  { orderId: '#1238', size: 'G', sizeLabel: 'G (L)', name: 'LUFECDS', number: '24' },
  { orderId: '#1239', size: 'G', sizeLabel: 'G (L)', name: 'Nathan', number: '31' },
  { orderId: '#1239-2', size: 'M', sizeLabel: 'M (M)', name: 'Lari', number: '31' },
  { orderId: '#1243', size: 'GG', sizeLabel: 'GG (XL)', name: 'R M ESPINOSA', number: '7' },
  { orderId: '#1248', size: 'GG', sizeLabel: 'GG (XL)', name: 'LEO BULHOES', number: '13' },
  { orderId: '#1261', size: 'M', sizeLabel: 'M (M)', name: 'MARI', number: '44' },
  { orderId: '#1261-2', size: 'M', sizeLabel: 'M (M)', name: 'GLAUBER', number: '67' },
  { orderId: '#1267', size: 'GG', sizeLabel: 'GG (XL)', name: 'Conj', number: '12' },
  { orderId: '#1298', size: 'G', sizeLabel: 'G (L)', name: 'Lula', number: '13' },
  { orderId: '#1312', size: 'G', sizeLabel: 'G (L)', name: 'Bruna Issao', number: '10' },
  { orderId: '#1327', size: 'G', sizeLabel: 'G (L)', name: 'Soljenítsin', number: '13' },
  { orderId: '#1332', size: 'G', sizeLabel: 'G (L)', name: 'ribeiro', number: '10' },
  { orderId: '#1336', size: 'G', sizeLabel: 'G (L)', name: 'LULA', number: '13' },
  { orderId: '#1338', size: 'G', sizeLabel: 'G (L)', name: 'Michele', number: '13' },
];

/** Pedidos amarelos — outro estoque (dados estáticos). */
/** @type {PersItem[]} */
const AMARELAS_OUTRO_ESTOQUE_ITEMS = [
  { orderId: '#1477', size: 'G', sizeLabel: 'G (L)', name: 'Lucas C.', number: '11' },
  { orderId: '#1157', size: 'P', sizeLabel: 'P (S)', name: 'NEYMAR JR', number: '10' },
  { orderId: '#1511', size: 'G', sizeLabel: 'G (L)', name: 'NEYMAR JR', number: '10' },
  { orderId: '#1512', size: 'G', sizeLabel: 'G (L)', name: 'NEYMAR JR', number: '10' },
  { orderId: '#1565', size: 'G', sizeLabel: 'G (L)', name: 'NEYMAR JR', number: '10' },
  { orderId: '#1574', size: 'P', sizeLabel: 'P (S)', name: 'Matô', number: '10' },
  { orderId: '#1575', size: 'G', sizeLabel: 'G (L)', name: 'NEYMAR JR', number: '10' },
];

export const QUEUES = [
  {
    id: 'alba-fedex-03',
    title: 'Alba - Fedex 03',
    productId: 'br-tor-vermelha',
    items: ALBA_FEDEX_03_ITEMS,
  },
  {
    id: 'amarelas-outro-estoque',
    title: 'Amarelas — outro estoque',
    productId: 'br-home-amarela',
    items: AMARELAS_OUTRO_ESTOQUE_ITEMS,
  },
];

/** Lista plana com metadados do produto e da fila em cada item. */
export const ALL_ITEMS = QUEUES.flatMap((queue) =>
  queue.items.map((item) => {
    const productId = item.productId || queue.productId;
    const product = PRODUCTS[productId] || PRODUCTS['br-tor-vermelha'];
    return {
      ...item,
      queueId: queue.id,
      queueTitle: queue.title,
      productId,
      productLabel: product.label,
      productName: item.productName || product.productName,
      imageUrl: item.imageUrl || product.imageUrl,
      productAccent: product.accent,
    };
  }),
);

/** Compatibilidade com import antigo */
export const LOT = QUEUES[0];
export const ITEMS = ALL_ITEMS.filter((i) => i.queueId === 'alba-fedex-03');
