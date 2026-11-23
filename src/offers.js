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
import { cleanCoupon, missingFields, validCoupon } from './message.js';
import { compactTitle, ddmm, normalizeSpaces, parsePrice, stripPriceSuffix, validPrice } from './text.js';
import { log } from './log.js';
import { classifyByKeywords, classifySubcategory, GENERAL_ID, getCategory, listCategories, subcategoriesOf, validSubcategory } from './categories.js';
import { interleave, sameOrder } from './queue-order.js';

const ACTIVE = new Set(['aguardando', 'fila', 'enviando', 'falhou']);
const MAX_OFFERS = 3000;

// Como a fila aparece no "antes e depois" do botão Intercalar.
const queueLine = (offer) => ({ id: offer.id, title: offer.title, subcategory: offer.subcategory || '', queueOrder: offer.queueOrder });

export class UserError extends Error {}

export class OfferService extends EventEmitter {
  constructor({ db, settings, reader = readProduct, shortLinker = shopeeShortLink, classifier = null }) {
    super();
    // classifier(title) -> id da categoria (a IA entra aqui; sem IA, usa as palavras de busca)
    this.classifier = classifier;
    this.db = db;
    this.settings = settings;
    this.reader = reader;
    this.shortLinker = shortLinker;
    this.reading = new Set();
    // Ofertas de antes das categorias ficam na "Geral" (onde estão os grupos antigos).
    if (this.list.some((o) => !o.category)) {
      this.db.update((data) => { for (const o of data.offers) if (!o.category) o.category = GENERAL_ID; });
    }
    this.fillSubcategories();
  }

