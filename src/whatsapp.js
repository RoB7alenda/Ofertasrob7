// Conexão direta com o WhatsApp lendo um QR code (como "aparelho conectado"), sem API paga.
// Usa a biblioteca Baileys. A Luna Ofertas só posta nos grupos que você marcar no painel
// e só obedece comandos no grupo de comando ("Luna Ofertas").

import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  isJidGroup,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  useMultiFileAuthState
} from 'baileys';
import { PATHS, VERSION } from './config.js';
import { log } from './log.js';

const silent = pino({ level: 'silent' });
const GROUP_CACHE_MS = 2 * 60_000;
const VERSION_CACHE_MS = 6 * 3_600_000;

// Nome que aparece no celular em "Aparelhos conectados".
export const DEVICE = ['Ofertas RoB7', 'Chrome', VERSION];

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Versão do WhatsApp Web que o programa diz que é. Se for velha, o celular recusa o QR
// ("não foi possível conectar, verifique a conexão"). Por isso pega a versão ATUAL direto
// do web.whatsapp.com; se não der, usa a da biblioteca.
export async function pickWaVersion(fetchers = [fetchLatestWaWebVersion, fetchLatestBaileysVersion]) {
  for (const fetcher of fetchers) {
    try {
      const result = await withTimeout(fetcher({}), 10_000);
      if (result?.isLatest && Array.isArray(result.version) && result.version.length === 3) {
        return { version: result.version, source: fetcher.name || 'versão' };
      }
    } catch {}
  }
  return { version: undefined, source: 'padrão da biblioteca' };
}

// A biblioteca (Baileys) junta a versão num texto (version.join('.')) pra conectar. Se a gente
// mandar o campo "version" vazio, ele sobrescreve o padrão dela e a conexão morre com
// "Cannot read properties of undefined (reading 'join')" — fica preso no QR pra sempre.
// Então: sem versão confirmada, o certo é NÃO mandar o campo e deixar a biblioteca usar a dela.
export function versionOption(version) {
  const ok = Array.isArray(version) && version.length === 3 && version.every((n) => Number.isInteger(n) && n >= 0);
  return ok ? { version } : {};
}

// Explica o código de erro do WhatsApp em português simples.
export function explainCloseCode(code) {
  if (code === 428) return 'O WhatsApp pediu uma verificação extra (chave de acesso/passkey) pra conectar o aparelho. Tente "Conectar pelo número" ou leia o QR de novo.';
  if (code === 405) return 'O WhatsApp recusou a conexão (versão). Clique em "Gerar QR novo do zero".';
  if (code === 500) return 'Sessão estragada. Clique em "Gerar QR novo do zero".';
  return '';
}

export function validPhone(number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!/^55\d{10,11}$/.test(digits)) return '';
  return digits;
}

export function textFromMessage(message) {
  const content = normalizeMessageContent(message?.message);
  if (!content) return '';
  return String(
    content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.videoMessage?.caption
    || content.buttonsResponseMessage?.selectedDisplayText
    || content.listResponseMessage?.title
    || ''
  ).trim();
}

