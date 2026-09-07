import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { registerSale, saleFinancialDate, saleInput, saleLineAmounts } from '../src/modules/operations/inventory-service.js';

type QueryCall = { text: string; values: unknown[] };

function saleClient(options: { stock?: number; cost?: number; balance?: number; productName?: string } = {}) {
  const calls: QueryCall[] = [];
  const client = {
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      if (text.includes('INSERT INTO ventas')) return { rows: [{ id: '44444444-4444-4444-8444-444444444444' }] };
      if (text.includes('SELECT id,nombre FROM productos')) return { rows: [{ id: values[0], nombre: options.productName ?? 'Producto prueba' }] };
      if (text.includes('SELECT saldo_actual FROM custodias')) return { rows: [{ saldo_actual: String(options.balance ?? 1000) }] };
      if (text.includes('SELECT existencia,costo_promedio_unitario FROM inventario')) return { rows: [{ existencia: options.stock ?? 10, costo_promedio_unitario: String(options.cost ?? 100) }] };
      return { rows: [] };
    }
  } as unknown as PoolClient;
  return { client, calls };
}

const sale = (overrides: Record<string, unknown> = {}) => saleInput.parse({
  fecha: '2026-08-15T12:00:00.000Z',
  observaciones: 'Venta de prueba',
  items: [{
    productoId: '11111111-1111-4111-8111-111111111111',
    socioId: '22222222-2222-4222-8222-222222222222',
    custodiaId: '33333333-3333-4333-8333-333333333333',
    cantidad: 2,
    precioUnitario: 150,
    ...overrides
  }]
});

test('calcula subtotal, costo y ganancia positiva usando centavos', () => {
  assert.deepEqual(saleLineAmounts(2, 150, 100), {
    priceUnitCents: 15000,
    costUnitCents: 10000,
    subtotalCents: 30000,
    costCents: 20000,
    profitCents: 10000
  });
});

test('permite vender exactamente al costo con ganancia cero', async () => {
  const { client } = saleClient({ cost: 100.004 });
  const result = await registerSale(client, sale({ precioUnitario: 100 }));
  assert.deepEqual(result, { id: '44444444-4444-4444-8444-444444444444', total: '200.00', ganancia: '0.00' });
});

test('rechaza una venta por debajo del costo promedio bloqueado', async () => {
  const { client, calls } = saleClient({ cost: 100.004, productName: 'Cámara X' });
  await assert.rejects(registerSale(client, sale({ precioUnitario: 99.99 })), (error: unknown) => {
    const appError = error as { code?: string; message?: string };
    return appError.code === 'SALE_BELOW_COST' && Boolean(appError.message?.includes('Cámara X'));
  });
  assert.equal(calls.some((call) => call.text.startsWith('UPDATE inventario')), false);
});

test('rechaza una cantidad mayor que el inventario bloqueado', async () => {
  const { client } = saleClient({ stock: 1 });
  await assert.rejects(registerSale(client, sale()), (error: unknown) => (error as { code?: string }).code === 'INSUFFICIENT_STOCK');
});

test('rechaza cantidades decimales, cero o negativas', () => {
  for (const cantidad of [1.5, 0, -1]) assert.throws(() => sale({ cantidad }));
});

test('rechaza productos repetidos antes de consultar la base de datos', async () => {
  const input = saleInput.parse({
    fecha: '2026-08-15T12:00:00.000Z',
    items: [
      sale().items[0],
      { ...sale().items[0], socioId: '55555555-5555-4555-8555-555555555555', custodiaId: '66666666-6666-4666-8666-666666666666' }
    ]
  });
  const { client, calls } = saleClient();
  await assert.rejects(registerSale(client, input), (error: unknown) => (error as { code?: string }).code === 'DUPLICATE_ITEM');
  assert.equal(calls.length, 0);
});

test('disminuye inventario, aumenta el fondo y usa la fecha seleccionada', async () => {
  const { client, calls } = saleClient({ stock: 10, cost: 100, balance: 1000 });
  const result = await registerSale(client, sale());
  assert.deepEqual(result, { id: '44444444-4444-4444-8444-444444444444', total: '300.00', ganancia: '100.00' });

  const inventoryUpdate = calls.find((call) => call.text.startsWith('UPDATE inventario SET'));
  assert.deepEqual(inventoryUpdate?.values.slice(0, 2), [8, '11111111-1111-4111-8111-111111111111']);
  const custodyUpdate = calls.find((call) => call.text.startsWith('UPDATE custodias SET'));
  assert.deepEqual(custodyUpdate?.values, ['1300.00', '33333333-3333-4333-8333-333333333333']);
  const financialMovement = calls.find((call) => call.text.includes('INSERT INTO movimientos_financieros'));
  assert.equal(financialMovement?.values[0], '2026-08-15');
  assert.equal(financialMovement?.values[1], '300.00');
  assert.equal(financialMovement?.values[5], '200.00');
  assert.equal(financialMovement?.text.includes('CURRENT_DATE'), false);
  assert.equal(calls.some((call) => call.text.includes('INSERT INTO auditoria_sistema')), true);
});

test('conserva hasta 2,000 caracteres de observaciones de venta', () => {
  const base = { ...sale(), observaciones: 'a'.repeat(2000) };
  assert.equal(saleInput.parse(base).observaciones?.length, 2000);
  assert.throws(() => saleInput.parse({ ...base, observaciones: 'a'.repeat(2001) }));
});

test('deriva la fecha financiera sin aplicar la zona horaria del servidor', () => {
  assert.equal(saleFinancialDate('2026-08-15T23:30:00.000-06:00'), '2026-08-15');
});
