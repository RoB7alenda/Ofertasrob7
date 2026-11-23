import { tempFile, fakeProduct } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JsonFile } from '../src/store.js';
import { DEFAULT_SETTINGS } from '../src/config.js';
import { OfferService } from '../src/offers.js';
import { classifySubcategory, migrateCategories, cloneDefaults } from '../src/categories.js';
import { interleave, sameOrder } from '../src/queue-order.js';

const sub = (offer) => offer.subcategory;
const line = (list) => list.map((o) => `${o.subcategory}${o.id}`).join(' ');
const fake = (subcategory, id) => ({ id: String(id), subcategory });
const MODA_ORDER = ['panelas', 'roupas', 'intimas', 'maquiagem', 'unhas', 'natal', 'infantil', 'cabelo', 'penteadeira', 'brinquedos', 'variedades'];

test('rodízio: lote em bloco sai intercalado, mantendo a ordem de chegada', () => {
  const queue = [fake('panelas', 1), fake('panelas', 2), fake('panelas', 3), fake('roupas', 4), fake('roupas', 5), fake('unhas', 6)];
  const out = interleave(queue, sub, { order: MODA_ORDER });
  assert.equal(line(out), 'panelas1 roupas4 unhas6 panelas2 roupas5 panelas3');
  // já intercalado: não muda mais nada (pode rodar quantas vezes quiser)
  assert.ok(sameOrder(interleave(out, sub, { order: MODA_ORDER }), out));
});

test('rodízio: respeita a ordem configurada das subcategorias e quem não tem subcategoria', () => {
  const queue = [fake('unhas', 1), fake('panelas', 2), fake('', 3), fake('roupas', 4)];
  assert.equal(line(interleave(queue, sub, { order: MODA_ORDER })), 'panelas2 roupas4 unhas1 3');
});

test('rodízio: keepFirst não mexe na próxima a postar', () => {
  const queue = [fake('roupas', 1), fake('panelas', 2), fake('panelas', 3), fake('roupas', 4)];
  assert.equal(line(interleave(queue, sub, { order: MODA_ORDER, keepFirst: 1 })), 'roupas1 panelas2 roupas4 panelas3');
});

test('rodízio: lista vazia, um item só e uma subcategoria só continuam iguais', () => {
  assert.deepEqual(interleave([], sub), []);
  const one = [fake('panelas', 1)];
  assert.ok(sameOrder(interleave(one, sub, { order: MODA_ORDER }), one));
  const same = [fake('panelas', 1), fake('panelas', 2), fake('panelas', 3)];
  assert.ok(sameOrder(interleave(same, sub, { order: MODA_ORDER }), same));
});

test('subcategoria pelo nome do produto (Moda do grupo Bea7)', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  migrateCategories(settings);
  const of = (title) => classifySubcategory(settings, 'moda', title);
  assert.equal(of('Jogo de Panelas Antiaderente 5 Peças'), 'panelas');
  assert.equal(of('Frigideira Grill Cerâmica 24cm'), 'panelas');
  assert.equal(of('Vestido Longo Floral Feminino'), 'roupas');
  assert.equal(of('Calça Wide Leg Jeans Cintura Alta'), 'roupas');
  assert.equal(of('Kit 6 Calcinhas Microfibra'), 'intimas');
  assert.equal(of('Sutiã Sem Bojo Renda Plus Size'), 'intimas');
  assert.equal(of('Batom Líquido Matte Longa Duração'), 'maquiagem');
  assert.equal(of('Paleta de Sombras 35 Cores'), 'maquiagem');
  assert.equal(of('Base Líquida Matte Cobertura Alta'), 'maquiagem');
  assert.equal(of('Esmalte Vermelho Kit 6 Unidades'), 'unhas');
  assert.equal(of('Kit Unhas Postiças Tips Gel Base'), 'unhas');
  // segundo lote do Bea7
  assert.equal(of('Enfeite de Natal Guirlanda 40cm'), 'natal');
  assert.equal(of('Body Bebê Manga Longa Kit 3'), 'infantil');
  assert.equal(of('Secador de Cabelo 2000w'), 'cabelo');
  assert.equal(of('Penteadeira Camarim com Espelho LED'), 'penteadeira');
  assert.equal(of('Pelúcia Urso Grande 1 Metro'), 'brinquedos');
  // nada bateu: a mais parecida ou, sem nada parecido, a última da lista (Variedades)
  assert.equal(of('Tapete Felpudo Sala'), 'variedades');
  assert.ok(MODA_ORDER.includes(of('Xyz Abcd Qwerty')));
  // categoria sem subcategoria continua como antes (vazio)
  assert.equal(classifySubcategory(settings, 'veiculos', 'Capacete Moto Articulado'), '');
});

