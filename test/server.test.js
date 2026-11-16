import { tempFile, FakeWhatsApp, fakeProduct, prepareSettings } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonFile } from '../src/store.js';
import { DEFAULT_SETTINGS } from '../src/config.js';
import { OfferService } from '../src/offers.js';
import { QueueRunner } from '../src/queue.js';
import { createServer } from '../src/server.js';
import { applySettingsPatch, publicSettings } from '../src/settings-patch.js';

function boot() {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  prepareSettings(settings, { offers: [], control: '' });
  const db = new JsonFile(tempFile('db.json'), { seq: 0, offers: [], sessions: [], queueState: {} });
  const offers = new OfferService({ db, settings, reader: async () => fakeProduct() });
  const whatsapp = new FakeWhatsApp();
  const queue = new QueueRunner({ offers, settings, db, whatsapp, loadImage: async () => Buffer.from('jpeg'), delayBetweenGroupsMs: 0 });
  const agent = { status: () => ({ running: '' }), run: async ({ categoryId }) => { if (categoryId === 'xx') throw new Error('Categoria inválida.'); return []; } };
  const ctx = { settings, db, offers, queue, whatsapp, agent, loadImage: async () => Buffer.from('jpeg'), buildState: () => ({ ok: true }) };
  const { app } = createServer(ctx);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, settings, offers }));
  });
}

function client(base) {
  let cookie = '';
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

test('painel: criar senha, login, criar e aprovar oferta', async () => {
  const { server, base, offers } = await boot();
  try {
    const call = client(base);
    let r = await call('/api/state');
    assert.equal(r.status, 401);
    r = await call('/api/auth');
    assert.equal(r.data.canSetup, true);
    r = await call('/api/auth/setup', { method: 'POST', body: { password: '123' } });
    assert.equal(r.status, 400);
    r = await call('/api/auth/setup', { method: 'POST', body: { password: 'senha-forte' } });
    assert.equal(r.status, 200);
    r = await call('/api/state');
    assert.equal(r.status, 200);

    // Sem cookie: bloqueado. Senha errada: 401.
    const other = client(base);
    assert.equal((await other('/api/offers')).status, 401);
    assert.equal((await other('/api/auth/login', { method: 'POST', body: { password: 'errada' } })).status, 401);
    assert.equal((await other('/api/auth/login', { method: 'POST', body: { password: 'senha-forte' } })).status, 200);
    assert.equal((await other('/api/offers')).status, 200);

    r = await call('/api/offers', { method: 'POST', body: { text: 'https://meli.la/abc' } });
    assert.equal(r.status, 200);
    const id = r.data[0].offer.id;
    assert.match(r.data[0].offer.caption, /🔥 Por: R\$ 49,90/);
    assert.match(r.data[0].offer.caption, /^\*🔥 50% OFF\*/);
    assert.equal(r.data[0].offer.discount, 50);

    r = await call(`/api/offers/${id}`, { method: 'PATCH', body: { price: '45,00', coupon: 'FONE10' } });
    assert.equal(r.data.price, 45);
    assert.equal(r.data.coupon, 'FONE10');
    assert.match(r.data.caption, /🎟️ Cupom: FONE10/);
    r = await call(`/api/offers/${id}/approve`, { method: 'POST', body: {} });
    assert.equal(r.data.status, 'fila');
    assert.equal(offers.queued().length, 1);

    // Categoria: o fone seria de Eletrônicos, mas ela está desligada -> Geral; dá pra trocar
    assert.equal(r.data.category, 'geral');
    r = await call(`/api/offers/${id}`, { method: 'PATCH', body: { category: 'moda' } });
    assert.equal(r.data.category, 'moda');
    assert.equal((await call('/api/offers?status=fila&category=moda')).data.length, 1);
    assert.equal((await call('/api/offers?status=fila&category=veiculos')).data.length, 0);
    r = await call(`/api/offers/${id}`, { method: 'PATCH', body: { category: 'nada' } });
    assert.equal(r.status, 400);

    // Agente RoB7
    r = await call('/api/agent/run', { method: 'POST', body: { category: 'xx' } });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Categoria inválida/);
    r = await call('/api/agent/run', { method: 'POST', body: {} });
    assert.equal(r.status, 200);

    // Erro amigável
    r = await call('/api/offers/999/approve', { method: 'POST', body: {} });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Não achei/);

    // Pedido vindo de outro site é bloqueado
    r = await call('/api/queue/pause', { method: 'POST', body: { paused: true }, headers: { origin: 'https://evil.com' } });
    assert.equal(r.status, 403);

    // Configurações: segredo não volta pro painel
    r = await call('/api/settings', { method: 'PUT', body: { shopeeApi: { appId: '123456', secret: 'segredo' } } });
    assert.equal(r.status, 200);
    assert.equal(r.data.shopeeApi.hasSecret, true);
    assert.equal(r.data.shopeeApi.secret, undefined);
    assert.equal(r.data.panel.passwordHash, undefined);

    // Túnel do celular: só muda pelo PC (pedido vindo pela Cloudflare é recusado)
    r = await call('/api/settings', { method: 'PUT', body: { tunnel: { enabled: false } }, headers: { 'cf-connecting-ip': '1.2.3.4' } });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /só dá pra mudar pelo painel no PC/);
  } finally {
    server.close();
  }
});

test('configurações: validação', () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  const cat = (patch) => applySettingsPatch(s, { categories: [{ id: 'veiculos', ...patch }] });
  assert.throws(() => cat({ start: '22:00', end: '08:00' }), /depois/);
  assert.throws(() => applySettingsPatch(s, { categories: [{ id: 'nada' }] }), /desconhecida/);
  assert.throws(() => applySettingsPatch(s, { categories: [{ id: 'veiculos', groups: ['1-1@g.us'] }, { id: 'moda', groups: ['1-1@g.us'] }] }), /duas categorias/);
  assert.throws(() => applySettingsPatch(s, { categories: [{ id: 'veiculos', groups: ['1-1@g.us'] }], groups: { control: '1-1@g.us' } }), /comando/);
  assert.throws(() => applySettingsPatch(s, { shopeeApi: { appId: 'abc' } }), /números/);
  assert.throws(() => applySettingsPatch(s, { ai: { apiKey: 'chave-errada' } }), /sk-ant/);
  const next = applySettingsPatch(s, {
    groups: { control: '2-2@g.us' },
    categories: [{ id: 'veiculos', groups: ['1-1@g.us', 'lixo'], intervalMin: 15, keywords: ['  capacete ', 'capacete', ''], minDiscount: 30 }],
    agent: { autopilot: true, everyMin: 60 },
    ai: { apiKey: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', dailyLimitUsd: 0.25 },
    message: { showDiscount: false, showCoupon: 'x' }
  });
  const v = next.categories.find((c) => c.id === 'veiculos');
  assert.deepEqual(v.groups, ['1-1@g.us']);
  assert.equal(v.intervalMin, 15);
  assert.deepEqual(v.keywords, ['capacete']);
  assert.equal(v.minDiscount, 30);
  assert.equal(next.agent.autopilot, true);
  assert.equal(next.agent.everyMin, 60);
  assert.equal(next.message.showDiscount, false);
  assert.equal(next.message.showCoupon, true);
  const shown = publicSettings(next);
  assert.equal(shown.ai.hasKey, true);
  assert.ok(!JSON.stringify(shown).includes('sk-ant'));
});
