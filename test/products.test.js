import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { bigMercadoLivreImage, parseMercadoLivreHtml, parseReaisLabel } from '../src/products/mercadolivre.js';
import { parseShopeePdp } from '../src/products/shopee.js';
import { fromShopeeNode, shopeeSignature } from '../src/products/shopee-api.js';
import { shopeeCandidateOk } from '../src/radar/shopee.js';
import { toOfferJpeg } from '../src/images.js';
import { isAllowedHost } from '../src/products/http.js';

test('Mercado Livre: página de produto com JSON-LD e preço antigo', () => {
  const html = `<html><head>
    <link rel="canonical" href="https://produto.mercadolivre.com.br/MLB-4012345678-fone-bluetooth-_JM">
    <meta property="og:title" content="Fone Bluetooth TWS | Mercado Livre">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Fone Bluetooth TWS Pro","image":"https://http2.mlstatic.com/D_NQ_NP_1-O.webp","sku":"MLB4012345678","offers":{"@type":"Offer","price":89.9,"priceCurrency":"BRL"}}</script>
    </head><body><h1 class="ui-pdp-title">Fone Bluetooth TWS Pro</h1>
    <s class="andes-money-amount andes-money-amount--previous" aria-label="Antes: 159 reais com 90 centavos">R$159,90</s></body></html>`;
  const data = parseMercadoLivreHtml(html, 'https://produto.mercadolivre.com.br/MLB-4012345678-fone-bluetooth-_JM');
  assert.equal(data.title, 'Fone Bluetooth TWS Pro');
  assert.equal(data.price, 89.9);
  assert.equal(data.oldPrice, 159.9);
  assert.equal(data.productId, 'MLB4012345678');
  assert.match(data.imageUrl, /mlstatic/);
});

test('Mercado Livre: página /social/ com JSON embutido de um produto', () => {
  const state = { page: { items: [{ id: 'MLB5551112223', title: 'Air Fryer 4L Digital Mondial', price: { amount: 299.9 }, original_price: 449.9, pictures: [{ url: 'https://http2.mlstatic.com/D_Q_NP_2-I.webp' }], permalink: 'https://produto.mercadolivre.com.br/MLB-5551112223' }] } };
  const html = `<html><body><script>window.__PRELOADED_STATE__ = ${JSON.stringify(state)};</script></body></html>`;
  const data = parseMercadoLivreHtml(html, 'https://www.mercadolivre.com.br/social/rob7?matt_tool=1');
  assert.equal(data.title, 'Air Fryer 4L Digital Mondial');
  assert.equal(data.price, 299.9);
  assert.equal(data.oldPrice, 449.9);
  assert.equal(data.productId, 'MLB5551112223');
});

test('Mercado Livre: página /social/ com VÁRIOS produtos e sem ID = não chuta', () => {
  const state = { items: [
    { id: 'MLB1111111', title: 'Produto Um Muito Bom', price: 10 },
    { id: 'MLB2222222', title: 'Produto Dois Muito Bom', price: 20 }
  ] };
  const html = `<script>window.__X__ = ${JSON.stringify(state)};</script>`;
  const data = parseMercadoLivreHtml(html, 'https://www.mercadolivre.com.br/social/rob7');
  assert.equal(data.title, '');
  assert.ok(Number.isNaN(data.price));
});

test('Mercado Livre: rótulo "Antes" e foto grande', () => {
  assert.equal(parseReaisLabel('Antes: 1.299 reais com 9 centavos'), 1299.9);
  assert.equal(parseReaisLabel('199 reais'), 199);
  assert.equal(bigMercadoLivreImage('https://http2.mlstatic.com/D_Q_NP_2-I.webp'), 'https://http2.mlstatic.com/D_Q_NP_2-O.webp');
});

test('Shopee: leitura da resposta da página (preço em centésimos de milésimo)', () => {
  const data = parseShopeePdp({ data: { item: { item_id: 58205214274, title: 'Ventilador de Mesa 40 cm Ventisol Turbo 10', price: 14241000000 / 1000, price_before_discount: 19990000, image: 'br-abc123' } } });
  assert.equal(data.title, 'Ventilador de Mesa 40 cm Ventisol Turbo 10');
  assert.equal(data.price, 142.41);
  assert.equal(data.oldPrice, 199.9);
  assert.equal(data.imageUrl, 'https://down-br.img.susercontent.com/file/br-abc123');
});

test('Shopee API: assinatura e conversão do produto', () => {
  const sig = shopeeSignature({ appId: '123', secret: 'abc', timestamp: 1700000000, payload: '{"query":"{}"}' });
  assert.equal(sig.length, 64);
  assert.equal(sig, shopeeSignature({ appId: '123', secret: 'abc', timestamp: 1700000000, payload: '{"query":"{}"}' }));
  const p = fromShopeeNode({ itemId: 99, shopId: 7, productName: 'Fone X', priceMin: '60.00', priceDiscountRate: 40, imageUrl: 'https://cf.shopee.com.br/file/a', offerLink: 'https://s.shopee.com.br/z', sales: 500, ratingStar: '4.8' });
  assert.equal(p.price, 60);
  assert.equal(p.oldPrice, 100);
  assert.match(p.oldPriceNote, /40%/);
  assert.ok(shopeeCandidateOk(p, { minDiscount: 20, minSales: 50, minRating: 4.5, maxPrice: 0 }));
  assert.ok(!shopeeCandidateOk(p, { minDiscount: 50, minSales: 0, minRating: 0, maxPrice: 0 }));
  assert.ok(!shopeeCandidateOk(p, { minDiscount: 0, minSales: 0, minRating: 0, maxPrice: 50 }));
});

test('só acessa domínios das lojas', () => {
  assert.ok(isAllowedHost('https://meli.la/x'));
  assert.ok(isAllowedHost('https://down-br.img.susercontent.com/file/x'));
  assert.ok(!isAllowedHost('https://evil.com/x'));
  assert.ok(!isAllowedHost('https://mercadolivre.com.br.evil.com/x'));
});

test('foto: webp vira JPEG; foto minúscula é recusada', async () => {
  const webp = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).webp().toBuffer();
  const jpeg = await toOfferJpeg(webp);
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 800);
  const tiny = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(() => toOfferJpeg(tiny), /pequena/);
});
