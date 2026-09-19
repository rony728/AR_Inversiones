import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/lib/errors.js';
import { distributionInput, distributionShareCents, expenseInput } from '../src/modules/operations/finance-service.js';
import { categoryAvailableProfitCents, categoryOperatingProfitCents, type CategoryProfit } from '../src/modules/operations/profit-service.js';
import { money } from '../src/modules/operations/inventory-service.js';

const row = (overrides: Partial<CategoryProfit> = {}): CategoryProfit => ({ rubro: 'PRESTAMOS', ingresos: '0', costos: '0', gastos: '0', perdidas: '0', distribuido: '0', ...overrides });
test('divide exactamente entre tres y rechaza centavos incompatibles', () => { assert.equal(money(distributionShareCents(3000)), '1000.00'); assert.throws(() => distributionShareCents(100), (error) => error instanceof AppError && error.code === 'INVALID_DISTRIBUTION_AMOUNT'); });
test('la pérdida se informa sin reducir ganancia ni disponible', () => { const components = row({ ingresos: '2000', gastos: '500', perdidas: '5000' }); assert.equal(money(categoryOperatingProfitCents(components)), '1500.00'); assert.equal(money(categoryAvailableProfitCents(components)), '1500.00'); });
test('el disponible descuenta distribuciones persistentes y admite parciales', () => { assert.equal(money(categoryAvailableProfitCents(row({ ingresos: '4000', distribuido: '3000' }))), '1000.00'); assert.equal(money(categoryAvailableProfitCents(row({ ingresos: '4600', distribuido: '3000' }))), '1600.00'); });
test('gasto nuevo exige rubro y distribución ya no recibe fondos manuales', () => { const base = { socioId: '11111111-1111-4111-8111-111111111111', custodiaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', concepto: 'Transporte', monto: 50, fecha: '2026-09-30' }; assert.equal(expenseInput.safeParse(base).success, false); assert.equal(expenseInput.safeParse({ ...base, rubro: 'PRODUCTOS' }).success, true); const distribution = distributionInput.parse({ rubro: 'PRESTAMOS', fecha: '2026-09-30', utilidadTotal: 3000, coberturas: [] }); assert.equal('socios' in distribution, false); });
