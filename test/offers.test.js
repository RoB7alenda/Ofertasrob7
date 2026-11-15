import { tempFile, fakeProduct } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonFile } from '../src/store.js';
import { DEFAULT_SETTINGS } from '../src/config.js';
import { OfferService } from '../src/offers.js';

function setup(reader = async () => fakeProduct(), shortLinker) {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  const db = new JsonFile(tempFile('db.json'), { seq: 0, offers: [], sessions: [], queueState: {}, radarState: {} });
  return { settings, db, offers: new OfferService({ db, settings, reader, shortLinker }) };
}

test('cria oferta pelo link meli.la e guarda o link exato', async () => {
  const { offers } = setup();
  const { offer } = await offers.addFromUrl('https://meli.la/1AbC?x=9');
  assert.equal(offer.status, 'aguardando');
  assert.equal(offer.publishUrl, 'https://meli.la/1AbC?x=9');
  assert.equal(offer.platform, 'mercadolivre');
  assert.deepEqual(offer.missing, []);
  assert.ok(offer.identity.includes('ml:MLB1234567890'));
});

test('recusa link do Mercado Livre que não é de afiliado', async () => {
  const { offers } = setup();
  await assert.rejects(() => offers.addFromUrl('https://produto.mercadolivre.com.br/MLB-123'), /afiliado/);
});

test('recusa link de loja desligada (TikTok vem desligado)', async () => {
  const { offers } = setup();
  await assert.rejects(() => offers.addFromUrl('https://vt.tiktok.com/ZS123/'), /desligado/);
});

test('Shopee normal + API: converte pra link de afiliado', async () => {
  const { offers, settings } = setup(async () => fakeProduct({ resolvedUrl: 'https://shopee.com.br/product/1/2', productId: '2' }), async () => 'https://s.shopee.com.br/NOVO');
  settings.update((s) => { s.shopeeApi = { appId: '123456', secret: 'segredo' }; });
  const { offer } = await offers.addFromUrl('https://shopee.com.br/product/1/2');
  assert.equal(offer.publishUrl, 'https://s.shopee.com.br/NOVO');
  assert.equal(offer.inputUrl, 'https://shopee.com.br/product/1/2');
});

test('não deixa repetir o mesmo produto (mesmo com link diferente)', async () => {
  const { offers } = setup();
  const first = await offers.addFromUrl('https://meli.la/aaa');
  const again = await offers.addFromUrl('https://meli.la/bbb');
  assert.equal(again.duplicate.id, first.offer.id);
  assert.match(again.message, /esperando aprovação/);
  const sameLink = await offers.addFromUrl('https://meli.la/aaa');
  assert.ok(sameLink.duplicate);
  const forced = await offers.addFromUrl('https://meli.la/bbb', { allowRepeat: true });
  assert.ok(forced.offer);
});

test('produto descartado pode voltar; postado há pouco não', async () => {
  const { offers } = setup();
  const { offer } = await offers.addFromUrl('https://meli.la/aaa');
  offers.reject(offer.id);
  const back = await offers.addFromUrl('https://meli.la/ccc');
  assert.ok(back.offer);
  offers.setStatus(back.offer, 'postada', { postedAt: new Date().toISOString() });
  const blocked = await offers.addFromUrl('https://meli.la/ddd');
  assert.match(blocked.message, /já foi postado/);
});

test('faltando preço: não aprova até corrigir', async () => {
  const { offers } = setup(async () => fakeProduct({ price: null, oldPrice: null }));
  const { offer } = await offers.addFromUrl('https://meli.la/x');
  assert.deepEqual(offer.missing, ['preço']);
  assert.throws(() => offers.approve(offer.id), /falta preço/);
  offers.update(offer.id, { price: '59,90' });
  assert.equal(offers.approve(offer.id).status, 'fila');
});

test('editar: "De" menor que o preço é apagado; "De" 0 tira', async () => {
  const { offers } = setup();
  const { offer } = await offers.addFromUrl('https://meli.la/x');
  assert.equal(offers.update(offer.id, { oldPrice: '10,00' }).oldPrice, null);
  assert.equal(offers.update(offer.id, { oldPrice: '199,90' }).oldPrice, 199.9);
  assert.equal(offers.update(offer.id, { oldPrice: '0' }).oldPrice, null);
  assert.throws(() => offers.update(offer.id, { price: 'abc' }), /Preço inválido/);
});

test('ordem da fila: subir e descer', async () => {
  const products = ['MLB111', 'MLB222', 'MLB333'];
  let i = 0;
  const { offers } = setup(async () => fakeProduct({ productId: products[i], resolvedUrl: `https://produto.mercadolivre.com.br/${products[i++]}` }));
  const ids = [];
  for (const code of ['a', 'b', 'c']) {
    const { offer } = await offers.addFromUrl(`https://meli.la/${code}`);
    offers.approve(offer.id);
    ids.push(offer.id);
  }
  offers.move(ids[2], 'up');
  assert.deepEqual(offers.queued().map((o) => o.id), [ids[0], ids[2], ids[1]]);
  offers.move(ids[1], 'top');
  assert.deepEqual(offers.queued().map((o) => o.id), [ids[1], ids[0], ids[2]]);
});

test('lista de links: um resultado por link', async () => {
  const { offers } = setup(async (platform, url) => fakeProduct({ productId: `MLB${url.length}${Math.random()}`, resolvedUrl: url }));
  const results = await offers.addFromText('https://meli.la/aaa\nhttps://amazon.com.br/x\nhttps://meli.la/bbbb');
  assert.equal(results.length, 3);
  assert.ok(results[0].offer);
  assert.match(results[1].error, /não é do Mercado Livre/);
  assert.ok(results[2].offer);
});
