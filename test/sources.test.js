import { tempFile, FakeWhatsApp, prepareSettings } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonFile } from '../src/store.js';
import { DEFAULT_SETTINGS } from '../src/config.js';
import { OfferService } from '../src/offers.js';
import { applySettingsPatch } from '../src/settings-patch.js';
import { SourceWatcher, mercadoLivreProductUrl, pageWithoutParams } from '../src/sources.js';

const FORA = '999-9@g.us';

function setup({ product = {}, links = null } = {}) {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  prepareSettings(settings);
  settings.update((s) => {
    s.categories.find((c) => c.id === 'veiculos').groups = ['333-3@g.us'];
    s.sources = { enabled: true, groups: [FORA], autoQueue: true, maxQueued: 40 };
  });
  const db = new JsonFile(tempFile('db.json'), { seq: 0, offers: [], sessions: [], queueState: {} });
  const offers = new OfferService({ db, settings, reader: async () => { throw new Error('não deveria ler'); } });
  const whatsapp = new FakeWhatsApp();
  const reads = [];
  const built = [];
  const reader = async (platform, url) => {
    reads.push(url);
    return { title: 'Capacete Moto Fechado Pro Tork - R$ 189,90', price: 189.9, oldPrice: 259.9, imageUrl: 'https://http2.mlstatic.com/a-O.jpg', productId: 'MLB23487640', resolvedUrl: 'https://www.mercadolivre.com.br/social/outro?matt_word=outro&ref=x', ...product };
  };
  const makeLinks = links || (async (urls) => { built.push(...urls); return new Map(urls.map((u) => [u, 'https://meli.la/NOSSO1'])); });
  const watcher = new SourceWatcher({ settings, db, offers, whatsapp, reader, makeLinks });
  watcher.attach();
  const say = async (text, jid = FORA) => {
    whatsapp.emit('message', { jid, isGroup: true, text, sender: '1@s.whatsapp.net' });
    await watcher.chain;
  };
  return { settings, db, offers, whatsapp, watcher, reads, built, say };
}

test('copiar: oferta do grupo de fora vira oferta com o NOSSO link, direto na fila', async () => {
  const { offers, whatsapp, reads, built, say, watcher } = setup();
  await say('🔥 Capacete top!\nDe R$ 259 por R$ 189\nhttps://meli.la/DELES123');
  assert.deepEqual(reads, ['https://meli.la/DELES123']);
  assert.deepEqual(built, ['https://www.mercadolivre.com.br/p/MLB23487640']); // sem o rastreio deles
  const [offer] = offers.list;
  assert.equal(offer.publishUrl, 'https://meli.la/NOSSO1');
  assert.notEqual(offer.publishUrl, 'https://meli.la/DELES123');
  assert.equal(offer.status, 'fila');
  assert.equal(offer.category, 'veiculos');
  assert.equal(offer.origin, 'copia');
  assert.equal(offer.title, 'Capacete Moto Fechado Pro Tork');
  assert.equal(whatsapp.sent.length, 0); // nunca escreve no grupo de fora
  assert.equal(watcher.status().copiedToday, 1);

  // mesmo link de novo: ignora; mesmo produto por outro link: pula
  await say('https://meli.la/DELES123');
  await say('repost https://meli.la/OUTRO999');
  assert.equal(offers.list.length, 1);
  assert.equal(reads.length, 2);
});

test('copiar: ignora outros grupos, desligado, e produto de categoria sem grupo', async () => {
  const { offers, reads, say, settings } = setup({ product: { title: 'Kit 10 Cuecas Boxer', productId: 'MLB1234567890' } });
  await say('https://meli.la/A1', '111-1@g.us');
  assert.equal(reads.length, 0);
  settings.update((s) => { s.sources.enabled = false; });
  await say('https://meli.la/A2');
  assert.equal(reads.length, 0);
  settings.update((s) => { s.sources.enabled = true; s.categories.find((c) => c.id === 'geral').groups = []; });
  await say('https://meli.la/A3'); // Moda está desligada -> Geral, que não tem grupo
  assert.equal(reads.length, 1);
  assert.equal(offers.list.length, 0);
});

test('copiar: sem conseguir o nosso link, não cria; espera aprovar quando pedir', async () => {
  const noLink = setup({ links: async () => new Map() });
  await noLink.say('https://meli.la/X1');
  assert.equal(noLink.offers.list.length, 0);
  assert.match(noLink.watcher.status().lastError, /meli\.la/);

  const approve = setup();
  approve.settings.update((s) => { s.sources.autoQueue = false; });
  await approve.say('https://meli.la/X2');
  assert.equal(approve.offers.list[0].status, 'aguardando');
});

test('copiar: Shopee só com a API; links da página do produto', async () => {
  const { reads, say } = setup();
  await say('https://s.shopee.com.br/DELES');
  assert.equal(reads.length, 0);
  assert.equal(mercadoLivreProductUrl('MLB23487640'), 'https://www.mercadolivre.com.br/p/MLB23487640');
  assert.equal(mercadoLivreProductUrl('MLB1365410555'), 'https://produto.mercadolivre.com.br/MLB-1365410555');
  assert.equal(mercadoLivreProductUrl('MLBU3184327547'), 'https://www.mercadolivre.com.br/up/MLBU3184327547');
  assert.equal(pageWithoutParams('https://produto.mercadolivre.com.br/MLB-123456789-capacete-_JM?matt_word=deles#x'), 'https://produto.mercadolivre.com.br/MLB-123456789-capacete-_JM');
  assert.equal(pageWithoutParams('https://www.mercadolivre.com.br/social/deles?ref=1'), '');
});

test('copiar: grupo de fora não pode ser de categoria nem o de comando', () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.groups.control = '2-2@g.us';
  s.categories.find((c) => c.id === 'veiculos').groups = ['3-3@g.us'];
  assert.throws(() => applySettingsPatch(s, { sources: { groups: ['2-2@g.us'] } }), /comando/);
  assert.throws(() => applySettingsPatch(s, { sources: { groups: ['3-3@g.us'] } }), /posta/);
  const next = applySettingsPatch(s, { sources: { enabled: true, groups: ['9-9@g.us', 'lixo'], autoQueue: false } });
  assert.deepEqual(next.sources.groups, ['9-9@g.us']);
  assert.equal(next.sources.autoQueue, false);
});
