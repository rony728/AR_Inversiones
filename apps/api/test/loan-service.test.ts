import assert from 'node:assert/strict';
import test from 'node:test';
import { accrueLoanInterest, addMonth, correctInheritedLoan, createLoan, declareBadDebt, deleteInheritedLoan, deleteInheritedLoanInput, inheritedLoanCorrectionInput, loanInput, nextPaymentDateAfterPayment, paymentBreakdown, registerBadDebtRecovery } from '../src/modules/operations/loan-service.js';
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

test('valida los capitales y fechas de una corrección heredada', () => {
  const base = { clienteId: '11111111-1111-4111-8111-111111111111', socioId: '22222222-2222-4222-8222-222222222222', custodiaId: '33333333-3333-4333-8333-333333333333', capitalOriginal: 1000, capitalPendiente: 800, interesPendiente: 120, tasaMensual: 15, fechaDesembolso: null, fechaProximoPago: '2026-10-07', observaciones: null, motivo: 'Corrección inicial' };
  assert.equal(inheritedLoanCorrectionInput.safeParse(base).success, true);
  assert.equal(inheritedLoanCorrectionInput.safeParse({ ...base, interesPendiente: 0 }).success, true);
  assert.equal(inheritedLoanCorrectionInput.safeParse({ ...base, capitalPendiente: 1200 }).success, false);
  assert.equal(inheritedLoanCorrectionInput.safeParse({ ...base, fechaDesembolso: '2026-11-01' }).success, false);
});

test('separa pago exacto de interés, abono a capital y liquidación total', () => {
  assert.deepEqual(paymentBreakdown(5000, 750, 750), { interes: '750.00', capital: '0.00', capitalRestante: '5000.00', totalAdeudado: '5750.00' });
  assert.deepEqual(paymentBreakdown(5000, 750, 1750), { interes: '750.00', capital: '1000.00', capitalRestante: '4000.00', totalAdeudado: '5750.00' });
  assert.equal(paymentBreakdown(5000, 750, 5750).capitalRestante, '0.00');
  assert.throws(() => paymentBreakdown(5000, 750, 749), (error: unknown) => (error as { code?: string }).code === 'INSUFFICIENT_INTEREST_PAYMENT');
  assert.throws(() => paymentBreakdown(5000, 750, 5751), (error: unknown) => (error as { code?: string }).code === 'EXCESSIVE_PAYMENT');
});

test('avanza la próxima fecha un mes desde el pago cuando queda capital', () => {
  assert.equal(nextPaymentDateAfterPayment('2026-09-11', 2000), '2026-10-11');
  assert.equal(nextPaymentDateAfterPayment('2026-01-31', 1), '2026-02-28');
  assert.equal(nextPaymentDateAfterPayment('2026-09-11', 0), null);
});

test('genera varios períodos simples con idempotencia SQL y límite seguro', async () => {
  const statements: string[] = [];
  const client = { query: async (sql: string) => { statements.push(sql); return { rows: sql.includes('INSERT INTO intereses_prestamo') ? [{ id: `interest-${statements.length}` }] : [] }; } };
  const loan = { id: '00000000-0000-4000-8000-000000000001', socio_id: '00000000-0000-4000-8000-000000000002', custodia_id: '00000000-0000-4000-8000-000000000003', capital_pendiente: '1000.00', tasa_mensual: '10', fecha_proximo_pago: '2026-01-31', calcular_interes_desde: '2026-01-01', estado: 'ACTIVO' as const };
  const result = await accrueLoanInterest(client as never, loan, '2026-04-30');
  assert.equal(result.fecha_proximo_pago, '2026-05-28');
  assert.equal(result.estado, 'VENCIDO');
  assert.equal(statements.filter((sql) => sql.includes('INSERT INTO intereses_prestamo')).length, 4);
  assert.equal(statements.filter((sql) => sql.includes('fecha_vencimiento=$2')).length, 4);
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
    if (sql.startsWith('INSERT INTO prestamos ')) return { rows: [{ id: '44444444-4444-4444-8444-444444444444', socio_id: '22222222-2222-4222-8222-222222222222', custodia_id: '33333333-3333-4333-8333-333333333333', capital_original: '1000.00', capital_pendiente: '1000.00', tasa_mensual: '15', fecha_proximo_pago: '2026-10-07', calcular_interes_desde: '2026-09-07', estado: 'ACTIVO' }] };
    if (sql.includes('INSERT INTO intereses_prestamo')) return { rows: [{ id: '55555555-5555-4555-8555-555555555555' }] };
    return { rows: [] };
  } };
  const input = loanInput.parse({ clienteId: '11111111-1111-4111-8111-111111111111', socioId: '22222222-2222-4222-8222-222222222222', custodiaId: '33333333-3333-4333-8333-333333333333', capital: 1000, tasaMensual: 15, fechaDesembolso: '2026-09-07', fechaProximoPago: '2026-10-07' });
  const result = await createLoan(client as never, input);
  assert.equal(result.interesInicial, '150.00');
  assert.equal(calls.find((call) => call.sql.includes('INSERT INTO intereses_prestamo'))?.values[4], '150.00');
  assert.deepEqual(calls.find((call) => call.sql.startsWith('UPDATE custodias'))?.values, ['1000.00', input.custodiaId]);
});

