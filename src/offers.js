// Coração das ofertas: criar a partir do link, editar, aprovar, descartar e controlar a fila.
//
// Situações (status) de uma oferta:
//   aguardando -> esperando você aprovar (pode estar faltando algo)
//   fila       -> aprovada, esperando o horário de postar
//   enviando   -> postando agora nos grupos
//   postada    -> foi pro grupo
//   falhou     -> não conseguiu postar (dá pra tentar de novo)
//   descartada -> você descartou

import { EventEmitter } from 'node:events';
import { detectPlatform, extractUrls, identityKeys, isAffiliateLink, PLATFORM_NAMES } from './links.js';
import { readProduct } from './products/index.js';
import { hasShopeeApi, shopeeShortLink } from './products/shopee-api.js';
import { missingFields } from './message.js';
import { compactTitle, ddmm, normalizeSpaces, parsePrice, validPrice } from './text.js';
import { log } from './log.js';

const ACTIVE = new Set(['aguardando', 'fila', 'enviando', 'falhou']);
const MAX_OFFERS = 3000;

export class UserError extends Error {}

export class OfferService extends EventEmitter {
  constructor({ db, settings, reader = readProduct, shortLinker = shopeeShortLink }) {
    super();
    this.db = db;
    this.settings = settings;
    this.reader = reader;
    this.shortLinker = shortLinker;
    this.reading = new Set();
  }

  get list() {
    return this.db.get().offers;
  }

  get(id) {
    return this.list.find((o) => o.id === String(id)) || null;
  }

  mustGet(id) {
    const offer = this.get(id);
    if (!offer) throw new UserError(`Não achei a oferta #${id}.`);
    return offer;
  }

  nextId() {
    return this.db.update((data) => {
      data.seq = (Number(data.seq) || 0) + 1;
      return String(data.seq);
    });
  }

  touch(offer) {
    offer.updatedAt = new Date().toISOString();
    offer.missing = missingFields(offer);
    this.db.update(() => {});
    this.emit('changed', offer);
    return offer;
  }

  // Produto repetido? (na fila, esperando, ou postado nos últimos X dias)
  findDuplicate(keys, { ignoreId = '' } = {}) {
    const days = Math.max(0, Number(this.settings.get().repeatDays) || 0);
    const limit = Date.now() - days * 86_400_000;
    const wanted = new Set(keys);
    for (const offer of this.list) {
      if (offer.id === ignoreId) continue;
      if (!offer.identity?.some((k) => wanted.has(k))) continue;
      if (ACTIVE.has(offer.status)) return offer;
      if (offer.status === 'postada' && offer.postedAt && Date.parse(offer.postedAt) >= limit) return offer;
    }
    return null;
  }

  describeDuplicate(offer) {
    if (offer.status === 'postada') return `já foi postado dia ${ddmm(new Date(offer.postedAt))} (oferta #${offer.id})`;
    if (offer.status === 'fila') return `já está na fila (oferta #${offer.id})`;
    if (offer.status === 'falhou') return `já está aqui, com falha no envio (oferta #${offer.id})`;
    return `já está esperando aprovação (oferta #${offer.id})`;
  }

  allIdentityKeys() {
    const keys = new Set();
    for (const offer of this.list) for (const key of offer.identity || []) keys.add(key);
    return keys;
  }

  // Lê todos os links de um texto, um de cada vez.
  async addFromText(text, options = {}) {
    const urls = extractUrls(text);
    if (!urls.length) throw new UserError('Não achei nenhum link nesse texto.');
    const results = [];
    for (const url of urls.slice(0, 30)) {
      try {
        results.push({ url, ...(await this.addFromUrl(url, options)) });
      } catch (error) {
        results.push({ url, error: error.message });
      }
    }
    return results;
  }

