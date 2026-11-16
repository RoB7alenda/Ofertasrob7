// Luna Ofertas no zap (entende comandos simples; a IA fica com o agente RoB7).
// Só responde no grupo de comando escolhido no painel. Nos grupos de ofertas ela só posta.
//
// Comandos:
//   (mandar 1 ou vários links)  -> monta as ofertas e mostra pra você aprovar
//   sim / sim 12 13             -> aprova (vai pra fila)
//   não / não 12                -> descarta
//   preço 12 49,90              -> corrige o preço   (sem número = a última oferta)
//   de 12 99,90 | de 12 0       -> corrige/tira o preço "De"
//   nome 12 Fone Bluetooth      -> corrige o nome
//   cupom 12 FONE10 | cupom 12 0 -> põe/tira o cupom
//   categoria 12 moda           -> muda a oferta de categoria (vai pra fila/grupo dela)
//   ver 12                      -> mostra a prévia com foto
//   buscar | buscar moda        -> o RoB7 procura ofertas agora
//   fila | pendentes | status | pausar | voltar | agora | agora 12 | tirar 12 | repetir 12 | ajuda

import { extractUrls } from './links.js';
import { buildCaption, captionOptions } from './message.js';
import { folded, hhmm, money } from './text.js';
import { log } from './log.js';
import { categoryName, findCategoryByName, listCategories } from './categories.js';

const YES = /^(?:s|sim+|ss+|si+m*|pode|ok|blz|beleza|manda|bora|aprova(?:r|do)?|posta(?:r)?)\b/;
const NO = /^(?:n|nao+|não+|nn+|descarta(?:r)?|cancela(?:r)?)\b/;

