// "Copiar de outros grupos": a Luna fica DENTRO de um grupo de promoção de outra pessoa, só lendo.
// Quando sai uma oferta lá, ela descobre o produto do link, gera o SEU link de afiliado pra esse
// mesmo produto e monta a oferta no nosso layout, na fila da categoria certa.
//
// Regras:
// - Nunca escreve nada no grupo de fora (só lê). Ele não pode ser grupo de categoria nem o de comando.
// - O link deles NUNCA vai pro nosso grupo: sem conseguir o nosso link, a oferta não é criada.
// - Mercado Livre: nosso meli.la vem do Gerador de links. Shopee: só com a API configurada.

import { EventEmitter } from 'node:events';
import { detectPlatform, extractUrls } from './links.js';
import { getCategory } from './categories.js';
import { hasShopeeApi } from './products/shopee-api.js';
import { readProduct } from './products/index.js';
import { makeMeliLinks } from './agent/mercadolivre.js';
import { validPrice } from './text.js';
import { log } from './log.js';

const MAX_SEEN = 600;
const MAX_LINKS_PER_MESSAGE = 5;

// Página do produto pelo código do Mercado Livre (é o que o Gerador de links recebe).
export function mercadoLivreProductUrl(productId) {
  const id = String(productId || '').toUpperCase();
  if (/^MLBU\d+$/.test(id)) return `https://www.mercadolivre.com.br/up/${id}`;
  const digits = id.replace(/^MLB-?/, '');
  if (!/^\d{6,}$/.test(digits)) return '';
  // Código curto (até 8 números) é de "produto do catálogo"; o longo é de anúncio.
  return digits.length <= 8 ? `https://www.mercadolivre.com.br/p/MLB${digits}` : `https://produto.mercadolivre.com.br/MLB-${digits}`;
}

// Página do produto sem nenhum parâmetro (tira o rastreio de afiliado DELES do link).
export function pageWithoutParams(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)mercadolivre\.com\.br$/i.test(u.hostname) || !/\/(?:p\/MLB|up\/MLBU|MLB-?\d)/i.test(u.pathname)) return '';
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

function today() {
  return new Date().toLocaleDateString('sv-SE');
}

export class SourceWatcher extends EventEmitter {
  constructor({ settings, db, offers, whatsapp, reader = readProduct, makeLinks = makeMeliLinks }) {
    super();
    this.settings = settings;
    this.db = db;
    this.offers = offers;
    this.whatsapp = whatsapp;
    this.reader = reader;
    this.makeLinks = makeLinks;
    this.chain = Promise.resolve();
    this.pending = 0;
    this.db.update((data) => {
      data.sourceState = data.sourceState || {};
      data.sourceState.seen = data.sourceState.seen || [];
    });
  }

  config() {
    return this.settings.get().sources || { enabled: false, groups: [] };
  }

  attach() {
    this.whatsapp.on('message', (msg) => this.onMessage(msg));
  }

  // Só lê: nada aqui manda mensagem pro grupo de onde veio.
  onMessage(msg) {
    const cfg = this.config();
    if (!cfg.enabled || !msg?.isGroup || !cfg.groups?.includes(msg.jid)) return 0;
    const links = extractUrls(msg.text).filter((url) => detectPlatform(url) === 'mercadolivre' || detectPlatform(url) === 'shopee');
    let queued = 0;
    for (const url of links.slice(0, MAX_LINKS_PER_MESSAGE)) {
      if (this.wasSeen(url)) continue;
      this.markSeen(url);
      queued++;
      this.pending++;
      // Um link por vez (o navegador invisível é um só).
      this.chain = this.chain
        .then(() => this.copy(url, msg.jid))
        .catch((error) => this.fail(url, error))
        .finally(() => { this.pending--; this.emit('status'); });
    }
    return queued;
  }

  wasSeen(url) {
    return (this.db.get().sourceState?.seen || []).includes(url);
  }

  markSeen(url) {
    this.db.update((data) => {
      const seen = data.sourceState.seen;
      seen.push(url);
      if (seen.length > MAX_SEEN) seen.splice(0, seen.length - MAX_SEEN);
    });
  }

  count(field, extra = {}) {
    this.db.update((data) => {
      const st = data.sourceState;
      if (st.day !== today()) Object.assign(st, { day: today(), copied: 0, skipped: 0 });
      st[field] = (st[field] || 0) + 1;
      Object.assign(st, extra);
    });
  }