test('migração: quem já tinha a configuração salva ganha as subcategorias', () => {
  const settings = { categories: cloneDefaults().map((c) => ({ ...c, subcategories: undefined })), categoriesVersion: 1 };
  settings.categories.find((c) => c.id === 'veiculos').keywords = ['minha palavra'];
  assert.equal(migrateCategories(settings), true);
  const moda = settings.categories.find((c) => c.id === 'moda');
  assert.deepEqual(moda.subcategories.map((s) => s.id), MODA_ORDER);
  assert.ok(moda.keywords.includes('panela')); // palavras do Bea7 entraram
  assert.deepEqual(settings.categories.find((c) => c.id === 'veiculos').keywords, ['minha palavra']); // o que você editou fica
  assert.equal(settings.categoriesVersion, 2);
  assert.equal(migrateCategories(settings), false); // só uma vez
});

function setup() {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  settings.update((s) => { migrateCategories(s); });
  const db = new JsonFile(tempFile('db.json'), { seq: 0, offers: [], sessions: [], queueState: {} });
  const titles = new Map();
  const reader = async (platform, url) => fakeProduct({ title: titles.get(url), productId: `MLB${url.slice(-6)}`, resolvedUrl: `https://produto.mercadolivre.com.br/MLB-${url.slice(-6)}` });
  const offers = new OfferService({ db, settings, reader });
  // cadastra e aprova, igual ao lote colado no painel
  const add = async (title, { approve = true } = {}) => {
    const url = `https://meli.la/${Math.random().toString(36).slice(2, 10)}`;
    titles.set(url, title);
    const { offer } = await offers.addFromUrl(url, { category: 'moda' });
    if (approve) offers.approve(offer.id);
    return offer;
  };
  return { settings, db, offers, add };
}

const subsOfQueue = (offers) => offers.queued('moda').map((o) => o.subcategory);

test('lote da mesma subcategoria entra intercalado na fila (não fica em bloco)', async () => {
  const { offers, add } = setup();
  for (const title of ['Jogo de Panelas 5 Peças', 'Panela de Pressão 4,5L', 'Frigideira 24cm',
    'Vestido Longo Floral', 'Calça Jeans Skinny', 'Blusa Manga Longa',
    'Kit 6 Calcinhas', 'Sutiã Renda']) await add(title);
  const fila = subsOfQueue(offers);
  assert.deepEqual(fila, ['panelas', 'roupas', 'intimas', 'panelas', 'roupas', 'intimas', 'panelas', 'roupas']);
  // a posição gravada é uma sequência 1..N
  assert.deepEqual(offers.queued('moda').map((o) => o.queueOrder), [1, 2, 3, 4, 5, 6, 7, 8]);
  // oferta nova depois do lote não bagunça quem já estava esperando
  const antes = offers.queued('moda').slice(0, 3).map((o) => o.id);
  await add('Esmalte Vermelho 8ml');
  assert.deepEqual(offers.queued('moda').slice(0, 3).map((o) => o.id), antes);
});

