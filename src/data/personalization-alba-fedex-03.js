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

/**
 * Regra do print:
 * - "Costas: Bolsonaro 22 arte 3 — Sml" → arte = "Bolsonaro 22 arte 3", nome = "Sml"
 * - "Nome e número — Lula 13" → nome/número = Lula / 13
 * - "Costas: Bolsonaro 22" (sem arte / sem —) → nome/número = Bolsonaro / 22
 *
 * @typedef {{ place: string, label: string, image?: string }} PersExtra
 * @typedef {{
 *   orderId: string,
 *   size: string,
 *   sizeLabel: string,
 *   name: string,
 *   number: string,
 *   productId?: string,
 *   createdAt?: string,
 *   placeholder?: boolean,
 *   disabled?: boolean,
 *   note?: string,
 *   alert?: string,
 *   alertImage?: string,
 *   extras?: PersExtra[],
 *   persSides?: string
 * }} PersItem
 */

const ART_AMARELA = '../src/assets/images/personalization/artes/Camisa Jogador Seleção Brasileira Amarela Copa do mundo home I 2026 - 2027';
const ART_VERMELHA = '../src/assets/images/personalization/artes/Camisa Vermelha Brasil 26-27 — Masculina e Feminina';

/** @param {string} base @param {string} place @param {string} file */
function art(base, place, file) {
  return `${base}/${place}/${file}`;
}

/**
 * Lotes por data de cadastro (YYYY-MM-DD).
 * Novos prints → novo lote com a data do dia, sem misturar com os anteriores.
 */
