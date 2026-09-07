import 'dotenv/config';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const option = (flag) => args[args.indexOf(flag) + 1];
const format = option('--format') ?? 'json';
if (!['json', 'csv'].includes(format)) throw new Error('El formato debe ser json o csv.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria para exportar.');
const requested = option('--tables')?.split(',').map((name) => name.trim()).filter(Boolean);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(option('--output') ?? `../../database/exports/ar-inversiones-${timestamp}.${format}`);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const safeRow = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key === 'password_hash' ? '[REDACTED]' : value]));

try {
  const found = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const allTables = found.rows.map((row) => row.tablename);
  const tables = requested ?? allTables;
  for (const table of tables) if (!allTables.includes(table)) throw new Error(`Tabla no exportable: ${table}`);
  const data = {};
  for (const table of tables) data[table] = (await pool.query(`SELECT * FROM \"${table}\"`)).rows.map(safeRow);
  if (format === 'json') {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify({ exportedAt: new Date().toISOString(), tables: data }, null, 2)}\n`, { mode: 0o600 });
    await chmod(output, 0o600);
    console.log(JSON.stringify({ export: output, tables }, null, 2));
  } else {
    await mkdir(output, { recursive: true });
    for (const [table, rows] of Object.entries(data)) {
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const csv = [columns.map(quote).join(','), ...rows.map((row) => columns.map((column) => quote(row[column])).join(','))].join('\n');
      const file = resolve(output, `${table}.csv`);
      await writeFile(file, `${csv}\n`, { mode: 0o600 }); await chmod(file, 0o600);
    }
    console.log(JSON.stringify({ exportDirectory: output, tables }, null, 2));
  }
} finally { await pool.end(); }
