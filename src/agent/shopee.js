// Agente RoB7 na Shopee: só funciona com a API oficial de afiliados (App ID + Secret).
// A API já devolve o link de afiliado da sua conta (offerLink), então não precisa de navegador.

import { fromShopeeNode, shopeeSearch } from '../products/shopee-api.js';
import { log } from '../log.js';

export function shopeeToCandidate(node, keyword = '') {
  const p = fromShopeeNode(node);
  if (!p) return null;
  return {
    platform: 'shopee',
    title: p.title,
    url: p.productLink || (p.shopId && p.productId ? `https://shopee.com.br/product/${p.shopId}/${p.productId}` : ''),
    offerLink: p.offerLink,
    productId: p.productId,
    shopId: p.shopId,
    price: p.price || 0,
    oldPrice: p.oldPrice || 0,
    oldPriceNote: p.oldPriceNote,
    discount: p.discount || 0,
    rating: p.rating || 0,
    reviews: 0,
    sales: p.sales || 0,
    freeShipping: false,
    full: false,
    imageUrl: p.imageUrl,
    keyword
  };
}

export async function searchShopee(credentials, keywords, { search = shopeeSearch } = {}) {
  const all = [];
  for (const keyword of keywords) {
    try {
      const nodes = await search(credentials, { keyword, sortType: 2, page: 1, limit: 40 });
      for (const node of nodes) {
        const c = shopeeToCandidate(node, keyword);
        if (c?.offerLink) all.push(c);
      }
    } catch (error) {
      log.warn('rob7', `Shopee: não consegui buscar "${keyword}" (${error.message}).`);
      if (/10035|acesso|permiss/i.test(error.message)) break;
    }
  }
  return all;
}
