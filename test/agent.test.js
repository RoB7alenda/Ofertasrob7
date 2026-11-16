import { tempFile, prepareSettings } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonFile } from '../src/store.js';
import { DEFAULT_SETTINGS } from '../src/config.js';
import { OfferService } from '../src/offers.js';
import { classifyByKeywords, findCategoryByName, migrateCategories } from '../src/categories.js';
import { candidateKeys, discountOf, rejectReason, scoreOf, shortlist } from '../src/agent/rules.js';
import { cleanProductUrl, searchUrl, toCandidate } from '../src/agent/mercadolivre.js';
import { AiService, costOf, extractJson } from '../src/ai.js';
import { AgentService } from '../src/agent/index.js';

const VEICULOS = DEFAULT_SETTINGS.categories.find((c) => c.id === 'veiculos');

function candidate(overrides = {}) {
  return {
    platform: 'mercadolivre',
    title: 'Kit Lavagem Automotiva Completo 10 Peças',
    url: 'https://www.mercadolivre.com.br/kit-lavagem/p/MLB111111#polycard',
    productId: 'MLB111111',
    price: 79.9,
    oldPrice: 129.9,
    discount: 38,
    rating: 4.8,
    reviews: 320,
    sales: 0,
    freeShipping: true,
    full: false,
    imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_1-O.webp',
    keyword: 'kit lavagem automotiva',
    ...overrides
  };
}

test('categorias: migra a config antiga pra "Geral" e acha pelo nome', () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.groups.offers = ['111-1@g.us'];
  s.queue.start = '09:00';
  assert.equal(migrateCategories(s), true);
  const geral = s.categories.find((c) => c.id === 'geral');
  assert.deepEqual(geral.groups, ['111-1@g.us']);
  assert.equal(geral.start, '09:00');
  assert.equal(migrateCategories(s), false); // só uma vez
  assert.equal(s.groups.offers, undefined);
  assert.equal(s.queue.start, undefined);
  assert.equal(s.categories.find((c) => c.id === 'veiculos').enabled, true);
  assert.equal(s.categories.find((c) => c.id === 'moda').enabled, false);
  assert.equal(findCategoryByName(s, 'Veículo'), 'veiculos');
  assert.equal(findCategoryByName(s, 'casa'), 'casa');
  assert.equal(findCategoryByName(s, 'eletronicos'), 'eletronicos');
  assert.equal(findCategoryByName(s, 'bicicleta'), '');
});

test('categorias: sem IA, escolhe pelas palavras de busca', () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  assert.equal(classifyByKeywords(s, 'Capacete Moto Fechado Pro Tork'), 'veiculos');
  assert.equal(classifyByKeywords(s, 'Kit 10 Cuecas Boxer Masculina'), 'moda');
  assert.equal(classifyByKeywords(s, 'Fritadeira Air Fryer 4L Mondial'), 'casa');
  assert.equal(classifyByKeywords(s, 'Fone de Ouvido Bluetooth TWS'), 'eletronicos');
  assert.equal(classifyByKeywords(s, 'Livro de receitas'), 'geral');
});

test('link colado: categoria desligada vai pra Geral', async () => {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  prepareSettings(settings);
  const db = new JsonFile(tempFile('db.json'), { seq: 0, offers: [], sessions: [], queueState: {} });
  const product = (title, id) => async () => ({ title, price: 50, oldPrice: 80, imageUrl: 'https://http2.mlstatic.com/a-O.jpg', productId: id, resolvedUrl: `https://produto.mercadolivre.com.br/${id}` });
  let offers = new OfferService({ db, settings, reader: product('Capacete Moto Fechado', 'MLB5551') });
  assert.equal((await offers.addFromUrl('https://meli.la/a1')).offer.category, 'veiculos');
  offers = new OfferService({ db, settings, reader: product('Kit 10 Cuecas Boxer', 'MLB5552') });
  assert.equal((await offers.addFromUrl('https://meli.la/a2')).offer.category, 'geral'); // Moda desligada
  settings.update((s) => { s.categories.find((c) => c.id === 'moda').enabled = true; });
  offers = new OfferService({ db, settings, reader: product('Kit 12 Cuecas Boxer', 'MLB5553') });
  assert.equal((await offers.addFromUrl('https://meli.la/a3')).offer.category, 'moda');
});

