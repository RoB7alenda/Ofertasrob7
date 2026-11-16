import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { compactTitle, money, parsePrice, stripPriceSuffix } from '../src/text.js';
import { cleanPastedUrl, detectPlatform, extractUrls, identityKeys, isAffiliateLink, mercadoLivreId, shopeeIds } from '../src/links.js';
import { buildCaption, cleanCoupon, discountPercent, missingFields, validCoupon } from '../src/message.js';

test('preço em formato brasileiro', () => {
  assert.equal(parsePrice('R$ 1.299,90'), 1299.9);
  assert.equal(parsePrice('49,90'), 49.9);
  assert.equal(parsePrice('49.90'), 49.9);
  assert.equal(parsePrice('1.299'), 1299);
  assert.equal(parsePrice(142.41), 142.41);
  assert.ok(Number.isNaN(parsePrice('abc')));
  assert.ok(Number.isNaN(parsePrice('')));
  assert.equal(money(1299.9), 'R$ 1.299,90');
});

test('título limpo e curto', () => {
  assert.equal(compactTitle('OFERTA: Fone Bluetooth frete grátis | Shopee Brasil'), 'Fone Bluetooth');
  // nome do meli.la vem com o preço no fim
  assert.equal(compactTitle('Bomba de Ar Elétrica Portátil B&G - R$ 99,99'), 'Bomba de Ar Elétrica Portátil B&G');
  assert.equal(compactTitle('Cadeira Infantil Maxi Baby - ROSA - R$ 419,01'), 'Cadeira Infantil Maxi Baby - ROSA');
  assert.equal(compactTitle('Carregador de Bateria 12V Portátil - R$'), 'Carregador de Bateria 12V Portátil');
  assert.equal(stripPriceSuffix('Kit Lavagem Vonixx - R$ 159,35'), 'Kit Lavagem Vonixx');
  assert.equal(stripPriceSuffix('Capa R$ 10 de volante'), 'Capa R$ 10 de volante');
  const long = 'palavra '.repeat(40);
  assert.ok(compactTitle(long).split(' ').length <= 16);
});

test('acha links no texto, inclusive sem https e com pontuação', () => {
  const text = 'olha *https://meli.la/1AbCd2*, e também s.shopee.com.br/AbC123. e https://exemplo.com/x)';
  assert.deepEqual(extractUrls(text), ['https://meli.la/1AbCd2', 'https://exemplo.com/x', 'https://s.shopee.com.br/AbC123']);
  assert.equal(cleanPastedUrl('https://meli.la/abc?x=1&y=2'), 'https://meli.la/abc?x=1&y=2');
});

test('o link colado é mantido EXATAMENTE (parâmetros não somem)', () => {
  const url = 'https://s.shopee.com.br/5fRfZyEkBp?share_channel_code=6&utm_x=Ab_C';
  assert.deepEqual(extractUrls(`link: ${url}`), [url]);
});

test('identifica a loja e se é link de afiliado', () => {
  assert.equal(detectPlatform('https://meli.la/abc'), 'mercadolivre');
  assert.equal(detectPlatform('https://produto.mercadolivre.com.br/MLB-123'), 'mercadolivre');
  assert.equal(detectPlatform('https://s.shopee.com.br/abc'), 'shopee');
  assert.equal(detectPlatform('https://vt.tiktok.com/ZS123/'), 'tiktok');
  assert.equal(detectPlatform('https://amazon.com.br/x'), '');
  assert.equal(isAffiliateLink('https://meli.la/abc'), true);
  assert.equal(isAffiliateLink('https://www.mercadolivre.com.br/sec/1abc'), true);
  assert.equal(isAffiliateLink('https://produto.mercadolivre.com.br/MLB-123'), false);
  assert.equal(isAffiliateLink('https://s.shopee.com.br/abc'), true);
  assert.equal(isAffiliateLink('https://shopee.com.br/product/1/2'), false);
});

test('IDs dos produtos', () => {
  assert.deepEqual(shopeeIds('https://shopee.com.br/product/563110312/58205214274'), { shopId: '563110312', itemId: '58205214274' });
  assert.deepEqual(shopeeIds('https://shopee.com.br/Ventilador-Turbo-i.563110312.58205214274?sp_atk=x'), { shopId: '563110312', itemId: '58205214274' });
  assert.equal(mercadoLivreId('https://produto.mercadolivre.com.br/MLB-4012345678-fone'), 'MLB4012345678');
  assert.equal(mercadoLivreId('https://www.mercadolivre.com.br/up/MLBU1234567'), 'MLBU1234567');
  const keys = identityKeys({ platform: 'shopee', publishUrl: 'https://s.shopee.com.br/x', resolvedUrl: 'https://shopee.com.br/product/1234/5678' });
  assert.ok(keys.includes('shopee:1234:5678'));
  assert.ok(keys.includes('link:https://s.shopee.com.br/x'));
});

test('mensagem no layout combinado (com % OFF e cupom)', () => {
  const offer = { title: 'Fone Bluetooth TWS', price: 49.9, oldPrice: 99.9, coupon: 'FONE10', imageUrl: 'https://x/y.jpg', publishUrl: 'https://meli.la/abc' };
  assert.equal(buildCaption(offer), [
    '*🔥 50% OFF*',
    '🛍️ Fone Bluetooth TWS',
    '',
    '❌ De: R$ 99,90',
    '🔥 Por: R$ 49,90',
    '🎟️ Cupom: FONE10',
    '',
    '🛒 Compre aqui:',
    'https://meli.la/abc',
    '',
    '⚠️ Atenção: O preço pode sofrer alteração...'
  ].join('\n'));
});

test('% OFF e cupom podem ser desligados', () => {
  const offer = { title: 'Fone Bluetooth TWS', price: 49.9, oldPrice: 99.9, coupon: 'FONE10', publishUrl: 'https://meli.la/abc' };
  const caption = buildCaption(offer, { showDiscount: false, showCoupon: false });
  assert.ok(!caption.includes('% OFF'));
  assert.ok(!caption.includes('Cupom'));
  assert.ok(caption.startsWith('🛍️ Fone Bluetooth TWS'));
});

test('% OFF: conta de verdade, arredonda pra baixo, some quando é pequeno', () => {
  assert.equal(discountPercent(89.9, 159.9), 43);
  assert.equal(discountPercent(50, 100), 50);
  assert.equal(discountPercent(100, 100), 0);
  assert.equal(discountPercent(100, null), 0);
  const small = buildCaption({ title: 'Produto X', price: 97, oldPrice: 100, publishUrl: 'https://meli.la/a' });
  assert.ok(!small.includes('% OFF'));
  assert.ok(small.includes('❌ De: R$ 100,00'));
});

test('cupom: limpa espaços e recusa coisa estranha', () => {
  assert.equal(cleanCoupon('  FONE 10 '), 'FONE10');
  assert.ok(validCoupon('BLACK-10'));
  assert.ok(validCoupon(''));
  assert.ok(!validCoupon('<script>'));
});

test('sem "De" quando o preço antigo não é maior', () => {
  const caption = buildCaption({ title: 'X produto', price: 50, oldPrice: 50, publishUrl: 'https://meli.la/a' });
  assert.ok(!caption.includes('❌ De'));
});

test('nada inventado: aponta o que falta', () => {
  assert.deepEqual(missingFields({ title: '', price: null, imageUrl: '', publishUrl: 'https://meli.la/a' }), ['nome', 'preço', 'foto']);
  assert.throws(() => buildCaption({ title: 'X produto', price: null, publishUrl: 'https://meli.la/a' }), /preço/);
});
