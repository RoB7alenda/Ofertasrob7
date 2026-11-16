// Mercado Livre: lê nome, preço, preço antigo e foto a partir do link meli.la.
// 1º tenta direto pelo servidor (rápido, sem navegador). Se faltar algo, usa o navegador invisível.

import { fetchPage } from './http.js';
import { absoluteUrl, cleanStoreTitle, embeddedJsonObjects, firstImageValue, jsonLdProduct, metaContent, priceFromLd, titleTag, walkObjects } from './html.js';
import { mercadoLivreId } from '../links.js';
import { parsePrice, validPrice } from '../text.js';
import { withPage } from '../browser.js';

// "Antes: 1.299 reais com 90 centavos" -> 1299.9
export function parseReaisLabel(label) {
  const m = String(label || '').match(/([\d.]+)\s*reais(?:\s*com\s*(\d{1,2})\s*centavos?)?/i);
  if (!m) return NaN;
  const reais = Number(m[1].replace(/\./g, ''));
  const cents = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
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
      return Math.round((n + Number(String(cents).padEnd(2, '0')) / 100) * 100) / 100;
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

function sameTitle(a, b) {
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

// Foto maior: troca o sufixo de miniatura do ML (-I, -V, -E) pelo tamanho original (-O).
export function bigMercadoLivreImage(url) {
  return String(url || '').replace(/-(?:I|V|E|W|R|S)\.(jpe?g|webp|png)(\?.*)?$/i, '-O.$1$2');
}

async function readWithBrowser(inputUrl) {
  return withPage(async (page) => {
    await page.goto(inputUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector('h1.ui-pdp-title, meta[itemprop="price"]', { timeout: 15_000 }).catch(() => {});
    const raw = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const previous = q('s.andes-money-amount--previous, .ui-pdp-price__original-value');
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
    return {
      resolvedUrl: raw.url,
      title: cleanStoreTitle(raw.title) || parsed.title,
      price: validPrice(parsePrice(raw.price)) ? parsePrice(raw.price) : parsed.price,
      oldPrice: validPrice(parseReaisLabel(raw.previous)) ? parseReaisLabel(raw.previous) : parsed.oldPrice,
      imageUrl: raw.image || parsed.imageUrl,
      productId: mercadoLivreId(`${raw.url} ${raw.canonical}`) || parsed.productId
    };
  });
}

export async function readMercadoLivre(inputUrl) {
  const notes = [];
  let data = { title: '', price: NaN, oldPrice: NaN, imageUrl: '', productId: '' };
  let resolvedUrl = inputUrl;
  try {
    const page = await fetchPage(inputUrl, { maxBytes: 8_000_000 });
    resolvedUrl = page.url;
    data = parseMercadoLivreHtml(page.html, page.url);
    if (!complete(data) && data.productId && !mercadoLivreId(page.url)) {
      const product = await fetchPage(productPageUrl(data.productId));
      const fromProduct = parseMercadoLivreHtml(product.html, product.url);
      data = { ...fromProduct, productId: fromProduct.productId || data.productId };
    }
  } catch (error) {
    notes.push(`Leitura direta: ${error.message}`);
  }
  if (!complete(data)) {
    try {
      const viaBrowser = await readWithBrowser(inputUrl);
      resolvedUrl = viaBrowser.resolvedUrl || resolvedUrl;
      data = {
        title: data.title || viaBrowser.title,
        price: validPrice(data.price) ? data.price : viaBrowser.price,
        oldPrice: validPrice(data.oldPrice) ? data.oldPrice : viaBrowser.oldPrice,
        imageUrl: data.imageUrl || viaBrowser.imageUrl,
        productId: data.productId || viaBrowser.productId
      };
    } catch (error) {
      notes.push(`Navegador invisível: ${error.message}`);
    }
  }
  return {
    resolvedUrl,
    title: data.title,
    price: validPrice(data.price) ? data.price : null,
    oldPrice: validPrice(data.oldPrice) && data.oldPrice > data.price ? data.oldPrice : null,
    imageUrl: bigMercadoLivreImage(data.imageUrl),
    productId: data.productId,
    notes
  };
}
