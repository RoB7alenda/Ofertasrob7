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

// Procura, no JSON embutido da página (ex.: página /social/), o produto do link.
function productFromEmbedded(html, preferredIds) {
  const candidates = [];
  for (const root of embeddedJsonObjects(html)) {
    walkObjects(root, (node) => {
      const title = typeof node.title === 'string' ? node.title : (typeof node.name === 'string' ? node.name : '');
      if (title.length < 8) return;
      const price = objectPrice(node);
      if (!validPrice(price)) return;
      const idText = [node.id, node.item_id, node.itemId, node.product_id, node.permalink, node.url].filter((v) => typeof v === 'string').join(' ');
      candidates.push({
        title,
        price,
        oldPrice: objectOldPrice(node),
        imageUrl: objectImage(node),
        productId: mercadoLivreId(idText),
        permalink: typeof node.permalink === 'string' ? node.permalink : ''
      });
    });
  }
  if (!candidates.length) return null;
  if (preferredIds.length) {
    const match = candidates.find((c) => c.productId && preferredIds.includes(c.productId));
    if (match) return match;
  }
  const withId = candidates.filter((c) => c.productId);
  const unique = new Set(withId.map((c) => c.productId));
  // Só aceita sem ID conhecido se a página tiver UM produto só (senão seria chute).
  if (unique.size === 1) return withId[0];
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
    const embedded = productFromEmbedded(html, preferredIds);
    if (embedded) {
      out.title = cleanStoreTitle(embedded.title);
      out.price = embedded.price;
      out.oldPrice = embedded.oldPrice;
      out.imageUrl = absoluteUrl(embedded.imageUrl, url);
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
        html: document.documentElement.outerHTML.slice(0, 2_500_000)
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
    const page = await fetchPage(inputUrl);
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