  async addFromUrl(inputUrl, { origin = 'painel', allowRepeat = false, awaitingZap = false, preset = null } = {}) {
    const settings = this.settings.get();
    const platform = detectPlatform(inputUrl);
    if (!platform) throw new UserError('Esse link não é do Mercado Livre, da Shopee nem do TikTok Shop.');
    if (!settings.platforms?.[platform]) {
      throw new UserError(`${PLATFORM_NAMES[platform]} está desligado. Ligue em Configurações > Lojas.`);
    }

    let publishUrl = inputUrl;
    const affiliate = isAffiliateLink(inputUrl, platform);
    if (!affiliate) {
      if (platform === 'mercadolivre') {
        throw new UserError('Esse link do Mercado Livre não é de afiliado. Cole o link meli.la gerado na sua conta de afiliado.');
      }
      if (platform === 'shopee' && !hasShopeeApi(settings)) {
        throw new UserError('Esse link da Shopee não é de afiliado. Cole o link s.shopee.com.br (ou configure a API da Shopee pra converter sozinho).');
      }
    }

    if (!allowRepeat) {
      const sameLink = this.findDuplicate([`link:${inputUrl}`]);
      if (sameLink) return { duplicate: sameLink, message: `Esse link ${this.describeDuplicate(sameLink)}.` };
    }

    const key = `${platform}:${inputUrl}`;
    if (this.reading.has(key)) throw new UserError('Esse link já está sendo lido, espera um pouquinho.');
    this.reading.add(key);
    let product;
    try {
      product = preset || await this.reader(platform, inputUrl, settings);
    } finally {
      this.reading.delete(key);
    }

    // Link normal da Shopee + API configurada: gera o link de afiliado da sua conta.
    if (!affiliate && platform === 'shopee') {
      const sourceUrl = product.resolvedUrl && !/s\.shopee\.com\.br/.test(product.resolvedUrl) ? product.resolvedUrl : inputUrl;
      publishUrl = await this.shortLinker(settings.shopeeApi, sourceUrl);
    }

    const identity = identityKeys({ platform, publishUrl, resolvedUrl: product.resolvedUrl, productId: product.productId });
    if (!allowRepeat) {
      const duplicate = this.findDuplicate(identity);
      if (duplicate) return { duplicate, message: `Esse produto ${this.describeDuplicate(duplicate)}.` };
    }

    const now = new Date().toISOString();
    const offer = {
      id: this.nextId(),
      platform,
      origin,
      inputUrl,
      publishUrl,
      resolvedUrl: product.resolvedUrl || '',
      title: normalizeSpaces(product.title || ''),
      price: validPrice(product.price) ? Number(product.price) : null,
      oldPrice: validPrice(product.oldPrice) && Number(product.oldPrice) > Number(product.price) ? Number(product.oldPrice) : null,
      oldPriceNote: product.oldPriceNote || '',
      imageUrl: product.imageUrl || '',
      productId: product.productId || '',
      identity,
      status: 'aguardando',
      awaitingZap: Boolean(awaitingZap),
      notes: Array.isArray(product.notes) ? product.notes.slice(0, 5) : [],
      extra: product.extra || undefined,
      missing: [],
      error: '',
      attempts: 0,
      results: [],
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
      postedAt: null,
      queueOrder: null
    };
    offer.missing = missingFields(offer);
    this.db.update((data) => {
      data.offers.push(offer);
      this.prune(data);
    });
    log.info('ofertas', `Oferta #${offer.id} criada (${PLATFORM_NAMES[platform]}, ${origin})${offer.missing.length ? ` — falta: ${offer.missing.join(', ')}` : ''}`);
    this.emit('changed', offer);
    return { offer };
  }

  prune(data) {
    if (data.offers.length <= MAX_OFFERS) return;
    const keep = data.offers.filter((o) => ACTIVE.has(o.status));
    const old = data.offers.filter((o) => !ACTIVE.has(o.status)).slice(-(MAX_OFFERS - keep.length));
    const ids = new Set([...keep, ...old].map((o) => o.id));
    data.offers = data.offers.filter((o) => ids.has(o.id));
  }

