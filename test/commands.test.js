import { tempFile, FakeWhatsApp, fakeProduct } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonFile } from '../src/store.js';
import { DEFAULT_SETTINGS } from '../src/config.js';
import { OfferService } from '../src/offers.js';
import { QueueRunner } from '../src/queue.js';
import { LunaCommands } from '../src/commands.js';

function setup(reader) {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  settings.update((s) => { s.groups.offers = ['111-1@g.us']; s.groups.control = '222-2@g.us'; });
  const db = new JsonFile(tempFile('db.json'), { seq: 0, offers: [], sessions: [], queueState: { lastPostAt: null }, radarState: {} });
  let n = 0;
  const offers = new OfferService({ db, settings, reader: reader || (async () => fakeProduct({ productId: `MLB10000${++n}`, resolvedUrl: `https://produto.mercadolivre.com.br/MLB-10000${n}` })) });
  const whatsapp = new FakeWhatsApp();
  const queue = new QueueRunner({ offers, settings, db, whatsapp, loadImage: async () => Buffer.from('jpeg'), delayBetweenGroupsMs: 0 });
  const luna = new LunaCommands({ offers, queue, whatsapp, settings, loadImage: async () => Buffer.from('jpeg') });
  luna.attach();
  const say = async (text, jid = '222-2@g.us') => {
    whatsapp.emit('message', { jid, isGroup: true, text });
    await luna.busy;
  };
  return { settings, offers, whatsapp, queue, luna, say };
}

test('link no zap: mostra prévia com foto e pergunta', async () => {
  const { whatsapp, say } = setup();
  await say('posta essa https://meli.la/abc');
  const last = whatsapp.sent.at(-1);
  assert.equal(last.type, 'image');
  assert.equal(last.jid, '222-2@g.us');
  assert.match(last.caption, /🛍️ Fone de Ouvido/);
  assert.match(last.caption, /Responde \*sim\*/);
});

test('"sim" aprova e "não" descarta', async () => {
  const { offers, whatsapp, say } = setup();
  await say('https://meli.la/abc');
  await say('Siiim');
  assert.equal(offers.list[0].status, 'fila');
  assert.match(whatsapp.sent.at(-1).text, /na fila/);
  await say('https://meli.la/def');
  await say('não');
  assert.equal(offers.list[1].status, 'descartada');
});

test('corrigir preço pelo zap', async () => {
  const { offers, say } = setup(async () => fakeProduct({ price: null, oldPrice: null }));
  await say('https://meli.la/abc');
  assert.deepEqual(offers.list[0].missing, ['preço']);
  await say('preço 39,90');
  assert.equal(offers.list[0].price, 39.9);
  await say(`de ${offers.list[0].id} 79,90`);
  assert.equal(offers.list[0].oldPrice, 79.9);
  await say('sim');
  assert.equal(offers.list[0].status, 'fila');
});

test('só obedece no grupo de comando', async () => {
  const { whatsapp, offers, say } = setup();
  await say('https://meli.la/abc', '111-1@g.us');
  await say('https://meli.la/abc', '5511999999999@s.whatsapp.net');
  assert.equal(offers.list.length, 0);
  assert.equal(whatsapp.sent.length, 0);
});

test('fila, pausar, voltar, status, ajuda e comando desconhecido', async () => {
  const { settings, whatsapp, say } = setup();
  await say('https://meli.la/abc');
  await say('sim');
  await say('fila');
  assert.match(whatsapp.sent.at(-1).text, /Fila \(1\)/);
  await say('pausar');
  assert.equal(settings.get().queue.paused, true);
  await say('voltar');
  assert.equal(settings.get().queue.paused, false);
  await say('status');
  assert.match(whatsapp.sent.at(-1).text, /Na fila: 1/);
  await say('ajuda');
  assert.match(whatsapp.sent.at(-1).text, /comandos/);
  await say('bom dia luna');
  assert.match(whatsapp.sent.at(-1).text, /Não entendi/);
});

test('agora: posta já nos grupos de ofertas', async () => {
  const { whatsapp, offers, say } = setup();
  await say('https://meli.la/abc');
  await say('sim');
  await say('agora');
  assert.equal(offers.list[0].status, 'postada');
  assert.ok(whatsapp.sent.some((m) => m.jid === '111-1@g.us' && m.type === 'image'));
  assert.match(whatsapp.sent.at(-1).text, /postada em 1 grupo/);
});

test('produto repetido: avisa e oferece "repetir"', async () => {
  const { whatsapp, say } = setup(async () => fakeProduct());
  await say('https://meli.la/abc');
  await say('https://meli.la/abc');
  assert.match(whatsapp.sent.at(-1).text, /repetir 1/);
});