export class WhatsAppConnection extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.state = 'iniciando'; // iniciando | qr | conectando | conectado | desconectado | erro
    this.qr = '';
    this.qrDataUrl = '';
    this.me = null;
    this.lastError = '';
    this.groupsCache = { at: 0, list: [] };
    this.groupMeta = new Map();
    this.sent = new Map();
    this.retryCount = 0;
    this.reconnectTimer = null;
    this.stopped = false;
    this.waVersion = null;
    this.pairingCode = '';
  }

  async currentVersion() {
    if (this.waVersion && Date.now() - this.waVersion.at < VERSION_CACHE_MS) return this.waVersion;
    const picked = await pickWaVersion();
    this.waVersion = { ...picked, at: Date.now() };
    if (picked.version) log.info('whatsapp', `Usando a versão ${picked.version.join('.')} do WhatsApp Web (${picked.source}).`);
    else log.warn('whatsapp', 'Não consegui ver a versão atual do WhatsApp Web (internet?). Vou usar a que vem na biblioteca.');
    return this.waVersion;
  }

  isConnected() {
    return this.state === 'conectado' && Boolean(this.sock);
  }

  snapshot() {
    return {
      state: this.state,
      qr: this.state === 'qr' ? this.qrDataUrl : '',
      pairingCode: this.state === 'qr' ? this.pairingCode : '',
      me: this.me,
      lastError: this.lastError
    };
  }

  setState(state, extra = {}) {
    Object.assign(this, extra);
    this.state = state;
    this.emit('state', this.snapshot());
  }

  async start() {
    this.stopped = false;
    clearTimeout(this.reconnectTimer);
    fs.mkdirSync(PATHS.waAuth, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(PATHS.waAuth);
    const { version } = await this.currentVersion();
    this.pairingCode = '';
    const sock = makeWASocket({
      ...versionOption(version),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silent) },
      logger: silent,
      browser: DEVICE,
      // Não fica "online" e não puxa o histórico antigo: o celular da Luna continua recebendo notificação normal.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => this.sent.get(key.id),
      cachedGroupMetadata: async (jid) => this.groupMeta.get(jid)
    });
    this.sock = sock;
    this.setState('conectando');

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      if (sock !== this.sock) return;
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        this.qr = qr;
        try { this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 }); } catch { this.qrDataUrl = ''; }
        const firstQr = this.state !== 'qr';
        this.setState('qr');
        if (firstQr) log.info('whatsapp', 'QR code pronto no painel (tela Início). Leia com o WhatsApp da Luna.');
      }
      if (connection === 'open') {
        this.retryCount = 0;
        const id = sock.user?.id || '';
        this.setState('conectado', {
          me: { id, number: id.split(':')[0].split('@')[0], name: sock.user?.name || '' },
          lastError: '',
          qr: '',
          qrDataUrl: '',
          pairingCode: ''
        });
        log.info('whatsapp', `Conectado como ${this.me.number}.`);
        this.refreshGroups(true).catch(() => {});
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const wasWaitingQr = this.state === 'qr';
        this.sock = null;
        if (this.stopped) return;
        if (code === DisconnectReason.loggedOut) {
          log.warn('whatsapp', 'O WhatsApp desconectou este aparelho. Vou mostrar um QR novo.');
          this.clearSession();
          this.setState('desconectado', { me: null, lastError: 'Aparelho desconectado pelo WhatsApp. Leia o QR de novo.' });
          this.scheduleReconnect(2000);
          return;
        }
        if (code === DisconnectReason.connectionReplaced) {
          this.setState('erro', { lastError: 'Outra cópia do programa conectou com esta mesma sessão. Feche a outra e clique em "Reconectar".' });
          log.error('whatsapp', 'Sessão substituída por outra conexão (programa aberto duas vezes?).');
          return;
        }
        if (code === DisconnectReason.forbidden) {
          this.setState('erro', { lastError: 'O WhatsApp bloqueou este número para aparelhos conectados.' });
          log.error('whatsapp', 'Número bloqueado (403).');
          return;
        }
        // QR que venceu sem ninguém ler: gera outro rapidinho (não conta como falha).
        const quick = code === DisconnectReason.restartRequired || wasWaitingQr;
        const wait = quick ? 1500 : Math.min(60_000, 2000 * 2 ** Math.min(this.retryCount, 5));
        if (!quick) this.retryCount++;
        if (code === DisconnectReason.restartRequired) {
          log.info('whatsapp', 'QR lido! Terminando de conectar...');
          this.setState('conectando', { lastError: '' });
        } else if (wasWaitingQr) {
          // 408 = o QR venceu sem ninguém ler (normal). Outro código = o celular tentou e deu erro.
          const explained = code === DisconnectReason.timedOut ? '' : explainCloseCode(code);
          if (code !== DisconnectReason.timedOut) {
            log.warn('whatsapp', `Pareamento não completou (código ${code ?? '?'}: ${lastDisconnect?.error?.message || 'sem detalhe'}).`);
          }
          this.setState('conectando', { lastError: explained || (code !== DisconnectReason.timedOut ? `Não completou a conexão (código ${code ?? '?'}). Tente de novo.` : '') });
        } else {
          this.setState('conectando', { lastError: lastDisconnect?.error?.message || '' });
          log.warn('whatsapp', `Conexão caiu (código ${code ?? '?'}). Reconectando em ${Math.round(wait / 1000)}s.`);
        }
        this.scheduleReconnect(wait);
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const message of messages) {
        const jid = message.key?.remoteJid || '';
        if (!jid || message.key?.fromMe) continue;
        // Mensagem antiga (chegou atrasada depois de reconectar): ignora, pra não executar comando velho.
        const rawTs = message.messageTimestamp;
        const ts = (typeof rawTs === 'object' && rawTs ? (rawTs.toNumber?.() ?? Number(rawTs.low)) : Number(rawTs)) * 1000;
        if (ts && Date.now() - ts > 3 * 60_000) continue;
        const text = textFromMessage(message);
        if (!text) continue;
        this.emit('message', {
          jid,
          isGroup: Boolean(isJidGroup(jid)),
          sender: message.key.participant || jid,
          senderAlt: message.key.participantAlt || message.key.remoteJidAlt || '',
          pushName: message.pushName || '',
          text,
          key: message.key
        });
      }
    });

    sock.ev.on('groups.update', () => { this.groupsCache.at = 0; });
    sock.ev.on('group-participants.update', () => { this.groupsCache.at = 0; });
  }

  // Plano B do QR: o celular digita um código de 8 letras (Aparelhos conectados > Conectar com número de telefone).
  async requestPairingCode(number) {
    const phone = validPhone(number);
    if (!phone) throw new Error('Número inválido. Use 55 + DDD + número, ex.: 5511940338222.');
    if (this.state !== 'qr' || !this.sock) throw new Error('Espere aparecer o QR code na tela e tente de novo.');
    if (this.sock.authState?.creds?.registered) throw new Error('Este aparelho já está conectado.');
    const raw = await this.sock.requestPairingCode(phone);
    const code = String(raw || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    this.pairingCode = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
    log.info('whatsapp', `Código de conexão gerado pro número ${phone.slice(0, 4)}…${phone.slice(-4)}.`);
    this.emit('state', this.snapshot());
    return this.pairingCode;
  }

  scheduleReconnect(ms) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.start().catch((error) => {
        log.error('whatsapp', 'Falha ao reconectar', error);
        this.setState('erro', { lastError: error.message });
        this.scheduleReconnect(30_000);
      });
    }, ms);
  }

  clearSession() {
    try { fs.rmSync(PATHS.waAuth, { recursive: true, force: true }); } catch {}
  }

  async restart() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    try { this.sock?.end(undefined); } catch {}
    this.sock = null;
    await this.start();
  }

  // Desconecta este aparelho do WhatsApp (pra trocar de número).
  async logout() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    try { await this.sock?.logout(); } catch {}
    this.sock = null;
    this.clearSession();
    this.setState('desconectado', { me: null, lastError: '' });
    await this.start();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    try { this.sock?.end(undefined); } catch {}
    this.sock = null;
  }

  async refreshGroups(force = false) {
    if (!this.isConnected()) return this.groupsCache.list;
    if (!force && Date.now() - this.groupsCache.at < GROUP_CACHE_MS) return this.groupsCache.list;
    const all = await this.sock.groupFetchAllParticipating();
    const list = Object.values(all).map((g) => {
      this.groupMeta.set(g.id, g);
      return {
        jid: g.id,
        name: g.subject || '(sem nome)',
        size: Array.isArray(g.participants) ? g.participants.length : 0,
        announce: Boolean(g.announce)
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    this.groupsCache = { at: Date.now(), list };
    this.emit('groups', list);
    return list;
  }

  groupName(jid) {
    return this.groupsCache.list.find((g) => g.jid === jid)?.name || this.groupMeta.get(jid)?.subject || '';
  }

  remember(sent) {
    if (sent?.key?.id && sent.message) {
      this.sent.set(sent.key.id, sent.message);
      if (this.sent.size > 300) this.sent.delete(this.sent.keys().next().value);
    }
    return sent;
  }

  ensure() {
    if (!this.isConnected()) throw new Error('O WhatsApp não está conectado.');
  }

  async sendImage(jid, buffer, caption) {
    this.ensure();
    return this.remember(await this.sock.sendMessage(jid, { image: buffer, caption, mimetype: 'image/jpeg' }));
  }

  async sendText(jid, text) {
    this.ensure();
    return this.remember(await this.sock.sendMessage(jid, { text }));
  }
}
