import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { listActiveUsers, PRESENCE_ACTIVE_WINDOW_MS, recordHeartbeat } from '../src/modules/presence/presence-service.js';

function fakeClient(rows: Array<{ id: string; nombre: string }> = []) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = { query: async (sql: string, values: unknown[] = []) => { calls.push({ sql, values }); return { rows }; } } as unknown as PoolClient;
  return { client, calls };
}

test('heartbeat actualiza únicamente la presencia del usuario autenticado sin auditoría', async () => {
  const db = fakeClient(); const at = new Date('2026-09-12T12:00:00.000Z');
  await recordHeartbeat(db.client, '11111111-1111-4111-8111-111111111111', at);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /INSERT INTO presencia_usuarios/);
  assert.match(db.calls[0].sql, /ON CONFLICT \(usuario_id\)/);
  assert.deepEqual(db.calls[0].values, ['11111111-1111-4111-8111-111111111111', at]);
  assert.equal(db.calls.some((call) => call.sql.includes('auditoria_sistema')), false);
});

test('usuarios activos usa una ventana de dos minutos y solo devuelve datos mínimos', async () => {
  const db = fakeClient([{ id: '1', nombre: 'Brian' }, { id: '2', nombre: 'Rony' }]);
  const now = new Date('2026-09-12T12:02:30.000Z');
  const users = await listActiveUsers(db.client, now);
  assert.deepEqual(users, [{ id: '1', nombre: 'Brian' }, { id: '2', nombre: 'Rony' }]);
  assert.equal((db.calls[0].values[0] as Date).getTime(), now.getTime() - PRESENCE_ACTIVE_WINDOW_MS);
  assert.match(db.calls[0].sql, /p\.ultima_actividad >= \$1/);
  assert.match(db.calls[0].sql, /u\.activo = true/);
  assert.doesNotMatch(db.calls[0].sql, /password|hash|usuario,/i);
});