  skip(url, reason) {
    log.info('copia', `Pulei ${url}: ${reason}.`);
    this.count('skipped');
    return null;
  }

  fail(url, error) {
    log.warn('copia', `Não consegui copiar ${url} (${error.message}).`);
    this.count('skipped', { lastError: error.message, lastErrorAt: new Date().toISOString() });
  }

  async copy(url, fromJid) {
    const settings = this.settings.get();
    const cfg = this.config();
    const platform = detectPlatform(url);
    if (!settings.platforms?.[platform]) return this.skip(url, 'loja desligada');
    if (platform === 'shopee' && !hasShopeeApi(settings)) return this.skip(url, 'link da Shopee só com a API configurada');

    // 1) Lê o produto pelo link deles (nome, preço, De e foto vêm da loja, não da mensagem deles).
    const product = await this.reader(platform, url, settings);
    if (!product?.title || !validPrice(product.price)) return this.skip(url, 'não deu pra ler nome e preço');
    if (platform === 'mercadolivre' && !product.productId) return this.skip(url, 'não achei o código do produto');
    const keys = platform === 'mercadolivre' ? [`ml:${String(product.productId).toUpperCase()}`] : [];
    if (keys.length && this.offers.findDuplicate(keys)) return this.skip(url, 'produto já está no programa');

    // 2) Categoria: só vale categoria ligada e com grupo.
    const categoryId = await this.offers.chooseCategory(product.title);
    const category = getCategory(settings, categoryId);
    if (!category.enabled || !category.groups.length) return this.skip(url, `"${product.title.slice(0, 40)}" seria de ${category.name}, que não tem grupo`);
    const max = Number(cfg.maxQueued) || 40;
    if (this.offers.queued(category.id).length >= max) return this.skip(url, `fila de ${category.name} cheia (${max})`);

    // 3) O NOSSO link. Sem ele, não cria a oferta.
    const groupName = this.whatsapp.groupName?.(fromJid) || 'grupo de fora';
    const preset = { ...product, notes: [`Copiada do grupo "${groupName}" (link trocado pelo seu).`] };
    let ourLink;
    if (platform === 'mercadolivre') {
      const productUrl = pageWithoutParams(product.resolvedUrl) || mercadoLivreProductUrl(product.productId);
      if (!productUrl) return this.skip(url, 'não montei o link do produto');
      ourLink = (await this.makeLinks([productUrl])).get(productUrl);
      if (!ourLink) throw new Error('não consegui gerar o seu meli.la (a conta de afiliado está logada?)');
    } else {
      // Shopee: passa o link do PRODUTO (não o deles); o programa gera o seu pela API.
      ourLink = product.resolvedUrl && !/s\.shopee\.com\.br|shp\.ee/i.test(product.resolvedUrl) ? product.resolvedUrl : '';
      if (!ourLink) return this.skip(url, 'não achei o link do produto na Shopee');
    }

    const result = await this.offers.addFromUrl(ourLink, {
      origin: 'copia',
      category: category.id,
      preset,
      autoApprove: cfg.autoQueue !== false
    });
    if (!result.offer) return this.skip(url, result.message || 'repetida');
    if (result.offer.publishUrl === url) throw new Error('o link publicado ficaria igual ao deles'); // trava de segurança
    this.count('copied', { lastAt: new Date().toISOString(), lastTitle: result.offer.title });
    log.info('copia', `Oferta #${result.offer.id} copiada de "${groupName}" pra ${category.name}${result.offer.status === 'fila' ? ' (já na fila)' : ''}.`);
    this.emit('copied', result.offer);
    return result.offer;
  }

  status() {
    const cfg = this.config();
    const st = this.db.get().sourceState || {};
    const fresh = st.day === today();
    return {
      enabled: Boolean(cfg.enabled),
      groups: (cfg.groups || []).map((jid) => ({ jid, name: this.whatsapp.groupName?.(jid) || '' })),
      autoQueue: cfg.autoQueue !== false,
      working: this.pending,
      copiedToday: fresh ? st.copied || 0 : 0,
      skippedToday: fresh ? st.skipped || 0 : 0,
      lastAt: st.lastAt || null,
      lastTitle: st.lastTitle || '',
      lastError: st.lastError || '',
      lastErrorAt: st.lastErrorAt || null
    };
  }
}
