// Regras do agente RoB7 (sem IA): o que passa no filtro de cada categoria e qual oferta é melhor.
// Um "candidato" é o que o agente achou na busca, antes de virar oferta:
// { platform, title, url, productId, price, oldPrice, discount, rating, reviews, sales,
//   freeShipping, full, imageUrl, offerLink? }

export function discountOf(price, oldPrice) {
  if (!(price > 0) || !(oldPrice > price)) return 0;
  return Math.round((1 - price / oldPrice) * 100);
}

// Por que esse candidato não serve? ('' = serve)
export function rejectReason(c, category) {
  if (!c?.title || !c.url || !(c.price > 0)) return 'faltou nome, link ou preço';
  if (!c.imageUrl) return 'sem foto';
  if (c.unavailable) return 'sem estoque';
  const minDiscount = Number(category.minDiscount) || 0;
  if (minDiscount > 0 && (c.discount || 0) < minDiscount) return `desconto menor que ${minDiscount}%`;
  const minRating = Number(category.minRating) || 0;
  if (minRating > 0 && !((c.rating || 0) >= minRating)) return `nota menor que ${minRating}`;
  const minReviews = Number(category.minReviews) || 0;
  const proof = Math.max(Number(c.reviews) || 0, Number(c.sales) || 0);
  if (minReviews > 0 && proof < minReviews) return 'poucas vendas/avaliações';
  // Frete grátis só dá pra conferir no Mercado Livre (a API da Shopee não informa).
  if (category.requireFreeShipping && c.platform === 'mercadolivre' && !c.freeShipping && !c.full) return 'sem frete grátis';
  const maxPrice = Number(category.maxPrice) || 0;
  if (maxPrice > 0 && c.price > maxPrice) return `acima de R$ ${maxPrice}`;
  return '';
}

// Nota de 0 a ~100 pra ordenar: desconto pesa mais, depois avaliação, prova social e frete.
export function scoreOf(c) {
  const proof = Math.max(Number(c.reviews) || 0, Number(c.sales) || 0);
  let score = Math.min(70, Number(c.discount) || 0);
  score += Math.max(0, ((Number(c.rating) || 0) - 4) * 15);
  score += Math.min(12, Math.log10(proof + 1) * 4);
  if (c.full) score += 6;
  else if (c.freeShipping) score += 4;
  if (c.sponsored) score -= 3;
  return Math.round(score * 10) / 10;
}

// Chaves pra saber se o produto já passou pelo programa (mesmo formato de links.js identityKeys).
export function candidateKeys(c) {
  const keys = [];
  if (c.platform === 'mercadolivre' && c.productId) keys.push(`ml:${String(c.productId).toUpperCase()}`);
  if (c.platform === 'shopee') {
    if (c.shopId && c.productId) keys.push(`shopee:${c.shopId}:${c.productId}`);
    if (c.productId) keys.push(`shopee:item:${c.productId}`);
  }
  if (c.offerLink) keys.push(`link:${c.offerLink}`);
  if (!keys.length && c.url) keys.push(`url:${c.url}`);
  return keys;
}

// Tira repetidos, o que já passou pelo programa e o que não passa no filtro. Devolve ordenado.
export function shortlist(candidates, category, knownKeys = new Set()) {
  const seen = new Set();
  const titles = new Set();
  const kept = [];
  const reasons = {};
  for (const c of candidates) {
    const keys = candidateKeys(c);
    if (keys.some((k) => seen.has(k) || knownKeys.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    const titleKey = String(c.title || '').toLowerCase().replace(/[^a-z0-9à-ú]+/g, ' ').trim().slice(0, 60);
    if (titleKey && titles.has(titleKey)) continue;
    if (titleKey) titles.add(titleKey);
    const reason = rejectReason(c, category);
    if (reason) {
      reasons[reason] = (reasons[reason] || 0) + 1;
      continue;
    }
    kept.push({ ...c, score: scoreOf(c) });
  }
  kept.sort((a, b) => b.score - a.score);
  return { kept, reasons };
}
