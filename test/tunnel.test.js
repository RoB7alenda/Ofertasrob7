import { tempFile } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JsonFile } from '../src/store.js';
import { DEFAULT_SETTINGS } from '../src/config.js';
import { extractToken, parseCloudflaredLine, TunnelService } from '../src/tunnel.js';
import { applySettingsPatch, publicSettings } from '../src/settings-patch.js';

const TOKEN = `eyJ${'a'.repeat(120)}`;

test('pega o token mesmo colando o comando inteiro', () => {
  assert.equal(extractToken(`cloudflared.exe service install ${TOKEN}`), TOKEN);
  assert.equal(extractToken(TOKEN), TOKEN);
  assert.equal(extractToken('qualquer coisa'), '');
});

test('entende o que o cloudflared escreve', () => {
  assert.equal(parseCloudflaredLine('2026-11-15T22:00:00Z INF Registered tunnel connection connIndex=0').event, 'connected');
  assert.equal(parseCloudflaredLine('ERR Provided Tunnel token is not valid.').event, 'error');
  assert.equal(parseCloudflaredLine('INF Starting tunnel'), null);
});

test('configurações do túnel: valida e esconde o token', () => {
  const s = structuredClone(DEFAULT_SETTINGS);
  assert.throws(() => applySettingsPatch(s, { tunnel: { enabled: true } }), /token/);
  assert.throws(() => applySettingsPatch(s, { tunnel: { token: 'abc' } }), /eyJ/);
  assert.throws(() => applySettingsPatch(s, { tunnel: { publicUrl: 'http://x' } }), /https/);
  const next = applySettingsPatch(s, { tunnel: { token: `comando ${TOKEN}`, publicUrl: 'https://ofertas.exemplo.com.br/', enabled: true } });
  assert.equal(next.tunnel.token, TOKEN);
  assert.equal(next.tunnel.publicUrl, 'https://ofertas.exemplo.com.br');
  const pub = publicSettings(next);
  assert.equal(pub.tunnel.hasToken, true);
  assert.equal(pub.tunnel.token, undefined);
  assert.equal(applySettingsPatch(next, { tunnel: { clear: true } }).tunnel.enabled, false);
});

function fakeBinary(lines, { stay = true } = {}) {
  const file = tempFile('fake-cloudflared.mjs');
  fs.writeFileSync(file, `
    if (!process.env.TUNNEL_TOKEN) { console.error('sem token'); process.exit(2); }
    ${lines.map((l) => `console.error(${JSON.stringify(l)});`).join('\n')}
    ${stay ? 'setInterval(() => {}, 1000);' : 'process.exit(1);'}
  `);
  return { cmd: process.execPath, args: [file] };
}

const waitFor = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};

test('liga o túnel com o token e desliga junto', async () => {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  settings.update((s) => { s.tunnel = { enabled: true, token: TOKEN, publicUrl: '' }; });
  const tunnel = new TunnelService({ settings, binary: fakeBinary(['INF Registered tunnel connection connIndex=0']) });
  tunnel.apply();
  assert.ok(await waitFor(() => tunnel.state === 'ligado'), `estado: ${tunnel.state} ${tunnel.lastError}`);
  settings.update((s) => { s.tunnel.enabled = false; });
  tunnel.apply();
  assert.ok(await waitFor(() => tunnel.state === 'desligado'));
  assert.equal(tunnel.child, null);
});

test('token recusado vira erro e não fica tentando', async () => {
  const settings = new JsonFile(tempFile('settings.json'), DEFAULT_SETTINGS);
  settings.update((s) => { s.tunnel = { enabled: true, token: TOKEN, publicUrl: '' }; });
  const tunnel = new TunnelService({ settings, binary: fakeBinary(['ERR Provided Tunnel token is not valid.']) });
  tunnel.apply();
  assert.ok(await waitFor(() => tunnel.state === 'erro'));
  assert.match(tunnel.lastError, /token/);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(tunnel.state, 'erro');
  tunnel.stop();
});
