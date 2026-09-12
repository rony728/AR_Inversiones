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

test('la migración 008 conserva transferencias históricas y formaliza ajustes de fondos', async () => {
  const sql = await readFile(new URL('../../../database/migrations/008_cross_partner_transfers_and_fund_adjustments.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN socio_destino_id uuid REFERENCES socios/);
  assert.match(sql, /UPDATE transferencias_custodia/);
  assert.match(sql, /CREATE TABLE ajustes_fondo/);
  assert.match(sql, /AJUSTE_MANUAL_FONDO/);
  assert.match(sql, /diferencia <> 0 AND saldo_nuevo = saldo_anterior \+ diferencia/);
  assert.doesNotMatch(sql, /movimientos_financieros/);
  assert.doesNotMatch(sql, /DELETE FROM/);
});