  // Ofertas de antes das subcategorias: descobre a subcategoria pelo nome do produto, uma vez só.
  // Só preenche, não muda a ordem de nada.
  fillSubcategories() {
    const settings = this.settings.get();
    const missing = this.list.filter((o) => o.subcategory === undefined);
    if (!missing.length) return 0;
    const toClassify = missing.filter((o) => o.title && subcategoriesOf(settings, this.categoryOf(o)).length);
    if (toClassify.length) {
      try {
        this.db.backup('antes-da-subcategoria');
      } catch (error) {
        log.warn('ofertas', `Não consegui fazer a cópia de segurança do banco (${error.message}). Sigo só preenchendo a subcategoria.`);
      }
    }
    let count = 0;
    this.db.update((data) => {
      for (const offer of data.offers) {
        if (offer.subcategory !== undefined) continue;
        offer.subcategory = offer.title ? classifySubcategory(settings, this.categoryOf(offer), offer.title) : '';
        if (offer.subcategory) count++;
      }
    });
    if (count) log.info('ofertas', `Subcategoria preenchida em ${count} oferta(s) pelo nome do produto.`);
    return count;
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

  validCategory(id) {
    return listCategories(this.settings.get()).some((c) => c.id === id) ? id : '';
  }

  // Categoria automática: só vale categoria ligada; se não, vai pra "Geral" (que tem grupo).
  async chooseCategory(title) {
    const settings = this.settings.get();
    let id = '';
    if (this.classifier) {
      try {
        id = this.validCategory(await this.classifier(title));
      } catch (error) {
        log.warn('ofertas', `Não consegui classificar com a IA (${error.message}). Usando as palavras.`);
      }
    }
    if (!id) id = classifyByKeywords(settings, title);
    return getCategory(settings, id).enabled ? id : GENERAL_ID;
  }

  async addFromUrl(inputUrl, { origin = 'painel', allowRepeat = false, awaitingZap = false, preset = null, category = 'auto', autoApprove = false } = {}) {
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

    const chosenCategory = this.validCategory(category) || (product.title ? await this.chooseCategory(product.title) : GENERAL_ID);
    const title = stripPriceSuffix(product.title);
    const now = new Date().toISOString();
    const offer = {
      id: this.nextId(),
      category: chosenCategory,
      platform,
      origin,
      inputUrl,
      publishUrl,
      resolvedUrl: product.resolvedUrl || '',
      title,
      subcategory: classifySubcategory(settings, chosenCategory, title),
      price: validPrice(product.price) ? Number(product.price) : null,
      oldPrice: validPrice(product.oldPrice) && Number(product.oldPrice) > Number(product.price) ? Number(product.oldPrice) : null,
      oldPriceNote: product.oldPriceNote || '',
      coupon: '',
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
    log.info('ofertas', `Oferta #${offer.id} criada (${PLATFORM_NAMES[platform]}, ${getCategory(this.settings.get(), offer.category).name}, ${origin})${offer.missing.length ? ` — falta: ${offer.missing.join(', ')}` : ''}`);
    this.emit('changed', offer);
    if (autoApprove && !offer.missing.length) return { offer: this.approve(offer.id) };
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
    // 1º confere tudo; só depois muda (se um campo estiver errado, nada é alterado).
    const next = {};
    if ('title' in patch) {
      const title = normalizeSpaces(patch.title).slice(0, 200);
      if (!compactTitle(title)) throw new UserError('O nome não pode ficar vazio.');
      next.title = title;
    }
    if ('price' in patch) {
      const price = parsePrice(patch.price);
      if (!validPrice(price)) throw new UserError('Preço inválido. Exemplo: 49,90');
      next.price = price;
    }
    if ('oldPrice' in patch) {
      const raw = patch.oldPrice;
      if (raw === null || raw === '' || Number(parsePrice(raw)) === 0) {
        next.oldPrice = null;
      } else {
        const old = parsePrice(raw);
        if (!validPrice(old)) throw new UserError('Preço "De" inválido. Exemplo: 99,90');
        next.oldPrice = old;
      }
      next.oldPriceNote = '';
    }
    if ('imageUrl' in patch) {
      const value = String(patch.imageUrl || '').trim();
      if (value && !/^https:\/\//i.test(value)) throw new UserError('A foto precisa ser um link que começa com https://');
      next.imageUrl = value;
    }
    if ('category' in patch) {
      const id = this.validCategory(String(patch.category || ''));
      if (!id) throw new UserError('Categoria inválida.');
      next.category = id;
    }
    if ('coupon' in patch) {
      const coupon = ['0', '-'].includes(String(patch.coupon ?? '').trim()) ? '' : cleanCoupon(patch.coupon);
      if (!validCoupon(coupon)) throw new UserError('Cupom inválido. Use só letras e números, ex.: FONE10');
      next.coupon = coupon;
    }
    if ('subcategory' in patch) {
      const wanted = String(patch.subcategory || '').trim();
      const target = next.category || this.categoryOf(offer);
      if (wanted && !validSubcategory(this.settings.get(), target, wanted)) throw new UserError('Subcategoria inválida.');
      next.subcategory = wanted;
    }
    const movedCategory = Boolean(next.category) && next.category !== this.categoryOf(offer);
    Object.assign(offer, next);
    if (movedCategory && offer.status === 'fila') offer.queueOrder = this.nextOrder(offer.category, offer.id);
    // Subcategoria em branco (automática), nome novo ou categoria nova: descobre pelo nome do produto.
    const autoSub = 'subcategory' in patch ? !next.subcategory : ('title' in next || movedCategory);
    if (autoSub) offer.subcategory = classifySubcategory(this.settings.get(), this.categoryOf(offer), offer.title);
    if (offer.oldPrice && offer.price && offer.oldPrice <= offer.price) offer.oldPrice = null;
    this.touch(offer);
    if (offer.status === 'fila' && offer.missing.length) {
      offer.status = 'aguardando';
      this.touch(offer);
    }
    if (offer.status === 'fila') this.rebalance(this.categoryOf(offer));
    return offer;
  }

  approve(id) {
    const offer = this.mustGet(id);
    if (offer.status === 'fila') return offer;
    if (!['aguardando', 'falhou', 'descartada'].includes(offer.status)) throw new UserError(`A oferta #${id} não pode ser aprovada agora.`);
    const missing = missingFields(offer);
    if (missing.length) throw new UserError(`Oferta #${id}: falta ${missing.join(', ')}.`);
    const order = this.nextOrder(this.categoryOf(offer), offer.id);
    Object.assign(offer, { status: 'fila', approvedAt: new Date().toISOString(), queueOrder: order, awaitingZap: false, error: '', attempts: 0 });
    log.info('ofertas', `Oferta #${id} aprovada e colocada na fila.`);
    this.touch(offer);
    // Lote da mesma subcategoria não fica em bloco: a fila entra em rodízio.
    this.rebalance(this.categoryOf(offer));
    return offer;
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

  categoryOf(offer) {
    return this.validCategory(offer.category) || GENERAL_ID;
  }

  nextOrder(categoryId, exceptId = '') {
    return Math.max(0, ...this.queued(categoryId).filter((o) => o.id !== exceptId).map((o) => Number(o.queueOrder) || 0)) + 1;
  }

  // Deixa a fila da categoria intercalada entre as subcategorias (rodízio), mantendo a ordem
  // de chegada dentro de cada uma. keepFirst = 1: não mexe na próxima a postar.
  // Categoria sem subcategoria (ou fila pequena): não muda nada.
  rebalance(categoryId, { keepFirst = 1 } = {}) {
    const subs = subcategoriesOf(this.settings.get(), categoryId);
    const queue = this.queued(categoryId);
    if (subs.length < 2 || queue.length < 3) return queue;
    const sorted = interleave(queue, (offer) => offer.subcategory, { order: subs.map((s) => s.id), keepFirst });
    if (sameOrder(sorted, queue)) return queue;
    sorted.forEach((offer, index) => { offer.queueOrder = index + 1; });
    this.db.update(() => {});
    for (const offer of sorted) this.emit('changed', offer);
    return sorted;
  }

  // Botão "Intercalar fila" do painel: faz a cópia de segurança e reordena os pendentes
  // (status "fila") daquela categoria. Devolve a lista de antes e a de depois.
  interleaveQueue(categoryId) {
    const settings = this.settings.get();
    const category = getCategory(settings, categoryId);
    if (!subcategoriesOf(settings, category.id).length) {
      throw new UserError(`A categoria ${category.name} não tem subcategorias. Crie em Configurações › Categorias.`);
    }
    const before = this.queued(category.id).map(queueLine);
    if (!before.length) throw new UserError(`A fila de ${category.name} está vazia.`);
    let backup = '';
    try {
      backup = this.db.backup(`intercalar-${category.id}`);
    } catch (error) {
      throw new UserError(`Não consegui fazer a cópia de segurança do banco (${error.message}). Não mexi na fila.`);
    }
    // Quem está sem subcategoria, ou com uma que não existe mais, é classificado pelo nome.
    const ids = new Set(subcategoriesOf(settings, category.id).map((sub) => sub.id));
    let fixed = 0;
    for (const offer of this.queued(category.id)) {
      if (ids.has(offer.subcategory)) continue;
      offer.subcategory = classifySubcategory(settings, category.id, offer.title);
      fixed++;
    }
    if (fixed) this.db.update(() => {});
    const after = this.rebalance(category.id, { keepFirst: 0 }).map(queueLine);
    log.info('ofertas', `Fila de ${category.name} intercalada (${after.length} ofertas). Cópia de segurança: ${backup}`);
    return { category: category.id, name: category.name, backup, before, after };
  }

  move(id, direction) {
    const queue = this.queued(this.categoryOf(this.mustGet(id)));
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
    if (product.title) offer.title = stripPriceSuffix(product.title);
    if (validPrice(product.price)) offer.price = Number(product.price);
    offer.oldPrice = validPrice(product.oldPrice) && product.oldPrice > offer.price ? Number(product.oldPrice) : offer.oldPrice;
    if (product.imageUrl) offer.imageUrl = product.imageUrl;
    offer.notes = product.notes || [];
    return this.touch(offer);
  }

  // Fila de uma categoria (ou de todas, se não disser qual).
  queued(categoryId = '') {
    return this.list
      .filter((o) => o.status === 'fila' && (!categoryId || this.categoryOf(o) === categoryId))
      .sort((a, b) => (a.queueOrder || 0) - (b.queueOrder || 0) || String(a.approvedAt).localeCompare(String(b.approvedAt)));
  }

  pending(categoryId = '') {
    return this.list
      .filter((o) => o.status === 'aguardando' && (!categoryId || this.categoryOf(o) === categoryId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
