// Mercado Livre: lê nome, preço, preço antigo e foto a partir do link meli.la.
// 1º tenta direto pelo servidor (rápido, sem navegador). Se faltar algo, usa o navegador invisível.

import { fetchPage } from './http.js';
import { absoluteUrl, cleanStoreTitle, embeddedJsonObjects, firstImageValue, jsonLdProduct, metaContent, priceFromLd, titleTag, walkObjects } from './html.js';
import { mercadoLivreId } from '../links.js';
import { parsePrice, validPrice } from '../text.js';
import { withPage } from '../browser.js';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../config.js';

// Quando não dá pra ler, guarda a página que chegou (pra eu ver o formato e corrigir). Fica só no seu PC.
export function saveDiagnostic(kind, url, html) {
  try {
    fs.mkdirSync(PATHS.diagnostics, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(PATHS.diagnostics, `ml-${kind}-${stamp}.html`);
    fs.writeFileSync(file, `<!-- ${url} -->\n${html || ''}`, 'utf8');
    const old = fs.readdirSync(PATHS.diagnostics).filter((n) => n.startsWith('ml-')).sort();
    for (const name of old.slice(0, Math.max(0, old.length - 12))) fs.unlinkSync(path.join(PATHS.diagnostics, name));
    return file;
  } catch {
    return '';
  }
}

// "Antes: 1.299 reais com 90 centavos" -> 1299.9
export function parseReaisLabel(label) {
  const m = String(label || '').match(/([\d.]+)\s*reais(?:\s*(?:com|con|e)\s*(\d{1,2})\s*centavos?)?/i);
  if (!m) return NaN;
  const reais = Number(m[1].replace(/\./g, ''));
  const cents = m[2] ? Number(m[2]) : 0;
  return Number.isFinite(reais) ? Math.round((reais + cents / 100) * 100) / 100 : NaN;
}

function idsFromParams(url) {
  const ids = [];
  try {
    const u = new URL(url);
    for (const value of u.searchParams.values()) {
      const direct = mercadoLivreId(value);
      if (direct) ids.push(direct);
      // Alguns parâmetros vêm em base64.
      if (/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(value)) {
        try {
          const decoded = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
          const id = mercadoLivreId(decoded);
          if (id) ids.push(id);
        } catch {}
      }
    }
  } catch {}
  return ids;
}

function objectPrice(node) {
  for (const value of [node.price?.amount, node.price?.value, node.price, node.current_price, node.sale_price?.amount, node.amount]) {
    const n = typeof value === 'object' ? NaN : parsePrice(value);
    if (validPrice(n)) return n;
  }
  return NaN;
}

function objectOldPrice(node) {
  for (const value of [node.original_price?.amount, node.original_price, node.previous_price?.amount, node.price?.original_value, node.regular_amount]) {
    const n = typeof value === 'object' ? NaN : parsePrice(value);
    if (validPrice(n)) return n;
  }
  return NaN;
}

function objectImage(node) {
  const pictures = Array.isArray(node.pictures) ? node.pictures[0] : null;
  return firstImageValue(pictures?.secure_url || pictures?.url || node.secure_thumbnail || node.thumbnail || node.picture || node.image || '');
}

function textValue(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.text === 'string') return value.text;
  return '';
}

function amountOf(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'object') {
    const base = value.value ?? value.amount ?? value.fraction;
    if (base === undefined) return NaN;
    const n = parsePrice(base);
    const cents = value.cents ?? value.decimal;
    if (Number.isFinite(n) && cents !== undefined && Number.isInteger(n) && /^\d{1,2}$/.test(String(cents))) {
      return Math.round((n + Number(cents) / 100) * 100) / 100;
    }
    return n;
  }
  return parsePrice(value);
}

function pictureUrl(pictures) {
  const list = Array.isArray(pictures?.pictures) ? pictures.pictures : (Array.isArray(pictures) ? pictures : []);
  const first = list[0];
  if (!first) return '';
  if (typeof first === 'string') return first;
  if (first.url || first.secure_url || first.src) return first.secure_url || first.url || first.src;
  if (first.id) return `https://http2.mlstatic.com/D_NQ_NP_${first.id}-O.webp`;
  return '';
}

