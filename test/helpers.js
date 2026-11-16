// Coisas comuns dos testes: pasta temporária e WhatsApp de mentira.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { migrateCategories } from '../src/categories.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rob7-test-'));
process.env.ROB7_DATA_DIR = dir;
process.env.ROB7_QUIET = '1';

export const TEST_DIR = dir;

export function tempFile(name) {
  return path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

export class FakeWhatsApp extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.sent = [];
    this.failFor = new Set();
    this.groupsCache = { list: [{ jid: '111-1@g.us', name: 'Ofertas RoB7 #01', size: 50 }, { jid: '222-2@g.us', name: 'Luna Ofertas', size: 2 }] };
  }
  isConnected() { return this.connected; }
  groupName(jid) { return this.groupsCache.list.find((g) => g.jid === jid)?.name || ''; }
  async sendImage(jid, buffer, caption) {
    if (this.failFor.has(jid)) throw new Error('falha de teste');
    this.sent.push({ type: 'image', jid, caption, size: buffer.length });
  }
  async sendText(jid, text) { this.sent.push({ type: 'text', jid, text }); }
  snapshot() { return { state: this.connected ? 'conectado' : 'desconectado', qr: '', me: { number: '5511999999999' } }; }
  async refreshGroups() { return this.groupsCache.list; }
}

export function fakeProduct(overrides = {}) {
  return {
    resolvedUrl: 'https://produto.mercadolivre.com.br/MLB-1234567890-fone-bluetooth',
    title: 'Fone de Ouvido Bluetooth TWS Pro com Cancelamento de Ruído',
    price: 49.9,
    oldPrice: 99.9,
    imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_000-O.jpg',
    productId: 'MLB1234567890',
    notes: [],
    ...overrides
  };
}

// Configuração de teste: grupo de comando 222-2 e grupo de ofertas 111-1 na categoria "Geral".
export function prepareSettings(settings, { offers = ['111-1@g.us'], control = '222-2@g.us' } = {}) {
  settings.update((s) => {
    s.groups.offers = offers;
    s.groups.control = control;
    s.categoriesVersion = 0;
    migrateCategories(s);
  });
}

// Nos testes da fila, toda oferta cai na "Geral" (sem depender das palavras de busca).
export const toGeneral = async () => 'geral';
