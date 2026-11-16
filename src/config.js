import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneDefaults } from './categories.js';

export const VERSION = '3.3.1';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..');
// Os dados (sessão do WhatsApp, ofertas, fotos) ficam FORA da pasta do programa,
// em %LOCALAPPDATA%\OfertasRoB7. Assim, atualizar o programa nunca apaga nada nem pede QR de novo.
export const DATA_DIR = process.env.ROB7_DATA_DIR
  ? path.resolve(process.env.ROB7_DATA_DIR)
  : (process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'OfertasRoB7')
    : path.join(ROOT_DIR, 'data'));
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export const PATHS = {
  db: path.join(DATA_DIR, 'db.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  waAuth: path.join(DATA_DIR, 'whatsapp-sessao'),
  browserProfile: path.join(DATA_DIR, 'navegador-perfil'),
  images: path.join(DATA_DIR, 'imagens'),
  logs: path.join(DATA_DIR, 'logs'),
  tunnelPid: path.join(DATA_DIR, 'tunel.pid'),
  diagnostics: path.join(DATA_DIR, 'diagnostico')
};

export const DEFAULT_SETTINGS = Object.freeze({
  panel: {
    port: 3777,
    // host 127.0.0.1: o painel só abre neste PC (ou pelo túnel da Cloudflare).
    host: '127.0.0.1',
    passwordHash: '',
    passwordSalt: '',
    sessionSecret: ''
  },
  // Horário e grupos de oferta ficam em cada categoria (categories). Aqui só o "pausar tudo".
  queue: {
    paused: false
  },
  groups: {
    control: ''
  },
  message: {
    footer: '⚠️ Atenção: O preço pode sofrer alteração...',
    showDiscount: true,
    showCoupon: true
  },
  repeatDays: 7,
  platforms: {
    mercadolivre: true,
    shopee: true,
    tiktok: false
  },
  shopeeApi: {
    appId: '',
    secret: ''
  },
  categories: cloneDefaults(),
  categoriesVersion: 0,
  agent: {
    enabled: true,
    everyMin: 120,
    autopilot: false,
    perRun: 5,
    maxPending: 15,
    notifyZap: true
  },
  ai: {
    apiKey: '',
    model: 'claude-haiku-5-5',
    dailyLimitUsd: 0.25,
    classifyLinks: true
  },
  browser: {
    chromePath: ''
  },
  tunnel: {
    enabled: false,
    token: '',
    publicUrl: ''
  }
});