/** @type {{ id: string, date: string, title: string, productId?: string, items: PersItem[] }[]} */
export const QUEUES = [
  {
    id: 'pers-2026-10-09',
    date: '2026-10-09',
    title: 'Personalização — 09/10/2026',
    productId: 'br-tor-vermelha',
    items: [
      // 🔴 Vermelha torcedor
      { orderId: '#ALY', size: 'P', sizeLabel: 'P (S)', name: 'ALY', number: '13', productId: 'br-tor-vermelha' },
      {
        orderId: '#Aninha',
        size: 'P',
        sizeLabel: 'P (S)',
        name: 'Aninha',
        number: '3',
        productId: 'br-tor-vermelha',
        extras: [
          {
            place: 'Manga esquerda',
            label: 'Che - arte 1',
            image: art(ART_VERMELHA, 'Manga esquerda', 'Che - arte 1.webp'),
          },
        ],
      },
      { orderId: '#Viktor', size: 'M', sizeLabel: 'M (M)', name: 'Viktor', number: '13', productId: 'br-tor-vermelha' },
      { orderId: '#sem-nome', size: 'GG', sizeLabel: 'GG (XL)', name: '', number: '13', productId: 'br-tor-vermelha' },
      // 🟡 Amarela jogador
      { orderId: '#PauloVictor', size: 'GG', sizeLabel: 'GG (XL)', name: 'Paulo Victor', number: '22', productId: 'br-home-amarela' },
      { orderId: '#Geovanna', size: 'P', sizeLabel: 'P (S)', name: 'Geovanna', number: '22', productId: 'br-home-amarela' },
    ],
  },
  {
    id: 'pers-2026-10-11',
    date: '2026-10-11',
    title: 'Personalização — 11/10/2026',
    items: [
      // #1916 — 2× amarela · costas Bolsonaro 22 arte 1
      {
        orderId: '#1916',
        size: 'P',
        sizeLabel: 'P (S)',
        name: 'Bolsonaro',
        number: '22',
        productId: 'br-home-amarela',
        extras: [
          {
            place: 'Costas',
            label: 'Bolsonaro 22 arte 1',
            image: art(ART_AMARELA, 'Costas', 'Bolsonaro 22 arte 1.webp'),
          },
        ],
      },
      {
        orderId: '#1916-2',
        size: 'M',
        sizeLabel: 'M (M)',
        name: 'Bolsonaro',
        number: '22',
        productId: 'br-home-amarela',
        note: 'Gola mais escura',
        extras: [
          {
            place: 'Costas',
            label: 'Bolsonaro 22 arte 1',
            image: art(ART_AMARELA, 'Costas', 'Bolsonaro 22 arte 1.webp'),
          },
        ],
      },

      // #1922 — costas arte + nome Sml
      {
        orderId: '#1922',
        size: 'P',
        sizeLabel: 'P (S)',
        name: 'Sml',
        number: '',
        productId: 'br-home-amarela',
        extras: [
          {
            place: 'Costas',
            label: 'Bolsonaro 22 arte 3',
            image: art(ART_AMARELA, 'Costas', 'Bolsonaro 22 arte 3.webp'),
          },
          {
            place: 'Frente — peito',
            label: 'Bolsonaro - arte 1',
            image: art(ART_AMARELA, 'Frente — peito', 'Bolsonaro - arte 1.webp'),
          },
        ],
      },

      // #1923 — costas arte + nome ANTI PETISTA
      {
        orderId: '#1923',
        size: 'M',
        sizeLabel: 'M (M)',
        name: 'ANTI PETISTA',
        number: '',
        productId: 'br-home-amarela',
        note: 'Gola mais clara',
        extras: [
          {
            place: 'Costas',
            label: 'Bolsonaro 22 arte 2',
            image: art(ART_AMARELA, 'Costas', 'Bolsonaro 22 arte 2.webp'),
          },
          {
            place: 'Frente — cintura',
            label: 'Patriótica - arte 1',
            image: art(ART_AMARELA, 'Frente — cintura', 'Patriótica - arte 1.webp'),
          },
          {
            place: 'Manga direita',
            label: 'Bolsonaro - arte 1',
            image: art(ART_AMARELA, 'Manga direita', 'Bolsonaro - arte 1.webp'),
          },
        ],
      },

      // #1924 — costas arte + nome Bolsonaro
      {
        orderId: '#1924',
        size: 'XG',
        sizeLabel: 'XGG (XG)',
        name: 'Bolsonaro',
        number: '',
        productId: 'br-home-amarela',
        extras: [
          {
            place: 'Costas',
            label: 'Bolsonaro 22 arte 1',
            image: art(ART_AMARELA, 'Costas', 'Bolsonaro 22 arte 1.webp'),
          },
          {
            place: 'Frente — peito',
            label: 'Bolsonaro - arte 1',
            image: art(ART_AMARELA, 'Frente — peito', 'Bolsonaro - arte 1.webp'),
          },
          {
            place: 'Manga direita',
            label: 'Bolsonaro - arte 1',
            image: art(ART_AMARELA, 'Manga direita', 'Bolsonaro - arte 1.webp'),
          },
        ],
      },

      // #1921 — vermelha · nome/número Lula 13 + manga
      {
        orderId: '#1921',
        size: 'XG',
        sizeLabel: 'XGG (XG)',
        name: 'Lula',
        number: '13',
        productId: 'br-tor-vermelha',
        extras: [
          {
            place: 'Manga esquerda',
            label: 'Estrela - arte 2',
            image: art(ART_VERMELHA, 'Manga esquerda', 'Estrela - arte 2.webp'),
          },
        ],
      },

      // #1915 — Retro 98 · só costas (sem aviso frente e atrás)
      { orderId: '#1915', size: 'G', sizeLabel: 'G (L)', name: 'Ricardo', number: '22', productId: 'br-retro-98', persSides: '' },
      { orderId: '#1915-2', size: 'M', sizeLabel: 'M (M)', name: 'Kethelyn', number: '22', productId: 'br-retro-98', persSides: '' },

      // #1926 — amarela · nome/número
      { orderId: '#1926', size: 'G', sizeLabel: 'G (L)', name: 'Rodrigo', number: '22', productId: 'br-home-amarela' },

      // #1929 — amarela · nome/número + manga
      {
        orderId: '#1929',
        size: 'XG',
        sizeLabel: 'XGG (XG)',
        name: 'Diogo',
        number: '22',
        productId: 'br-home-amarela',
        extras: [
          {
            place: 'Manga direita',
            label: 'God Loves Brazil',
            image: art(ART_AMARELA, 'Manga direita', 'God Loves Brazil.webp'),
          },
        ],
      },
    ],
  },
];

/** Formata YYYY-MM-DD → DD/MM/YYYY */
export function formatBatchDate(isoDate) {
  const [y, m, d] = String(isoDate || '').split('-');
  if (!y || !m || !d) return isoDate || '';
  return `${d}/${m}/${y}`;
}

/** Datas de cadastro disponíveis (mais recente primeiro). */
export function listBatchDates() {
  const dates = [...new Set(QUEUES.map((q) => q.date).filter(Boolean))];
  return dates.sort((a, b) => b.localeCompare(a));
}

export const ALL_ITEMS = QUEUES.flatMap((queue) =>
  queue.items.map((item) => {
    const productId = item.productId || queue.productId;
    const product = PRODUCTS[productId] || PRODUCTS['br-home-amarela'];
    const createdAt = item.createdAt || queue.date;
    const extras = Array.isArray(item.extras) ? item.extras : [];
    const alertFromExtras = extras
      .map((extra) => `${extra.place}: ${extra.label}`)
      .join(' · ');
    const alert = item.alert || alertFromExtras || '';
    const alertImage = item.alertImage || extras.find((extra) => extra.image)?.image || '';
    return {
      ...item,
      createdAt,
      extras,
      alert,
      alertImage,
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