test('regras: filtro, nota e repetidos', () => {
  assert.equal(discountOf(80, 100), 20);
  assert.equal(discountOf(80, 0), 0);
  assert.equal(rejectReason(candidate(), VEICULOS), '');
  assert.match(rejectReason(candidate({ discount: 10 }), VEICULOS), /desconto/);
  assert.match(rejectReason(candidate({ rating: 4.2 }), VEICULOS), /nota/);
  assert.match(rejectReason(candidate({ rating: 0 }), VEICULOS), /nota/);
  assert.match(rejectReason(candidate({ reviews: 3 }), VEICULOS), /poucas/);
  assert.match(rejectReason(candidate({ freeShipping: false }), VEICULOS), /frete/);
  assert.equal(rejectReason(candidate({ freeShipping: false, full: true }), VEICULOS), '');
  assert.match(rejectReason(candidate({ imageUrl: '' }), VEICULOS), /foto/);
  assert.ok(scoreOf(candidate({ discount: 50 })) > scoreOf(candidate({ discount: 25 })));
  assert.deepEqual(candidateKeys(candidate()), ['ml:MLB111111']);

  const list = [
    candidate({ discount: 25 }),
    candidate({ productId: 'MLB222', url: 'https://x/MLB222', title: 'Aspirador Automotivo 12V', discount: 45 }),
    candidate({ productId: 'MLB222', url: 'https://x/MLB222', title: 'Aspirador Automotivo 12V (de novo)', discount: 45 }),
    candidate({ productId: 'MLB333', url: 'https://x/MLB333', title: 'Cera Automotiva', discount: 5 }),
    candidate({ productId: 'MLB444', url: 'https://x/MLB444', title: 'Já postado' })
  ];
  const { kept, reasons } = shortlist(list, VEICULOS, new Set(['ml:MLB444']));
  assert.deepEqual(kept.map((c) => c.productId), ['MLB222', 'MLB111111']);
  assert.equal(reasons['desconto menor que 20%'], 1);
});

test('Mercado Livre: link da busca, card e link limpo', () => {
  assert.equal(searchUrl('Câmera de Ré'), 'https://lista.mercadolivre.com.br/camera-de-re');
  assert.equal(cleanProductUrl('https://www.mercadolivre.com.br/x/p/MLB1?tracking_id=abc&pdp_filters=item_id#polycard_client=search'), 'https://www.mercadolivre.com.br/x/p/MLB1?pdp_filters=item_id');
  const c = toCandidate({ title: 'Capacete', url: 'https://produto.mercadolivre.com.br/MLB-123456789-capacete', price: 150, oldPrice: 200, discountLabel: 25, rating: 4.7, reviews: 88, freeShipping: true, full: true, imageUrl: 'https://http2.mlstatic.com/D_Q_NP_2X_1-V.webp' });
  assert.equal(c.productId, 'MLB123456789');
  assert.equal(c.discount, 25);
  assert.equal(c.full, true);
  assert.equal(c.imageUrl, 'https://http2.mlstatic.com/D_Q_NP_2X_1-O.webp');
  // sem preço antigo não inventa desconto
  assert.equal(toCandidate({ title: 'X', url: 'https://x/MLB-1234567', price: 10, oldPrice: 0, discountLabel: 30 }).discount, 0);
});

function fakeFetch(reply, usage = { input_tokens: 1000, output_tokens: 100 }) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), key: init.headers['x-api-key'] });
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: typeof reply === 'function' ? reply(calls.length) : reply }], usage }) };
  };
  fn.calls = calls;
  return fn;
}

