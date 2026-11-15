// Valida e aplica as mudanças de Configurações que vêm do painel.
// Só aceita os campos conhecidos, com o tipo certo. O resto é ignorado.

import { validQueueSettings } from './queue.js';

export class SettingsError extends Error {}

const isGroupJid = (v) => typeof v === 'string' && /^[\d-]+@g\.us$/.test(v);
const bool = (v) => v === true || v === false;
const num = (v, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new SettingsError(`Valor fora do limite (${min} a ${max}).`);
  return n;
};

export function applySettingsPatch(settings, patch = {}) {
  const next = structuredClone(settings);

  if (patch.queue) {
    const q = { ...next.queue };
    for (const key of ['start', 'end']) if (typeof patch.queue[key] === 'string') q[key] = patch.queue[key].trim();
    if (patch.queue.intervalMin !== undefined) q.intervalMin = Number(patch.queue.intervalMin);
    if (Array.isArray(patch.queue.days)) q.days = [...new Set(patch.queue.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (bool(patch.queue.paused)) q.paused = patch.queue.paused;
    const error = validQueueSettings(q);
    if (error) throw new SettingsError(error);
    next.queue = q;
  }

  if (patch.groups) {
    const g = { ...next.groups };
    if (Array.isArray(patch.groups.offers)) g.offers = [...new Set(patch.groups.offers.filter(isGroupJid))].slice(0, 20);
    if (patch.groups.control !== undefined) {
      if (patch.groups.control !== '' && !isGroupJid(patch.groups.control)) throw new SettingsError('Grupo de comando inválido.');
      g.control = patch.groups.control;
    }
    if (g.control && g.offers.includes(g.control)) {
      throw new SettingsError('O grupo de comando não pode ser também um grupo de ofertas.');
    }
    next.groups = g;
  }

  if (patch.message && typeof patch.message.footer === 'string') {
    next.message = { ...next.message, footer: patch.message.footer.trim().slice(0, 300) };
  }

  if (patch.repeatDays !== undefined) next.repeatDays = Math.round(num(patch.repeatDays, 0, 90));

  if (patch.platforms) {
    for (const key of ['mercadolivre', 'shopee', 'tiktok']) {
      if (bool(patch.platforms[key])) next.platforms[key] = patch.platforms[key];
    }
  }

  if (patch.shopeeApi) {
    if (patch.shopeeApi.clear === true) {
      next.shopeeApi = { appId: '', secret: '' };
    } else {
      if (typeof patch.shopeeApi.appId === 'string') {
        const appId = patch.shopeeApi.appId.trim();
        if (appId && !/^\d{3,20}$/.test(appId)) throw new SettingsError('O App ID da Shopee tem que ter só números.');
        next.shopeeApi.appId = appId;
      }
      if (typeof patch.shopeeApi.secret === 'string' && patch.shopeeApi.secret.trim()) {
        next.shopeeApi.secret = patch.shopeeApi.secret.trim().slice(0, 200);
      }
    }
  }

  if (patch.radar) {
    if (bool(patch.radar.notifyZap)) next.radar.notifyZap = patch.radar.notifyZap;
    const s = patch.radar.shopee;
    if (s) {
      const r = { ...next.radar.shopee };
      if (bool(s.enabled)) r.enabled = s.enabled;
      if (s.everyMin !== undefined) r.everyMin = Math.round(num(s.everyMin, 15, 1440));
      if (s.perRun !== undefined) r.perRun = Math.round(num(s.perRun, 1, 20));
      if (s.minDiscount !== undefined) r.minDiscount = Math.round(num(s.minDiscount, 0, 95));
      if (s.minSales !== undefined) r.minSales = Math.round(num(s.minSales, 0, 1_000_000));
      if (s.minRating !== undefined) r.minRating = num(s.minRating, 0, 5);
      if (s.maxPrice !== undefined) r.maxPrice = num(s.maxPrice, 0, 1_000_000);
      if (Array.isArray(s.keywords)) r.keywords = s.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 30);
      next.radar.shopee = r;
    }
    const m = patch.radar.mercadolivre;
    if (m) {
      const r = { ...next.radar.mercadolivre };
      if (bool(m.enabled)) r.enabled = m.enabled;
      if (m.everyMin !== undefined) r.everyMin = Math.round(num(m.everyMin, 15, 1440));
      if (m.perRun !== undefined) r.perRun = Math.round(num(m.perRun, 1, 12));
      next.radar.mercadolivre = r;
    }
  }

  if (patch.browser && typeof patch.browser.chromePath === 'string') {
    next.browser = { ...next.browser, chromePath: patch.browser.chromePath.trim() };
  }

  return next;
}

// O que o painel pode ver (sem senha, sem segredo).
export function publicSettings(settings) {
  const copy = structuredClone(settings);
  copy.panel = { port: settings.panel.port, hasPassword: Boolean(settings.panel.passwordHash) };
  copy.shopeeApi = { appId: settings.shopeeApi.appId, hasSecret: Boolean(settings.shopeeApi.secret) };
  return copy;
}
