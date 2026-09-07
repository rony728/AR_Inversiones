import assert from 'node:assert/strict';
import test from 'node:test';
import { money, toCents, weightedAverage } from '../src/modules/operations/inventory-service.js';

test('calcula costo promedio ponderado sin redondear el saldo monetario', () => {
  assert.equal(weightedAverage(2, 300, 3, 500), 420);
  assert.equal(money(toCents(2 * 420)), '840.00');
});

test('mantiene dos decimales para movimientos de custodia', () => {
  assert.equal(money(toCents(500) - toCents(300)), '200.00');
});

test('conserva la ganancia de una venta de L 500 con costo L 300', () => {
  const ingreso = toCents(500);
  const costo = toCents(300);
  assert.equal(money(ingreso - costo), '200.00');
});
