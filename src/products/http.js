// Busca páginas das lojas seguindo os redirecionamentos (ex.: meli.la -> mercadolivre.com.br).
// Só acessa domínios das lojas e das CDNs de imagem delas (lista abaixo). Nada de site aleatório.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const ALLOWED_SUFFIXES = [
  // Mercado Livre
  'meli.la', 'mercado.li', 'mercadolivre.com.br', 'mercadolivre.com', 'mercadolibre.com', 'mlstatic.com',
  // Shopee
  'shopee.com.br', 'shopee.com', 'shp.ee', 'susercontent.com', 'shopeemobile.com',
  // TikTok
  'tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'ibyteimg.com', 'byteimg.com', 'tiktokv.com'
];

export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function isAllowedHost(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('A loja demorou demais pra responder.');
    throw new Error(`Não consegui acessar a loja (${error.cause?.code || error.message}).`);
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response, maxBytes) {
  if (!response.body) return '';
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    out += decoder.decode(chunk, { stream: true });
    if (total > maxBytes) break;
  }
  return out + decoder.decode();
}

function metaRefreshTarget(html, base) {
  const m = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'>\s]+)/i);
  if (!m) return '';
  try { return new URL(m[1].replace(/&amp;/g, '&'), base).href; } catch { return ''; }
}

// Guarda os cookies entre um pulo e outro do link (o meli.la, por exemplo, só para de
// redirecionar depois que recebe de volta o cookie que ele mesmo mandou).
export class CookieJar {
  constructor() {
    this.cookies = [];
  }

  store(url, setCookies = []) {
    const host = new URL(url).hostname.toLowerCase();
    for (const header of setCookies) {
      const [pair, ...attrs] = String(header).split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = host;
      let hostOnly = true;
      let path = '/';
      let expired = false;
      for (const attr of attrs) {
        const [k, ...v] = attr.split('=');
        const key = k.trim().toLowerCase();
        const val = v.join('=').trim();
        if (key === 'domain' && val) {
          const d = val.replace(/^\./, '').toLowerCase();
          if (host === d || host.endsWith(`.${d}`)) { domain = d; hostOnly = false; }
        } else if (key === 'path' && val.startsWith('/')) {
          path = val;
        } else if (key === 'max-age' && Number(val) <= 0) {
          expired = true;
        } else if (key === 'expires' && Date.parse(val) < Date.now()) {
          expired = true;
        }
      }
      this.cookies = this.cookies.filter((c) => !(c.name === name && c.domain === domain && c.path === path));
      if (!expired) this.cookies.push({ name, value, domain, hostOnly, path });
    }
  }

  header(url) {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return this.cookies
      .filter((c) => (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith(`.${c.domain}`)))
      .filter((c) => u.pathname.startsWith(c.path))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }
}

function describeChain(chain) {
  return chain.slice(-4).map((u) => {
    try { const x = new URL(u); return `${x.hostname}${x.pathname.slice(0, 40)}`; } catch { return '?'; }
  }).join(' → ');
}

// Segue redirecionamentos um por um (guarda o caminho e os cookies) e devolve a página final.
export async function fetchPage(rawUrl, { timeoutMs = 12000, maxBytes = 3_000_000, maxRedirects = 12 } = {}) {
  let current = rawUrl;
  const chain = [];
  const jar = new CookieJar();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isAllowedHost(current)) throw new Error(`Link fora das lojas permitidas: ${new URL(current).hostname}`);
    chain.push(current);
    const cookie = jar.header(current);
    const response = await fetchWithTimeout(current, {
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.5',
        ...(cookie ? { cookie } : {})
      }
    }, timeoutMs);
    jar.store(current, typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []);
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      try { await response.body?.cancel(); } catch {}
      current = new URL(location, current).href;
      continue;
    }
    const html = await readLimited(response, maxBytes);
    const refresh = metaRefreshTarget(html.slice(0, 20000), current);
    if (refresh && refresh !== current && hop < maxRedirects) {
      current = refresh;
      continue;
    }
    return { url: current, status: response.status, ok: response.ok, html, chain };
  }
  throw new Error(`O link redirecionou vezes demais (passou por: ${describeChain(chain)}).`);
}

export async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  const response = await fetchWithTimeout(url, { method, headers, body }, timeoutMs);
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  if (data === null) throw new Error('Resposta inválida (não é JSON).');
  return data;
}

function isPrivateAddress(address) {
  if (!address) return true;
  if (address.includes(':')) {
    const v = address.toLowerCase();
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('::ffff:');
  }
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// Foto colada à mão pode vir de qualquer site público (https), menos endereços internos.
async function assertPublicHttps(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('A foto precisa ser um link https.');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('Endereço não permitido.');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Endereço não permitido.');
    return;
  }
  const records = await lookup(host, { all: true });
  if (!records.length || records.some((r) => isPrivateAddress(r.address))) throw new Error('Endereço não permitido.');
}

export async function fetchBinary(url, { timeoutMs = 15000, maxBytes = 12_000_000, referer = '', anyHost = false } = {}) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    if (anyHost) await assertPublicHttps(current);
    else if (!isAllowedHost(current)) throw new Error('Imagem fora das lojas permitidas.');
    const response = await fetchWithTimeout(current, {
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5',
        ...(referer ? { referer } : {})
      }
    }, timeoutMs);
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) throw new Error(`Imagem HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('Imagem grande demais.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('Imagem grande demais.');
    return { bytes, contentType: (response.headers.get('content-type') || '').split(';')[0], url: current };
  }
  throw new Error('A imagem redirecionou vezes demais.');
}
