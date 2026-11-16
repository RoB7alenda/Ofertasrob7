// Agente RoB7 no Mercado Livre (navegador invisível do PC):
// 1) procura cada palavra em lista.mercadolivre.com.br e lê os cards (preço, De, nota, frete, Full);
// 2) gera o link meli.la da SUA conta de afiliado no "Gerador de links" da Central de Afiliados.
//    Se o gerador não funcionar, tenta o botão Compartilhar > Copiar link na página do produto.
//
// ATENÇÃO: depende da tela do Mercado Livre. Se eles mudarem o site, o agente avisa o erro,
// salva a página em "diagnostico" e o resto do programa continua funcionando normal.

import { withPage } from '../browser.js';
import { mercadoLivreId } from '../links.js';
import { bigMercadoLivreImage, saveDiagnostic } from '../products/mercadolivre.js';
import { folded } from '../text.js';
import { discountOf } from './rules.js';
import { log } from '../log.js';

export const ML_HUB = 'https://www.mercadolivre.com.br/afiliados/hub';
export const ML_LINK_BUILDER = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
const LOGIN_RE = /\/(?:jms\/[a-z]+\/lgz|login|registration)|auth\.mercadolivre/i;

export function searchUrl(keyword) {
  const slug = folded(keyword).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `https://lista.mercadolivre.com.br/${slug}`;
}

// Link do produto sem o "#polycard..." do fim (só pra gerar o meli.la, não é o link publicado).
export function cleanProductUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(?:tracking_id|sid|wid|position|search_layout|type|c_|polycard)/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch {
    return String(url || '');
  }
}

// Roda DENTRO da página de busca do Mercado Livre. Não usa nada de fora.
export function readSearchCards() {
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const amount = (box) => {
    if (!box) return 0;
    const fraction = box.querySelector('.andes-money-amount__fraction');
    if (!fraction) return 0;
    const whole = Number(norm(fraction.textContent).replace(/\./g, ''));
    const cents = Number(norm(box.querySelector('.andes-money-amount__cents')?.textContent || '0'));
    if (!Number.isFinite(whole)) return 0;
    return Math.round((whole + (Number.isFinite(cents) ? cents / 100 : 0)) * 100) / 100;
  };
  const count = (text) => {
    const t = norm(text).toLowerCase();
    const m = t.match(/([\d.,]+)\s*(mil)?/);
    if (!m) return 0;
    const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * (m[2] ? 1000 : 1)) : 0;
  };
  const roots = document.querySelectorAll('.poly-card').length
    ? [...document.querySelectorAll('.poly-card')]
    : [...document.querySelectorAll('li.ui-search-layout__item, .ui-search-result__wrapper')];
  const out = [];
  for (const card of roots) {
    const titleEl = card.querySelector('.poly-component__title, .ui-search-item__title, h2, h3');
    const linkEl = card.querySelector('a.poly-component__title, .poly-component__title a, a.ui-search-link, a[href*="MLB"]') || titleEl?.closest('a');
    const title = norm(titleEl?.textContent);
    const url = linkEl?.href || '';
    if (!title || !url) continue;
    const current = card.querySelector('.poly-price__current .andes-money-amount, .ui-search-price__second-line .andes-money-amount');
    const previous = card.querySelector('s.andes-money-amount--previous, .andes-money-amount--previous');
    const discountText = norm(card.querySelector('.andes-money-amount__discount, .poly-price__disc_label')?.textContent);
    const ratingText = norm(card.querySelector('.poly-reviews__rating, .ui-search-reviews__rating-number')?.textContent);
    const reviewsText = norm(card.querySelector('.poly-reviews__total, .ui-search-reviews__amount')?.textContent);
    const shippingEl = card.querySelector('.poly-component__shipping, .ui-search-item__shipping');
    const shipping = norm(shippingEl?.textContent);
    const full = Boolean(card.querySelector('[aria-label="FULL" i], [aria-label*="full" i], [class*="fulfillment" i], [class*="full-icon" i]')) || /\bfull\b/i.test(shipping);
    const img = card.querySelector('img.poly-component__picture, img.ui-search-result-image__element, img');
    const image = [img?.getAttribute('data-src'), img?.currentSrc, img?.src].find((v) => v && /^https?:/i.test(v)) || '';
    const text = norm(card.innerText || card.textContent);
    const salesMatch = text.match(/\+?\s*([\d.,]+\s*(?:mil)?)\s+vendidos/i);
    out.push({
      title,
      url,
      price: amount(current),
      oldPrice: amount(previous),
      discountLabel: Number((discountText.match(/(\d{1,2})\s*%/) || [])[1]) || 0,
      rating: Number(ratingText.replace(',', '.')) || 0,
      reviews: count(reviewsText),
      sales: salesMatch ? count(salesMatch[1]) : 0,
      freeShipping: /gr[áa]tis/i.test(shipping),
      full,
      imageUrl: image,
      sponsored: /patrocinado/i.test(text),
      unavailable: /esgotado|indispon[íi]vel|pausado/i.test(text)
    });
  }
  return out;
}

