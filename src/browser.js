// Navegador invisível (Chrome do próprio PC, sem janela) usado pra ler produtos e pro agente RoB7.
// Usa um perfil separado (data/navegador-perfil): você entra nas contas UMA vez pela janela de login
// e depois tudo roda escondido, sem abrir aba nem janela na sua frente.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { PATHS } from './config.js';
import { log } from './log.js';

let context = null;
let mode = null; // 'invisivel' | 'janela'
let idleTimer = null;
let chain = Promise.resolve();
let lastError = '';

const CANDIDATES = () => {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  return [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
};

export function findChrome(custom = '') {
  if (custom && fs.existsSync(custom)) return custom;
  return CANDIDATES().find((file) => fs.existsSync(file)) || '';
}

function chromeMajor(executable) {
  try {
    const dir = path.dirname(executable);
    const version = fs.readdirSync(dir).find((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name));
    if (version) return version.split('.')[0];
  } catch {}
  return '131';
}

let settingsRef = () => ({});
export function configureBrowser(getSettings) {
  settingsRef = getSettings;
}

async function closeContext() {
  clearTimeout(idleTimer);
  idleTimer = null;
  const current = context;
  context = null;
  mode = null;
  if (current) {
    try { await current.close(); } catch {}
  }
}

async function launch(targetMode) {
  const executablePath = findChrome(settingsRef()?.browser?.chromePath || '');
  if (!executablePath) {
    throw new Error('Não achei o Google Chrome neste PC. Instale o Chrome ou informe o caminho em Configurações.');
  }
  fs.mkdirSync(PATHS.browserProfile, { recursive: true });
  const major = chromeMajor(executablePath);
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  const ctx = await chromium.launchPersistentContext(PATHS.browserProfile, {
    executablePath,
    headless: targetMode === 'invisivel',
    viewport: targetMode === 'invisivel' ? { width: 1366, height: 900 } : null,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    userAgent: targetMode === 'invisivel' ? userAgent : undefined,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check']
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  try {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.mercadolivre.com.br' });
  } catch {}
  ctx.on('close', () => {
    if (context === ctx) {
      context = null;
      mode = null;
      log.info('navegador', 'Navegador fechado.');
    }
  });
  context = ctx;
  mode = targetMode;
  lastError = '';
  return ctx;
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  if (mode !== 'invisivel') return;
  idleTimer = setTimeout(() => {
    enqueue(async () => { if (mode === 'invisivel') await closeContext(); }).catch(() => {});
  }, 120_000);
}

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

// Roda uma tarefa numa aba nova do navegador invisível. Uma tarefa por vez (fila).
export function withPage(task, { timeoutMs = 90_000 } = {}) {
  return enqueue(async () => {
    clearTimeout(idleTimer);
    if (!context) await launch('invisivel');
    const page = await context.newPage();
    let timer;
    try {
      return await Promise.race([
        task(page, context),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('O navegador invisível demorou demais.')), timeoutMs);
        })
      ]);
    } catch (error) {
      lastError = error.message;
      throw error;
    } finally {
      clearTimeout(timer);
      try { await page.close(); } catch {}
      scheduleIdleClose();
    }
  });
}

// Abre a janela de login (visível) pra você entrar nas contas das lojas. Só na configuração.
export function openLoginWindow(urls) {
  return enqueue(async () => {
    if (mode !== 'janela') {
      await closeContext();
      await launch('janela');
    }
    const pages = context.pages();
    let first = true;
    for (const url of urls) {
      const page = first && pages[0] ? pages[0] : await context.newPage();
      first = false;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    }
    log.info('navegador', 'Janela de login aberta. Entre nas contas e feche a janela quando terminar.');
    return true;
  });
}

export function browserStatus() {
  const chrome = findChrome(settingsRef()?.browser?.chromePath || '');
  return { chromeFound: Boolean(chrome), chromePath: chrome, open: Boolean(context), mode, lastError };
}

export async function shutdownBrowser() {
  await closeContext();
}
