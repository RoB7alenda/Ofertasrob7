// Banco local em arquivo JSON. Simples, sem instalar nada, fácil de copiar (backup = copiar a pasta data).
// Toda gravação é atômica: grava num arquivo temporário e depois troca, então nunca corrompe pela metade.

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    // Arquivo estragado: guarda uma cópia pra não perder e começa do backup.
    const broken = `${file}.estragado-${Date.now()}`;
    try { fs.copyFileSync(file, broken); } catch {}
    try {
      return JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
    } catch {
      return fallback;
    }
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try { if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`); } catch {}
  fs.renameSync(tmp, file);
}

// Quantas cópias de segurança guardar (as mais velhas vão sendo apagadas).
const MAX_BACKUPS = 10;

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

// Junta os padrões com o que está salvo, sem apagar campos novos que vierem em versões futuras.
export function mergeDefaults(defaults, saved) {
  if (!isPlainObject(defaults)) return saved === undefined ? defaults : saved;
  const out = {};
  const source = isPlainObject(saved) ? saved : {};
  for (const key of Object.keys(defaults)) {
    out[key] = isPlainObject(defaults[key])
      ? mergeDefaults(defaults[key], source[key])
      : (source[key] === undefined ? structuredClone(defaults[key]) : source[key]);
  }
  for (const key of Object.keys(source)) if (!(key in out)) out[key] = source[key];
  return out;
}

export class JsonFile extends EventEmitter {
  constructor(file, defaults) {
    super();
    this.file = file;
    this.data = mergeDefaults(defaults, readJson(file, {}));
    this.timer = null;
    this.saveNow();
  }

  get() {
    return this.data;
  }

  update(mutator) {
    const result = mutator(this.data);
    this.scheduleSave();
    this.emit('change', this.data);
    return result;
  }

  scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveNow();
    }, 150);
  }

  saveNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    writeJsonAtomic(this.file, this.data);
  }

  // Cópia datada antes de uma mudança grande (ex.: intercalar a fila toda).
  // Fica na mesma pasta, assim: db-backup-2026-11-23-0712-intercalar-moda.json
  // Devolve o caminho da cópia. Se não conseguir copiar, dá erro (quem chamou não deve mexer nos dados).
  backup(label = '') {
    this.saveNow();
    const dir = path.dirname(this.file);
    const base = path.basename(this.file, path.extname(this.file));
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safe = String(label).replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const file = path.join(dir, `${base}-backup-${stamp}${safe ? `-${safe}` : ''}.json`);
    fs.copyFileSync(this.file, file);
    this.cleanOldBackups(dir, base);
    return file;
  }

  cleanOldBackups(dir, base) {
    try {
      const list = fs.readdirSync(dir).filter((name) => name.startsWith(`${base}-backup-`) && name.endsWith('.json')).sort();
      for (const old of list.slice(0, Math.max(0, list.length - MAX_BACKUPS))) fs.rmSync(path.join(dir, old), { force: true });
    } catch {}
  }
}
