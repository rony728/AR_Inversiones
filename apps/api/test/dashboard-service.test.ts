import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardPeriodInput, netPeriodProfit } from '../src/modules/operations/dashboard-service.js';

test('calcula ganancia neta sin tratar capital ni transferencias como ingreso', () => {
  assert.equal(netPeriodProfit(1200, 300, 450), 1050);
});

test('valida un período inclusivo y rechaza fechas invertidas', () => {
  assert.deepEqual(dashboardPeriodInput.parse({ desde: '2026-09-01', hasta: '2026-09-30' }), { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.equal(dashboardPeriodInput.safeParse({ desde: '2026-10-01', hasta: '2026-09-30' }).success, false);
});