// Card da vitrine (/social/) no formato "polycard": nome e preço ficam em "components" separados.
function cardFromPolycard(node) {
  const components = Array.isArray(node.components) ? node.components : [];
  if (!components.length) return null;
  const titleComp = components.find((c) => textValue(c?.title));
  const priceComp = components.find((c) => c?.price && (c.price.current_price || c.price.previous_price));
  if (!titleComp || !priceComp) return null;
  const meta = node.metadata || {};
  const idText = [meta.id, meta.product_id, meta.user_product_id, meta.url, meta.permalink].filter((v) => typeof v === 'string').join(' ');
  return {
    title: textValue(titleComp.title),
    price: amountOf(priceComp.price.current_price),
    oldPrice: amountOf(priceComp.price.previous_price),
    imageUrl: pictureUrl(node.pictures),
    productId: mercadoLivreId(idText)
  };
}

// Card em formato simples: { title, price, ... } no mesmo objeto.
function cardFromPlain(node) {
  const title = textValue(node.title) || (typeof node.name === 'string' ? node.name : '');
  if (title.length < 8) return null;
  let price = objectPrice(node);
  let oldPrice = objectOldPrice(node);
  if (!validPrice(price) && node.price && typeof node.price === 'object') {
    price = amountOf(node.price.current_price);
    oldPrice = amountOf(node.price.previous_price);
  }
  if (!validPrice(price)) return null;
  const idText = [node.id, node.item_id, node.itemId, node.product_id, node.permalink, node.url].filter((v) => typeof v === 'string').join(' ');
  return { title, price, oldPrice, imageUrl: objectImage(node), productId: mercadoLivreId(idText) };
}