// Card lido da página -> candidato do agente (só com dado confirmado; o resto fica zerado).
export function toCandidate(card) {
  const productId = mercadoLivreId(card.url);
  const price = Number(card.price) || 0;
  const oldPrice = Number(card.oldPrice) > price ? Number(card.oldPrice) : 0;
  return {
    platform: 'mercadolivre',
    title: card.title,
    url: card.url,
    productId,
    price,
    oldPrice,
    discount: discountOf(price, oldPrice) || (oldPrice ? Number(card.discountLabel) || 0 : 0),
    rating: Number(card.rating) || 0,
    reviews: Number(card.reviews) || 0,
    sales: Number(card.sales) || 0,
    freeShipping: Boolean(card.freeShipping),
    full: Boolean(card.full),
    imageUrl: card.imageUrl ? bigMercadoLivreImage(card.imageUrl) : '',
    sponsored: Boolean(card.sponsored),
    unavailable: Boolean(card.unavailable)
  };
}

async function scrollAll(page) {
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9)));
    await page.waitForTimeout(350);
  }
}

// Busca várias palavras numa aba só. Devolve candidatos (sem filtro).
export async function searchMercadoLivre(keywords) {
  return withPage(async (page) => {
    const all = [];
    for (const keyword of keywords) {
      const url = searchUrl(keyword);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(1500);
        await scrollAll(page);
        const cards = await page.evaluate(readSearchCards);
        if (!cards.length) {
          saveDiagnostic('busca', url, await page.content().catch(() => ''));
          log.warn('rob7', `Mercado Livre: a busca "${keyword}" não mostrou produtos (página salva em diagnostico).`);
        }
        for (const card of cards) all.push({ ...toCandidate(card), keyword });
      } catch (error) {
        log.warn('rob7', `Mercado Livre: não consegui buscar "${keyword}" (${error.message}).`);
      }
    }
    return all;
  }, { timeoutMs: Math.max(90_000, keywords.length * 60_000) });
}

// Roda DENTRO da página: todos os links de afiliado que aparecem (campos, links e texto).
export function collectAffiliateLinks() {
  const re = /https?:\/\/(?:meli\.la|mercado\.li)\/[A-Za-z0-9_-]+/gi;
  const found = [];
  const add = (v) => { for (const m of String(v || '').matchAll(re)) found.push(m[0]); };
  for (const el of document.querySelectorAll('input,textarea')) add(el.value);
  for (const el of document.querySelectorAll('a[href],[data-clipboard-text]')) { add(el.href); add(el.getAttribute('data-clipboard-text')); }
  add(document.body?.innerText);
  return [...new Set(found)];
}

function notLoggedIn(page) {
  return LOGIN_RE.test(page.url());
}

