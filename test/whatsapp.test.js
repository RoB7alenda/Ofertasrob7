import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE, explainCloseCode, pickWaVersion, validPhone, versionOption } from '../src/whatsapp.js';

test('usa a versão atual do WhatsApp Web; se falhar, a da biblioteca', async () => {
  const web = async () => ({ version: [2, 3000, 1054691497], isLatest: true });
  const lib = async () => ({ version: [2, 3000, 1043857760], isLatest: true });
  const broken = async () => { throw new Error('sem internet'); };
  const stale = async () => ({ version: [2, 3000, 1], isLatest: false });
  assert.deepEqual((await pickWaVersion([web, lib])).version, [2, 3000, 1054691497]);
  assert.deepEqual((await pickWaVersion([broken, lib])).version, [2, 3000, 1043857760]);
  assert.deepEqual((await pickWaVersion([stale, lib])).version, [2, 3000, 1043857760]);
  assert.equal((await pickWaVersion([broken, stale])).version, undefined);
});

// Sem isso a conexão morre com "Cannot read properties of undefined (reading 'join')"
// e o programa fica preso no QR.
test('sem versão confirmada, não manda o campo version pra biblioteca', () => {
  assert.deepEqual(versionOption([2, 3000, 1054691497]), { version: [2, 3000, 1054691497] });
  assert.deepEqual(versionOption(undefined), {});
  assert.deepEqual(versionOption([]), {});
  assert.deepEqual(versionOption([2, 3000]), {});
  assert.deepEqual(versionOption(['2', '3000', '1']), {});
});

test('nome do aparelho no celular', () => {
  assert.equal(DEVICE[0], 'Ofertas RoB7');
  assert.equal(DEVICE[1], 'Chrome');
});

test('número pra conectar pelo código', () => {
  assert.equal(validPhone('55 (11) 94033-8222'), '5511940338222');
  assert.equal(validPhone('551140338222'), '551140338222');
  assert.equal(validPhone('11940338222'), '');
  assert.equal(validPhone('abc'), '');
});

test('explica os erros do pareamento', () => {
  assert.match(explainCloseCode(428), /passkey/);
  assert.equal(explainCloseCode(408), '');
});