// Quando o JSON não dá pra abrir inteiro: corta o HTML em pedaços, um por "polycard",
// e lê nome e preço dentro do MESMO pedaço (nunca mistura um card com outro).
function cardsFromRawPolycards(html) {
  const cards = [];
  const parts = html.split(/"polycard"\s*:/).slice(1, 200);
  const str = (raw) => { try { return JSON.parse(`"${raw}"`); } catch { return raw; } };
  for (const part of parts) {
    const seg = part.slice(0, 6000);
    const title = seg.match(/"title"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const current = seg.match(/"current_price"\s*:\s*\{[^{}]*?"value"\s*:\s*(\d+(?:\.\d+)?)/);
    if (!title || !current) continue;
    const previous = seg.match(/"previous_price"\s*:\s*\{[^{}]*?"value"\s*:\s*(\d+(?:\.\d+)?)/);
    const pic = seg.match(/"pictures"\s*:\s*\{\s*"pictures"\s*:\s*\[\s*\{[^{}]*?"id"\s*:\s*"([^"]+)"/);
    const id = seg.match(/"(?:id|product_id|user_product_id)"\s*:\s*"(MLBU?\d{6,})"/);
    cards.push({
      title: str(title[1]),
      price: Number(current[1]),
      oldPrice: previous ? Number(previous[1]) : NaN,
      imageUrl: pic ? `https://http2.mlstatic.com/D_NQ_NP_${pic[1]}-O.webp` : '',
      productId: id ? id[1].toUpperCase() : ''
    });
  }
  return cards;
}

export function sameTitle(a, b) {
  const norm = (v) => String(v || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 12 && y.startsWith(x)) || (y.length >= 12 && x.startsWith(y));
}

// Procura, no JSON da página (ex.: vitrine /social/ do meli.la), o produto do link.
// Escolhe o card pelo ID do link ou pelo nome do og:title. Com vários cards e nada batendo: não chuta.
export function productFromEmbedded(html, preferredIds, ogTitle = '') {
  const candidates = [];
  for (const root of embeddedJsonObjects(html, { maxScripts: 60, maxLength: 8_000_000 })) {
    walkObjects(root, (node) => {
      const card = cardFromPolycard(node) || cardFromPlain(node);
      if (card && validPrice(card.price)) candidates.push(card);
    });
  }
  if (!candidates.length) candidates.push(...cardsFromRawPolycards(html).filter((c) => validPrice(c.price)));
  if (!candidates.length) return null;
  if (preferredIds.length) {
    const match = candidates.find((c) => c.productId && preferredIds.includes(c.productId));
    if (match) return match;
  }
  if (ogTitle) {
    const byTitle = candidates.filter((c) => sameTitle(c.title, ogTitle));
    const prices = new Set(byTitle.map((c) => c.price));
    if (byTitle.length && prices.size === 1) return byTitle[0];
  }
  const distinct = new Map();
  for (const c of candidates) distinct.set(`${c.productId || ''}|${c.title}`, c);
  // Só aceita sem bater ID/nome se a página tiver UM produto só (senão seria chute).
  if (distinct.size === 1) return candidates[0];
  return null;
}

export function parseMercadoLivreHtml(html, url) {
  const out = { title: '', price: NaN, oldPrice: NaN, imageUrl: '', productId: '' };
  const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i) || [])[1] || '';
  const preferredIds = [mercadoLivreId(url), mercadoLivreId(canonical), mercadoLivreId(metaContent(html, 'og:url')), ...idsFromParams(url)].filter(Boolean);
  out.productId = preferredIds[0] || '';

  const ld = jsonLdProduct(html);
  if (ld) {
    out.title = cleanStoreTitle(ld.name || '');
    out.price = priceFromLd(ld);
    out.imageUrl = absoluteUrl(firstImageValue(ld.image), url);
    if (!out.productId) out.productId = mercadoLivreId(`${ld.sku || ''} ${ld.productID || ''} ${ld.url || ''} ${ld.offers?.url || ''}`);
  }

  const isProductPage = Boolean(ld) || /ui-pdp-title/.test(html);
  if (isProductPage) {
    if (!out.title) out.title = cleanStoreTitle(metaContent(html, 'og:title') || titleTag(html));
    if (!validPrice(out.price)) out.price = parsePrice(metaContent(html, 'price'));
    if (!out.imageUrl) out.imageUrl = absoluteUrl(metaContent(html, 'og:image'), url);
    const before = html.match(/aria-label=["']Antes:\s*([^"']+)["']/i);
    if (before) out.oldPrice = parseReaisLabel(before[1]);
  } else {
    const ogTitle = metaContent(html, 'og:title');
    const embedded = productFromEmbedded(html, preferredIds, ogTitle);
    if (embedded) {
      out.title = cleanStoreTitle(embedded.title);
      out.price = embedded.price;
      out.oldPrice = embedded.oldPrice;
      out.imageUrl = absoluteUrl(embedded.imageUrl, url) || absoluteUrl(metaContent(html, 'og:image'), url);
      out.productId = embedded.productId || out.productId;
    }
  }
  if (!(validPrice(out.oldPrice) && out.oldPrice > out.price)) out.oldPrice = NaN;
  return out;
}

function complete(data) {
  return Boolean(data.title && validPrice(data.price) && data.imageUrl);
}

function productPageUrl(id) {
  if (/^MLBU/i.test(id)) return `https://www.mercadolivre.com.br/up/${id}`;
  return `https://produto.mercadolivre.com.br/MLB-${id.replace(/^MLB/i, '')}`;
}

// Foto maior: troca o sufixo de tamanho do ML (-I, -P, -V, -E...) pelo tamanho original (-O).
export function bigMercadoLivreImage(url) {
  return String(url || '').replace(/-(?!O\.)[A-Z]\.(jpe?g|webp|png)(\?.*)?$/i, '-O.$1$2');
}

// Roda DENTRO da página (navegador invisível): acha na tela o card do produto do link
// (pelo nome do og:title) e lê o preço que está aparecendo pra quem abre o link.
export function readRenderedCards() {
  const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  const amount = (el) => {
    if (!el) return '';
    const f = el.querySelector('.andes-money-amount__fraction')?.textContent || '';
    const c = el.querySelector('.andes-money-amount__cents')?.textContent || '';
    if (f) return c ? `${f},${c}` : f;
    return el.getAttribute('aria-label') || el.textContent || '';
  };
  const readContainer = (box, title) => {
    const all = [...box.querySelectorAll('.andes-money-amount')];
    const previous = box.querySelector('s.andes-money-amount--previous, .andes-money-amount--previous, s .andes-money-amount');
    const current = box.querySelector('.poly-price__current .andes-money-amount')
      || all.find((el) => !el.matches('.andes-money-amount--previous') && !el.closest('s'));
    let img = box.querySelector('img');
    for (let up = box.parentElement, i = 0; !img && up && i < 3; up = up.parentElement, i++) img = up.querySelector('img');
    return {
      title: title || box.querySelector('.poly-component__title, h2, h3, a[title]')?.textContent || '',
      price: amount(current),
      oldPrice: amount(previous),
      image: img?.currentSrc || img?.getAttribute('src') || img?.getAttribute('data-src') || '',
      link: box.querySelector('a[href*="MLB"]')?.href || box.querySelector('a[href]')?.href || ''
    };
  };
  const out = { og, cards: [], byTitle: null };
  const target = norm(og);
  if (target.length >= 8) {
    // Menor elemento cujo texto é o nome do produto; sobe até achar um bloco com preço.
    const hits = [...document.querySelectorAll('h1,h2,h3,a,span,p,div')].filter((el) => {
      const t = norm(el.textContent);
      return t && (t === target || (t.length >= 12 && target.startsWith(t)) || (target.length >= 12 && t.startsWith(target))) && el.children.length <= 3;
    }).sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    for (const hit of hits) {
      let box = hit;
      for (let i = 0; i < 8 && box && box !== document.body; i++, box = box.parentElement) {
        if (box.querySelector('.andes-money-amount')) {
          out.byTitle = readContainer(box, og);
          break;
        }
      }
      if (out.byTitle?.price) break;
    }
  }
  for (const card of [...document.querySelectorAll('.poly-card, [class*="poly-card--"]')].slice(0, 60)) out.cards.push(readContainer(card, ''));
  return out;
}

function priceFromText(value) {
  const label = parseReaisLabel(value);
  if (validPrice(label)) return label;
  return parsePrice(value);
}

async function readWithBrowser(inputUrl) {
  return withPage(async (page) => {
    await page.goto(inputUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector('.andes-money-amount, h1.ui-pdp-title, meta[itemprop="price"]', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const raw = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const previous = q('.ui-pdp-price__original-value, .ui-pdp-container s.andes-money-amount--previous');
      return {
        url: location.href,
        canonical: q('link[rel="canonical"]')?.href || '',
        title: q('h1.ui-pdp-title')?.textContent || '',
        price: q('meta[itemprop="price"]')?.getAttribute('content') || '',
        previous: previous?.getAttribute('aria-label') || '',
        image: q('meta[property="og:image"]')?.getAttribute('content') || q('.ui-pdp-gallery__figure img')?.getAttribute('src') || '',
        html: document.documentElement.outerHTML.slice(0, 8_000_000)
      };
    });
    const parsed = parseMercadoLivreHtml(raw.html, raw.url);
    let title = cleanStoreTitle(raw.title) || parsed.title;
    let price = validPrice(parsePrice(raw.price)) ? parsePrice(raw.price) : parsed.price;
    let oldPrice = validPrice(parseReaisLabel(raw.previous)) ? parseReaisLabel(raw.previous) : parsed.oldPrice;
    let imageUrl = raw.image || parsed.imageUrl;
    let productId = mercadoLivreId(`${raw.url} ${raw.canonical}`) || parsed.productId;
    // Vitrine (/social/): lê o card que está aparecendo na tela.
    if (!title || !validPrice(price)) {
      const seen = await page.evaluate(readRenderedCards).catch(() => null);
      let card = seen?.byTitle && validPrice(priceFromText(seen.byTitle.price)) ? seen.byTitle : null;
      if (!card && seen?.og) card = seen.cards.find((c) => sameTitle(c.title, seen.og) && validPrice(priceFromText(c.price))) || null;
      if (!card && seen?.cards?.length === 1 && validPrice(priceFromText(seen.cards[0].price))) card = seen.cards[0];
      if (card) {
        title = title || cleanStoreTitle(card.title || seen.og);
        price = priceFromText(card.price);
        const old = priceFromText(card.oldPrice);
        oldPrice = validPrice(old) && old > price ? old : oldPrice;
        imageUrl = imageUrl || card.image;
        productId = productId || mercadoLivreId(card.link);
      }
    }
    return { resolvedUrl: raw.url, title, price, oldPrice, imageUrl, productId, html: raw.html };
  });
}

// Robôs de prévia de link (como o do WhatsApp) recebem do Mercado Livre uma página simples,
// sem ficar redirecionando. Serve de segunda tentativa, ainda sem navegador.
export const PREVIEW_BOT_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

function merge(base, extra) {
  return {
    title: base.title || extra.title || '',
    price: validPrice(base.price) ? base.price : extra.price,
    oldPrice: validPrice(base.oldPrice) ? base.oldPrice : extra.oldPrice,
    imageUrl: base.imageUrl || extra.imageUrl || '',
    productId: base.productId || extra.productId || ''
  };
}

function shortUrl(url) {
  try { const u = new URL(url); return `${u.hostname}${u.pathname.slice(0, 40)}`; } catch { return '?'; }
}

export async function readMercadoLivre(inputUrl) {
  const notes = [];
  let data = { title: '', price: NaN, oldPrice: NaN, imageUrl: '', productId: '' };
  let resolvedUrl = inputUrl;
  const lastHtml = {};

  // 1) Leitura direta (rápida, guarda cookies entre os redirecionamentos).
  try {
    const page = await fetchPage(inputUrl, { maxBytes: 8_000_000 });
    resolvedUrl = page.url;
    data = parseMercadoLivreHtml(page.html, page.url);
    if (!complete(data) && data.productId && !mercadoLivreId(page.url)) {
      const product = await fetchPage(productPageUrl(data.productId), { maxBytes: 8_000_000 });
      data = merge(parseMercadoLivreHtml(product.html, product.url), data);
    }
    if (!complete(data)) lastHtml.direta = { url: page.url, html: page.html };
    if (!complete(data)) notes.push(`Leitura direta: abriu ${shortUrl(page.url)} mas não achou ${!data.title ? 'nome' : ''}${!data.title && !validPrice(data.price) ? ' nem ' : ''}${!validPrice(data.price) ? 'preço' : ''}${data.title && validPrice(data.price) ? 'foto' : ''}.`);
  } catch (error) {
    notes.push(`Leitura direta: ${error.message}`);
  }

  // 2) Como robô de prévia de link.
  if (!complete(data)) {
    try {
      const page = await fetchPage(inputUrl, { maxBytes: 8_000_000, userAgent: PREVIEW_BOT_UA });
      const fromBot = parseMercadoLivreHtml(page.html, page.url);
      if (!fromBot.title || !validPrice(fromBot.price)) lastHtml.previa = { url: page.url, html: page.html };
      data = merge(data, fromBot);
      if (!resolvedUrl || resolvedUrl === inputUrl) resolvedUrl = page.url;
    } catch (error) {
      notes.push(`Leitura como prévia: ${error.message}`);
    }
  }

  // 3) Navegador invisível (abre a página igual a uma pessoa e lê o que aparece na tela).
  if (!complete(data)) {
    try {
      const viaBrowser = await readWithBrowser(inputUrl);
      resolvedUrl = viaBrowser.resolvedUrl || resolvedUrl;
      data = merge(data, viaBrowser);
      if (viaBrowser.html && (!data.title || !validPrice(data.price))) lastHtml.navegador = { url: viaBrowser.resolvedUrl, html: viaBrowser.html };
      if (!data.title || !validPrice(data.price)) notes.push(`Navegador invisível: abriu ${shortUrl(viaBrowser.resolvedUrl)} mas não achou ${!data.title ? 'o nome' : 'o preço'} na tela.`);
    } catch (error) {
      notes.push(`Navegador invisível: ${error.message}`);
    }
  }

  const ok = data.title && validPrice(data.price);
  if (!ok) {
    const saved = Object.entries(lastHtml).map(([kind, v]) => saveDiagnostic(kind, v.url, v.html)).filter(Boolean);
    if (saved.length) notes.push(`Guardei a página no PC pra eu analisar: pasta ${PATHS.diagnostics} (me mande o arquivo ml-... mais novo).`);
  }
  return {
    resolvedUrl,
    title: data.title,
    price: validPrice(data.price) ? data.price : null,
    oldPrice: validPrice(data.oldPrice) && data.oldPrice > data.price ? data.oldPrice : null,
    imageUrl: bigMercadoLivreImage(data.imageUrl),
    productId: data.productId,
    notes: ok ? [] : notes
  };
}
