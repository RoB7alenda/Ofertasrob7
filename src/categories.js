// Categorias: cada uma tem o seu grupo de WhatsApp, a sua fila, o seu horário e as palavras
// que o agente RoB7 usa pra procurar produtos. "Geral" recebe os links que você manda
// quando não dá pra saber a categoria.
//
// Cada categoria pode ter SUBCATEGORIAS (ex.: na Moda: panelas, roupas, íntimas, maquiagem,
// unhas). Elas servem pra fila sair intercalada (rodízio) em vez de postar várias do mesmo
// tipo em sequência. Categoria sem subcategoria continua funcionando exatamente como antes.

import { folded } from './text.js';

export const GENERAL_ID = 'geral';
export const CATEGORIES_VERSION = 2;

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function subcategory(id, name, words) {
  return { id, name, words };
}

// Ordem aqui = ordem do rodízio da fila.
const MODA_SUBCATEGORIES = [
  subcategory('panelas', 'Panelas', ['panela', 'frigideira', 'caçarola', 'wok', 'fervedor']),
  subcategory('roupas', 'Roupas', ['vestido', 'calça', 'blusa', 'macacão', 'saia', 'conjunto', 'jeans', 'roupa']),
  subcategory('intimas', 'Íntimas', ['calcinha', 'sutiã', 'sutia', 'soutien', 'lingerie', 'body de renda', 'body']),
  subcategory('maquiagem', 'Maquiagem', ['batom', 'cílios', 'rímel', 'base', 'primer', 'pó compacto', 'delineador',
    'paleta', 'iluminador', 'blush', 'gloss', 'labial', 'sombra', 'contorno', 'corretivo', 'maquiagem']),
  subcategory('unhas', 'Unhas', ['esmalte', 'unha', 'nail', 'gel base', 'tips', 'alongamento']),
  subcategory('natal', 'Natal', ['natal', 'natalino', 'guirlanda', 'papai noel', 'pisca pisca', 'arvore de natal', 'enfeite']),
  subcategory('infantil', 'Roupinha infantil', ['infantil', 'criança', 'bebe', 'bebê', 'menina', 'menino', 'roupinha', 'body bebe']),
  subcategory('cabelo', 'Cabelo', ['secador', 'chapinha', 'prancha', 'modelador', 'babyliss', 'escova rotativa', 'cabelo']),
  subcategory('penteadeira', 'Penteadeira e espelho', ['penteadeira', 'espelho', 'camarim', 'espelho led']),
  subcategory('brinquedos', 'Brinquedos', ['brinquedo', 'pelucia', 'pelúcia', 'boneca', 'carrinho', 'blocos de montar', 'quebra cabeca', 'lego']),
  subcategory('variedades', 'Variedades', ['variedades', 'utilidades', 'organizador', 'necessaire', 'porta joias'])
];

// Palavras e descrição que a Moda tinha antes das subcategorias. Servem pra migração saber
// se você mexeu nelas: se estiverem iguais a estas, o programa pode atualizar sozinho.
const MODA_V1 = Object.freeze({
  description: 'Roupas e calçados: tênis, meias, cuecas, calcinhas, camisetas, calças, bermudas, casacos, jaquetas, moletons, bonés, mochilas e acessórios de moda.',
  keywords: ['tênis masculino', 'tênis feminino', 'kit cueca boxer', 'kit meias', 'jaqueta masculina', 'moletom', 'camiseta dry fit',
    'calça jeans', 'bermuda masculina', 'vestido feminino', 'boné', 'mochila']
});

// A Moda é a categoria do grupo feminino (Ofertas Bea7), por isso procura também panelas,
// maquiagem, esmalte e lingerie. Atenção: "jogo de panelas" também está em "Casa e cozinha";
// na dúvida vale a primeira da lista (Moda vem antes de Casa). Se um dia a Casa ganhar grupo
// próprio, decidir de quem fica a panela.
const MODA = Object.freeze({
  description: 'Moda e beleza do grupo feminino: vestidos, calças, blusas, saias, macacões, roupas íntimas (calcinha, sutiã, lingerie), maquiagem (batom, base, paleta, cílios), unhas (esmalte, postiças) e panelas e frigideiras.',
  keywords: [...MODA_V1.keywords,
    'jogo de panelas', 'panela', 'frigideira', 'kit maquiagem', 'batom matte', 'paleta de sombras',
    'cílios postiços', 'esmalte', 'kit unhas postiças', 'calcinha', 'sutiã', 'conjunto lingerie',
    'saia feminina', 'blusa feminina', 'macacão feminino', 'enfeite de natal', 'roupa infantil menina',
    'secador de cabelo', 'penteadeira com espelho', 'brinquedo educativo']
});

