import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const migration = new URL('../../../database/migrations/011_financial_categories_and_negative_funds.sql', import.meta.url);
test('migración 011 preserva historial y habilita rubros, extras, códigos nulos y fondos negativos', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /ALTER COLUMN codigo DROP NOT NULL/);
  assert.match(sql, /WHERE codigo IS NOT NULL/);
  assert.match(sql, /gastos ADD COLUMN rubro/);
  assert.match(sql, /pagos_prestamo ADD COLUMN monto_extra/);
  assert.match(sql, /distribuciones_utilidades ADD COLUMN rubro/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS custodias_saldo_no_negativo/);
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE/);
});
