// Túnel da Cloudflare pra abrir o painel no celular de qualquer lugar.
// O programa liga o "cloudflared" sozinho com o token do túnel (sem instalar serviço do Windows,
// então não briga com outro túnel que já exista no PC). Desligou o programa, o túnel desliga junto.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { log } from './log.js';
import { PATHS } from './config.js';

const CANDIDATES = () => {
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  return [
    path.join(pf86, 'cloudflared', 'cloudflared.exe'),
    path.join(pf, 'cloudflared', 'cloudflared.exe'),
    local && path.join(local, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared'
  ].filter(Boolean);
};

function onPath(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, `${name}${ext}`);
      try { if (fs.statSync(file).isFile()) return file; } catch {}
    }
  }
  return '';
}

export function findCloudflared() {
  return CANDIDATES().find((file) => fs.existsSync(file)) || onPath('cloudflared');
}

// Token do túnel: texto longo (base64) que a Cloudflare mostra ao criar o túnel.
// Aceita colar o comando inteiro ("cloudflared service install eyJ...") e pega só o token.
export function extractToken(value) {
  const text = String(value || '').trim();
  const match = text.match(/eyJ[A-Za-z0-9_\-+/=]{40,}/);
  return match ? match[0] : '';
}

// Lê o que o cloudflared escreve e transforma em situação simples.
export function parseCloudflaredLine(line) {
  const text = String(line);
  if (/Registered tunnel connection/i.test(text)) return { event: 'connected' };
  if (/Unregistered tunnel connection|Connection terminated|Retrying connection/i.test(text)) return { event: 'reconnecting' };
  if (/Provided Tunnel token is not valid|invalid token|Unauthorized|token.*(?:malformed|invalid)/i.test(text)) {
    return { event: 'error', message: 'O token do túnel não é válido. Copie de novo no painel da Cloudflare.' };
  }
  if (/failed to dial|no such host|network is unreachable/i.test(text)) return { event: 'reconnecting' };
  return null;
}

// Se o programa foi fechado à força (PARAR.bat), o cloudflared antigo pode ter ficado ligado.
// Desliga só se o número do processo guardado for mesmo um cloudflared.
export function killStaleTunnel(pidFile = PATHS.tunnelPid) {
  let pid = 0;
  try { pid = Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch { return false; }
  try { fs.unlinkSync(pidFile); } catch {}
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
      if (!/cloudflared/i.test(out)) return false;
    } else {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!/cloudflared/i.test(cmdline)) return false;
    }
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

export class TunnelService extends EventEmitter {
  constructor({ settings, binary = null }) {
    super();
    this.settings = settings;
    this.binary = binary; // pros testes: { cmd, args }
    this.child = null;
    this.state = 'desligado'; // desligado | ligando | ligado | erro
    this.lastError = '';
    this.connections = 0;
    this.restartTimer = null;
    this.failures = 0;
    this.installing = false;
    this.wanted = '';
  }

  status() {
    const binary = this.binary ? 'teste' : findCloudflared();
    return {
      installed: Boolean(binary),
      installing: this.installing,
      state: this.state,
      connections: this.connections,
      lastError: this.lastError
    };
  }

  setState(state, extra = {}) {
    Object.assign(this, extra);
    this.state = state;
    this.emit('status', this.status());
  }

  // Liga, desliga ou reinicia conforme as Configurações.
  apply() {
    if (!this.cleaned) {
      this.cleaned = true;
      if (!this.binary && killStaleTunnel()) log.info('celular', 'Desliguei um túnel antigo que tinha ficado aberto.');
    }
    const cfg = this.settings.get().tunnel || {};
    const want = cfg.enabled && cfg.token ? cfg.token : '';
    if (want === this.wanted && (this.child || !want)) return;
    this.wanted = want;
    this.stop(false);
    if (want) this.start();
  }

