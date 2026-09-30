import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { AppError } from '../src/lib/errors.js';
import {
  historicalInventoryValuationInput,
  valueHistoricalInventory,
} from '../src/modules/operations/historical-inventory-valuation-service.js';
import { registerSale, saleInput } from '../src/modules/operations/inventory-service.js';

type QueryCall = { text: string; values: unknown[] };
const productId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const valuationId = '33333333-3333-4333-8333-333333333333';

function input(overrides: Record<string, unknown> = {}) {
  return historicalInventoryValuationInput.parse({
    productoId: productId,
    existenciaEsperada: 4,
    costoUnitario: 125.25,
    fechaReferencia: '2026-09-20',
    motivo: 'Inventario adquirido antes de producción',
    ...overrides,
  });
}

function valuationClient(options: { stock?: number; cost?: number; failOn?: string } = {}) {
  const calls: QueryCall[] = [];
  const state = { stock: options.stock ?? 4, cost: options.cost ?? 0 };
  const client = {
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      if (options.failOn && text.includes(options.failOn)) throw new Error('forced failure');
      if (text.includes('FROM productos p') && text.includes('FOR UPDATE OF i')) {
        return { rows: [{ id: productId, nombre: 'Producto heredado', existencia: state.stock, costo_promedio_unitario: String(state.cost) }] };
      }
      if (text.includes('INSERT INTO valorizaciones_inventario_historico')) return { rows: [{ id: valuationId }] };
      if (text.startsWith('UPDATE inventario SET costo_promedio_unitario')) state.cost = Number(values[0]);
      if (text.includes('INSERT INTO ventas')) return { rows: [{ id: '44444444-4444-4444-8444-444444444444' }] };
      if (text.includes('SELECT id,nombre FROM productos')) return { rows: [{ id: productId, nombre: 'Producto heredado' }] };
      if (text.includes('SELECT saldo_actual FROM custodias')) return { rows: [{ saldo_actual: '1000' }] };
      if (text.includes('SELECT existencia,costo_promedio_unitario FROM inventario')) return { rows: [{ existencia: state.stock, costo_promedio_unitario: String(state.cost) }] };
      if (text.startsWith('UPDATE inventario SET existencia=')) state.stock = Number(values[0]);
      return { rows: [] };
    },
  } as unknown as PoolClient;
  return { client, calls, state };
}

test('valoriza inventario histórico sin cambiar existencia ni generar compra o movimientos financieros', async () => {
  const { client, calls, state } = valuationClient();
  const result = await valueHistoricalInventory(client, input(), userId);

  assert.deepEqual(result, {
    id: valuationId,
    productoId: productId,
    producto: 'Producto heredado',
    existencia: 4,
    costoAnterior: '0.0000',
    costoNuevo: '125.2500',
    fechaReferencia: '2026-09-20',
  });
  assert.equal(state.stock, 4);
  assert.equal(state.cost, 125.25);
  assert.deepEqual(
    calls.find((call) => call.text.startsWith('UPDATE inventario SET costo_promedio_unitario'))?.values,
    [125.25, productId],
  );
  const movement = calls.find((call) => call.text.includes('INSERT INTO movimientos_inventario'));
  assert.deepEqual(movement?.values, [productId, 4, 125.25, valuationId, userId]);
  assert.match(movement?.text ?? '', /'VALORIZACION_HISTORICA',0,\$2,\$2/);
  assert.equal(calls.some((call) => /compras|custodias|movimientos_financieros/i.test(call.text)), false);
  assert.equal(calls.some((call) => call.text.includes('INSERT INTO auditoria_sistema')), true);
});

test('rechaza existencia cero, inventario cambiado y un producto ya valorizado', async () => {
  for (const [options, expectedInput, code] of [
    [{ stock: 0 }, {}, 'HISTORICAL_STOCK_REQUIRED'],
    [{ stock: 5 }, {}, 'STALE_INVENTORY'],
    [{ cost: 25 }, {}, 'HISTORICAL_COST_ALREADY_SET'],
  ] as const) {
    const { client, calls } = valuationClient(options);
    await assert.rejects(valueHistoricalInventory(client, input(expectedInput)), (error: unknown) => error instanceof AppError && error.code === code);
    assert.equal(calls.some((call) => call.text.startsWith('UPDATE inventario')), false);
  }
});

test('valida costo positivo, existencia esperada entera, fecha y motivo', () => {
  for (const overrides of [
    { costoUnitario: 0 },
    { costoUnitario: -1 },
    { existenciaEsperada: 1.5 },
    { fechaReferencia: 'ayer' },
    { motivo: '  ' },
  ]) {
    assert.throws(() => input(overrides));
  }
});

test('propaga fallos para que la transacción externa haga rollback', async () => {
  const { client, calls } = valuationClient({ failOn: 'INSERT INTO movimientos_inventario' });
  await assert.rejects(valueHistoricalInventory(client, input(), userId), /forced failure/);
  assert.equal(calls.some((call) => call.text.includes('INSERT INTO auditoria_sistema')), false);
});

test('una venta posterior usa el costo valorizado y calcula costo total y utilidad', async () => {
  const { client, calls, state } = valuationClient();
  await valueHistoricalInventory(client, input(), userId);
  const sale = saleInput.parse({
    fecha: '2026-09-21T16:00:00.000Z',
    items: [{
      productoId: productId,
      socioId: '55555555-5555-4555-8555-555555555555',
      custodiaId: '66666666-6666-4666-8666-666666666666',
      cantidad: 2,
      precioUnitario: 200,
    }],
  });
  const result = await registerSale(client, sale, userId);

  assert.equal(state.stock, 2);
  assert.deepEqual(result, {
    id: '44444444-4444-4444-8444-444444444444',
    total: '400.00',
    ganancia: '149.50',
  });
  const detail = calls.find((call) => call.text.includes('INSERT INTO detalle_ventas'));
  assert.equal(detail?.values[6], 125.25);
  assert.equal(detail?.values[8], '250.50');
  assert.equal(detail?.values[9], '149.50');
});
