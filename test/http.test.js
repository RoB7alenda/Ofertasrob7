import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CookieJar, fetchPage } from '../src/products/http.js';
import { bigMercadoLivreImage } from '../src/products/mercadolivre.js';

test('cookies: guarda e manda de volta só pro site certo', () => {
  const jar = new CookieJar();
  jar.store('https://www.mercadolivre.com.br/social/x', ['_d2id=abc; Path=/; Domain=.mercadolivre.com.br', 'so=1; Path=/social']);
  assert.equal(jar.header('https://www.mercadolivre.com.br/social/x'), '_d2id=abc; so=1');
  assert.equal(jar.header('https://produto.mercadolivre.com.br/MLB-1'), '_d2id=abc');
  assert.equal(jar.header('https://shopee.com.br/'), '');
  jar.store('https://www.mercadolivre.com.br/', ['_d2id=; Max-Age=0; Domain=.mercadolivre.com.br; Path=/']);
  assert.equal(jar.header('https://produto.mercadolivre.com.br/MLB-1'), '');
});

test('meli.la que só para de redirecionar com o cookie: agora chega na página', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, cookie: opts.headers.cookie || '' });
    if (url === 'https://meli.la/2WbkYXm') {
      return new Response('', { status: 301, headers: { location: 'https://www.mercadolivre.com.br/social/rob7?matt=1' } });
    }
    if (!/_d2id=abc/.test(opts.headers.cookie || '')) {
      return new Response('', { status: 302, headers: [['location', 'https://www.mercadolivre.com.br/social/rob7?matt=1'], ['set-cookie', '_d2id=abc; Path=/; Domain=.mercadolivre.com.br']] });
    }
    return new Response('<html><title>ok</title></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  try {
    const page = await fetchPage('https://meli.la/2WbkYXm');
    assert.equal(page.status, 200);
    assert.match(page.html, /ok/);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('redirecionamento sem fim: erro diz por onde passou', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 302, headers: { location: 'https://www.mercadolivre.com.br/loop' } });
  try {
    await assert.rejects(() => fetchPage('https://meli.la/x'), /passou por: .*mercadolivre\.com\.br\/loop/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('foto do Mercado Livre no tamanho grande', () => {
  assert.equal(bigMercadoLivreImage('https://http2.mlstatic.com/D_NQ_NP_998180-MLB117995940155_092026-P.webp'), 'https://http2.mlstatic.com/D_NQ_NP_998180-MLB117995940155_092026-O.webp');
  assert.equal(bigMercadoLivreImage('https://http2.mlstatic.com/D_x-O.jpg'), 'https://http2.mlstatic.com/D_x-O.jpg');
});
