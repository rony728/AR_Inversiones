import assert from 'node:assert/strict';
import test from 'node:test';
import { accrueLoanInterest, addMonth, createLoan, declareBadDebt, loanInput, paymentBreakdown, registerBadDebtRecovery } from '../src/modules/operations/loan-service.js';
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
  assert.equal(addMonth('2026-04-30'), '2026-05-30');
  assert.equal(addMonth('2026-12-31'), '2027-01-31');
});

test('valida que la próxima fecha no sea anterior al desembolso', () => {
  const base = { clienteId: '11111111-1111-4111-8111-111111111111', socioId: '22222222-2222-4222-8222-222222222222', custodiaId: '33333333-3333-4333-8333-333333333333', capital: 1000, tasaMensual: 15, fechaDesembolso: '2026-09-07' };
  assert.equal(loanInput.safeParse({ ...base, fechaProximoPago: '2026-09-06' }).success, false);
  assert.equal(loanInput.safeParse({ ...base, fechaProximoPago: '2026-10-07' }).success, true);
});

test('separa pago exacto de interés, abono a capital y liquidación total', () => {
  assert.deepEqual(paymentBreakdown(5000, 750, 750), { interes: '750.00', capital: '0.00', capitalRestante: '5000.00', totalAdeudado: '5750.00' });
  assert.deepEqual(paymentBreakdown(5000, 750, 1750), { interes: '750.00', capital: '1000.00', capitalRestante: '4000.00', totalAdeudado: '5750.00' });
  assert.equal(paymentBreakdown(5000, 750, 5750).capitalRestante, '0.00');
  assert.throws(() => paymentBreakdown(5000, 750, 749), (error: unknown) => (error as { code?: string }).code === 'INSUFFICIENT_INTEREST_PAYMENT');
  assert.throws(() => paymentBreakdown(5000, 750, 5751), (error: unknown) => (error as { code?: string }).code === 'EXCESSIVE_PAYMENT');
});

test('genera varios períodos simples con idempotencia SQL y límite seguro', async () => {
  const statements: string[] = [];
  const client = { query: async (sql: string) => { statements.push(sql); return { rows: [] }; } };
  const loan = { id: '00000000-0000-4000-8000-000000000001', socio_id: '00000000-0000-4000-8000-000000000002', custodia_id: '00000000-0000-4000-8000-000000000003', capital_pendiente: '1000.00', tasa_mensual: '10', fecha_proximo_pago: '2026-01-31', calcular_interes_desde: '2026-01-01', estado: 'ACTIVO' as const };
  const result = await accrueLoanInterest(client as never, loan, '2026-04-30');
  assert.equal(result.fecha_proximo_pago, '2026-05-28');
  assert.equal(result.estado, 'VENCIDO');
  assert.equal(statements.filter((sql) => sql.includes('INSERT INTO intereses_prestamo')).length, 4);
  assert.equal(statements.filter((sql) => sql.includes('INSERT INTO intereses_prestamo')).every((sql) => sql.includes('ON CONFLICT')), true);
});

test('no genera intereses para estados terminales', async () => {
  for (const estado of ['PAGADO', 'ANULADO', 'INCOBRABLE', 'RECUPERADO'] as const) {
    let queries = 0; const client = { query: async () => { queries++; return { rows: [] }; } };
    await accrueLoanInterest(client as never, { id: '1', socio_id: '2', custodia_id: '3', capital_pendiente: '1000', tasa_mensual: '15', fecha_proximo_pago: '2020-01-01', estado }, '2026-09-07');
    assert.equal(queries, 0);
  }
});

