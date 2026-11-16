// Categorias: cada uma tem o seu grupo de WhatsApp, a sua fila, o seu horário e as palavras
// que o agente RoB7 usa pra procurar produtos. "Geral" recebe os links que você manda
// quando não dá pra saber a categoria.

import { folded } from './text.js';

export const GENERAL_ID = 'geral';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function category(id, name, description, keywords, extra = {}) {
  return {
    id,
    name,
    description,
    enabled: false,
    groups: [],
    keywords,
    start: '08:00',
    end: '22:00',
    intervalMin: 30,
    offsetMin: 0,
    days: [...ALL_DAYS],
    minDiscount: 20,
    minRating: 4.5,
    minReviews: 10,
    requireFreeShipping: true,
    maxPrice: 0,
    ...extra
  };
}

export const DEFAULT_CATEGORIES = Object.freeze([
  category(GENERAL_ID, 'Geral', 'Links que você manda e que não são de nenhuma categoria.', [], { enabled: true, offsetMin: 26, minDiscount: 0, minRating: 0, minReviews: 0, requireFreeShipping: false }),
  category('veiculos', 'Veículos',
    'Tudo sobre veículos: peças e acessórios de carro e moto, limpeza e lavagem automotiva, som e multimídia automotiva, ferramentas e equipamentos para carro, moto e motociclista.',
    ['kit lavagem automotiva', 'lavadora alta pressão', 'aspirador automotivo', 'cera automotiva', 'capa banco carro', 'tapete automotivo',
      'suporte celular carro', 'câmera de ré', 'multimídia automotiva', 'som automotivo', 'compressor ar portátil', 'carregador veicular',
      'capacete moto', 'baú moto', 'luva motociclista', 'jaqueta motociclista', 'kit ferramentas automotivo'],
    { enabled: true, offsetMin: 0 }),
  category('moda', 'Moda',
    'Roupas e calçados: tênis, meias, cuecas, calcinhas, camisetas, calças, bermudas, casacos, jaquetas, moletons, bonés, mochilas e acessórios de moda.',
    ['tênis masculino', 'tênis feminino', 'kit cueca boxer', 'kit meias', 'jaqueta masculina', 'moletom', 'camiseta dry fit',
      'calça jeans', 'bermuda masculina', 'vestido feminino', 'boné', 'mochila'],
    { offsetMin: 8 }),
  category('casa', 'Casa e cozinha',
    'Casa e cozinha: eletroportáteis, panelas, utensílios, organização, cama mesa e banho, limpeza da casa, iluminação, ventiladores.',
    ['air fryer', 'jogo de panelas', 'ventilador', 'organizador', 'jogo de cama', 'toalha de banho', 'liquidificador',
      'aspirador de pó', 'cafeteira', 'panela elétrica de arroz', 'mop giratório', 'luminária led'],
    { offsetMin: 15 }),
  category('eletronicos', 'Eletrônicos e games',
    'Eletrônicos e games: fones, celulares, smartwatches, carregadores, power banks, caixas de som, periféricos gamer, consoles, controles, SSD, TV.',
    ['fone bluetooth', 'smartwatch', 'carregador turbo', 'power bank', 'caixa de som bluetooth', 'mouse gamer',
      'teclado mecânico', 'headset gamer', 'controle ps5', 'ssd', 'smart tv', 'celular'],
    { offsetMin: 22 })
]);

export function cloneDefaults() {
  return structuredClone(DEFAULT_CATEGORIES);
}

// Primeira vez com categorias: a configuração antiga (grupos + horário) vira a categoria "Geral".
export function migrateCategories(settings) {
  if (Array.isArray(settings.categories) && settings.categoriesVersion >= 1) return false;
  const list = Array.isArray(settings.categories) && settings.categories.length ? settings.categories : cloneDefaults();
  const general = list.find((c) => c.id === GENERAL_ID);
  if (general) {
    if (!general.groups.length && Array.isArray(settings.groups?.offers)) general.groups = [...settings.groups.offers];
    for (const key of ['start', 'end', 'intervalMin', 'days']) {
      if (settings.queue?.[key] !== undefined) general[key] = structuredClone(settings.queue[key]);
    }
  }
  settings.categories = list;
  settings.categoriesVersion = 1;
  // O que era da fila única e do radar antigo não é mais usado.
  if (settings.groups) delete settings.groups.offers;
  if (settings.queue) for (const key of ['start', 'end', 'intervalMin', 'days']) delete settings.queue[key];
  delete settings.radar;
  return true;
}

export function listCategories(settings) {
  return Array.isArray(settings.categories) ? settings.categories : cloneDefaults();
}

export function getCategory(settings, id) {
  const list = listCategories(settings);
  return list.find((c) => c.id === id) || list.find((c) => c.id === GENERAL_ID) || list[0];
}

export function categoryName(settings, id) {
  return getCategory(settings, id)?.name || 'Geral';
}

// "veiculos", "Veículos", "veiculo", "moda"... -> id da categoria (ou '' se não achar).
export function findCategoryByName(settings, text) {
  const wanted = folded(text).replace(/[^a-z0-9 ]/g, ' ').trim();
  if (!wanted) return '';
  for (const c of listCategories(settings)) {
    const name = folded(c.name);
    const first = name.split(/\s+/)[0];
    if (wanted === c.id || wanted === name || wanted === first || wanted.replace(/s$/, '') === first.replace(/s$/, '')) return c.id;
  }
  return '';
}

// Sem IA: escolhe a categoria pelas palavras de busca que aparecem no nome do produto.
export function classifyByKeywords(settings, title) {
  const text = ` ${folded(title).replace(/[^a-z0-9]+/g, ' ')} `;
  let best = { id: GENERAL_ID, score: 0 };
  for (const c of listCategories(settings)) {
    if (c.id === GENERAL_ID) continue;
    let score = 0;
    for (const keyword of c.keywords || []) {
      const words = folded(keyword).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length >= 3);
      if (!words.length) continue;
      const hits = words.filter((w) => text.includes(` ${w} `) || text.includes(` ${w}s `)).length;
      if (hits === words.length) score += 2 + words.length;
      else if (hits && words.length > 1) score += hits / words.length;
    }
    if (score > best.score) best = { id: c.id, score };
  }
  return best.score >= 2 ? best.id : GENERAL_ID;
}

export function scheduleOf(category) {
  return { start: category.start, end: category.end, intervalMin: category.intervalMin, days: category.days, offsetMin: category.offsetMin || 0 };
}