function category(id, name, description, keywords, extra = {}) {
  return {
    id,
    name,
    description,
    enabled: false,
    groups: [],
    keywords,
    subcategories: [],
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
  category('moda', 'Moda', MODA.description, [...MODA.keywords],
    { offsetMin: 8, subcategories: structuredClone(MODA_SUBCATEGORIES) }),
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

const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// Primeira vez com categorias: a configuração antiga (grupos + horário) vira a categoria "Geral".
function migrateToV1(settings) {
  const list = Array.isArray(settings.categories) && settings.categories.length ? settings.categories : cloneDefaults();
  const general = list.find((c) => c.id === GENERAL_ID);
  if (general) {
    if (!general.groups.length && Array.isArray(settings.groups?.offers)) general.groups = [...settings.groups.offers];
    for (const key of ['start', 'end', 'intervalMin', 'days']) {
      if (settings.queue?.[key] !== undefined) general[key] = structuredClone(settings.queue[key]);
    }
  }
  settings.categories = list;
  // O que era da fila única e do radar antigo não é mais usado.
  if (settings.groups) delete settings.groups.offers;
  if (settings.queue) for (const key of ['start', 'end', 'intervalMin', 'days']) delete settings.queue[key];
  delete settings.radar;
}

// Chegaram as subcategorias: quem já tinha a configuração salva recebe as de fábrica.
// Palavras e descrição que você editou ficam como estão.
function migrateToV2(settings) {
  const list = Array.isArray(settings.categories) ? settings.categories : cloneDefaults();
  for (const fallback of DEFAULT_CATEGORIES) {
    const saved = list.find((c) => c.id === fallback.id);
    if (!saved) {
      list.push(structuredClone(fallback));
      continue;
    }
    if (!Array.isArray(saved.subcategories)) saved.subcategories = structuredClone(fallback.subcategories);
  }
  const moda = list.find((c) => c.id === 'moda');
  if (moda) {
    if (sameList(moda.keywords, MODA_V1.keywords)) moda.keywords = [...MODA.keywords];
    if (moda.description === MODA_V1.description) moda.description = MODA.description;
  }
  settings.categories = list;
}

export function migrateCategories(settings) {
  const from = Array.isArray(settings.categories) ? Number(settings.categoriesVersion) || 0 : 0;
  if (from >= CATEGORIES_VERSION) return false;
  if (from < 1) migrateToV1(settings);
  if (from < 2) migrateToV2(settings);
  settings.categoriesVersion = CATEGORIES_VERSION;
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

// ---------- subcategorias ----------

export function subcategoriesOf(settings, categoryId) {
  const list = getCategory(settings, categoryId)?.subcategories;
  return Array.isArray(list) ? list.filter((s) => s && s.id) : [];
}

export function subcategoryName(settings, categoryId, subId) {
  if (!subId) return '';
  return subcategoriesOf(settings, categoryId).find((s) => s.id === subId)?.name || subId;
}

export function validSubcategory(settings, categoryId, subId) {
  return subcategoriesOf(settings, categoryId).some((s) => s.id === subId) ? subId : '';
}

// ---------- classificação por palavras ----------

// Texto do nome do produto com espaço nas pontas, pra procurar palavra inteira.
function searchable(title) {
  return ` ${folded(title).replace(/[^a-z0-9]+/g, ' ')} `;
}

// Quanto o nome do produto combina com uma lista de palavras.
// Palavra (ou expressão) inteira dentro do nome vale muito; parte de uma expressão vale pouco.
function scoreKeywords(text, keywords) {
  let score = 0;
  for (const keyword of keywords || []) {
    const words = folded(keyword).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length >= 3);
    if (!words.length) continue;
    const hits = words.filter((w) => text.includes(` ${w} `) || text.includes(` ${w}s `)).length;
    if (hits === words.length) score += 2 + words.length;
    else if (hits && words.length > 1) score += hits / words.length;
  }
  return score;
}

// Sem IA: escolhe a categoria pelas palavras de busca que aparecem no nome do produto.
export function classifyByKeywords(settings, title) {
  const text = searchable(title);
  let best = { id: GENERAL_ID, score: 0 };
  for (const c of listCategories(settings)) {
    if (c.id === GENERAL_ID) continue;
    const score = scoreKeywords(text, c.keywords);
    if (score > best.score) best = { id: c.id, score };
  }
  return best.score >= 2 ? best.id : GENERAL_ID;
}

// Duas palavras parecidas? ("panelinha" x "panela", "baton" x "batom")
function similar(a, b) {
  if (a === b) return 1;
  if (a.length < 4 || b.length < 4) return 0;
  if (a.includes(b)) return b.length / a.length;
  if (b.includes(a)) return a.length / b.length;
  let same = 0;
  while (same < a.length && same < b.length && a[same] === b[same]) same++;
  return same >= 4 ? same / Math.max(a.length, b.length) : 0;
}

// Dentro de uma categoria: de qual subcategoria é esse produto.
// Categoria sem subcategoria devolve '' (continua tudo como antes). Quando ela tem, nunca
// fica vazio: se nenhuma palavra bater, fica com a subcategoria de palavra mais parecida.
export function classifySubcategory(settings, categoryId, title) {
  const subs = subcategoriesOf(settings, categoryId);
  if (!subs.length) return '';
  const words = folded(title).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';

  const text = searchable(title);
  let best = { id: '', score: 0 };
  for (const sub of subs) {
    const score = scoreKeywords(text, sub.words);
    if (score > best.score) best = { id: sub.id, score };
  }
  if (best.id) return best.id;

  // Nenhuma palavra bateu: a mais parecida. Sem nada parecido, a última da lista
  // (por isso a Variedades fica por último).
  let near = { id: subs[subs.length - 1].id, score: 0 };
  for (const sub of subs) {
    for (const keyword of sub.words || []) {
      for (const part of folded(keyword).replace(/[^a-z0-9]+/g, ' ').trim().split(' ')) {
        for (const word of words) {
          const score = similar(word, part);
          if (score > near.score) near = { id: sub.id, score };
        }
      }
    }
  }
  return near.id;
}

export function scheduleOf(category) {
  return { start: category.start, end: category.end, intervalMin: category.intervalMin, days: category.days, offsetMin: category.offsetMin || 0 };
}
