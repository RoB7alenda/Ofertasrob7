// Registro do que acontece no programa: guarda os últimos eventos na memória (pro painel)
// e grava um arquivo por dia em data/logs.

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PATHS } from './config.js';

const MAX_MEMORY = 400;
const entries = [];
export const logEvents = new EventEmitter();

function dayFile(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return path.join(PATHS.logs, `${y}-${m}-${d}.log`);
}

function write(level, area, message, extra) {
  const at = new Date();
  const entry = { at: at.toISOString(), level, area, message: String(message) };
  if (extra !== undefined) entry.extra = extra instanceof Error ? extra.message : extra;
  entries.push(entry);
  if (entries.length > MAX_MEMORY) entries.splice(0, entries.length - MAX_MEMORY);
  logEvents.emit('entry', entry);
  const line = `${entry.at} [${level}] [${area}] ${entry.message}${entry.extra !== undefined ? ` | ${typeof entry.extra === 'string' ? entry.extra : JSON.stringify(entry.extra)}` : ''}\n`;
  if (process.env.ROB7_QUIET !== '1') process.stdout.write(line);
  try {
    fs.mkdirSync(PATHS.logs, { recursive: true });
    fs.appendFileSync(dayFile(at), line, 'utf8');
  } catch {}
}

export const log = {
  info: (area, message, extra) => write('info', area, message, extra),
  warn: (area, message, extra) => write('aviso', area, message, extra),
  error: (area, message, extra) => write('erro', area, message, extra)
};

export function recentLogs(limit = 200) {
  return entries.slice(-limit);
}
