import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { bigMercadoLivreImage, parseMercadoLivreHtml, parseReaisLabel, productFromEmbedded } from '../src/products/mercadolivre.js';
import { parseShopeePdp } from '../src/products/shopee.js';
import { fromShopeeNode, shopeeSignature } from '../src/products/shopee-api.js';
import { shopeeToCandidate } from '../src/agent/shopee.js';
import { rejectReason } from '../src/agent/rules.js';
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
  assert.equal(parseReaisLabel('Antes: 1.299 reais com 9 centavos'), 1299.09);
  assert.equal(parseReaisLabel('Antes: 1.299 reais com 90 centavos'), 1299.9);
  assert.equal(parseReaisLabel('59 reais con 90 centavos'), 59.9);
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
  const node = { itemId: 99, shopId: 7, productName: 'Fone X', priceMin: '60.00', priceDiscountRate: 40, imageUrl: 'https://cf.shopee.com.br/file/a', offerLink: 'https://s.shopee.com.br/z', sales: 500, ratingStar: '4.8' };
  const p = fromShopeeNode(node);
  assert.equal(p.price, 60);
  assert.equal(p.oldPrice, 100);
  assert.match(p.oldPriceNote, /40%/);
  const c = shopeeToCandidate(node);
  const rules = { minDiscount: 20, minRating: 4.5, minReviews: 50, requireFreeShipping: true, maxPrice: 0 };
  assert.equal(rejectReason(c, rules), ''); // frete grátis não é cobrado da Shopee (a API não informa)
  assert.match(rejectReason(c, { ...rules, minDiscount: 50 }), /desconto/);
  assert.match(rejectReason(c, { ...rules, maxPrice: 50 }), /acima/);
});

test('só acessa domínios das lojas', () => {
  assert.ok(isAllowedHost('https://meli.la/x'));
  assert.ok(isAllowedHost('https://down-br.img.susercontent.com/file/x'));
  assert.ok(!isAllowedHost('https://evil.com/x'));
  assert.ok(!isAllowedHost('https://mercadolivre.com.br.evil.com/x'));
});

test('foto: webp vira JPEG quadrado; foto minúscula é recusada', async () => {
  const webp = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).webp().toBuffer();
  const jpeg = await toOfferJpeg(webp);
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 800);
  // foto estreita (263x500, igual à da bomba de ar) não fica mais fina no zap
  const tall = await sharp({ create: { width: 263, height: 500, channels: 3, background: '#000' } }).webp().toBuffer();
  const square = await sharp(await toOfferJpeg(tall)).metadata();
  assert.deepEqual([square.width, square.height], [800, 800]);
  const huge = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#000' } }).jpeg().toBuffer();
  const capped = await sharp(await toOfferJpeg(huge)).metadata();
  assert.deepEqual([capped.width, capped.height], [1280, 1280]);
  const tiny = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(() => toOfferJpeg(tiny), /pequena/);
});

// Vitrine do meli.la (/social/): cards "polycard", nome e preço em componentes separados.
function polycard(id, title, current, previous, pic) {
  return {
    polycard: {
      metadata: { id, url: `produto.mercadolivre.com.br/${id.replace('MLB', 'MLB-')}` },
      pictures: { pictures: [{ id: pic }] },
      components: [
        { type: 'title', id: 'title', title: { text: title } },
        { type: 'price', id: 'price', price: { current_price: { value: current, currency: 'BRL' }, ...(previous ? { previous_price: { value: previous, currency: 'BRL' } } : {}), discount_label: { text: 'x% OFF' } } }
      ]
    }
  };
}
const VITRINE = { pageState: { initialState: { results: [
  polycard('MLB1111111111', 'Fone Bluetooth JBL Tune 520BT', 199.9, 349.9, '111-MLA1'),
  polycard('MLB2222222222', 'Creatina 1kg Suplemento Monohidratada em pó 100% Pura', 59.9, 239.9, '222-MLA2'),
  polycard('MLB3333333333', 'Camiseta Dry Fit Masculina', 29.9, null, '333-MLA3')
] } } };

test('Mercado Livre: vitrine /social/ escolhe o card do og:title (formato polycard)', () => {
  const html = `<html><head><title>Ofertas RoB7 | Perfil Social</title>
    <meta property="og:title" content="Creatina 1kg Suplemento Monohidratada em pó 100% Pura">
    <meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_og-O.jpg"></head>
    <body><script id="__PRELOADED_STATE__" type="application/json">${JSON.stringify(VITRINE)}</script></body></html>`;
  const data = parseMercadoLivreHtml(html, 'https://www.mercadolivre.com.br/social/delmaschiirobert?matt_word=x');
  assert.equal(data.title, 'Creatina 1kg Suplemento Monohidratada em pó 100% Pura');
  assert.equal(data.price, 59.9);
  assert.equal(data.oldPrice, 239.9);
  assert.equal(data.productId, 'MLB2222222222');
  assert.equal(data.imageUrl, 'https://http2.mlstatic.com/D_NQ_NP_222-MLA2-O.webp');
});

test('Mercado Livre: vitrine com JSON que não abre inteiro (lê card por card)', () => {
  const inner = JSON.stringify(VITRINE).replace(/\//g, '\\/');
  const html = `<meta property="og:title" content="Fone Bluetooth JBL Tune 520BT | Mercado Livre">
    <script>window.__STATE__ = ${inner}; window.outra = function(){ return 1 }</script>`;
  const data = parseMercadoLivreHtml(html, 'https://www.mercadolivre.com.br/social/rob7');
  assert.equal(data.title, 'Fone Bluetooth JBL Tune 520BT');
  assert.equal(data.price, 199.9);
  assert.equal(data.oldPrice, 349.9);
});

test('Mercado Livre: vitrine com vários cards e nenhum batendo = não chuta', () => {
  assert.equal(productFromEmbedded(`<script type="application/json">${JSON.stringify(VITRINE)}</script>`, [], 'Outro produto qualquer de teste'), null);
});
