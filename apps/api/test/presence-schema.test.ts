import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('migración 010 crea presencia temporal 1:1 ligada a usuarios', async () => {
  const sql = await readFile(new URL('../../../database/migrations/010_user_presence.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE presencia_usuarios/i);
  assert.match(sql, /usuario_id uuid PRIMARY KEY REFERENCES usuarios\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /ultima_actividad timestamptz NOT NULL DEFAULT now\(\)/i);
  assert.doesNotMatch(sql, /auditoria_sistema|password|direccion_ip/i);
});