export async function viaLinkBuilder(page, productUrl) {
  if (!page.url().startsWith(ML_LINK_BUILDER)) {
    await page.goto(ML_LINK_BUILDER, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2500);
  }
  if (notLoggedIn(page)) throw new Error('Não estou logado na conta de afiliado do Mercado Livre. Em Configurações, clique em "Entrar nas contas".');
  const field = page.locator('textarea:visible, input[type="url"]:visible, input[placeholder*="link" i]:visible, input[placeholder*="url" i]:visible').first();
  await field.waitFor({ state: 'visible', timeout: 15_000 });
  await field.fill('');
  await field.fill(productUrl);
  const before = new Set(await page.evaluate(collectAffiliateLinks));
  const button = page.locator('button:visible, [role="button"]:visible').filter({ hasText: /gerar/i }).first();
  await button.click({ timeout: 10_000 });
  const handle = await page.waitForFunction((known) => {
    const re = /https?:\/\/(?:meli\.la|mercado\.li)\/[A-Za-z0-9_-]+/gi;
    const values = [...document.querySelectorAll('input,textarea')].map((el) => el.value).concat(document.body?.innerText || '');
    for (const v of values) for (const m of String(v).matchAll(re)) if (!known.includes(m[0])) return m[0];
    return null;
  }, [...before], { timeout: 20_000, polling: 300 });
  return String(await handle.jsonValue() || '');
}

// Plano B: página do produto > barra de afiliado > Compartilhar > Copiar link.
export async function viaProductPage(page, productUrl) {
  await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2500);
  if (notLoggedIn(page)) throw new Error('Não estou logado na conta de afiliado do Mercado Livre.');
  const share = page.locator('button:visible, a:visible, [role="button"]:visible').filter({ hasText: /^\s*compartilhar\s*$/i }).first();
  await share.click({ timeout: 10_000 });
  await page.waitForTimeout(1200);
  const inside = await page.evaluate(collectAffiliateLinks);
  if (inside.length) return inside[0];
  await page.evaluate(() => navigator.clipboard.writeText('').catch(() => {}));
  const copy = page.locator('button:visible, a:visible, [role="button"]:visible').filter({ hasText: /copiar link/i }).first();
  await copy.click({ timeout: 8000 });
  const handle = await page.waitForFunction(async () => {
    try {
      const m = (await navigator.clipboard.readText()).match(/https?:\/\/(?:meli\.la|mercado\.li)\/[A-Za-z0-9_-]+/i);
      return m ? m[0] : null;
    } catch {
      return null;
    }
  }, null, { timeout: 10_000, polling: 300 });
  return String(await handle.jsonValue() || '');
}

// Gera o meli.la de cada produto. Devolve Map(url do produto -> link). Produto sem link fica de fora.
export async function makeMeliLinks(productUrls) {
  const links = new Map();
  if (!productUrls.length) return links;
  await withPage(async (page) => {
    let builderBroken = false;
    for (const raw of productUrls) {
      const productUrl = cleanProductUrl(raw);
      let link = '';
      if (!builderBroken) {
        try {
          link = await viaLinkBuilder(page, productUrl);
        } catch (error) {
          if (/logado/.test(error.message)) throw error;
          builderBroken = true;
          saveDiagnostic('gerador', page.url(), await page.content().catch(() => ''));
          log.warn('rob7', `Gerador de links do Mercado Livre não funcionou (${error.message}). Tentando pelo Compartilhar.`);
        }
      }
      if (!link) {
        try {
          link = await viaProductPage(page, productUrl);
        } catch (error) {
          if (/logado/.test(error.message)) throw error;
          saveDiagnostic('compartilhar', productUrl, await page.content().catch(() => ''));
          log.warn('rob7', `Não consegui o meli.la de ${productUrl} (${error.message}).`);
        }
      }
      if (link) links.set(raw, link);
    }
  }, { timeoutMs: Math.max(120_000, productUrls.length * 75_000) });
  return links;
}