test('botão Intercalar: faz backup, reordena só a fila e não toca no resto', async () => {
  const { offers, db, add } = setup();
  const postada = await add('Jogo de Panelas Esmaltadas');
  offers.setStatus(postada, 'postada', { postedAt: new Date().toISOString(), queueOrder: null });
  const descartada = await add('Panela Wok Ferro', { approve: false });
  offers.reject(descartada.id);
  const esperando = await add('Panela de Arroz Elétrica', { approve: false });

  // entram já intercalados; pra testar o botão, embaralha na mão (como estava a fila do Bea7)
  const titles = ['Panela Pressão 6L', 'Frigideira Antiaderente', 'Caçarola 20cm', 'Vestido Midi', 'Saia Jeans', 'Esmalte Rosa'];
  for (const title of titles) await add(title);
  const fila = offers.queued('moda');
  fila.forEach((offer, index) => { offer.queueOrder = index + 1; });
  const emBloco = [...fila].sort((a, b) => a.subcategory.localeCompare(b.subcategory) || Number(a.id) - Number(b.id));
  emBloco.forEach((offer, index) => { offer.queueOrder = index + 1; });
  assert.deepEqual(subsOfQueue(offers), ['panelas', 'panelas', 'panelas', 'roupas', 'roupas', 'unhas']);

  const result = offers.interleaveQueue('moda');
  assert.deepEqual(subsOfQueue(offers), ['panelas', 'roupas', 'unhas', 'panelas', 'roupas', 'panelas']);
  assert.equal(result.before.length, 6);
  assert.equal(result.after.length, 6);
  assert.ok(result.before.every((item) => item.title));
  assert.ok(fs.existsSync(result.backup));
  assert.ok(path.basename(result.backup).includes('-backup-'));

  // nada fora da fila foi mexido
  assert.equal(offers.get(postada.id).status, 'postada');
  assert.equal(offers.get(postada.id).queueOrder, null);
  assert.equal(offers.get(descartada.id).status, 'descartada');
  assert.equal(offers.get(esperando.id).status, 'aguardando');
  assert.equal(offers.get(esperando.id).queueOrder, null);
  assert.equal(db.get().offers.filter((o) => o.status === 'fila').length, 6);
});

test('botão Intercalar: avisa quando a categoria não tem subcategoria ou a fila está vazia', async () => {
  const { offers } = setup();
  assert.throws(() => offers.interleaveQueue('veiculos'), /não tem subcategorias/);
  assert.throws(() => offers.interleaveQueue('moda'), /vazia/);
});

test('editar: escolher a subcategoria na mão e voltar pra automática', async () => {
  const { offers, add } = setup();
  const offer = await add('Jogo de Panelas 5 Peças', { approve: false });
  assert.equal(offer.subcategory, 'panelas');
  assert.equal(offers.update(offer.id, { subcategory: 'maquiagem' }).subcategory, 'maquiagem');
  assert.equal(offers.update(offer.id, { subcategory: '' }).subcategory, 'panelas');
  assert.throws(() => offers.update(offer.id, { subcategory: 'nao-existe' }), /Subcategoria inválida/);
  // mudou de categoria: a subcategoria é descoberta de novo (Veículos não tem)
  assert.equal(offers.update(offer.id, { category: 'veiculos' }).subcategory, '');
});

test('ofertas antigas (sem subcategoria) são classificadas pelo nome ao ligar o programa', () => {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  settings.update((s) => { migrateCategories(s); });
  const file = tempFile('db.json');
  const velhas = [
    { id: '1', category: 'moda', status: 'fila', title: 'Kit 4 Calcinhas Algodão', queueOrder: 1 },
    { id: '2', category: 'moda', status: 'fila', title: 'Jogo de Panelas Cerâmica', queueOrder: 2 },
    { id: '3', category: 'veiculos', status: 'fila', title: 'Capacete Moto Articulado', queueOrder: 1 },
    { id: '4', category: 'moda', status: 'postada', title: 'Esmalte Azul', queueOrder: null }
  ];
  const db = new JsonFile(file, { seq: 4, offers: velhas, sessions: [], queueState: {} });
  const offers = new OfferService({ db, settings, reader: async () => fakeProduct() });
  assert.equal(offers.get('1').subcategory, 'intimas');
  assert.equal(offers.get('2').subcategory, 'panelas');
  assert.equal(offers.get('3').subcategory, '');
  assert.equal(offers.get('4').subcategory, 'unhas');
  // só preenche: a ordem da fila continua a mesma até você mandar intercalar
  assert.deepEqual(offers.queued('moda').map((o) => o.id), ['1', '2']);
  // ligar de novo não faz nada
  assert.equal(new OfferService({ db, settings, reader: async () => fakeProduct() }).fillSubcategories(), 0);
});
