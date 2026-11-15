// Radar Shopee pela API oficial de afiliados: procura produtos com bom desconto e boas vendas
// e joga pra você aprovar. Nunca repete produto que já passou pelo programa.

import { fromShopeeNode, hasShopeeApi, shopeeSearch } from '../products/shopee-api.js';
import { log } from '../log.js';

export function shopeeCandidateOk(p, cfg) {
  if (!p?.offerLink || !p.title || !p.imageUrl || !(p.price > 0)) return false;
  if (Number(cfg.minDiscount) > 0 && p.discount < Number(cfg.minDiscount)) return false;
  if (Number(cfg.minSales) > 0 && p.sales < Number(cfg.minSales)) return false;
  if (Number(cfg.minRating) > 0 && p.rating > 0 && p.rating < Number(cfg.minRating)) return false;
  if (Number(cfg.maxPrice) > 0 && p.price > Number(cfg.maxPrice)) return false;
  return true;
}

export async function runShopeeRadar({ settings, offers, db, awaitingZap = false, search = shopeeSearch }) {
  const all = settings.get();
  const cfg = all.radar.shopee;
  if (!hasShopeeApi(all)) throw new Error('O radar da Shopee precisa da API oficial (App ID e Secret) em Configurações.');
  const perRun = Math.min(20, Math.max(1, Number(cfg.perRun) || 5));
  const keywords = (cfg.keywords || []).map((k) => String(k).trim()).filter(Boolean);
  const state = db.get().radarState.shopee || {};
  const startIndex = Number(state.keywordIndex) || 0;
  const rounds = keywords.length ? keywords.map((_, i) => keywords[(startIndex + i) % keywords.length]) : [''];
  const known = offers.allIdentityKeys();
  const picked = [];
  const seen = new Set();
  let used = 0;
  for (const keyword of rounds) {
    used++;
    for (let page = 1; page <= 3 && picked.length < perRun; page++) {
      const nodes = await search(all.shopeeApi, { keyword, sortType: 2, page, limit: 40 });
      if (!nodes.length) break;
      for (const node of nodes) {
        const p = fromShopeeNode(node);
        const keys = [`shopee:${p.shopId}:${p.productId}`, `shopee:item:${p.productId}`, `link:${p.offerLink}`];
        if (keys.some((k) => known.has(k) || seen.has(k))) continue;
        keys.forEach((k) => seen.add(k));
        if (!shopeeCandidateOk(p, cfg)) continue;
        picked.push(p);
        if (picked.length >= perRun) break;
      }
    }
    if (picked.length >= perRun) break;
  }
  db.update((data) => {
    data.radarState.shopee = { ...data.radarState.shopee, keywordIndex: keywords.length ? (startIndex + used) % keywords.length : 0 };
  });
  const added = [];
  for (const p of picked) {
    try {
      const result = await offers.addFromUrl(p.offerLink, {
        origin: 'radar',
        awaitingZap,
        preset: {
          resolvedUrl: p.productLink || `https://shopee.com.br/product/${p.shopId}/${p.productId}`,
          title: p.title,
          price: p.price,
          oldPrice: p.oldPrice,
          oldPriceNote: p.oldPriceNote,
          imageUrl: p.imageUrl,
          productId: p.productId,
          notes: [`Radar Shopee: ${p.discount}% off, ${p.sales} vendidos${p.rating ? `, nota ${p.rating.toFixed(1)}` : ''}`]
        }
      });
      if (result.offer) added.push(result.offer);
    } catch (error) {
      log.warn('radar', `Shopee: não salvei um produto do radar (${error.message})`);
    }
  }
  return added;
}
