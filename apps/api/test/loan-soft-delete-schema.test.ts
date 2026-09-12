import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('la migración conserva el préstamo y registra eliminación auditada', async () => {
  const sql = await readFile(new URL('../../../database/migrations/006_soft_delete_legacy_loans.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS eliminado_at timestamptz/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS eliminado_por uuid REFERENCES usuarios/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS motivo_eliminacion text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS estado_antes_eliminacion estado_prestamo/);
  assert.doesNotMatch(sql, /DELETE FROM prestamos/i);
});