  start() {
    clearTimeout(this.restartTimer);
    const token = this.wanted;
    if (!token) return;
    let cmd;
    let args;
    if (this.binary) {
      ({ cmd } = this.binary);
      args = [...this.binary.args];
    } else {
      cmd = findCloudflared();
      args = ['tunnel', '--no-autoupdate', 'run'];
    }
    if (!cmd) {
      this.setState('erro', { lastError: 'O cloudflared não está instalado neste PC. Clique em "Instalar o cloudflared".' });
      return;
    }
    this.setState('ligando', { lastError: '', connections: 0 });
    // O token vai por variável de ambiente (não aparece na lista de processos).
    const child = spawn(cmd, args, { env: { ...process.env, TUNNEL_TOKEN: token }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    if (!this.binary && child.pid) {
      try { fs.writeFileSync(PATHS.tunnelPid, String(child.pid)); } catch {}
    }
    const onData = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const parsed = parseCloudflaredLine(line);
        if (!parsed) continue;
        if (parsed.event === 'connected') {
          this.failures = 0;
          const first = this.state !== 'ligado';
          this.setState('ligado', { connections: this.connections + 1, lastError: '' });
          if (first) log.info('celular', 'Túnel ligado: o painel já abre no celular.');
        } else if (parsed.event === 'error') {
          this.setState('erro', { lastError: parsed.message });
          this.wanted = '';
          try { child.kill(); } catch {}
        } else if (parsed.event === 'reconnecting' && this.state === 'ligado') {
          this.setState('ligando', { connections: Math.max(0, this.connections - 1) });
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (error) => {
      this.setState('erro', { lastError: `Não consegui abrir o cloudflared (${error.message}).` });
    });
    child.on('exit', (code) => {
      if (!this.binary) { try { fs.unlinkSync(PATHS.tunnelPid); } catch {} }
      if (this.child !== child) return;
      this.child = null;
      if (!this.wanted) {
        if (this.state !== 'erro') this.setState('desligado', { connections: 0 });
        return;
      }
      // Caiu sozinho: liga de novo, esperando cada vez mais (até 2 min).
      this.failures++;
      const wait = Math.min(120_000, 3000 * 2 ** Math.min(this.failures, 5));
      log.warn('celular', `O túnel parou (código ${code ?? '?'}). Ligando de novo em ${Math.round(wait / 1000)}s.`);
      this.setState('ligando', { connections: 0 });
      this.restartTimer = setTimeout(() => this.start(), wait);
    });
  }

  stop(updateState = true) {
    clearTimeout(this.restartTimer);
    const child = this.child;
    this.child = null;
    if (child) {
      try { child.kill(); } catch {}
    }
    if (updateState) this.wanted = '';
    if (this.state !== 'erro' || updateState) this.setState('desligado', { connections: 0 });
  }

  restart() {
    this.wanted = '';
    this.apply();
  }

  // Instala o cloudflared pelo winget (Windows). Só pelo PC.
  install() {
    if (process.platform !== 'win32') return Promise.reject(new Error('A instalação automática é só no Windows.'));
    if (this.installing) return Promise.reject(new Error('Já está instalando, espera um pouco.'));
    this.installing = true;
    this.emit('status', this.status());
    log.info('celular', 'Instalando o cloudflared pelo winget...');
    return new Promise((resolve, reject) => {
      execFile('winget', ['install', '-e', '--id', 'Cloudflare.cloudflared', '--silent', '--accept-source-agreements', '--accept-package-agreements'],
        { windowsHide: true, timeout: 10 * 60_000 },
        (error) => {
          this.installing = false;
          const ok = Boolean(findCloudflared());
          this.emit('status', this.status());
          if (ok) {
            log.info('celular', 'cloudflared instalado.');
            this.restart();
            resolve(true);
          } else {
            reject(new Error(`Não consegui instalar o cloudflared${error ? ` (${error.message})` : ''}. Instale pelo site da Cloudflare e clique em Ligar.`));
          }
        });
    });
  }
}
