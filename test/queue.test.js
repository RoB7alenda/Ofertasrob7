import { tempFile, FakeWhatsApp, fakeProduct, prepareSettings, toGeneral } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { forecast, nextSlot, QueueRunner, validQueueSettings } from '../src/queue.js';
import { JsonFile } from '../src/store.js';
import { DEFAULT_SETTINGS } from '../src/config.js';
import { OfferService } from '../src/offers.js';

const Q = { start: '08:00', end: '22:00', intervalMin: 30, days: [0, 1, 2, 3, 4, 5, 6] };
const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0, 0);

test('valida o horário da fila', () => {
  assert.equal(validQueueSettings(Q), '');
  assert.match(validQueueSettings({ ...Q, end: '07:00' }), /depois/);
  assert.match(validQueueSettings({ ...Q, intervalMin: 1 }), /intervalo/);
  assert.match(validQueueSettings({ ...Q, days: [] }), /dia/);
});

test('próximo horário: dentro, antes e depois do horário', () => {
  assert.equal(nextSlot(at(2026, 11, 16, 10, 0), null, Q).getTime(), at(2026, 11, 16, 10, 0).getTime());
  assert.equal(nextSlot(at(2026, 11, 16, 6, 0), null, Q).getTime(), at(2026, 11, 16, 8, 0).getTime());
  assert.equal(nextSlot(at(2026, 11, 16, 23, 0), null, Q).getTime(), at(2026, 11, 17, 8, 0).getTime());
  // última postagem às 10:00 -> próxima 10:30
  assert.equal(nextSlot(at(2026, 11, 16, 10, 5), at(2026, 11, 16, 10, 0), Q).getTime(), at(2026, 11, 16, 10, 30).getTime());
  // 21:50 + 30 min passa das 22h -> amanhã 8h
  assert.equal(nextSlot(at(2026, 11, 16, 21, 55), at(2026, 11, 16, 21, 50), Q).getTime(), at(2026, 11, 17, 8, 0).getTime());
});

test('pula os dias desmarcados', () => {
  const weekdays = { ...Q, days: [1, 2, 3, 4, 5] };
  // 21/11/2026 é sábado -> segunda 23/11 às 8h
  assert.equal(nextSlot(at(2026, 11, 21, 12, 0), null, weekdays).getTime(), at(2026, 11, 23, 8, 0).getTime());
});

test('previsão da fila: uma a cada 30 min', () => {
  const plan = forecast([{ id: '1' }, { id: '2' }, { id: '3' }], at(2026, 11, 16, 9, 0), null, Q);
  assert.deepEqual(plan.map((p) => new Date(p.at).getHours() * 60 + new Date(p.at).getMinutes()), [540, 570, 600]);
});

function setup() {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  prepareSettings(settings);
  const db = new JsonFile(tempFile('db.json'), { seq: 0, offers: [], sessions: [], queueState: {} });
  const offers = new OfferService({ db, settings, reader: async () => fakeProduct(), classifier: toGeneral });
  const whatsapp = new FakeWhatsApp();
  const queue = new QueueRunner({ offers, settings, db, whatsapp, loadImage: async () => Buffer.from('jpeg'), delayBetweenGroupsMs: 0 });
  return { settings, db, offers, whatsapp, queue };
}

test('posta no horário, marca postada e respeita o intervalo', async () => {
  const { offers, whatsapp, queue, db } = setup();
  const { offer } = await offers.addFromUrl('https://meli.la/abc');
  offers.approve(offer.id);
  const { offer: second } = await offers.addFromUrl('https://meli.la/def', { preset: fakeProduct({ productId: 'MLB999', resolvedUrl: 'https://produto.mercadolivre.com.br/MLB-999' }) });
  offers.approve(second.id);

  await queue.tick(at(2026, 11, 16, 10, 0));
  assert.equal(offers.get(offer.id).status, 'postada');
  assert.equal(whatsapp.sent.length, 1);
  assert.equal(whatsapp.sent[0].jid, '111-1@g.us');
  assert.match(whatsapp.sent[0].caption, /https:\/\/meli\.la\/abc/);
  const last = db.get().queueState.byCategory.geral;
  assert.ok(last);

  // logo em seguida não posta (intervalo de 30 min)
  await queue.tick(new Date(Date.parse(last) + 60_000));
  assert.equal(offers.get(second.id).status, 'fila');
});

