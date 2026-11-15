// Tudo sobre links: achar links num texto, saber de qual loja é e montar a "identidade" do produto
// (pra não postar o mesmo produto duas vezes).
//
// Regra de ouro (desde a V2.4): o link que vai pro grupo é EXATAMENTE o que você colou.
// Nada de encurtar, converter ou tirar parâmetros. O link "resolvido" só serve pra ler o produto.

const BARE_HOSTS = /\b(?:s\.shopee\.com\.br|shp\.ee|meli\.la|mercado\.li|vt\.tiktok\.com|vm\.tiktok\.com)\/[A-Za-z0-9_\-]+/gi;
const TRAILING = /[)\]}>,.;:!?*_~"'`]+$/;

export function cleanPastedUrl(raw) {
  let value = String(raw || '').trim().replace(TRAILING, '');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return value;
  } catch {
    return '';
  }
}

// Acha todos os links de um texto (ordem preservada, sem repetir).
export function extractUrls(text) {
  const found = [];
  const source = String(text || '');
  const withProtocol = source.match(/https?:\/\/[^\s<>"'“”]+/gi) || [];
  for (const raw of withProtocol) found.push(cleanPastedUrl(raw));
  const withoutProtocol = source.replace(/https?:\/\/[^\s<>"'“”]+/gi, ' ').match(BARE_HOSTS) || [];
  for (const raw of withoutProtocol) found.push(cleanPastedUrl(raw));
  return [...new Set(found.filter(Boolean))];
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function detectPlatform(url) {
  const host = hostOf(url);
  if (!host) return '';
  if (host === 'meli.la' || host === 'mercado.li' || /(^|\.)mercadolivre\.com(\.br)?$/.test(host) || /(^|\.)mercadolibre\.com$/.test(host)) {
    return 'mercadolivre';
  }
  if (host === 'shp.ee' || /(^|\.)shopee\.com\.br$/.test(host) || /(^|\.)shopee\.com$/.test(host)) return 'shopee';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  return '';
}

export const PLATFORM_NAMES = {
  mercadolivre: 'Mercado Livre',
  shopee: 'Shopee',
  tiktok: 'TikTok Shop'
};

// Link afiliado de verdade? (é o que pode ir pro grupo)
export function isAffiliateLink(url, platform = detectPlatform(url)) {
  const host = hostOf(url);
  let path = '';
  try { path = new URL(url).pathname; } catch {}
  if (platform === 'mercadolivre') {
    return host === 'meli.la' || host === 'mercado.li' || (/mercadolivre\.com(\.br)?$/.test(host) && /^\/sec\//i.test(path));
  }
  if (platform === 'shopee') return host === 's.shopee.com.br' || host === 'shp.ee';
  if (platform === 'tiktok') return ['vt.tiktok.com', 'vm.tiktok.com'].includes(host) || /\/(?:view\/)?product\/\d+/i.test(path);
  return false;
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function shopeeIds(url) {
  const text = safeDecode(String(url || ''));
  let m = text.match(/\/product\/(\d{3,})\/(\d{3,})/i);
  if (m) return { shopId: m[1], itemId: m[2] };
  m = text.match(/-i\.(\d{3,})\.(\d{3,})/i);
  if (m) return { shopId: m[1], itemId: m[2] };
  m = text.match(/shopee\.com\.br\/[^/?#]+\/(\d{3,})\/(\d{3,})/i);
  if (m) return { shopId: m[1], itemId: m[2] };
  try {
    const u = new URL(url);
    const shopId = u.searchParams.get('shopid') || u.searchParams.get('shop_id');
    const itemId = u.searchParams.get('itemid') || u.searchParams.get('item_id');
    if (shopId && itemId && /^\d+$/.test(shopId) && /^\d+$/.test(itemId)) return { shopId, itemId };
  } catch {}
  return null;
}

export function mercadoLivreId(text) {
  const value = safeDecode(String(text || ''));
  const m = value.match(/\bMLB(U?)[-_]?(\d{6,})\b/i);
  return m ? `MLB${m[1].toUpperCase()}${m[2]}` : '';
}

export function tiktokProductId(url) {
  const m = safeDecode(String(url || '')).match(/\/(?:view\/)?product\/(\d{6,})/i);
  return m ? m[1] : '';
}

// Chaves que identificam o produto. Se qualquer chave bater com uma oferta antiga, é o mesmo produto.
export function identityKeys({ platform, publishUrl, resolvedUrl, productId }) {
  const keys = new Set();
  const all = [resolvedUrl, publishUrl].filter(Boolean).join(' ');
  if (platform === 'shopee') {
    const ids = shopeeIds(resolvedUrl) || shopeeIds(publishUrl);
    if (ids) keys.add(`shopee:${ids.shopId}:${ids.itemId}`);
    if (productId) keys.add(`shopee:item:${productId}`);
    if (ids) keys.add(`shopee:item:${ids.itemId}`);
  }
  if (platform === 'mercadolivre') {
    const id = productId || mercadoLivreId(all);
    if (id) keys.add(`ml:${id.toUpperCase()}`);
  }
  if (platform === 'tiktok') {
    const id = productId || tiktokProductId(all);
    if (id) keys.add(`tiktok:${id}`);
  }
  if (publishUrl) keys.add(`link:${publishUrl}`);
  return [...keys];
}
