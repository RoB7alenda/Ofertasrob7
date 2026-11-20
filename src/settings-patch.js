// Valida e aplica as mudanças de Configurações que vêm do painel.
// Só aceita os campos conhecidos, com o tipo certo. O resto é ignorado.

import { validQueueSettings } from './queue.js';
import { extractToken } from './tunnel.js';

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

  if (patch.groups && patch.groups.control !== undefined) {
    if (patch.groups.control !== '' && !isGroupJid(patch.groups.control)) throw new SettingsError('Grupo de comando inválido.');
    next.groups = { ...next.groups, control: patch.groups.control };
  }

  if (Array.isArray(patch.categories)) {
    const list = structuredClone(next.categories || []);
    for (const change of patch.categories) {
      const c = list.find((x) => x.id === change?.id);
      if (!c) throw new SettingsError('Categoria desconhecida.');
      if (bool(change.enabled)) c.enabled = change.enabled;
      if (typeof change.name === 'string' && change.name.trim()) c.name = change.name.trim().slice(0, 40);
      if (Array.isArray(change.groups)) c.groups = [...new Set(change.groups.filter(isGroupJid))].slice(0, 10);
      if (Array.isArray(change.keywords)) c.keywords = [...new Set(change.keywords.map((k) => String(k).trim()).filter(Boolean))].slice(0, 40).map((k) => k.slice(0, 60));
      if (typeof change.description === 'string') c.description = change.description.trim().slice(0, 400);
      const sched = { start: c.start, end: c.end, intervalMin: c.intervalMin, days: c.days };
      if (typeof change.start === 'string') sched.start = change.start.trim();
      if (typeof change.end === 'string') sched.end = change.end.trim();
      if (change.intervalMin !== undefined) sched.intervalMin = Number(change.intervalMin);
      if (Array.isArray(change.days)) sched.days = [...new Set(change.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
      const error = validQueueSettings(sched);
      if (error) throw new SettingsError(`${c.name}: ${error}`);
      Object.assign(c, sched);
      if (change.minDiscount !== undefined) c.minDiscount = Math.round(num(change.minDiscount, 0, 95));
      if (change.minRating !== undefined) c.minRating = num(change.minRating, 0, 5);
      if (change.minReviews !== undefined) c.minReviews = Math.round(num(change.minReviews, 0, 100000));
      if (bool(change.requireFreeShipping)) c.requireFreeShipping = change.requireFreeShipping;
      if (change.maxPrice !== undefined) c.maxPrice = num(change.maxPrice, 0, 1_000_000);
    }
    // Um grupo só pode ser de uma categoria (senão recebe oferta de tudo).
    const owner = new Map();
    for (const c of list) {
      for (const jid of c.groups) {
        if (owner.has(jid)) throw new SettingsError(`Um grupo está em duas categorias (${owner.get(jid)} e ${c.name}). Deixe em uma só.`);
        owner.set(jid, c.name);
      }
    }
    next.categories = list;
  }

  if (patch.sources) {
    const src = { ...next.sources };
    if (bool(patch.sources.enabled)) src.enabled = patch.sources.enabled;
    if (bool(patch.sources.autoQueue)) src.autoQueue = patch.sources.autoQueue;
    if (Array.isArray(patch.sources.groups)) src.groups = [...new Set(patch.sources.groups.filter(isGroupJid))].slice(0, 5);
    if (patch.sources.maxQueued !== undefined) src.maxQueued = Math.round(num(patch.sources.maxQueued, 5, 200));
    next.sources = src;
  }

  const control = next.groups?.control;
  if (control && (next.categories || []).some((c) => c.groups.includes(control))) {
    throw new SettingsError('O grupo de comando não pode ser também um grupo de ofertas.');
  }
  // Grupo de fora (de onde a Luna copia) é só pra ler: não pode ser de categoria nem o de comando.
  for (const jid of next.sources?.groups || []) {
    if (jid === control) throw new SettingsError('O grupo de comando não pode ser um grupo de onde a Luna copia.');
    const owner = (next.categories || []).find((c) => c.groups.includes(jid));
    if (owner) throw new SettingsError(`Esse grupo é onde a Luna posta (${owner.name}). O grupo de onde ela copia tem que ser outro.`);
  }

  if (patch.message) {
    const m = { ...next.message };
    if (typeof patch.message.footer === 'string') m.footer = patch.message.footer.trim().slice(0, 300);
    if (bool(patch.message.showDiscount)) m.showDiscount = patch.message.showDiscount;
    if (bool(patch.message.showCoupon)) m.showCoupon = patch.message.showCoupon;
    next.message = m;
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

  if (patch.queue && bool(patch.queue.paused)) next.queue = { ...next.queue, paused: patch.queue.paused };

  if (patch.agent) {
    const a = { ...next.agent };
    for (const key of ['enabled', 'autopilot', 'notifyZap']) if (bool(patch.agent[key])) a[key] = patch.agent[key];
    if (patch.agent.everyMin !== undefined) a.everyMin = Math.round(num(patch.agent.everyMin, 30, 1440));
    if (patch.agent.perRun !== undefined) a.perRun = Math.round(num(patch.agent.perRun, 1, 10));
    if (patch.agent.maxPending !== undefined) a.maxPending = Math.round(num(patch.agent.maxPending, 1, 100));
    next.agent = a;
  }

  if (patch.ai) {
    const ai = { ...next.ai };
    if (patch.ai.clear === true) ai.apiKey = '';
    if (typeof patch.ai.apiKey === 'string' && patch.ai.apiKey.trim()) {
      const key = patch.ai.apiKey.trim();
      if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) throw new SettingsError('Essa não parece uma chave da Anthropic (começa com sk-ant-).');
      ai.apiKey = key;
    }
    if (typeof patch.ai.model === 'string' && patch.ai.model.trim()) {
      if (!/^claude-[a-z0-9.-]{3,60}$/.test(patch.ai.model.trim())) throw new SettingsError('Nome de modelo inválido.');
      ai.model = patch.ai.model.trim();
    }
    if (patch.ai.dailyLimitUsd !== undefined) ai.dailyLimitUsd = num(patch.ai.dailyLimitUsd, 0, 10);
    if (bool(patch.ai.classifyLinks)) ai.classifyLinks = patch.ai.classifyLinks;
    next.ai = ai;
  }

  if (patch.tunnel) {
    const t = { ...next.tunnel };
    if (patch.tunnel.clear === true) {
      t.token = '';
      t.enabled = false;
    }
    if (typeof patch.tunnel.token === 'string' && patch.tunnel.token.trim()) {
      const token = extractToken(patch.tunnel.token);
      if (!token) throw new SettingsError('Isso não parece o token do túnel. Ele é um texto bem longo que começa com "eyJ".');
      t.token = token;
    }
    if (typeof patch.tunnel.publicUrl === 'string') {
      const url = patch.tunnel.publicUrl.trim().replace(/\/+$/, '');
      if (url && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(url)) throw new SettingsError('O endereço tem que ser assim: https://ofertas.seudominio.com.br');
      t.publicUrl = url;
    }
    if (bool(patch.tunnel.enabled)) t.enabled = patch.tunnel.enabled;
    if (t.enabled && !t.token) throw new SettingsError('Cole o token do túnel antes de ligar.');
    next.tunnel = t;
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
  copy.tunnel = { enabled: Boolean(settings.tunnel?.enabled), publicUrl: settings.tunnel?.publicUrl || '', hasToken: Boolean(settings.tunnel?.token) };
  copy.ai = { model: settings.ai?.model, dailyLimitUsd: settings.ai?.dailyLimitUsd, classifyLinks: settings.ai?.classifyLinks !== false, hasKey: Boolean(settings.ai?.apiKey) };
  return copy;
}
