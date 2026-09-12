import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardPeriodInput, getDashboard, netPeriodProfit } from '../src/modules/operations/dashboard-service.js';

test('calcula ganancia neta sin tratar capital ni transferencias como ingreso', () => {
  assert.equal(netPeriodProfit(1200, 300, 450), 1050);
  assert.equal(netPeriodProfit(1200, 300, 450, 200, 500), 750);
});

test('valida un período inclusivo y rechaza fechas invertidas', () => {
  assert.deepEqual(dashboardPeriodInput.parse({ desde: '2026-09-01', hasta: '2026-09-30' }), { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.equal(dashboardPeriodInput.safeParse({ desde: '2026-10-01', hasta: '2026-09-30' }).success, false);
});

test('las consultas del dashboard excluyen préstamos eliminados', async () => {
  const calls: string[] = [];
  const client = { query: async (sql: string) => { calls.push(sql); return calls.length === 1 ? { rows: [{ ventas_periodo: '0', ganancia_ventas: '0', gastos_periodo: '0', intereses_cobrados: '0', recuperaciones_incobrables: '0', perdidas_prestamo: '0', capital_prestado_actual: '0', prestamos_vencidos: 0, fondos_totales: '0', valor_inventario: '0' }] } : { rows: [] }; } };
  await getDashboard(client as never, '2026-09-01', '2026-09-30');
  assert.match(calls[0], /eliminado_at IS NULL AND estado IN \('ACTIVO','VENCIDO'\)/);
  assert.match(calls[1], /eliminado_at IS NULL AND es_heredado=false/);
});
