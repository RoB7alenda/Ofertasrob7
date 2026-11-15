// Ofertas RoB7 V3 — liga tudo: banco local, WhatsApp, fila, Luna Ofertas, radar e painel.

import fs from 'node:fs';
import { exec } from 'node:child_process';
import { DATA_DIR, DEFAULT_SETTINGS, PATHS, VERSION } from './config.js';
import { JsonFile } from './store.js';
import { log } from './log.js';
import { WhatsAppConnection } from './whatsapp.js';
import { OfferService } from './offers.js';
import { QueueRunner } from './queue.js';
import { LunaCommands } from './commands.js';
import { RadarService } from './radar/index.js';
import { createServer } from './server.js';
import { cleanOldImages, loadOfferImage } from './images.js';
import { browserStatus, configureBrowser, shutdownBrowser } from './browser.js';
import { publicSettings } from './settings-patch.js';
import { TunnelService } from './tunnel.js';

const DB_DEFAULTS = {
  seq: 0,
  offers: [],
  sessions: [],
  queueState: { lastPostAt: null },
  radarState: { shopee: {}, mercadolivre: {} }
};

fs.mkdirSync(DATA_DIR, { recursive: true });
const settings = new JsonFile(PATHS.settings, DEFAULT_SETTINGS);
const db = new JsonFile(PATHS.db, DB_DEFAULTS);
configureBrowser(() => settings.get());

const whatsapp = new WhatsAppConnection();
const offers = new OfferService({ db, settings });
const queue = new QueueRunner({ offers, settings, db, whatsapp, loadImage: loadOfferImage });
const luna = new LunaCommands({ offers, queue, whatsapp, settings, loadImage: loadOfferImage });
const radar = new RadarService({ settings, offers, db, notify: (text) => luna.reply(text) });
const tunnel = new TunnelService({ settings });

let rev = 0;
function buildState() {
  const s = settings.get();
  const list = offers.list;
  return {
    version: VERSION,
    rev,
    dataDir: DATA_DIR,
    wa: whatsapp.snapshot(),
    groupsReady: whatsapp.groupsCache.list.length > 0,
    queue: queue.status(),
    radar: radar.status(),
    browser: browserStatus(),
    tunnel: tunnel.status(),
    counts: {
      aguardando: list.filter((o) => o.status === 'aguardando').length,
      fila: list.filter((o) => o.status === 'fila').length,
      falhou: list.filter((o) => o.status === 'falhou').length,
      postadasHoje: offers.postedToday().length
    },
    settings: publicSettings(s)
  };
}

const ctx = { settings, db, offers, queue, whatsapp, radar, tunnel, loadImage: loadOfferImage, buildState };
const { app, pushState } = createServer(ctx);

offers.on('changed', () => { rev++; pushState(); });
for (const emitter of [whatsapp, settings, radar, queue, tunnel]) {
  for (const event of ['state', 'groups', 'change', 'status', 'posted', 'failed']) emitter.on(event, pushState);
}

const { port, host } = settings.get().panel;
const server = app.listen(port, host, () => {
  log.info('programa', `Ofertas RoB7 ${VERSION} ligado. Painel: http://127.0.0.1:${port}`);
  log.info('programa', `Dados guardados em: ${DATA_DIR}`);
  whatsapp.start().catch((error) => log.error('whatsapp', 'Não consegui iniciar o WhatsApp', error));
  queue.start();
  radar.start();
  luna.attach();
  luna.attachQueueNotices();
  tunnel.apply();
  settings.on('change', () => tunnel.apply());
  setInterval(pushState, 60_000); // atualiza o "próxima às" do painel
  cleanOldImages(30).catch(() => {});
  setInterval(() => cleanOldImages(30).catch(() => {}), 24 * 3_600_000);
  if (process.argv.includes('--abrir') && process.platform === 'win32') exec(`cmd /c start "" http://127.0.0.1:${port}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    log.warn('programa', `O programa já está aberto (porta ${port} ocupada). Saindo desta cópia.`);
    process.exit(3);
  }
  log.error('programa', 'Erro no painel', error);
  process.exit(1);
});

let closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  log.info('programa', 'Desligando...');
  queue.stop();
  radar.stop();
  tunnel.stop();
  server.close();
  await whatsapp.stop().catch(() => {});
  await shutdownBrowser().catch(() => {});
  settings.saveNow();
  db.saveNow();
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (error) => log.error('programa', 'Erro não tratado', error instanceof Error ? error : String(error)));
process.on('uncaughtException', (error) => {
  log.error('programa', 'Erro grave, reiniciando', error);
  try { settings.saveNow(); db.saveNow(); } catch {}
  process.exit(1);
});