for (const [capital, rate, expected] of [[2000, 15, '300.00'], [2500, 15, '375.00'], [1000, 0, '0.00']] as const) {
  test(`al desembolsar L ${capital} al ${rate}% genera L ${expected} de interés inicial`, async () => {
    const client = { query: async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith('SELECT id FROM clientes') || sql.startsWith('SELECT id FROM socios')) return { rows: [{ id: values[0] }] };
      if (sql.startsWith('SELECT saldo_actual FROM custodias')) return { rows: [{ saldo_actual: '10000.00' }] };
      if (sql.startsWith('INSERT INTO prestamos ')) return { rows: [{ id: '44444444-4444-4444-8444-444444444444', socio_id: values[1], custodia_id: values[2], capital_original: Number(values[6]).toFixed(2), capital_pendiente: Number(values[6]).toFixed(2), tasa_mensual: String(values[5]), fecha_proximo_pago: values[4], calcular_interes_desde: values[3], estado: 'ACTIVO' }] };
      if (sql.includes('INSERT INTO intereses_prestamo')) return { rows: [{ id: '55555555-5555-4555-8555-555555555555' }] };
      return { rows: [] };
    } };
    const input = loanInput.parse({ clienteId: '11111111-1111-4111-8111-111111111111', socioId: '22222222-2222-4222-8222-222222222222', custodiaId: '33333333-3333-4333-8333-333333333333', capital, tasaMensual: rate, fechaDesembolso: '2026-09-11' });
    assert.equal((await createLoan(client as never, input)).interesInicial, expected);
  });
}

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

test('corrige un préstamo heredado sin alterar saldos ni movimientos de custodia', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id,cliente_id,socio_id')) return { rows: [{ id: 'loan-1', cliente_id: 'client-old', socio_id: 'partner-old', custodia_id: 'fund-old', fecha_desembolso: null, capital_original: '2000.00', capital_pendiente: '2000.00', tasa_mensual: '15', fecha_proximo_pago: '2024-05-24', calcular_interes_desde: '2026-09-08', es_heredado: true, interes_inicial_heredado: '0.00', observaciones: 'Migrado', estado: 'ACTIVO' }] };
    if (sql.startsWith('SELECT EXISTS')) return { rows: [{ has_history: false }] };
    if (sql.startsWith('SELECT id FROM clientes')) return { rows: [{ id: values[0] }] };
    if (sql.startsWith('SELECT id FROM socios')) return { rows: [{ id: values[0] }] };
    if (sql.startsWith('SELECT saldo_actual FROM custodias')) return { rows: [{ saldo_actual: '5000.00' }] };
    if (sql.startsWith('SELECT id,fecha_vencimiento,capital_base')) return { rows: [{ id: 'interest-old', fecha_vencimiento: '2024-05-24', capital_base: '2000.00', monto_interes: '300.00', saldo_pendiente: '300.00' }] };
    if (sql.startsWith('UPDATE prestamos SET cliente_id=')) return { rows: [{ id: 'loan-1', cliente_id: values[0], socio_id: values[1], custodia_id: values[2], capital_original: values[6], capital_pendiente: values[7], fecha_proximo_pago: values[4], estado: values[8] }] };
    return { rows: [] };
  } };
  const result = await correctInheritedLoan(client as never, 'loan-1', inheritedLoanCorrectionInput.parse({ clienteId: '11111111-1111-4111-8111-111111111111', socioId: '22222222-2222-4222-8222-222222222222', custodiaId: '33333333-3333-4333-8333-333333333333', capitalOriginal: 2500, capitalPendiente: 1800, interesPendiente: 270, tasaMensual: 15, fechaDesembolso: null, fechaProximoPago: '2026-10-08', observaciones: 'Saldo confirmado', motivo: 'Conciliación de apertura' }));
  assert.equal(result.capitalPendiente, '1800.00');
  assert.equal(result.interesPendiente, '270.00');
  assert.equal(calls.filter((call) => call.sql.startsWith('DELETE FROM intereses_prestamo')).length, 1);
  assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO intereses_prestamo')).length, 1);
  assert.equal(calls.some((call) => call.sql.startsWith('UPDATE custodias')), false);
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO movimientos_custodia')), false);
  assert.equal(calls.some((call) => call.values.includes('CORREGIR_DATOS_HEREDADOS')), true);
});

