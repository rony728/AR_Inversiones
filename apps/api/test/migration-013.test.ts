import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = new URL('../../../database/migrations/013_historical_inventory_valuations.sql', import.meta.url);

test('migración 013 agrega valorización histórica sin alterar compras, fondos ni existencias', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /ADD VALUE IF NOT EXISTS 'VALORIZACION_HISTORICA'/i);
  assert.match(sql, /CREATE TABLE valorizaciones_inventario_historico/i);
  assert.match(sql, /producto_id uuid NOT NULL REFERENCES productos/i);
  assert.match(sql, /existencia_verificada integer NOT NULL/i);
  assert.match(sql, /costo_anterior numeric\(14,4\) NOT NULL/i);
  assert.match(sql, /costo_nuevo numeric\(14,4\) NOT NULL/i);
  assert.match(sql, /fecha_referencia date NOT NULL/i);
  assert.match(sql, /created_by uuid REFERENCES usuarios/i);
  assert.match(sql, /existencia_verificada > 0/i);
  assert.match(sql, /costo_anterior >= 0 AND costo_nuevo > 0/i);
  assert.doesNotMatch(sql, /UPDATE inventario|INSERT INTO compras|movimientos_custodia|movimientos_financieros/i);
});
