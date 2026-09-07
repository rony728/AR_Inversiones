import assert from 'node:assert/strict';
import test from 'node:test';
import { money, purchaseInput, registerPurchase, toCents, weightedAverage } from '../src/modules/operations/inventory-service.js';

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

test('acepta hasta 2,000 caracteres de observaciones en una compra', () => {
  const base = {
    socioId: '11111111-1111-4111-8111-111111111111',
    custodiaId: '22222222-2222-4222-8222-222222222222',
    fecha: '2026-09-07',
    items: [{ productoId: '33333333-3333-4333-8333-333333333333', cantidad: 1, costoUnitario: 10 }]
  };
  assert.equal(purchaseInput.parse({ ...base, observaciones: 'a'.repeat(2000) }).observaciones?.length, 2000);
  assert.throws(() => purchaseInput.parse({ ...base, observaciones: 'a'.repeat(2001) }));
});

test('rechaza productos repetidos antes de iniciar escrituras de compra', async () => {
  const input = purchaseInput.parse({
    socioId: '11111111-1111-4111-8111-111111111111',
    custodiaId: '22222222-2222-4222-8222-222222222222',
    fecha: '2026-09-07',
    items: [
      { productoId: '33333333-3333-4333-8333-333333333333', cantidad: 1, costoUnitario: 10 },
      { productoId: '33333333-3333-4333-8333-333333333333', cantidad: 2, costoUnitario: 12 }
    ]
  });
  await assert.rejects(registerPurchase({} as never, input), (error: unknown) => (error as { code?: string }).code === 'DUPLICATE_ITEM');
});
