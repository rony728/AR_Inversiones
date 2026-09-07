import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const valueFor = (flag) => args[args.indexOf(flag) + 1];
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const defaultFile = resolve(process.cwd(), '../../database/backups', `ar-inversiones-${timestamp}.dump`);
const output = resolve(valueFor('--output') ?? defaultFile);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria para crear un respaldo.');
await mkdir(dirname(output), { recursive: true });
const pgDump = process.env.PG_DUMP_PATH || 'pg_dump';
const exitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(pgDump, ['--format=custom', '--no-owner', '--no-privileges', '--file', output, process.env.DATABASE_URL], { stdio: 'inherit', env: process.env });
  child.once('error', reject); child.once('close', resolveExit);
});
if (exitCode !== 0) throw new Error(`pg_dump terminó con código ${exitCode}.`);
await chmod(output, 0o600);
const file = await readFile(output);
const fileStat = await stat(output);
const manifest = { id: randomUUID(), createdAt: new Date().toISOString(), file: output.split(/[\\/]/).pop(), bytes: fileStat.size, sha256: createHash('sha256').update(file).digest('hex'), format: 'pg_dump custom' };
const manifestPath = `${output}.manifest.json`;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ backup: output, manifest: manifestPath, sha256: manifest.sha256 }, null, 2));
