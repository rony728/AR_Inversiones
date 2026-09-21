import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = new URL('../../../database/migrations/012_allow_negative_fund_adjustments.sql', import.meta.url);

test('migración 012 elimina únicamente el bloqueo residual de saldos negativos en ajustes', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /ALTER TABLE ajustes_fondo/i);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS ajustes_fondo_saldos_no_negativos/i);
  assert.doesNotMatch(sql, /DROP CONSTRAINT IF EXISTS ajustes_fondo_diferencia_valida/i);
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE|UPDATE ajustes_fondo/i);
});
