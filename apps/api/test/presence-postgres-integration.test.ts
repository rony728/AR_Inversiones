import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { listActiveUsers, recordHeartbeat } from '../src/modules/presence/presence-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL con migración 010 excluye presencia expirada e incluye dos usuarios activos', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl }); const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const table = await client.query<{ name: string | null }>("SELECT to_regclass('public.presencia_usuarios')::text AS name");
    assert.equal(table.rows[0].name, 'presencia_usuarios', 'Aplica primero la migración 010 en la base de pruebas.');
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) await client.query('INSERT INTO usuarios (id,nombre,usuario,password_hash) VALUES ($1,$2,$3,$4)', [id, `Presencia ${index}`, `presencia-${id}`, 'hash-prueba']);
    const now = new Date('2026-09-12T12:00:00.000Z');
    await recordHeartbeat(client, ids[0], now); await recordHeartbeat(client, ids[1], new Date(now.getTime() - 119_000)); await recordHeartbeat(client, ids[2], new Date(now.getTime() - 121_000));
    const active = await listActiveUsers(client, now);
    assert.deepEqual(active.map((user) => user.id).sort(), ids.slice(0, 2).sort());
    assert.equal(active.some((user) => user.id === ids[2]), false);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined); client.release(); await pool.end();
  }
});
