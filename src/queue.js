// A fila: solta 1 oferta a cada X minutos, só dentro do horário e dos dias escolhidos,
// em todos os grupos marcados como "postar aqui".

import { EventEmitter } from 'node:events';
import { buildCaption } from './message.js';
import { hhmm } from './text.js';
import { log } from './log.js';

const MINUTE = 60_000;
const MAX_ATTEMPTS = 3;

export function parseHM(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

export function validQueueSettings(q) {
  const start = parseHM(q.start);
  const end = parseHM(q.end);
  const interval = Number(q.intervalMin);
  const days = Array.isArray(q.days) ? q.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Horário inválido. Use o formato 08:00.';
  if (end <= start) return 'O horário final tem que ser depois do inicial.';
  if (!Number.isFinite(interval) || interval < 5 || interval > 720) return 'O intervalo tem que ser entre 5 e 720 minutos.';
  if (!days.length) return 'Escolha pelo menos um dia da semana.';
  return '';
}

function atMinutes(day, minutes) {
  const d = new Date(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

// Próximo horário em que pode postar, a partir de "agora" e da última postagem.
export function nextSlot(now, lastPostAt, q) {
  const start = parseHM(q.start);
  const end = parseHM(q.end);
  const interval = Number(q.intervalMin) * MINUTE;
  const days = new Set(q.days);
  let candidate = new Date(Math.max(now.getTime(), lastPostAt ? new Date(lastPostAt).getTime() + interval : 0));
  for (let i = 0; i < 9; i++) {
    const day = new Date(candidate);
    day.setHours(0, 0, 0, 0);
    if (i > 0) day.setDate(day.getDate() + i);
    if (!days.has(day.getDay())) continue;
    const windowStart = atMinutes(day, start);
    const windowEnd = atMinutes(day, end);
    if (i === 0) {
      if (candidate < windowStart) return windowStart;
      if (candidate < windowEnd) return candidate;
      continue;
    }
    return windowStart;
  }
  return null;
}

// Previsão de horário pra cada oferta da fila.
export function forecast(queue, now, lastPostAt, q) {
  const out = [];
  let last = lastPostAt;
  let from = now;
  for (const offer of queue) {
    const slot = nextSlot(from, last, q);
    if (!slot) break;
    out.push({ id: offer.id, at: slot.toISOString() });
    last = slot;
    from = slot;
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class QueueRunner extends EventEmitter {
  constructor({ offers, settings, db, whatsapp, loadImage, delayBetweenGroupsMs = 2500 }) {
    super();
    this.offers = offers;
    this.settings = settings;
    this.db = db;
    this.whatsapp = whatsapp;
    this.loadImage = loadImage;
    this.delayBetweenGroupsMs = delayBetweenGroupsMs;
    this.busy = false;
    this.timer = null;
  }

  get lastPostAt() {
    return this.db.get().queueState?.lastPostAt || null;
  }

  recoverInterrupted() {
    for (const offer of this.offers.list.filter((o) => o.status === 'enviando')) {
      const sent = (offer.results || []).some((r) => r.ok);
      this.offers.setStatus(offer, sent ? 'postada' : 'fila', sent ? { postedAt: offer.postedAt || new Date().toISOString() } : {});
    }
  }

  start() {
    this.recoverInterrupted();
    this.timer = setInterval(() => this.tick().catch((error) => log.error('fila', 'Erro na fila', error)), 15_000);
    setTimeout(() => this.tick().catch(() => {}), 3000);
  }

  stop() {
    clearInterval(this.timer);
  }

  status(now = new Date()) {
    const q = this.settings.get().queue;
    const queue = this.offers.queued();
    const plan = forecast(queue, now, this.lastPostAt, q);
    return {
      paused: Boolean(q.paused),
      busy: this.busy,
      size: queue.length,
      lastPostAt: this.lastPostAt,
      next: plan[0]?.at || null,
      plan
    };
  }

  nextReady(now) {
    return this.offers.queued().find((o) => !o.retryAfter || Date.parse(o.retryAfter) <= now.getTime()) || null;
  }

  async tick(now = new Date()) {
    if (this.busy) return;
    const settings = this.settings.get();
    if (settings.queue.paused) return;
    if (!this.whatsapp.isConnected()) return;
    if (!settings.groups.offers.length) return;
    const offer = this.nextReady(now);
    if (!offer) return;
    const slot = nextSlot(now, this.lastPostAt, settings.queue);
    if (!slot || slot > now) return;
    await this.post(offer);
  }

  async sendNow(id) {
    if (this.busy) throw new Error('Já tem uma oferta sendo postada, espera terminar.');
    if (!this.whatsapp.isConnected()) throw new Error('O WhatsApp não está conectado.');
    if (!this.settings.get().groups.offers.length) throw new Error('Nenhum grupo marcado pra postar. Veja em Configurações > Grupos.');
    let offer = id ? this.offers.mustGet(id) : this.offers.queued()[0];
    if (!offer) throw new Error('A fila está vazia.');
    if (offer.status === 'aguardando') offer = this.offers.approve(offer.id);
    if (offer.status !== 'fila' && offer.status !== 'falhou') throw new Error(`A oferta #${offer.id} não está pronta pra postar.`);
    return this.post(offer);
  }

  async post(offer) {
    this.busy = true;
    const settings = this.settings.get();
    const groups = [...settings.groups.offers];
    try {
      this.offers.setStatus(offer, 'enviando', { error: '', retryAfter: null });
      let caption;
      let image;
      try {
        caption = buildCaption(offer, { footer: settings.message.footer });
        image = await this.loadImage(offer.imageUrl);
      } catch (error) {
        this.offers.setStatus(offer, 'falhou', { error: error.message, queueOrder: null });
        log.error('fila', `Oferta #${offer.id} não pôde ser montada`, error);
        this.emit('failed', offer);
        return offer;
      }
      const results = [];
      for (const [index, jid] of groups.entries()) {
        if (index > 0) await sleep(this.delayBetweenGroupsMs);
        const at = new Date().toISOString();
        const name = this.whatsapp.groupName(jid) || jid;
        try {
          await this.whatsapp.sendImage(jid, image, caption);
          results.push({ jid, name, ok: true, at });
        } catch (error) {
          results.push({ jid, name, ok: false, error: error.message, at });
          log.error('fila', `Falha ao postar #${offer.id} em ${name}`, error);
        }
        offer.results = results;
      }
      const okCount = results.filter((r) => r.ok).length;
      if (okCount) {
        const postedAt = new Date().toISOString();
        this.db.update((data) => { data.queueState.lastPostAt = postedAt; });
        this.offers.setStatus(offer, 'postada', { postedAt, results, queueOrder: null });
        log.info('fila', `Oferta #${offer.id} postada às ${hhmm()} em ${okCount}/${results.length} grupo(s).`);
        this.emit('posted', offer);
      } else {
        const attempts = (Number(offer.attempts) || 0) + 1;
        const error = results[0]?.error || 'Não consegui postar.';
        if (attempts < MAX_ATTEMPTS) {
          this.offers.setStatus(offer, 'fila', { attempts, error, results, retryAfter: new Date(Date.now() + 5 * MINUTE).toISOString() });
          log.warn('fila', `Oferta #${offer.id}: tentativa ${attempts} falhou, tento de novo em 5 min.`);
        } else {
          this.offers.setStatus(offer, 'falhou', { attempts, error, results, queueOrder: null });
          this.emit('failed', offer);
        }
      }
      return offer;
    } finally {
      this.busy = false;
    }
  }
}