test('al desembolsar genera el primer interés completo y descuenta solo el fondo PRESTAMOS', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id FROM clientes')) return { rows: [{ id: values[0] }] };
    if (sql.startsWith('SELECT id FROM socios')) return { rows: [{ id: values[0] }] };
    if (sql.startsWith('SELECT saldo_actual FROM custodias')) return { rows: [{ saldo_actual: '2000.00' }] };
    if (sql.startsWith('INSERT INTO prestamos')) return { rows: [{ id: '44444444-4444-4444-8444-444444444444', socio_id: '22222222-2222-4222-8222-222222222222', custodia_id: '33333333-3333-4333-8333-333333333333', capital_original: '1000.00', capital_pendiente: '1000.00', tasa_mensual: '15', fecha_proximo_pago: '2026-10-07', calcular_interes_desde: '2026-09-07', estado: 'ACTIVO' }] };
    return { rows: [] };
  } };
  const input = loanInput.parse({ clienteId: '11111111-1111-4111-8111-111111111111', socioId: '22222222-2222-4222-8222-222222222222', custodiaId: '33333333-3333-4333-8333-333333333333', capital: 1000, tasaMensual: 15, fechaDesembolso: '2026-09-07', fechaProximoPago: '2026-10-07' });
  const result = await createLoan(client as never, input);
  assert.equal(result.interesInicial, '150.00');
  assert.equal(calls.find((call) => call.sql.includes('INSERT INTO intereses_prestamo'))?.values[4], '150.00');
  assert.deepEqual(calls.find((call) => call.sql.startsWith('UPDATE custodias'))?.values, ['1000.00', input.custodiaId]);
});

test('declarar incobrable cancela intereses, registra pérdida y no mueve el fondo', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id,cliente_id')) return { rows: [{ id: '1', socio_id: '2', custodia_id: '3', capital_pendiente: '900.00', tasa_mensual: '15', fecha_proximo_pago: '2026-10-07', estado: 'ACTIVO' }] };
    if (sql.startsWith('SELECT saldo_pendiente FROM intereses')) return { rows: [{ saldo_pendiente: '135.00' }] };
    if (sql.startsWith('INSERT INTO prestamos_incobrables')) return { rows: [{ id: '4' }] };
    return { rows: [] };
  } };
  const result = await declareBadDebt(client as never, '1', { fecha: '2026-09-07', motivo: 'Gestión de cobro agotada' });
  assert.equal(result.capitalIncobrable, '900.00'); assert.equal(result.interesesCancelados, '135.00');
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO movimientos_custodia')), false);
  assert.equal(calls.some((call) => call.sql.includes("'PERDIDA_PRESTAMO'")), true);
});

test('una recuperación parcial aumenta el fondo y conserva estado INCOBRABLE', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id,cliente_id')) return { rows: [{ id: '1', socio_id: '2', custodia_id: '3', capital_pendiente: '900.00', tasa_mensual: '15', fecha_proximo_pago: '2026-10-07', estado: 'INCOBRABLE' }] };
    if (sql.startsWith('SELECT id,saldo_pendiente FROM prestamos_incobrables')) return { rows: [{ id: '4', saldo_pendiente: '900.00' }] };
    if (sql.startsWith('SELECT saldo_actual FROM custodias')) return { rows: [{ saldo_actual: '100.00' }] };
    if (sql.startsWith('INSERT INTO recuperaciones_incobrables')) return { rows: [{ id: '5' }] };
    return { rows: [] };
  } };
  const result = await registerBadDebtRecovery(client as never, '1', { fecha: '2026-09-07', monto: 300 });
  assert.equal(result.saldoIncobrable, '600.00'); assert.equal(result.saldoFondo, '400.00'); assert.equal(result.estado, 'INCOBRABLE');
  assert.equal(calls.some((call) => call.sql.includes("'RECUPERACION_INCOBRABLE'")), true);
  await assert.rejects(registerBadDebtRecovery({ query: async (sql: string) => sql.startsWith('SELECT id,cliente_id') ? { rows: [{ id: '1', estado: 'PAGADO' }] } : { rows: [] } } as never, '1', { fecha: '2026-09-07', monto: 1 }), (error: unknown) => (error as { code?: string }).code === 'INVALID_LOAN_STATE');
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