test('não posta pausada, sem WhatsApp ou fora do horário', async () => {
  const { offers, whatsapp, queue, settings } = setup();
  const { offer } = await offers.addFromUrl('https://meli.la/abc');
  offers.approve(offer.id);
  await queue.tick(at(2026, 11, 16, 23, 0));
  assert.equal(offers.get(offer.id).status, 'fila');
  whatsapp.connected = false;
  await queue.tick(at(2026, 11, 16, 10, 0));
  assert.equal(offers.get(offer.id).status, 'fila');
  whatsapp.connected = true;
  settings.update((s) => { s.queue.paused = true; });
  await queue.tick(at(2026, 11, 16, 10, 0));
  assert.equal(offers.get(offer.id).status, 'fila');
  assert.equal(whatsapp.sent.length, 0);
});

test('falha no envio: tenta de novo e depois marca falhou', async () => {
  const { offers, whatsapp, queue } = setup();
  whatsapp.failFor.add('111-1@g.us');
  const { offer } = await offers.addFromUrl('https://meli.la/abc');
  offers.approve(offer.id);
  await queue.post(offers.get(offer.id));
  assert.equal(offers.get(offer.id).status, 'fila');
  assert.ok(offers.get(offer.id).retryAfter);
  await queue.post(offers.get(offer.id));
  await queue.post(offers.get(offer.id));
  assert.equal(offers.get(offer.id).status, 'falhou');
});

test('postar agora pula a fila', async () => {
  const { offers, whatsapp, queue } = setup();
  const { offer } = await offers.addFromUrl('https://meli.la/abc');
  const result = await queue.sendNow(offer.id);
  assert.equal(result.status, 'postada');
  assert.equal(whatsapp.sent.length, 1);
});

test('horários desencontrados: a categoria com atraso começa depois', () => {
  const late = { ...Q, offsetMin: 8 };
  assert.equal(nextSlot(at(2026, 11, 16, 6, 0), null, late).getTime(), at(2026, 11, 16, 8, 8).getTime());
  // depois que já postou, segue o intervalo normal
  assert.equal(nextSlot(at(2026, 11, 16, 10, 0), at(2026, 11, 16, 9, 38), late).getTime(), at(2026, 11, 16, 10, 8).getTime());
});

test('cada categoria posta no seu grupo e tem a sua fila', async () => {
  const { offers, whatsapp, queue, settings } = setup();
  settings.update((s) => {
    const v = s.categories.find((c) => c.id === 'veiculos');
    v.enabled = true;
    v.groups = ['333-3@g.us'];
  });
  const { offer: geral } = await offers.addFromUrl('https://meli.la/abc');
  const { offer: carro } = await offers.addFromUrl('https://meli.la/def', { category: 'veiculos', preset: fakeProduct({ productId: 'MLB777', resolvedUrl: 'https://produto.mercadolivre.com.br/MLB-777', title: 'Kit Lavagem Automotiva' }) });
  offers.approve(geral.id);
  offers.approve(carro.id);
  assert.equal(offers.queued('geral').length, 1);
  assert.equal(offers.queued('veiculos').length, 1);
  assert.equal(queue.status().categories.find((c) => c.id === 'veiculos').size, 1);

  await queue.tick(at(2026, 11, 16, 10, 0));
  await queue.tick(at(2026, 11, 16, 10, 1));
  assert.equal(offers.get(geral.id).status, 'postada');
  assert.equal(offers.get(carro.id).status, 'postada');
  assert.deepEqual(whatsapp.sent.map((m) => m.jid).sort(), ['111-1@g.us', '333-3@g.us']);
});

test('categoria sem grupo ou desligada não posta', async () => {
  const { offers, whatsapp, queue } = setup();
  const { offer } = await offers.addFromUrl('https://meli.la/abc', { category: 'moda' });
  offers.approve(offer.id);
  await queue.tick(at(2026, 11, 16, 10, 0));
  assert.equal(offers.get(offer.id).status, 'fila');
  assert.equal(whatsapp.sent.length, 0);
  await assert.rejects(() => queue.sendNow(offer.id), /não tem grupo/);
});
