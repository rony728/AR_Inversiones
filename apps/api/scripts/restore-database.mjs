import 'dotenv/config';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const backupArg = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
if (!backupArg) throw new Error('Uso: npm run restore -- RUTA.dump --confirm [--dry-run]');
if (!args.includes('--confirm')) throw new Error('La restauración reemplaza datos. Repita el comando con --confirm.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria para restaurar.');
const backup = resolve(backupArg);
await access(backup);
let integrity = 'sin manifiesto';
try {
  const manifest = JSON.parse(await readFile(`${backup}.manifest.json`, 'utf8'));
  const hash = createHash('sha256').update(await readFile(backup)).digest('hex');
  if (manifest.sha256 !== hash) throw new Error('El SHA-256 no coincide con el manifiesto.');
  integrity = 'SHA-256 validado';
} catch (error) { if (String(error).includes('SHA-256')) throw error; }
if (dryRun) { console.log(JSON.stringify({ restore: backup, integrity, action: 'validación únicamente; no se modificó la base' }, null, 2)); process.exit(0); }
const pgRestore = process.env.PG_RESTORE_PATH || 'pg_restore';
const exitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(pgRestore, ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--dbname', process.env.DATABASE_URL, backup], { stdio: 'inherit', env: process.env });
  child.once('error', reject); child.once('close', resolveExit);
});
if (exitCode !== 0) throw new Error(`pg_restore terminó con código ${exitCode}.`);
console.log(JSON.stringify({ restored: backup, integrity }, null, 2));
