// Confere a sintaxe de todos os arquivos .js do projeto (node --check).
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['src', 'public', 'test', 'scripts'];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(m?js)$/.test(name)) files.push(full);
  }
};
for (const root of roots) { try { walk(root); } catch {} }
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed++;
    console.error(`ERRO em ${file}\n${error.stderr?.toString() || error.message}`);
  }
}
console.log(`${files.length - failed}/${files.length} arquivos OK`);
process.exit(failed ? 1 : 0);
