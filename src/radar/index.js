// Agenda dos radares: roda cada um no seu intervalo, só dentro do horário da fila,
// e avisa no grupo de comando quando acha ofertas novas.

import { EventEmitter } from 'node:events';
import { runShopeeRadar } from './shopee.js';
import { runMercadoLivreRadar } from './mercadolivre.js';
import { parseHM } from '../queue.js';
import { money } from '../text.js';
import { log } from '../log.js';

const RUNNERS = {
  shopee: runShopeeRadar,
  mercadolivre: runMercadoLivreRadar
};

const NAMES = { shopee: 'Shopee', mercadolivre: 'Mercado Livre' };

export class RadarService extends EventEmitter {
  constructor({ settings, offers, db, notify }) {
    super();
    this.settings = settings;
    this.offers = offers;
    this.db = db;
    this.notify = notify;
    this.running = new Set();
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), 60_000);
  }

  stop() {
    clearInterval(this.timer);
  }

  state(platform) {
    return this.db.get().radarState[platform] || {};
  }

  status() {
    const all = this.settings.get();
    return Object.keys(RUNNERS).map((platform) => ({
      platform,
      name: NAMES[platform],
      enabled: Boolean(all.radar[platform]?.enabled) && Boolean(all.platforms[platform]),
      running: this.running.has(platform),
      ...this.state(platform)
    }));
  }

  inWorkingHours(now) {
    const q = this.settings.get().queue;
    const minutes = now.getHours() * 60 + now.getMinutes();
    return q.days.includes(now.getDay()) && minutes >= parseHM(q.start) && minutes < parseHM(q.end);
  }

  async tick(now = new Date()) {
    if (!this.inWorkingHours(now)) return;
    const all = this.settings.get();
    for (const platform of Object.keys(RUNNERS)) {
      const cfg = all.radar[platform];
      if (!cfg?.enabled || !all.platforms[platform] || this.running.has(platform)) continue;
      const last = Date.parse(this.state(platform).lastRunAt || 0) || 0;
      if (now.getTime() - last < Math.max(15, Number(cfg.everyMin) || 120) * 60_000) continue;
      await this.run(platform).catch(() => {});
    }
  }

  async run(platform, { manual = false } = {}) {
    const runner = RUNNERS[platform];
    if (!runner) throw new Error('Radar desconhecido.');
    if (this.running.has(platform)) throw new Error(`O radar ${NAMES[platform]} já está rodando.`);
    this.running.add(platform);
    this.emit('status', this.status());
    const startedAt = new Date().toISOString();
    const notifyZap = Boolean(this.settings.get().radar.notifyZap);
    try {
      log.info('radar', `Radar ${NAMES[platform]} começou${manual ? ' (manual)' : ''}.`);
      const added = await runner({ settings: this.settings, offers: this.offers, db: this.db, awaitingZap: notifyZap });
      this.db.update((data) => {
        data.radarState[platform] = { ...data.radarState[platform], lastRunAt: startedAt, lastResult: `${added.length} nova(s)`, lastError: '' };
      });
      log.info('radar', `Radar ${NAMES[platform]}: ${added.length} oferta(s) nova(s).`);
      if (added.length && notifyZap && this.notify) {
        const lines = added.map((o) => `#${o.id} ${o.title.slice(0, 45)} — ${o.price ? money(o.price) : '?'}`);
        await this.notify(`🔎 *Radar ${NAMES[platform]}* achou ${added.length} oferta(s):\n${lines.join('\n')}\n\nResponde *sim* pra aprovar todas, *sim 12* pra uma, ou *não 12* pra descartar.`).catch(() => {});
      }
      return added;
    } catch (error) {
      this.db.update((data) => {
        data.radarState[platform] = { ...data.radarState[platform], lastRunAt: startedAt, lastError: error.message };
      });
      log.error('radar', `Radar ${NAMES[platform]} falhou`, error);
      throw error;
    } finally {
      this.running.delete(platform);
      this.emit('status', this.status());
    }
  }
}
