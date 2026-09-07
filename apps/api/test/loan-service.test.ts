import assert from 'node:assert/strict';
import test from 'node:test';
import { accrueLoanInterest, addMonth } from '../src/modules/operations/loan-service.js';
import { money, toCents } from '../src/modules/operations/inventory-service.js';

test('calcula el interés mensual simple de L 5,000 al 15%', () => {
  assert.equal(money(toCents(5000 * 0.15)), '750.00');
});

test('un pago de L 1,750 aplica L 750 a interés y L 1,000 a capital', () => {
  const payment = toCents(1750); const interest = toCents(750);
  assert.equal(money(payment - interest), '1000.00');
  assert.equal(money(toCents(5000) - (payment - interest)), '4000.00');
});

test('conserva un día válido al avanzar meses', () => {
  assert.equal(addMonth('2026-01-31'), '2026-02-28');
  assert.equal(addMonth('2028-01-31'), '2028-02-29');
});

test('un préstamo heredado no acumula intereses anteriores a la fecha de migración', async () => {
  const statements: string[] = [];
  const client = { query: async (sql: string) => { statements.push(sql); return { rows: [], rowCount: 0 }; } };
  const result = await accrueLoanInterest(client as never, {
    id: '00000000-0000-4000-8000-000000000001', socio_id: '00000000-0000-4000-8000-000000000002', custodia_id: '00000000-0000-4000-8000-000000000003',
    capital_pendiente: '2000.00', tasa_mensual: '15.0000', fecha_proximo_pago: '2024-05-24', calcular_interes_desde: '2026-09-06', estado: 'ACTIVO'
  }, '2026-09-06');
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO intereses_prestamo')), false);
  assert.equal(result.fecha_proximo_pago, '2026-09-24');
});
