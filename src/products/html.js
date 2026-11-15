// Leitura de dados de produto de dentro do HTML das lojas (meta tags, JSON-LD e JSON embutido).

import { decodeHtml, normalizeSpaces, parsePrice, validPrice } from '../text.js';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function metaContent(html, key) {
  const k = escapeRegExp(key);
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${k}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${k}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m && m[1]) return normalizeSpaces(decodeHtml(m[1]));
  }
  return '';
}

export function titleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? normalizeSpaces(decodeHtml(m[1])) : '';
}

function walk(value, visit, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 40) return;
  visit(value);
  if (Array.isArray(value)) for (const item of value) walk(item, visit, depth + 1);
  else for (const child of Object.values(value)) walk(child, visit, depth + 1);
}

export function jsonLdBlocks(html) {
  const out = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(regex)) {
    try { out.push(JSON.parse(decodeHtml(m[1]).trim())); } catch {}
  }
  return out;
}

export function jsonLdProduct(html) {
  let found = null;
  for (const block of jsonLdBlocks(html)) {
    walk(block, (node) => {
      if (found || Array.isArray(node)) return;
      const type = [].concat(node['@type'] || []).join(' ').toLowerCase();
      if (type.includes('product')) found = node;
    });
    if (found) break;
  }
  return found;
}

export function firstImageValue(value) {
  if (Array.isArray(value)) return firstImageValue(value[0]);
  if (value && typeof value === 'object') return value.url || value.contentUrl || '';
  return String(value || '');
}

export function priceFromLd(product) {
  if (!product) return NaN;
  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  for (const candidate of [offers?.price, offers?.lowPrice, offers?.priceSpecification?.price, product.price]) {
    const n = parsePrice(candidate);
    if (validPrice(n)) return n;
  }
  return NaN;
}

// Procura JSON grande embutido em <script> (estado da página) e devolve os objetos encontrados.
export function embeddedJsonObjects(html, { maxScripts = 40, maxLength = 4_000_000 } = {}) {
  const out = [];
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts.slice(0, 400)) {
    if (out.length >= maxScripts) break;
    const body = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    if (body.length < 50 || body.length > maxLength) continue;
    if (/type=["']application\/(?:ld\+)?json["']/i.test(script) || /^[{[]/.test(body)) {
      try { out.push(JSON.parse(body)); continue; } catch {}
    }
    // window.__ALGO__ = {...};
    const m = body.match(/=\s*({[\s\S]*})\s*;?\s*$/);
    if (m) {
      try { out.push(JSON.parse(m[1])); } catch {}
    }
  }
  return out;
}

export function walkObjects(value, visit) {
  walk(value, (node) => { if (!Array.isArray(node)) visit(node); });
}

export function absoluteUrl(raw, base) {
  const value = String(raw || '').trim().replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  if (!value) return '';
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function cleanStoreTitle(value) {
  return normalizeSpaces(decodeHtml(value))
    .replace(/\s*[|–-]\s*(?:Shopee Brasil|Shopee|Mercado Livre|MercadoLivre|TikTok Shop|TikTok)\s*$/i, '')
    .replace(/^\s*Comprar\s+/i, '')
    .slice(0, 200)
    .trim();
}