  update(id, patch = {}) {
    const offer = this.mustGet(id);
    if (['enviando', 'postada'].includes(offer.status)) throw new UserError(`A oferta #${id} já foi (ou está sendo) postada.`);
    if ('title' in patch) {
      const title = normalizeSpaces(patch.title).slice(0, 200);
      if (!compactTitle(title)) throw new UserError('O nome não pode ficar vazio.');
      offer.title = title;
    }
    if ('price' in patch) {
      const price = parsePrice(patch.price);
      if (!validPrice(price)) throw new UserError('Preço inválido. Exemplo: 49,90');
      offer.price = price;
    }
    if ('oldPrice' in patch) {
      const raw = patch.oldPrice;
      if (raw === null || raw === '' || Number(parsePrice(raw)) === 0) {
        offer.oldPrice = null;
      } else {
        const old = parsePrice(raw);
        if (!validPrice(old)) throw new UserError('Preço "De" inválido. Exemplo: 99,90');
        offer.oldPrice = old;
      }
      offer.oldPriceNote = '';
    }
    if ('imageUrl' in patch) {
      const value = String(patch.imageUrl || '').trim();
      if (value && !/^https:\/\//i.test(value)) throw new UserError('A foto precisa ser um link que começa com https://');
      offer.imageUrl = value;
    }
    if (offer.oldPrice && offer.price && offer.oldPrice <= offer.price) offer.oldPrice = null;
    this.touch(offer);
    if (offer.status === 'fila' && offer.missing.length) {
      offer.status = 'aguardando';
      this.touch(offer);
    }
    return offer;
  }

  approve(id) {
    const offer = this.mustGet(id);
    if (offer.status === 'fila') return offer;
    if (!['aguardando', 'falhou', 'descartada'].includes(offer.status)) throw new UserError(`A oferta #${id} não pode ser aprovada agora.`);
    const missing = missingFields(offer);
    if (missing.length) throw new UserError(`Oferta #${id}: falta ${missing.join(', ')}.`);
    const order = Math.max(0, ...this.list.filter((o) => o.status === 'fila').map((o) => Number(o.queueOrder) || 0)) + 1;
    Object.assign(offer, { status: 'fila', approvedAt: new Date().toISOString(), queueOrder: order, awaitingZap: false, error: '', attempts: 0 });
    log.info('ofertas', `Oferta #${id} aprovada e colocada na fila.`);
    return this.touch(offer);
  }

  reject(id) {
    const offer = this.mustGet(id);
    if (['enviando', 'postada'].includes(offer.status)) throw new UserError(`A oferta #${id} já foi (ou está sendo) postada.`);
    Object.assign(offer, { status: 'descartada', awaitingZap: false, queueOrder: null });
    log.info('ofertas', `Oferta #${id} descartada.`);
    return this.touch(offer);
  }

  unqueue(id) {
    const offer = this.mustGet(id);
    if (offer.status !== 'fila') throw new UserError(`A oferta #${id} não está na fila.`);
    Object.assign(offer, { status: 'aguardando', queueOrder: null });
    return this.touch(offer);
  }

  move(id, direction) {
    const queue = this.queued();
    const index = queue.findIndex((o) => o.id === String(id));
    if (index < 0) throw new UserError(`A oferta #${id} não está na fila.`);
    const target = direction === 'up' ? index - 1 : direction === 'top' ? 0 : index + 1;
    if (target < 0 || target >= queue.length || target === index) return queue[index];
    const [item] = queue.splice(index, 1);
    queue.splice(target, 0, item);
    queue.forEach((offer, i) => { offer.queueOrder = i + 1; });
    this.db.update(() => {});
    for (const offer of queue) this.emit('changed', offer);
    return item;
  }

  async reread(id) {
    const offer = this.mustGet(id);
    if (['enviando', 'postada'].includes(offer.status)) throw new UserError(`A oferta #${id} já foi postada.`);
    const product = await this.reader(offer.platform, offer.inputUrl, this.settings.get());
    if (product.title) offer.title = normalizeSpaces(product.title);
    if (validPrice(product.price)) offer.price = Number(product.price);
    offer.oldPrice = validPrice(product.oldPrice) && product.oldPrice > offer.price ? Number(product.oldPrice) : offer.oldPrice;
    if (product.imageUrl) offer.imageUrl = product.imageUrl;
    offer.notes = product.notes || [];
    return this.touch(offer);
  }

  queued() {
    return this.list.filter((o) => o.status === 'fila').sort((a, b) => (a.queueOrder || 0) - (b.queueOrder || 0));
  }

  pending() {
    return this.list.filter((o) => o.status === 'aguardando').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  awaitingZap() {
    return this.pending().filter((o) => o.awaitingZap);
  }

  setStatus(offer, status, extra = {}) {
    Object.assign(offer, extra, { status });
    return this.touch(offer);
  }

  postedToday(now = new Date()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return this.list.filter((o) => o.status === 'postada' && o.postedAt && Date.parse(o.postedAt) >= start.getTime());
  }
}
