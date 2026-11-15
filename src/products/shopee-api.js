// API oficial de Afiliados da Shopee (Open API). É de graça pra afiliado:
// no painel affiliate.shopee.com.br > "Open API" você pega o App ID e o Secret.
// Com ela, nome, preço e foto vêm direto da Shopee, sem abrir nenhuma página.

import crypto from 'node:crypto';
import { fetchJson } from './http.js';

export const SHOPEE_ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

const NODE_FIELDS = 'itemId productName priceMin priceMax priceDiscountRate imageUrl offerLink productLink shopId shopName sales ratingStar commissionRate';

export function shopeeSignature({ appId, secret, timestamp, payload }) {
  return crypto.createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`).digest('hex');
}

export function hasShopeeApi(settings) {
  return Boolean(settings?.shopeeApi?.appId && settings?.shopeeApi?.secret);
}

function digitsOnly(value, label) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,20}$/.test(text)) throw new Error(`${label} inválido.`);
  return text;
}

export async function shopeeQuery(credentials, query) {
  const appId = String(credentials?.appId || '').trim();
  const secret = String(credentials?.secret || '').trim();
  if (!appId || !secret) throw new Error('Falta o App ID ou o Secret da Shopee.');
  const payload = JSON.stringify({ query });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = shopeeSignature({ appId, secret, timestamp, payload });
  let data;
  try {
    data = await fetchJson(SHOPEE_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`
      },
      body: payload
    });
  } catch (error) {
    if (error.data?.errors?.length) data = error.data;
    else throw new Error(`A Shopee não respondeu (${error.message}).`);
  }
  if (Array.isArray(data?.errors) && data.errors.length) {
    const first = data.errors[0];
    const code = first?.extensions?.code;
    const message = String(first?.message || 'erro desconhecido');
    if (Number(code) === 10035 || /do not have access/i.test(message)) {
      throw new Error('Essa conta ainda não tem acesso à Open API da Shopee. No painel de afiliado (affiliate.shopee.com.br), entre em "Open API" e peça o acesso.');
    }
    if ([10020, 10010, 10031].includes(Number(code)) || /sign|credential|auth|permission/i.test(message)) {
      throw new Error(`A Shopee recusou as credenciais da Open API (${message}). Confira o App ID e o Secret.`);
    }
    throw new Error(`Shopee: ${message}`);
  }
  return data?.data || {};
}

export async function shopeeProductById(credentials, { itemId, shopId }) {
  const item = digitsOnly(itemId, 'ID do produto');
  const shop = shopId ? `, shopId: ${digitsOnly(shopId, 'ID da loja')}` : '';
  const data = await shopeeQuery(credentials, `{ productOfferV2(itemId: ${item}${shop}, limit: 1) { nodes { ${NODE_FIELDS} } } }`);
  return data?.productOfferV2?.nodes?.[0] || null;
}

// sortType: 1 = relevância, 2 = mais vendidos, 3 = maior preço, 4 = menor preço, 5 = maior comissão
export async function shopeeSearch(credentials, { keyword = '', sortType = 2, page = 1, limit = 30 } = {}) {
  const parts = [`sortType: ${Number(sortType) || 2}`, `page: ${Math.max(1, Number(page) || 1)}`, `limit: ${Math.min(50, Math.max(1, Number(limit) || 30))}`];
  if (keyword) parts.unshift(`keyword: ${JSON.stringify(String(keyword).slice(0, 80))}`);
  const data = await shopeeQuery(credentials, `{ productOfferV2(${parts.join(', ')}) { nodes { ${NODE_FIELDS} } pageInfo { page limit hasNextPage } } }`);
  return data?.productOfferV2?.nodes || [];
}

// Transforma um link normal da Shopee em link de afiliado (s.shopee.com.br) da sua conta.
export async function shopeeShortLink(credentials, originUrl) {
  const data = await shopeeQuery(credentials, `mutation { generateShortLink(input: { originUrl: ${JSON.stringify(String(originUrl))}, subIds: ["rob7"] }) { shortLink } }`);
  const link = data?.generateShortLink?.shortLink;
  if (!link) throw new Error('A Shopee não devolveu o link de afiliado.');
  return link;
}

// Converte o produto da API pro formato do programa.
export function fromShopeeNode(node) {
  if (!node) return null;
  const price = Number(node.priceMin ?? node.priceMax);
  const rate = Number(node.priceDiscountRate || 0);
  // O "De" vem do desconto que a própria Shopee informa (não é chute nosso).
  const oldPrice = Number.isFinite(price) && rate > 0 && rate < 95 ? Math.round((price / (1 - rate / 100)) * 100) / 100 : null;
  return {
    title: String(node.productName || '').trim(),
    price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null,
    oldPrice,
    oldPriceNote: oldPrice ? `calculado pelo desconto de ${rate}% informado pela Shopee` : '',
    imageUrl: String(node.imageUrl || ''),
    productId: String(node.itemId || ''),
    shopId: String(node.shopId || ''),
    offerLink: String(node.offerLink || ''),
    productLink: String(node.productLink || ''),
    sales: Number(node.sales || 0),
    rating: Number(node.ratingStar || 0),
    discount: rate,
    commissionRate: Number(node.commissionRate || 0)
  };
}
