import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('la migración 006 conserva cualquier préstamo y registra eliminación auditada', async () => {
  const sql = await readFile(new URL('../../../database/migrations/006_soft_delete_legacy_loans.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS eliminado_at timestamptz/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS eliminado_por uuid REFERENCES usuarios/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS motivo_eliminacion text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS estado_antes_eliminacion estado_prestamo/);
  assert.doesNotMatch(sql, /DELETE FROM prestamos/i);
  assert.doesNotMatch(sql, /es_heredado/i);
});

test('la migración 007 identifica ajustes de préstamo en fondos y finanzas', async () => {
  const sql = await readFile(new URL('../../../database/migrations/007_flexible_loan_adjustments.sql', import.meta.url), 'utf8');
  assert.match(sql, /tipo_movimiento_custodia ADD VALUE IF NOT EXISTS 'AJUSTE_PRESTAMO'/);
  assert.match(sql, /tipo_movimiento_financiero ADD VALUE IF NOT EXISTS 'AJUSTE_PRESTAMO'/);
});