function ids(text) {
  return [...String(text).matchAll(/#?\b(\d{1,6})\b/g)].map((m) => m[1]);
}

export const HELP = [
  '🤖 *Luna Ofertas — comandos*',
  '',
  '🔗 Manda o link (ou vários) que eu monto a oferta',
  '✅ *sim* — aprova (vai pra fila) • *sim 12* — só a #12',
  '🗑️ *não* — descarta • *não 12*',
  '💲 *preço 12 49,90* — corrige o preço',
  '❌ *de 12 99,90* — corrige o "De" (*de 12 0* tira)',
  '✏️ *nome 12 Fone Bluetooth* — corrige o nome',
  '🎟️ *cupom 12 FONE10* — põe cupom (*cupom 12 0* tira)',
  '🏷️ *categoria 12 moda* — muda a categoria',
  '👀 *ver 12* — mostra a oferta com foto',
  '🤖 *buscar* — o RoB7 procura ofertas agora (*buscar moda* só uma)',
  '📋 *fila* • *pendentes* • *status*',
  '⏸️ *pausar* • ▶️ *voltar*',
  '🚀 *agora* — posta a próxima já • *agora 12*',
  '↩️ *tirar 12* — tira da fila • *repetir 12* — posta de novo um produto já postado'
].join('\n');

export class LunaCommands {
  constructor({ offers, queue, whatsapp, settings, loadImage, agent = null }) {
    this.agent = agent;
    this.offers = offers;
    this.queue = queue;
    this.whatsapp = whatsapp;
    this.settings = settings;
    this.loadImage = loadImage;
    this.busy = Promise.resolve();
  }

  controlJid() {
    return this.settings.get().groups.control || '';
  }

  attach() {
    this.whatsapp.on('message', (msg) => {
      if (!msg.isGroup || msg.jid !== this.controlJid()) return;
      // Um comando por vez, na ordem que chegou.
      this.busy = this.busy.then(() => this.handle(msg.text)).catch((error) => {
        log.error('luna', 'Erro ao responder comando', error);
        return this.reply(`❌ Deu erro: ${error.message}`).catch(() => {});
      });
    });
  }

  async reply(text) {
    const jid = this.controlJid();
    if (!jid || !this.whatsapp.isConnected()) return;
    await this.whatsapp.sendText(jid, text);
  }

  async preview(offer, intro = '') {
    const jid = this.controlJid();
    if (!jid) return;
    let caption;
    try {
      caption = buildCaption(offer, captionOptions(this.settings.get()));
    } catch {
      caption = `🛍️ ${offer.title || '(sem nome)'}\n🔥 Por: ${offer.price ? money(offer.price) : '?'}\n🛒 ${offer.publishUrl}`;
    }
    const tail = offer.missing?.length
      ? `\n\n⚠️ *Oferta #${offer.id}*: falta ${offer.missing.join(', ')}.${offer.missing.includes('preço') ? ` Manda: *preço ${offer.id} 49,90*` : ''}`
      : `\n\n✅ *Oferta #${offer.id}* (${categoryName(this.settings.get(), offer.category)}) pronta. Responde *sim* pra pôr na fila ou *não* pra descartar.`;
    const text = `${intro ? `${intro}\n\n` : ''}${caption}${tail}`;
    if (offer.imageUrl) {
      try {
        const image = await this.loadImage(offer.imageUrl);
        await this.whatsapp.sendImage(jid, image, text);
        return;
      } catch (error) {
        log.warn('luna', `Prévia #${offer.id} sem foto: ${error.message}`);
      }
    }
    await this.whatsapp.sendText(jid, text);
  }

  // Quando o comando não diz o número: usa as ofertas esperando resposta no zap.
  targets(text, { single = false } = {}) {
    const list = ids(text);
    if (list.length) return list;
    const waiting = this.offers.awaitingZap();
    if (!waiting.length) return [];
    if (single) return waiting.length === 1 ? [waiting[0].id] : null;
    return waiting.map((o) => o.id);
  }

  async handle(rawText) {
    const text = String(rawText || '').trim();
    const lower = folded(text);
    const urls = extractUrls(text);

    if (urls.length) return this.handleLinks(text, lower);
    if (/^(?:ajuda|comandos|menu|\?|help)$/.test(lower)) return this.reply(HELP);
    if (/^(?:fila)$/.test(lower)) return this.reply(this.queueText());
    if (/^(?:pendentes?|esperando)$/.test(lower)) return this.reply(this.pendingText());
    if (/^(?:status|como (?:ta|esta)|situacao)$/.test(lower)) return this.reply(this.statusText());
    if (/^(?:pausa|pausar|parar|para)$/.test(lower)) return this.setPaused(true);
    if (/^(?:voltar|volta|continuar|continua|retomar|despausar)$/.test(lower)) return this.setPaused(false);
    if (/^(?:agora|postar agora|posta agora)\b/.test(lower)) return this.postNow(lower);
    if (/^(?:tirar|tira|remover|remove)\b/.test(lower)) return this.unqueue(lower);
    if (/^repetir\b/.test(lower)) return this.repeat(lower);
    if (/^(?:preco|valor)\b/.test(lower)) return this.edit(lower, 'price');
    if (/^de\b/.test(lower)) return this.edit(lower, 'oldPrice');
    if (/^(?:nome|titulo)\b/.test(lower)) return this.editName(text);
    if (/^cupom\b/.test(lower)) return this.editCoupon(text);
    if (/^categoria\b/.test(lower)) return this.editCategory(lower);
    if (/^(?:ver|mostra|mostrar)\b/.test(lower)) return this.show(lower);
    if (/^(?:buscar|busca|procurar|procura|rob7)\b/.test(lower)) return this.search(lower);
    if (YES.test(lower)) return this.approve(lower);
    if (NO.test(lower)) return this.reject(lower);
    return this.reply('🤔 Não entendi. Manda *ajuda* pra ver os comandos.');
  }

  async handleLinks(text) {
    const urls = extractUrls(text);
    if (urls.length > 1) await this.reply(`⏳ Lendo ${urls.length} links...`);
    const results = await this.offers.addFromText(text, { origin: 'zap', awaitingZap: true });
    for (const result of results) {
      if (result.offer) await this.preview(result.offer);
      else if (result.duplicate) await this.reply(`⚠️ ${result.message}\nSe quiser postar de novo, manda: *repetir ${result.duplicate.id}*`);
      else await this.reply(`❌ ${result.error}`);
    }
  }

  async approve(lower) {
    const list = this.targets(lower);
    if (!list.length) return this.reply('🤔 Não tem oferta esperando resposta. Manda um link ou *pendentes*.');
    const ok = [];
    const fail = [];
    for (const id of list) {
      try {
        this.offers.approve(id);
        ok.push(`#${id}`);
      } catch (error) {
        fail.push(error.message);
      }
    }
    const status = this.queue.status();
    const lines = [];
    if (ok.length) lines.push(`✅ ${ok.join(', ')} na fila (${status.size} no total).${status.next ? ` Próxima às ${hhmm(new Date(status.next))}.` : ''}`);
    for (const message of fail) lines.push(`⚠️ ${message}`);
    return this.reply(lines.join('\n'));
  }

  async reject(lower) {
    const list = this.targets(lower);
    if (!list.length) return this.reply('🤔 Não tem oferta esperando resposta.');
    const done = [];
    for (const id of list) {
      try { this.offers.reject(id); done.push(`#${id}`); } catch (error) { await this.reply(`⚠️ ${error.message}`); }
    }
    if (done.length) return this.reply(`🗑️ Descartei ${done.join(', ')}.`);
  }

  async edit(lower, field) {
    const numbers = [...lower.matchAll(/(\d+(?:[.,]\d{1,2})?)/g)].map((m) => m[1]);
    if (!numbers.length) return this.reply(field === 'price' ? 'Manda assim: *preço 12 49,90*' : 'Manda assim: *de 12 99,90*');
    const value = numbers[numbers.length - 1];
    let id = numbers.length > 1 && /^\d+$/.test(numbers[0]) ? numbers[0] : null;
    if (!id) {
      const single = this.targets('', { single: true });
      if (!single?.length) return this.reply(`🤔 Qual oferta? Manda: *${field === 'price' ? 'preço' : 'de'} 12 ${value}*`);
      id = single[0];
    }
    const offer = this.offers.update(id, { [field]: value });
    return this.preview(offer, field === 'price' ? `💲 Preço da #${id} atualizado.` : `❌ "De" da #${id} atualizado.`);
  }

  async editName(text) {
    const m = text.match(/^\s*(?:nome|t[íi]tulo)\s+#?(\d+)?\s*(.+)$/i);
    if (!m || !m[2]) return this.reply('Manda assim: *nome 12 Fone Bluetooth*');
    let id = m[1];
    if (!id) {
      const single = this.targets('', { single: true });
      if (!single?.length) return this.reply('🤔 Qual oferta? Manda: *nome 12 Fone Bluetooth*');
      id = single[0];
    }
    const offer = this.offers.update(id, { title: m[2] });
    return this.preview(offer, `✏️ Nome da #${id} atualizado.`);
  }

  async editCoupon(text) {
    const parts = text.trim().split(/\s+/).slice(1);
    let id = null;
    let code = '';
    if (parts.length >= 2 && /^#?\d+$/.test(parts[0])) {
      id = parts[0].replace('#', '');
      code = parts[1];
    } else if (parts.length === 1 && !/^#?\d+$/.test(parts[0])) {
      code = parts[0];
    } else {
      return this.reply('Manda assim: *cupom 12 FONE10* (ou *cupom 12 0* pra tirar)');
    }
    if (!id) {
      const single = this.targets('', { single: true });
      if (!single?.length) return this.reply(`🤔 Qual oferta? Manda: *cupom 12 ${code}*`);
      id = single[0];
    }
    const offer = this.offers.update(id, { coupon: code });
    return this.preview(offer, offer.coupon ? `🎟️ Cupom da #${id}: ${offer.coupon}` : `🎟️ Tirei o cupom da #${id}.`);
  }

  async editCategory(lower) {
    const m = lower.match(/^categoria\s+#?(\d+)?\s*(.*)$/);
    const wanted = findCategoryByName(this.settings.get(), m?.[2] || '');
    const names = listCategories(this.settings.get()).map((c) => c.name.split(' ')[0].toLowerCase()).join(', ');
    if (!wanted) return this.reply(`Manda assim: *categoria 12 moda* (tem: ${names})`);
    let id = m[1];
    if (!id) {
      const single = this.targets('', { single: true });
      if (!single?.length) return this.reply(`🤔 Qual oferta? Manda: *categoria 12 ${m[2]}*`);
      id = single[0];
    }
    const offer = this.offers.update(id, { category: wanted });
    return this.reply(`🏷️ #${id} agora é de *${categoryName(this.settings.get(), offer.category)}*.`);
  }

  async show(lower) {
    const [id] = ids(lower);
    if (!id) return this.reply('Manda assim: *ver 12*');
    return this.preview(this.offers.mustGet(id));
  }

  async search(lower) {
    if (!this.agent) return this.reply('🤖 O RoB7 não está ligado.');
    const rest = lower.replace(/^(?:buscar|busca|procurar|procura|rob7)\s*/, '').trim();
    const categoryId = rest ? findCategoryByName(this.settings.get(), rest) : '';
    if (rest && !categoryId) return this.reply('🤔 Não achei essa categoria. Manda *buscar* ou *buscar veiculos*.');
    await this.reply(`🤖 RoB7 procurando ofertas${categoryId ? ` de ${categoryName(this.settings.get(), categoryId)}` : ''}... (leva uns minutos)`);
    // Não espera terminar (leva minutos): a Luna continua respondendo. O agente avisa o que achou.
    this.agent.run({ categoryId })
      .then((added) => (added.length ? null : this.reply('🤖 RoB7 não achou oferta nova que passe no filtro agora.')))
      .catch((error) => this.reply(`❌ RoB7: ${error.message}`))
      .catch(() => {});
  }

  async setPaused(paused) {
    this.settings.update((s) => { s.queue.paused = paused; });
    const status = this.queue.status();
    if (paused) return this.reply(`⏸️ Fila pausada. ${status.size} oferta(s) esperando. Manda *voltar* pra continuar.`);
    return this.reply(`▶️ Fila ligada de novo.${status.next ? ` Próxima às ${hhmm(new Date(status.next))}.` : ''}`);
  }

  async postNow(lower) {
    const [id] = ids(lower);
    await this.reply('🚀 Postando agora...');
    const offer = await this.queue.sendNow(id || null);
    if (offer.status === 'postada') {
      const ok = offer.results.filter((r) => r.ok).length;
      return this.reply(`✅ #${offer.id} postada em ${ok} grupo(s).`);
    }
    return this.reply(`❌ #${offer.id} não foi: ${offer.error || 'erro no envio'}.`);
  }

  async unqueue(lower) {
    const [id] = ids(lower);
    if (!id) return this.reply('Manda assim: *tirar 12*');
    this.offers.unqueue(id);
    return this.reply(`↩️ #${id} saiu da fila (continua em pendentes).`);
  }

  async repeat(lower) {
    const [id] = ids(lower);
    if (!id) return this.reply('Manda assim: *repetir 12*');
    const old = this.offers.mustGet(id);
    const { offer } = await this.offers.addFromUrl(old.inputUrl, { origin: 'zap', allowRepeat: true, awaitingZap: true });
    return this.preview(offer, `🔁 Montei de novo a #${id} como #${offer.id}.`);
  }

  queueText() {
    const status = this.queue.status();
    if (!status.size) return `📋 Fila vazia.${status.paused ? ' (pausada)' : ''}`;
    const times = new Map(status.plan.map((p) => [p.id, p.at]));
    const lines = [`📋 *Fila (${status.size})*${status.paused ? ' ⏸️ pausada' : ''}`];
    for (const cat of status.categories.filter((c) => c.size)) {
      lines.push('', `*${cat.name}* (${cat.size})${!cat.enabled ? ' — categoria desligada' : !cat.groups ? ' — sem grupo' : ''}`);
      for (const o of this.offers.queued(cat.id).slice(0, 8)) {
        const at = times.get(o.id);
        lines.push(`${at ? hhmm(new Date(at)) : '--:--'} • #${o.id} ${o.title.slice(0, 38)} — ${money(o.price)}`);
      }
      if (cat.size > 8) lines.push(`... e mais ${cat.size - 8}`);
    }
    return lines.join('\n');
  }

  pendingText() {
    const list = this.offers.pending();
    if (!list.length) return '✅ Nada esperando aprovação.';
    const settings = this.settings.get();
    const lines = list.slice(0, 15).map((o) => `#${o.id} [${categoryName(settings, o.category)}] ${o.title ? o.title.slice(0, 36) : '(sem nome)'}${o.missing.length ? ` ⚠️ falta ${o.missing.join(', ')}` : ''}`);
    return [`⏳ *Esperando aprovação (${list.length})*`, ...lines, list.length > 15 ? `... e mais ${list.length - 15}` : '', '', 'Responde *sim 12* pra aprovar ou *ver 12* pra ver a foto.'].filter((l, i, a) => l || a[i - 1]).join('\n');
  }

  statusText() {
    const status = this.queue.status();
    const today = this.offers.postedToday().length;
    const lines = [
      '📊 *Status*',
      `📤 Postadas hoje: ${today}`,
      `📋 Na fila: ${status.size}${status.paused ? ' (⏸️ pausada)' : ''}`,
      `⏳ Esperando aprovação: ${this.offers.pending().length}`
    ];
    const settings = this.settings.get();
    for (const cat of status.categories.filter((c) => c.enabled)) {
      const c = listCategories(settings).find((x) => x.id === cat.id);
      lines.push(`• *${cat.name}*: ${cat.groups ? `${c.start}–${c.end}, a cada ${c.intervalMin} min` : 'sem grupo'}${cat.next ? `, próxima ${hhmm(new Date(cat.next))}` : ''}`);
    }
    if (this.agent) {
      const a = this.agent.status();
      lines.push(`🤖 RoB7: ${a.enabled ? (a.autopilot ? 'piloto automático' : 'modo treino') : 'desligado'}${a.running ? ' (procurando agora)' : a.nextRunAt && a.enabled ? `, próxima busca ${hhmm(new Date(a.nextRunAt))}` : ''}`);
      if (a.ai?.hasKey) lines.push(`🧠 IA hoje: US$ ${a.ai.usedUsd.toFixed(2).replace('.', ',')} de ${a.ai.limitUsd.toFixed(2).replace('.', ',')}`);
    }
    return lines.join('\n');
  }

  // Avisos que a fila manda no grupo de comando (só falhas, pra não encher o grupo).
  attachQueueNotices() {
    this.queue.on('failed', (offer) => {
      this.reply(`❌ A oferta #${offer.id} não foi postada: ${offer.error}\nNo painel dá pra corrigir e tentar de novo.`).catch(() => {});
    });
  }
}
