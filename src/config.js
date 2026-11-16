import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '3.2.1';

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
  tunnelPid: path.join(DATA_DIR, 'tunel.pid')
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
  queue: {
    paused: false,
    start: '08:00',
    end: '22:00',
    intervalMin: 30,
    days: [0, 1, 2, 3, 4, 5, 6]
  },
  groups: {
    offers: [],
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
  radar: {
    notifyZap: true,
    shopee: {
      enabled: false,
      everyMin: 120,
      perRun: 5,
      keywords: [],
      minDiscount: 20,
      minSales: 50,
      minRating: 4.5,
      maxPrice: 0
    },
    mercadolivre: {
      enabled: false,
      everyMin: 180,
      perRun: 5
    }
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