test('bloquea la corrección cuando el préstamo ya tiene actividad operativa', async () => {
  const client = { query: async (sql: string) => {
    if (sql.startsWith('SELECT id,cliente_id,socio_id')) return { rows: [{ id: 'loan-1', es_heredado: true, estado: 'ACTIVO' }] };
    if (sql.startsWith('SELECT EXISTS')) return { rows: [{ has_history: true }] };
    return { rows: [] };
  } };
  await assert.rejects(correctInheritedLoan(client as never, 'loan-1', inheritedLoanCorrectionInput.parse({ clienteId: '11111111-1111-4111-8111-111111111111', socioId: '22222222-2222-4222-8222-222222222222', custodiaId: '33333333-3333-4333-8333-333333333333', capitalOriginal: 1000, capitalPendiente: 1000, interesPendiente: 150, tasaMensual: 15, fechaDesembolso: null, fechaProximoPago: '2026-10-08', motivo: 'Corrección inicial' })), (error: unknown) => (error as { code?: string }).code === 'LOAN_HAS_OPERATIONAL_HISTORY');
});

test('elimina lógicamente un préstamo heredado sin mover fondos y audita el estado anterior', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id,cliente_id,socio_id')) return { rows: [{ id: 'loan-1', cliente_id: 'client-1', socio_id: 'partner-1', custodia_id: 'fund-1', capital_pendiente: '2000.00', tasa_mensual: '15', fecha_proximo_pago: '2026-10-11', es_heredado: true, estado: 'ACTIVO', eliminado_at: null }] };
    if (sql.startsWith('SELECT EXISTS')) return { rows: [{ has_history: false }] };
    if (sql.startsWith('UPDATE prestamos SET eliminado_at=')) return { rows: [{ eliminado_at: '2026-09-11T12:00:00.000Z' }] };
    return { rows: [] };
  } };
  const result = await deleteInheritedLoan(client as never, 'loan-1', deleteInheritedLoanInput.parse({ motivo: 'Duplicado de migración' }), 'user-1');
  assert.equal(result.estadoAnterior, 'ACTIVO');
  assert.equal(calls.some((call) => call.sql.startsWith('UPDATE custodias') || call.sql.includes('INSERT INTO movimientos_')), false);
  assert.equal(calls.some((call) => call.values.includes('ELIMINAR_LOGICO')), true);
});

test('bloquea eliminar un préstamo con operaciones posteriores', async () => {
  const client = { query: async (sql: string) => {
    if (sql.startsWith('SELECT id,cliente_id,socio_id')) return { rows: [{ id: 'loan-1', es_heredado: true, estado: 'ACTIVO', eliminado_at: null }] };
    if (sql.startsWith('SELECT EXISTS')) return { rows: [{ has_history: true }] };
    return { rows: [] };
  } };
  await assert.rejects(deleteInheritedLoan(client as never, 'loan-1', { motivo: 'Duplicado de migración' }, 'user-1'), (error: unknown) => (error as { code?: string }).code === 'LOAN_HAS_OPERATIONAL_HISTORY');
});

test('bloquea eliminar préstamos creados por la aplicación', async () => {
  const client = { query: async (sql: string) => sql.startsWith('SELECT id,cliente_id,socio_id') ? { rows: [{ id: 'loan-1', es_heredado: false, estado: 'ACTIVO', eliminado_at: null }] } : { rows: [] } };
  await assert.rejects(deleteInheritedLoan(client as never, 'loan-1', { motivo: 'No corresponde' }, 'user-1'), (error: unknown) => (error as { code?: string }).code === 'LOAN_DELETE_NOT_ALLOWED');
});