function aiSetup(fetchImpl, limit = 0.25) {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  prepareSettings(settings);
  settings.update((s) => { s.ai.apiKey = 'sk-ant-api03-teste-teste-teste-teste'; s.ai.dailyLimitUsd = limit; });
  const db = new JsonFile(tempFile('db.json'), { seq: 0, offers: [], sessions: [], queueState: {} });
  return { settings, db, ai: new AiService({ settings, db, fetchImpl }) };
}

test('IA: custo, JSON e limite por dia', async () => {
  assert.equal(costOf('claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 0 }), 1);
  assert.equal(costOf('modelo-desconhecido', { input_tokens: 0, output_tokens: 1_000_000 }), 75);
  assert.equal(costOf('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 0.6);
  assert.deepEqual(extractJson('aqui: {"a":1} pronto'), { a: 1 });
  assert.throws(() => extractJson('nada'), /JSON/);

  const fetchImpl = fakeFetch('veiculos', { input_tokens: 1_000_000, output_tokens: 100_000 }); // US$ 0,15 por chamada no Haiku 5.5
  const { ai } = aiSetup(fetchImpl);
  assert.equal(await ai.classify('Capacete moto'), 'veiculos');
  assert.equal(fetchImpl.calls[0].key, 'sk-ant-api03-teste-teste-teste-teste');
  assert.equal(ai.status().calls, 1);
  assert.equal(await ai.classify('Capacete moto'), 'veiculos'); // 0,30: passou do limite
  assert.equal(ai.available(), false);
  assert.equal(await ai.classify('Capacete moto'), ''); // não chama mais hoje
  assert.equal(fetchImpl.calls.length, 2);
  await assert.rejects(() => ai.ask({ system: 'x', prompt: 'y' }), /limite/);
});

test('IA: escolhe da lista e ignora número inválido', async () => {
  const { ai } = aiSetup(fakeFetch('{"escolhidos":[{"n":2,"motivo":"ótimo desconto"},{"n":9},{"n":2},{"n":1,"motivo":"vende muito"}],"recusados":[]}'));
  const picks = await ai.pick(VEICULOS, [candidate(), candidate({ title: 'Aspirador' })], 5);
  assert.deepEqual(picks, [{ index: 1, reason: 'ótimo desconto' }, { index: 0, reason: 'vende muito' }]);
});

function agentSetup({ ai = null, found = null } = {}) {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  prepareSettings(settings);
  const db = new JsonFile(tempFile('db.json'), { seq: 0, offers: [], sessions: [], queueState: {} });
  const offers = new OfferService({ db, settings, reader: async () => { throw new Error('não deveria ler'); } });
  const notices = [];
  const searched = [];
  const results = found || [
    candidate(),
    candidate({ productId: 'MLB222', url: 'https://www.mercadolivre.com.br/a/p/MLB222', title: 'Aspirador Automotivo Portátil 12V', discount: 45 }),
    candidate({ productId: 'MLB333', url: 'https://www.mercadolivre.com.br/b/p/MLB333', title: 'Cera Automotiva', discount: 5 })
  ];
  const agent = new AgentService({
    settings, db, offers, ai,
    notify: async (text) => notices.push(text),
    searchMl: async (keywords) => { searched.push(keywords); return results; },
    makeLinks: async (urls) => new Map(urls.map((u, i) => [u, `https://meli.la/rob7${i}${u.length}`]))
  });
  return { settings, db, offers, agent, notices, searched };
}

test('RoB7 (modo treino): busca, filtra, gera link e espera aprovação', async () => {
  const { offers, agent, notices, searched, db } = agentSetup();
  const added = await agent.run({ categoryId: 'veiculos' });
  assert.equal(added.length, 2);
  assert.equal(searched[0].length, 3); // 3 palavras por rodada
  for (const o of added) {
    assert.equal(o.status, 'aguardando');
    assert.equal(o.category, 'veiculos');
    assert.equal(o.origin, 'rob7');
    assert.equal(o.awaitingZap, true);
    assert.match(o.publishUrl, /^https:\/\/meli\.la\//);
    assert.equal(o.publishUrl, o.inputUrl);
    assert.match(o.notes[0], /RoB7/);
  }
  assert.equal(added[0].title, 'Aspirador Automotivo Portátil 12V'); // maior desconto primeiro
  assert.match(notices[0], /RoB7\* achou 2 oferta/);
  assert.match(notices[0], /\*Veículos\*/);
  assert.match(notices[0], /sim 12/);
  assert.equal(db.get().agentState.byCategory.veiculos.keywordIndex, 3);

  // Rodando de novo: não repete produto
  const again = await agent.run({ categoryId: 'veiculos' });
  assert.equal(again.length, 0);
  assert.equal(offers.pending('veiculos').length, 2);
});

test('RoB7 (piloto automático): vai direto pra fila; para quando tem muita coisa esperando', async () => {
  const { settings, agent, offers } = agentSetup();
  settings.update((s) => { s.agent.autopilot = true; });
  const added = await agent.run({ categoryId: 'veiculos' });
  assert.ok(added.every((o) => o.status === 'fila'));
  assert.equal(offers.queued('veiculos').length, 2);

  const other = agentSetup();
  other.settings.update((s) => { s.agent.maxPending = 1; s.agent.perRun = 5; });
  assert.equal((await other.agent.run({ categoryId: 'veiculos' })).length, 1);
  assert.equal((await other.agent.run({ categoryId: 'veiculos' })).length, 0);
  assert.match(other.agent.status().categories.find((c) => c.id === 'veiculos').lastResult, /parado/);
});

test('RoB7 com IA: a IA escolhe; sem link de afiliado não vira oferta', async () => {
  const fetchImpl = fakeFetch('{"escolhidos":[{"n":2,"motivo":"mais barato"}]}');
  const { ai } = aiSetup(fetchImpl);
  const { agent, offers } = agentSetup({ ai });
  const added = await agent.run({ categoryId: 'veiculos' });
  assert.equal(added.length, 1);
  assert.equal(added[0].productId, 'MLB111111'); // 2º da lista ordenada
  assert.ok(added[0].notes.some((n) => /IA: mais barato/.test(n)));
  assert.match(fetchImpl.calls[0].body.system, /Veículos/);

  const noLink = agentSetup();
  noLink.agent.makeLinks = async () => new Map();
  assert.equal((await noLink.agent.run({ categoryId: 'veiculos' })).length, 0);
  assert.match(noLink.agent.status().categories.find((c) => c.id === 'veiculos').lastError, /link de afiliado/);
  assert.equal(offers.list.length, 1);
});

test('RoB7: horário, intervalo e erros', async () => {
  const { agent, settings, notices } = agentSetup();
  const day = (h, m = 0) => new Date(2026, 10, 16, h, m);
  assert.equal(agent.inWindow(settings.get().categories.find((c) => c.id === 'veiculos'), day(7, 30)), true);
  assert.equal(agent.inWindow(settings.get().categories.find((c) => c.id === 'veiculos'), day(21, 45)), false);
  assert.deepEqual(agent.workable().map((c) => c.id), ['veiculos']);

  await agent.tick(day(3));
  assert.equal(agent.status().lastRunAt, null); // de madrugada não procura
  await agent.tick(day(10));
  assert.ok(agent.status().lastRunAt);
  const first = agent.status().lastRunAt;
  await agent.tick(new Date(Date.parse(first) + 60 * 60_000));
  assert.equal(agent.status().lastRunAt, first); // ainda não deu 2h

  await assert.rejects(() => agent.run({ categoryId: 'geral' }), /inválida/);
  agent.searchMl = async () => [];
  await agent.run({ categoryId: 'veiculos' });
  assert.match(notices.at(-1), /teve problema/);
  const count = notices.length;
  await agent.run({ categoryId: 'veiculos' });
  assert.equal(notices.length, count); // mesmo erro não avisa de novo no mesmo dia
});
