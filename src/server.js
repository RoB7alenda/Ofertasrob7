// Painel (site local). Abre em http://127.0.0.1:3777 no PC.
// No celular, pelo túnel da Cloudflare (ver docs/CELULAR.md). Sempre com senha.

import express from 'express';
import { EventEmitter } from 'node:events';
import { PUBLIC_DIR } from './config.js';
import {
  checkPassword, clearFailures, createSession, destroyAllSessions, destroySession, hashPassword,
  isAuthenticated, isLocalRequest, registerFailure, tooManyAttempts
} from './auth.js';
import { applySettingsPatch, publicSettings, SettingsError } from './settings-patch.js';
import { UserError } from './offers.js';
import { buildCaption } from './message.js';
import { recentLogs, logEvents, log } from './log.js';
import { shopeeSearch } from './products/shopee-api.js';
import { openLoginWindow } from './browser.js';
import { ML_HUB } from './radar/mercadolivre.js';

function offerView(offer, settings) {
  let caption = '';
  try { caption = buildCaption(offer, { footer: settings.message.footer }); } catch {}
  return { ...offer, caption };
}

export function createServer(ctx) {
  const { settings, db, offers, queue, whatsapp, radar } = ctx;
  const app = express();
  const bus = new EventEmitter();
  bus.setMaxListeners(50);

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(express.json({ limit: '200kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Bloqueia pedido vindo de outro site (proteção contra formulário falso).
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Origem não permitida.' });
      } catch {
        return res.status(403).json({ error: 'Origem não permitida.' });
      }
    }
    if (!req.is('application/json')) return res.status(415).json({ error: 'Envie JSON.' });
    next();
  });

  // ---------- Login ----------
  app.get('/api/auth', (req, res) => {
    const s = settings.get();
    res.json({
      hasPassword: Boolean(s.panel.passwordHash),
      canSetup: !s.panel.passwordHash && isLocalRequest(req),
      authenticated: isAuthenticated(db, req)
    });
  });

  app.post('/api/auth/setup', (req, res) => {
    const s = settings.get();
    if (s.panel.passwordHash) return res.status(409).json({ error: 'A senha já foi criada.' });
    if (!isLocalRequest(req)) return res.status(403).json({ error: 'Crie a senha pelo próprio PC.' });
    const password = String(req.body?.password || '');
    if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
    const { hash, salt } = hashPassword(password);
    settings.update((x) => { x.panel.passwordHash = hash; x.panel.passwordSalt = salt; });
    createSession(db, res, req);
    log.info('painel', 'Senha do painel criada.');
    res.json({ ok: true });
  });

  app.post('/api/auth/login', (req, res) => {
    if (tooManyAttempts(req)) return res.status(429).json({ error: 'Muitas tentativas. Espera 10 minutos.' });
    const s = settings.get();
    if (!checkPassword(String(req.body?.password || ''), { hash: s.panel.passwordHash, salt: s.panel.passwordSalt })) {
      registerFailure(req);
      log.warn('painel', 'Senha errada no login do painel.');
      return res.status(401).json({ error: 'Senha errada.' });
    }
    clearFailures(req);
    createSession(db, res, req);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    destroySession(db, req, res);
    res.json({ ok: true });
  });

  // Daqui pra baixo, só logado.
  app.use('/api', (req, res, next) => {
    if (isAuthenticated(db, req)) return next();
    res.status(401).json({ error: 'Faça login.' });
  });

  app.post('/api/auth/password', (req, res) => {
    const s = settings.get();
    if (!checkPassword(String(req.body?.current || ''), { hash: s.panel.passwordHash, salt: s.panel.passwordSalt })) {
      return res.status(400).json({ error: 'A senha atual está errada.' });
    }
    const next = String(req.body?.next || '');
    if (next.length < 6) return res.status(400).json({ error: 'A senha nova precisa ter pelo menos 6 caracteres.' });
    const { hash, salt } = hashPassword(next);
    settings.update((x) => { x.panel.passwordHash = hash; x.panel.passwordSalt = salt; });
    destroyAllSessions(db);
    createSession(db, res, req);
    res.json({ ok: true });
  });

  // ---------- Estado geral ----------
  app.get('/api/state', (req, res) => res.json(ctx.buildState()));

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('state', ctx.buildState());
    const onState = (data) => send('state', data);
    const onLog = (entry) => send('log', entry);
    bus.on('state', onState);
    logEvents.on('entry', onLog);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      bus.off('state', onState);
      logEvents.off('entry', onLog);
    });
  });

  // ---------- Ofertas ----------
  app.get('/api/offers', (req, res) => {
    const s = settings.get();
    const status = String(req.query.status || '');
    let list = offers.list;
    if (status) list = list.filter((o) => status.split(',').includes(o.status));
    if (status === 'fila') list = offers.queued();
    else list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300);
    res.json(list.map((o) => offerView(o, s)));
  });

  app.post('/api/offers', async (req, res) => {
    const text = String(req.body?.text || '');
    const origin = (text.match(/https?:\/\//g) || []).length > 1 ? 'lista' : 'painel';
    const results = await offers.addFromText(text, { origin });
    const s = settings.get();
    res.json(results.map((r) => ({
      url: r.url,
      error: r.error || '',
      message: r.message || '',
      duplicateId: r.duplicate?.id || '',
      offer: r.offer ? offerView(r.offer, s) : null
    })));
  });

  app.patch('/api/offers/:id', (req, res) => {
    const allowed = {};
    for (const key of ['title', 'price', 'oldPrice', 'imageUrl']) if (key in (req.body || {})) allowed[key] = req.body[key];
    res.json(offerView(offers.update(req.params.id, allowed), settings.get()));
  });

  const action = (fn) => async (req, res) => res.json(offerView(await fn(req.params.id, req.body || {}), settings.get()));
  app.post('/api/offers/:id/approve', action((id) => offers.approve(id)));
  app.post('/api/offers/:id/reject', action((id) => offers.reject(id)));
  app.post('/api/offers/:id/unqueue', action((id) => offers.unqueue(id)));
  app.post('/api/offers/:id/move', action((id, body) => offers.move(id, body.direction)));
  app.post('/api/offers/:id/reread', action((id) => offers.reread(id)));
  app.post('/api/offers/:id/send-now', action((id) => queue.sendNow(id)));
  app.post('/api/offers/:id/repeat', async (req, res) => {
    const old = offers.mustGet(req.params.id);
    const { offer } = await offers.addFromUrl(old.inputUrl, { origin: 'painel', allowRepeat: true });
    res.json(offerView(offer, settings.get()));
  });

  app.get('/api/offers/:id/image', async (req, res) => {
    const offer = offers.mustGet(req.params.id);
    let image;
    try {
      image = await ctx.loadImage(offer.imageUrl);
    } catch (error) {
      return res.status(404).json({ error: error.message });
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(image);
  });

  // ---------- Fila ----------
  app.post('/api/queue/pause', (req, res) => {
    const paused = Boolean(req.body?.paused);
    settings.update((s) => { s.queue.paused = paused; });
    log.info('fila', paused ? 'Fila pausada pelo painel.' : 'Fila ligada pelo painel.');
    res.json(queue.status());
  });

  app.post('/api/queue/send-next', async (req, res) => {
    const offer = await queue.sendNow(null);
    res.json(offerView(offer, settings.get()));
  });

  // ---------- WhatsApp ----------
  app.get('/api/groups', async (req, res) => {
    const list = await whatsapp.refreshGroups(req.query.refresh === '1').catch(() => whatsapp.groupsCache.list);
    res.json(list);
  });

  app.post('/api/whatsapp/restart', async (req, res) => {
    await whatsapp.restart();
    res.json(whatsapp.snapshot());
  });

  app.post('/api/whatsapp/logout', async (req, res) => {
    await whatsapp.logout();
    log.warn('whatsapp', 'Aparelho desconectado pelo painel.');
    res.json(whatsapp.snapshot());
  });

  app.post('/api/whatsapp/pairing-code', async (req, res) => {
    try {
      const code = await whatsapp.requestPairingCode(req.body?.number);
      res.json({ code });
    } catch (error) {
      throw new UserError(error.message);
    }
  });

  app.post('/api/whatsapp/test', async (req, res) => {
    const jid = settings.get().groups.control;
    if (!jid) throw new UserError('Escolha primeiro o grupo de comando.');
    await whatsapp.sendText(jid, '👋 Oi! Aqui é a Luna Ofertas. Tô conectada. Manda *ajuda* pra ver os comandos.');
    res.json({ ok: true });
  });

  // ---------- Configurações ----------
  app.get('/api/settings', (req, res) => res.json(publicSettings(settings.get())));

  app.put('/api/settings', (req, res) => {
    const next = applySettingsPatch(settings.get(), req.body || {});
    settings.update((s) => { Object.assign(s, next); });
    log.info('painel', 'Configurações salvas.');
    res.json(publicSettings(settings.get()));
  });

  app.post('/api/shopee/test', async (req, res) => {
    const nodes = await shopeeSearch(settings.get().shopeeApi, { keyword: 'fone bluetooth', limit: 3 });
    res.json({ ok: true, sample: nodes.slice(0, 3).map((n) => n.productName) });
  });

  app.post('/api/browser/login', async (req, res) => {
    const s = settings.get();
    const urls = [];
    if (s.platforms.shopee) urls.push('https://shopee.com.br/buyer/login');
    if (s.platforms.mercadolivre) urls.push(ML_HUB);
    if (s.platforms.tiktok) urls.push('https://www.tiktok.com/login');
    if (!isLocalRequest(req)) throw new UserError('A janela de login só abre no PC. Faça isso pelo painel no próprio PC.');
    await openLoginWindow(urls);
    res.json({ ok: true });
  });

  app.post('/api/radar/:platform/run', async (req, res) => {
    const added = await radar.run(req.params.platform, { manual: true });
    res.json({ added: added.length });
  });

  app.get('/api/logs', (req, res) => res.json(recentLogs(300)));

  // ---------- Arquivos do painel ----------
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));

  // Erros: mensagem simples pra quem usa.
  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    const known = error instanceof UserError || error instanceof SettingsError;
    if (!known) log.error('painel', `${req.method} ${req.path}`, error);
    res.status(known ? 400 : 500).json({ error: error.message || 'Erro inesperado.' });
  });

  // Avisa o painel quando algo muda (no máximo 3x por segundo).
  let pending = null;
  const pushState = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      bus.emit('state', ctx.buildState());
    }, 300);
  };

  return { app, pushState };
}
