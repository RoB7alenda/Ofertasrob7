// Shopee: lê nome, preço e foto a partir do link s.shopee.com.br.
// Caminho 1 (recomendado): API oficial de afiliados (App ID + Secret). Sem página, sem aba.
// Caminho 2: navegador invisível com a sua conta da Shopee logada (perfil separado).

import { fetchPage } from './http.js';
import { cleanStoreTitle, metaContent } from './html.js';
import { hasShopeeApi, shopeeProductById, fromShopeeNode } from './shopee-api.js';
import { shopeeIds } from '../links.js';
import { parsePrice, validPrice } from '../text.js';
import { withPage } from '../browser.js';

export async function resolveShopeeLink(inputUrl) {
  const direct = shopeeIds(inputUrl);
  if (direct) return { resolvedUrl: inputUrl, ids: direct };
  const page = await fetchPage(inputUrl, { maxBytes: 600_000 });
  for (const url of [...page.chain].reverse().concat(page.url)) {
    const ids = shopeeIds(url);
    if (ids) return { resolvedUrl: url, ids };
  }
  // Às vezes o link final só aparece dentro da página.
  const fromHtml = shopeeIds(page.html.slice(0, 200_000)) || shopeeIds(metaContent(page.html, 'og:url'));
  return { resolvedUrl: page.url, ids: fromHtml || null };
}

const SHOPEE_UNIT = 100000;

function shopeeImage(hash) {
  if (!hash) return '';
  if (/^https?:/i.test(hash)) return hash;
  return `https://down-br.img.susercontent.com/file/${hash}`;
}

export function parseShopeePdp(json) {
  const data = json?.data || json;
  const item = data?.item || data?.item_basic || {};
  const priceBlock = data?.product_price || {};
  const pick = (...values) => {
    for (const v of values) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return Math.round((n / SHOPEE_UNIT) * 100) / 100;
    }
    return null;
  };
  const price = pick(priceBlock?.price?.single_value, priceBlock?.price?.range_min, item.price_min, item.price);
  let oldPrice = pick(priceBlock?.price_before_discount?.single_value, priceBlock?.price_before_discount?.range_min, item.price_min_before_discount, item.price_before_discount);
  if (!(oldPrice && price && oldPrice > price)) oldPrice = null;
  return {
    title: String(item.title || item.name || '').trim(),
    price,
    oldPrice,
    imageUrl: shopeeImage(item.image || item.images?.[0] || ''),
    productId: String(item.item_id || item.itemid || '')
  };
}

async function readWithBrowser(ids) {
  return withPage(async (page) => {
    let captured = null;
    page.on('response', async (response) => {
      if (captured) return;
      const url = response.url();
      if (!/\/api\/v4\/(?:pdp\/get_pc|pdp\/get|item\/get)\b/.test(url)) return;
      try {
        const json = await response.json();
        const parsed = parseShopeePdp(json);
        if (parsed.title) captured = parsed;
      } catch {}
    });
    await page.goto(`https://shopee.com.br/product/${ids.shopId}/${ids.itemId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    for (let i = 0; i < 40 && !captured; i++) await page.waitForTimeout(500);
    if (captured) return captured;
    const current = page.url();
    if (/\/buyer\/login|\/verify\//i.test(current)) {
      throw new Error('A Shopee pediu login. Em Configurações, clique em "Entrar nas contas" e faça login na Shopee.');
    }
    const dom = await page.evaluate(() => ({
      title: document.querySelector('meta[property="og:title"]')?.content || document.title || '',
      image: document.querySelector('meta[property="og:image"]')?.content || '',
      price: document.querySelector('meta[property="product:price:amount"]')?.content || ''
    }));
    return {
      title: cleanStoreTitle(dom.title),
      price: validPrice(parsePrice(dom.price)) ? parsePrice(dom.price) : null,
      oldPrice: null,
      imageUrl: dom.image,
      productId: ids.itemId
    };
  });
}

export async function readShopee(inputUrl, settings) {
  const notes = [];
  const { resolvedUrl, ids } = await resolveShopeeLink(inputUrl);
  if (!ids) throw new Error('Não consegui achar o produto nesse link da Shopee.');
  let data = null;
  if (hasShopeeApi(settings)) {
    try {
      const node = await shopeeProductById(settings.shopeeApi, ids);
      data = fromShopeeNode(node);
      if (!data) notes.push('A API da Shopee não achou esse produto (pode não ter comissão de afiliado).');
    } catch (error) {
      notes.push(error.message);
    }
  }
  if (!data || !data.title || !validPrice(data.price)) {
    try {
      const viaBrowser = await readWithBrowser(ids);
      data = {
        ...viaBrowser,
        title: data?.title || viaBrowser.title,
        price: validPrice(data?.price) ? data.price : viaBrowser.price,
        oldPrice: data?.oldPrice || viaBrowser.oldPrice,
        oldPriceNote: data?.oldPriceNote || '',
        imageUrl: data?.imageUrl || viaBrowser.imageUrl
      };
    } catch (error) {
      notes.push(`Navegador invisível: ${error.message}`);
    }
  }
  return {
    resolvedUrl,
    title: data?.title || '',
    price: validPrice(data?.price) ? data.price : null,
    oldPrice: data?.oldPrice || null,
    oldPriceNote: data?.oldPriceNote || '',
    imageUrl: data?.imageUrl || '',
    productId: ids.itemId,
    shopId: ids.shopId,
    notes
  };
}
