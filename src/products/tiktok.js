// TikTok Shop: fica pronto, mas vem DESLIGADO (liga em Configurações quando a conta de afiliado sair).
// Lê o produto pelo navegador invisível. O que não der pra confirmar fica em branco pra você preencher.

import { fetchPage } from './http.js';
import { cleanStoreTitle, firstImageValue, jsonLdProduct, metaContent, priceFromLd } from './html.js';
import { tiktokProductId } from '../links.js';
import { parsePrice, validPrice } from '../text.js';
import { withPage } from '../browser.js';

function fromHtml(html, url) {
  const ld = jsonLdProduct(html);
  return {
    title: cleanStoreTitle(ld?.name || metaContent(html, 'og:title')),
    price: validPrice(priceFromLd(ld)) ? priceFromLd(ld) : parsePrice(metaContent(html, 'product:price:amount')),
    imageUrl: firstImageValue(ld?.image) || metaContent(html, 'og:image'),
    productId: tiktokProductId(url)
  };
}

export async function readTiktok(inputUrl) {
  const notes = [];
  let resolvedUrl = inputUrl;
  let data = { title: '', price: NaN, imageUrl: '', productId: '' };
  try {
    const page = await fetchPage(inputUrl);
    resolvedUrl = page.url;
    data = fromHtml(page.html, page.url);
  } catch (error) {
    notes.push(`Leitura direta: ${error.message}`);
  }
  if (!data.title || !validPrice(data.price) || !data.imageUrl) {
    try {
      const viaBrowser = await withPage(async (page) => {
        await page.goto(inputUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(4000);
        const html = await page.content();
        const parsed = fromHtml(html, page.url());
        if (!validPrice(parsed.price)) {
          const priceText = await page.evaluate(() => {
            const nodes = [...document.querySelectorAll('[class*="price" i]')];
            const hit = nodes.map((n) => n.textContent || '').find((t) => /R\$\s*\d/.test(t));
            return hit || '';
          });
          const m = priceText.match(/R\$\s*([\d.]+,\d{2})/);
          if (m) parsed.price = parsePrice(m[1]);
        }
        return { ...parsed, resolvedUrl: page.url() };
      });
      resolvedUrl = viaBrowser.resolvedUrl || resolvedUrl;
      data = {
        title: data.title || viaBrowser.title,
        price: validPrice(data.price) ? data.price : viaBrowser.price,
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
    oldPrice: null,
    imageUrl: data.imageUrl,
    productId: data.productId || tiktokProductId(resolvedUrl),
    notes
  };
}
