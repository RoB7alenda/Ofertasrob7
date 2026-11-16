// Agente RoB7: de tempos em tempos procura ofertas pra cada categoria ligada,
// filtra pelas regras (desconto, nota, vendas, frete), deixa a IA escolher as melhores,
// gera o link de afiliado da sua conta e coloca no painel.
//   Modo treino (padrão): tudo espera você aprovar (no painel ou no zap).
//   Piloto automático: o que estiver completo vai direto pra fila da categoria.

import { EventEmitter } from 'node:events';
import { GENERAL_ID, getCategory, listCategories } from '../categories.js';
import { parseHM } from '../queue.js';
import { hasShopeeApi } from '../products/shopee-api.js';
import { makeMeliLinks, searchMercadoLivre } from './mercadolivre.js';
import { searchShopee } from './shopee.js';
import { discountOf, shortlist } from './rules.js';
import { money } from '../text.js';
import { log } from '../log.js';

const KEYWORDS_PER_RUN = 3;
const SHORTLIST_FOR_AI = 15;
const MINUTE = 60_000;

export class AgentService extends EventEmitter {
  constructor({ settings, db, offers, ai = null, notify = null, searchMl = searchMercadoLivre, searchSp = searchShopee, makeLinks = makeMeliLinks }) {
    super();
    this.settings = settings;
    this.db = db;
    this.offers = offers;
    this.ai = ai;
    this.notify = notify;
    this.searchMl = searchMl;
    this.searchSp = searchSp;
    this.makeLinks = makeLinks;
    this.running = '';
    this.timer = null;
    this.db.update((data) => {
      data.agentState = data.agentState || {};
      data.agentState.byCategory = data.agentState.byCategory || {};
      delete data.radarState; // o radar antigo virou o agente
    });
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), MINUTE);
  }

  stop() {
    clearInterval(this.timer);
  }

  state() {
    return this.db.get().agentState || { byCategory: {} };
  }

  catState(id) {
    return this.state().byCategory?.[id] || {};
  }

  setCatState(id, patch) {
    this.db.update((data) => {
      data.agentState.byCategory[id] = { ...data.agentState.byCategory[id], ...patch };
    });
  }

  // Categorias que o agente pode trabalhar: ligadas, com palavras de busca (a "Geral" não tem).
  workable() {
    return listCategories(this.settings.get()).filter((c) => c.id !== GENERAL_ID && c.enabled && c.keywords?.length);
  }

  // Busca de 1h antes de abrir até 30 min antes de fechar a fila da categoria.
  inWindow(category, now) {
    if (!category.days.includes(now.getDay())) return false;
    const minutes = now.getHours() * 60 + now.getMinutes();
    return minutes >= parseHM(category.start) - 60 && minutes < parseHM(category.end) - 30;
  }

  status() {
    const cfg = this.settings.get().agent;
    const st = this.state();
    const last = Date.parse(st.lastRunAt || 0) || 0;
    return {
      enabled: Boolean(cfg.enabled),
      autopilot: Boolean(cfg.autopilot),
      everyMin: cfg.everyMin,
      running: this.running,
      lastRunAt: st.lastRunAt || null,
      lastResult: st.lastResult || '',
      nextRunAt: cfg.enabled ? new Date(Math.max(Date.now(), last + cfg.everyMin * MINUTE)).toISOString() : null,
      ai: this.ai ? this.ai.status() : null,
      categories: listCategories(this.settings.get()).filter((c) => c.id !== GENERAL_ID).map((c) => {
        const s = this.catState(c.id);
        return { id: c.id, name: c.name, enabled: c.enabled, keywords: c.keywords.length, groups: c.groups.length, lastRunAt: s.lastRunAt || null, lastResult: s.lastResult || '', lastError: s.lastError || '' };
      })
    };
  }

  async tick(now = new Date()) {
    const cfg = this.settings.get().agent;
    if (!cfg.enabled || this.running) return;
    const last = Date.parse(this.state().lastRunAt || 0) || 0;
    if (now.getTime() - last < Math.max(30, Number(cfg.everyMin) || 120) * MINUTE) return;
    const list = this.workable().filter((c) => this.inWindow(c, now));
    if (!list.length) return;
    await this.run({ categories: list }).catch(() => {});
  }

  // manual: roda agora (uma categoria ou todas as ligadas), sem olhar horário.
  async run({ categoryId = '', categories = null } = {}) {
    if (this.running) throw new Error('O RoB7 já está procurando, espera terminar.');
    let list = categories || this.workable();
    if (categoryId) {
      const category = getCategory(this.settings.get(), categoryId);
      if (!category || category.id !== categoryId || category.id === GENERAL_ID) throw new Error('Categoria inválida.');
      if (!category.keywords?.length) throw new Error(`A categoria ${category.name} não tem palavras de busca.`);
      list = [category];
    }
    if (!list.length) throw new Error('Nenhuma categoria ligada com palavras de busca.');
    const startedAt = new Date().toISOString();
    this.running = categoryId || 'todas';
    this.db.update((data) => { data.agentState.lastRunAt = startedAt; });
    this.emit('status');
    const added = [];
    const errors = [];
    try {
      log.info('rob7', `RoB7 começou a procurar (${list.map((c) => c.name).join(', ')}).`);
      for (const category of list) {
        try {
          added.push(...await this.runCategory(category));
        } catch (error) {
          errors.push(`${category.name}: ${error.message}`);
          this.setCatState(category.id, { lastRunAt: startedAt, lastError: error.message });
          log.error('rob7', `RoB7 falhou em ${category.name}`, error);
          if (/logado/.test(error.message)) break; // as outras vão falhar igual
        }
      }
      const result = `${added.length} oferta(s) nova(s)${errors.length ? ` • ${errors.length} erro(s)` : ''}`;
      this.db.update((data) => { data.agentState.lastResult = result; });
      log.info('rob7', `RoB7 terminou: ${result}.`);
      await this.announce(added, errors);
      return added;
    } finally {
      this.running = '';
      this.emit('status');
    }
  }

  nextKeywords(category) {
    const words = category.keywords;
    const start = (Number(this.catState(category.id).keywordIndex) || 0) % words.length;
    const take = Math.min(KEYWORDS_PER_RUN, words.length);
    const chosen = Array.from({ length: take }, (_, i) => words[(start + i) % words.length]);
    this.setCatState(category.id, { keywordIndex: (start + take) % words.length });
    return chosen;
  }

  async runCategory(category) {
    const settings = this.settings.get();
    const cfg = settings.agent;
    const now = new Date().toISOString();
    // Não deixa acumular: no treino conta o que espera aprovação; no piloto, também o que já está na fila.
    const pending = this.offers.pending(category.id).length + (cfg.autopilot ? this.offers.queued(category.id).length : 0);
    if (pending >= cfg.maxPending) {
      this.setCatState(category.id, { lastRunAt: now, lastResult: `parado: já tem ${pending} ${cfg.autopilot ? 'esperando ou na fila' : 'esperando aprovação'}`, lastError: '' });
      return [];
    }
    const room = Math.max(1, Math.min(cfg.perRun, cfg.maxPending - pending));
    const keywords = this.nextKeywords(category);

    const candidates = [];
    if (settings.platforms.mercadolivre) candidates.push(...await this.searchMl(keywords));
    if (settings.platforms.shopee && hasShopeeApi(settings)) candidates.push(...await this.searchSp(settings.shopeeApi, keywords));
    if (!candidates.length) {
      log.warn('rob7', `${category.name}: nada na busca por ${keywords.join(', ')}.`);
      throw new Error('a busca não trouxe nenhum produto (o site pode ter mudado; veja a pasta diagnostico).');
    }

    const { kept } = shortlist(candidates, category, this.offers.allIdentityKeys());
    const short = kept.slice(0, SHORTLIST_FOR_AI);
    let picks = short.slice(0, room).map((c) => ({ ...c, reason: '' }));
    let byAi = false;
    if (short.length && this.ai?.available()) {
      try {
        picks = (await this.ai.pick(category, short, room)).map((p) => ({ ...short[p.index], reason: p.reason }));
        byAi = true;
      } catch (error) {
        log.warn('rob7', `IA não escolheu (${error.message}). Usando só as regras.`);
      }
    }

    const mlUrls = picks.filter((p) => p.platform === 'mercadolivre').map((p) => p.url);
    const links = mlUrls.length ? await this.makeLinks(mlUrls) : new Map();
    const added = [];
    for (const p of picks) {
      const link = p.platform === 'shopee' ? p.offerLink : links.get(p.url);
      if (!link) continue;
      try {
        const result = await this.offers.addFromUrl(link, {
          origin: 'rob7',
          category: category.id,
          awaitingZap: Boolean(cfg.notifyZap) && !cfg.autopilot,
          autoApprove: Boolean(cfg.autopilot),
          preset: {
            resolvedUrl: p.url,
            title: p.title,
            price: p.price,
            oldPrice: p.oldPrice || null,
            oldPriceNote: p.oldPriceNote || '',
            imageUrl: p.imageUrl,
            productId: p.productId,
            notes: [describe(p), p.reason ? `IA: ${p.reason}` : ''].filter(Boolean)
          }
        });
        if (result.offer) added.push(result.offer);
      } catch (error) {
        log.warn('rob7', `Não salvei "${p.title.slice(0, 40)}" (${error.message}).`);
      }
    }
    const summary = `${candidates.length} achados, ${kept.length} no filtro, ${picks.length} escolhido(s)${byAi ? ' pela IA' : ''}, ${added.length} novo(s)`;
    this.setCatState(category.id, { lastRunAt: now, lastResult: summary, lastError: picks.length && !added.length && mlUrls.length ? 'não consegui gerar o link de afiliado (veja o Registro)' : '' });
    log.info('rob7', `${category.name}: ${summary}.`);
    return added;
  }

  async announce(added, errors) {
    const cfg = this.settings.get().agent;
    if (!this.notify || !cfg.notifyZap) return;
    const lines = [];
    if (added.length) {
      lines.push(cfg.autopilot ? `🤖 *RoB7* pôs ${added.length} oferta(s) na fila:` : `🤖 *RoB7* achou ${added.length} oferta(s) pra você aprovar:`);
      const settings = this.settings.get();
      for (const id of [...new Set(added.map((o) => o.category))]) {
        lines.push('', `*${getCategory(settings, id).name}*`);
        for (const o of added.filter((x) => x.category === id)) {
          const off = discountOf(o.price, o.oldPrice);
          lines.push(`#${o.id} ${o.title.slice(0, 45)} — ${o.price ? money(o.price) : '?'}${off ? ` (${off}% OFF)` : ''}${o.status === 'fila' ? ' ✅' : ''}`);
        }
      }
      if (!cfg.autopilot) lines.push('', 'Responde *sim* pra aprovar todas, *sim 12* pra uma, *não 12* pra descartar ou *ver 12* pra ver a foto.');
    }
    // Erro: avisa no máximo 1 vez por dia o mesmo erro.
    const today = new Date().toDateString();
    const fresh = errors.filter((e) => this.state().lastErrorNotice !== `${today}|${e}`);
    if (fresh.length) {
      if (lines.length) lines.push('');
      lines.push('⚠️ *RoB7* teve problema:', ...fresh.map((e) => `• ${e}`));
      this.db.update((data) => { data.agentState.lastErrorNotice = `${today}|${fresh[0]}`; });
    }
    if (lines.length) await this.notify(lines.join('\n').trim()).catch(() => {});
  }
}

function describe(p) {
  return [
    `RoB7 (${p.platform === 'shopee' ? 'Shopee' : 'Mercado Livre'}): ${p.discount}% off`,
    p.rating ? `nota ${p.rating.toFixed(1)}` : '',
    p.reviews ? `${p.reviews} avaliações` : '',
    p.sales ? `${p.sales} vendidos` : '',
    p.full ? 'Full' : p.freeShipping ? 'frete grátis' : '',
    p.keyword ? `busca "${p.keyword}"` : ''
  ].filter(Boolean).join(', ');
}
