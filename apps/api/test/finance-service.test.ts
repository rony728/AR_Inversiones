import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/lib/errors.js';
import { distributionShareCents, registerProfitDistribution } from '../src/modules/operations/finance-service.js';
import { money } from '../src/modules/operations/inventory-service.js';
import { calculateAvailableProfitCents, getAvailableProfit } from '../src/modules/operations/profit-service.js';

test('la distribucion divide la utilidad exactamente entre tres socios', () => {
  const share = distributionShareCents(9000);
  assert.equal(money(share), '3000.00');
});

test('la distribucion rechaza montos que no se dividen en centavos exactos', () => {
  assert.throws(() => distributionShareCents(100), (error) => error instanceof AppError && error.code === 'INVALID_DISTRIBUTION_AMOUNT');
});

const profit = (overrides: Partial<{ ganancia_ventas: string; intereses_cobrados: string; recuperaciones_incobrables: string; gastos: string; perdidas_prestamo: string; distribuciones_previas: string }> = {}) => ({ ganancia_ventas: '0', intereses_cobrados: '0', recuperaciones_incobrables: '0', gastos: '0', perdidas_prestamo: '0', distribuciones_previas: '0', ...overrides });

test('la utilidad disponible combina solo resultados reconocidos y descuenta pérdidas y distribuciones', () => {
  assert.equal(money(calculateAvailableProfitCents(profit({ ganancia_ventas: '900', intereses_cobrados: '300', gastos: '150', perdidas_prestamo: '600', recuperaciones_incobrables: '120' }))), '570.00');
  assert.equal(money(calculateAvailableProfitCents(profit({ ganancia_ventas: '900', distribuciones_previas: '300' }))), '600.00');
});

test('capital, desembolsos y tablas históricas no forman parte de la consulta de utilidad', async () => {
  let sql = '';
  const client = { query: async (statement: string) => { sql = statement; return { rows: [profit()] }; } };
  await getAvailableProfit(client as never, '2026-09-30');
  assert.match(sql, /ganancia_total/);
  assert.match(sql, /monto_interes/);
  assert.match(sql, /revertido_at IS NULL/);
  assert.match(sql, /fecha::date<=\$1/);
  assert.doesNotMatch(sql, /monto_capital|DESEMBOLSO_PRESTAMO|ventas_historicas|pagos_intereses_historicos|distribuciones_utilidades_historicas|movimientos_financieros_legacy/);
});

const partners = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
];
const funds = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
];
const distribution = (amount: number) => ({ fecha: '2026-09-30', utilidadTotal: amount, socios: partners.map((socioBeneficiarioId, index) => ({ socioBeneficiarioId, custodiaId: funds[index] })) });

function distributionClient(components: ReturnType<typeof profit>) {
  const calls: string[] = [];
  const client = { query: async (sql: string) => {
    calls.push(sql);
    if (sql.includes('AS distribuciones_previas')) return { rows: [components] };
    if (sql.startsWith('SELECT id FROM socios')) return { rows: partners.map((id) => ({ id })) };
    if (sql.startsWith('SELECT id,socio_id,saldo_actual FROM custodias')) return { rows: funds.map((id, index) => ({ id, socio_id: partners[index], saldo_actual: '1000.00' })) };
    if (sql.startsWith('INSERT INTO distribuciones_utilidades')) return { rows: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }] };
    return { rows: [] };
  } };
  return { client, calls };
}

test('permite distribuir parcialmente, devuelve saldos de utilidad y divide exactamente entre tres', async () => {
  const db = distributionClient(profit({ ganancia_ventas: '900', intereses_cobrados: '300', gastos: '150', perdidas_prestamo: '600', recuperaciones_incobrables: '120' }));
  const result = await registerProfitDistribution(db.client as never, distribution(570));
  assert.deepEqual({ antes: result.utilidadDisponibleAntes, distribuido: result.utilidadTotal, restante: result.utilidadRestante, porSocio: result.montoPorSocio }, { antes: '570.00', distribuido: '570.00', restante: '0.00', porSocio: '190.00' });
  assert.equal(db.calls[0], 'SELECT pg_advisory_xact_lock(1095914054)');
  assert.ok(db.calls.findIndex((sql) => sql.includes('AS distribuciones_previas')) < db.calls.findIndex((sql) => sql.startsWith('INSERT INTO distribuciones_utilidades')));
});

test('rechaza una distribución cuando no existe utilidad disponible', async () => {
  const db = distributionClient(profit({ perdidas_prestamo: '100' }));
  await assert.rejects(registerProfitDistribution(db.client as never, distribution(300)), (error) => error instanceof AppError && error.code === 'NO_AVAILABLE_PROFIT');
  assert.equal(db.calls.some((sql) => sql.startsWith('INSERT INTO distribuciones_utilidades')), false);
});

test('rechaza distribuir más de la utilidad disponible y considera distribuciones previas', async () => {
  const db = distributionClient(profit({ ganancia_ventas: '900', distribuciones_previas: '600' }));
  await assert.rejects(registerProfitDistribution(db.client as never, distribution(600)), (error) => error instanceof AppError && error.code === 'INSUFFICIENT_AVAILABLE_PROFIT');
  assert.equal(db.calls.some((sql) => sql.startsWith('INSERT INTO distribuciones_utilidades')), false);
});
