import assert from 'node:assert/strict';
import test from 'node:test';
import { accrueLoanInterest, addMonth, createLoan, declareBadDebt, deleteLoan, deleteLoanInput, editLoan, loanEditInput, loanInput, nextPaymentDateAfterPayment, paymentBreakdown, registerBadDebtRecovery } from '../src/modules/operations/loan-service.js';
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

test('valida los capitales, fechas y motivo de una edición', () => {
  const base = { clienteId: '11111111-1111-4111-8111-111111111111', socioId: '22222222-2222-4222-8222-222222222222', custodiaId: '33333333-3333-4333-8333-333333333333', capitalOriginal: 1000, capitalPendiente: 800, interesPendiente: 120, tasaMensual: 15, fechaDesembolso: null, fechaProximoPago: '2026-10-07', observaciones: null, motivo: 'Corrección inicial' };
  assert.equal(loanEditInput.safeParse(base).success, true);
  assert.equal(loanEditInput.safeParse({ ...base, interesPendiente: 0, capitalPendiente: 0 }).success, true);
  assert.equal(loanEditInput.safeParse({ ...base, capitalPendiente: 1200 }).success, false);
  assert.equal(loanEditInput.safeParse({ ...base, fechaDesembolso: '2026-11-01' }).success, false);
  assert.equal(loanEditInput.safeParse({ ...base, motivo: 'No' }).success, false);
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

type FlexibleLoan = { id: string; cliente_id: string; socio_id: string; custodia_id: string; capital_original: string; capital_pendiente: string; tasa_mensual: string; fecha_desembolso: string | null; fecha_proximo_pago: string; estado: 'ACTIVO' | 'VENCIDO' | 'PAGADO' | 'ANULADO' | 'INCOBRABLE' | 'RECUPERADO'; es_heredado: boolean; eliminado_at: string | null; observaciones: string | null };
const flexibleFundA = '33333333-3333-4333-8333-333333333333';
const flexibleFundB = '44444444-4444-4444-8444-444444444444';
const flexiblePartnerB = '55555555-5555-4555-8555-555555555555';

function flexibleLoanClient(changes: Partial<FlexibleLoan> = {}, balances: Record<string, number> = { [flexibleFundA]: 5000, [flexibleFundB]: 5000 }) {
  const loan: FlexibleLoan = { id: 'loan-1', cliente_id: 'client-1', socio_id: '22222222-2222-4222-8222-222222222222', custodia_id: flexibleFundA, capital_original: '1000.00', capital_pendiente: '1000.00', tasa_mensual: '15', fecha_desembolso: '2026-09-11', fecha_proximo_pago: '2026-10-11', estado: 'ACTIVO', es_heredado: false, eliminado_at: null, observaciones: null, ...changes };
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id,cliente_id,socio_id')) return { rows: [{ ...loan }] };
    if (sql.startsWith('SELECT id FROM clientes') || sql.startsWith('SELECT id FROM socios')) return { rows: [{ id: values[0] }] };
    if (sql.startsWith('SELECT id,capital_declarado,saldo_pendiente')) return { rows: [{ id: 'bad-1', capital_declarado: '1000.00', saldo_pendiente: '700.00' }] };
    if (sql.startsWith('SELECT id,fecha_vencimiento,capital_base')) return { rows: [{ id: 'interest-old', fecha_vencimiento: loan.fecha_proximo_pago, capital_base: loan.capital_pendiente, monto_interes: '150.00', saldo_pendiente: '150.00' }] };
    if (sql.startsWith('SELECT saldo_actual FROM custodias')) return { rows: [{ saldo_actual: (balances[String(values[0])] ?? 0).toFixed(2) }] };
    if (sql.startsWith('UPDATE custodias SET saldo_actual=')) { balances[String(values[1])] = Number(values[0]); return { rows: [] }; }
    if (sql.startsWith('UPDATE prestamos SET cliente_id=')) { Object.assign(loan, { cliente_id: values[0], socio_id: values[1], custodia_id: values[2], fecha_desembolso: values[3], fecha_proximo_pago: values[4], tasa_mensual: values[5], capital_original: values[6], capital_pendiente: values[7], estado: values[8], observaciones: values[9] }); return { rows: [{ ...loan }] }; }
    if (sql.startsWith('UPDATE prestamos SET eliminado_at=')) { loan.eliminado_at = '2026-09-11T12:00:00.000Z'; return { rows: [{ ...loan }] }; }
    return { rows: [] };
  } };
  return { client, loan, calls, balances };
}

const editPayload = (changes: Partial<ReturnType<typeof loanEditInput.parse>> = {}) => loanEditInput.parse({ clienteId: '11111111-1111-4111-8111-111111111111', socioId: '22222222-2222-4222-8222-222222222222', custodiaId: '33333333-3333-4333-8333-333333333333', capitalOriginal: 1000, capitalPendiente: 800, interesPendiente: 120, tasaMensual: 15, fechaDesembolso: '2026-09-11', fechaProximoPago: '2026-10-11', observaciones: 'Actualizado', motivo: 'Ajuste confirmado', ...changes });

for (const inherited of [false, true]) test(`edita un préstamo ${inherited ? 'heredado' : 'nuevo'} y conserva el historial de intereses`, async () => {
  const db = flexibleLoanClient({ es_heredado: inherited }, { [flexibleFundA]: 5000 });
  const result = await editLoan(db.client as never, 'loan-1', editPayload(), 'user-1');
  assert.equal(result.capitalPendiente, '800.00');
  assert.equal(db.balances[flexibleFundA], 5200);
  assert.equal(db.calls.some((call) => call.sql.startsWith('SELECT EXISTS')), false);
  assert.equal(db.calls.some((call) => call.sql.startsWith('DELETE FROM intereses_prestamo')), false);
  assert.equal(db.calls.some((call) => call.sql.startsWith('UPDATE intereses_prestamo SET saldo_pendiente=0,cancelado_at=now()')), true);
  assert.equal(db.calls.some((call) => call.values.includes('EDITAR')), true);
});

test('edita un préstamo con pagos y aumenta capital solo si el fondo alcanza', async () => {
  const db = flexibleLoanClient({ capital_original: '1200.00', capital_pendiente: '800.00' }, { [flexibleFundA]: 500 });
  await editLoan(db.client as never, 'loan-1', editPayload({ capitalOriginal: 1200, capitalPendiente: 1000, interesPendiente: 150 }), 'user-1');
  assert.equal(db.balances[flexibleFundA], 300);
  const insufficient = flexibleLoanClient({ capital_pendiente: '800.00' }, { [flexibleFundA]: 100 });
  await assert.rejects(editLoan(insufficient.client as never, 'loan-1', editPayload({ capitalOriginal: 1200, capitalPendiente: 1000 }), 'user-1'), (error: unknown) => (error as { code?: string }).code === 'INSUFFICIENT_CUSTODY_BALANCE');
});

test('al cambiar socio devuelve la exposición al fondo anterior y la descuenta del nuevo', async () => {
  const db = flexibleLoanClient({}, { [flexibleFundA]: 1000, [flexibleFundB]: 2000 });
  await editLoan(db.client as never, 'loan-1', editPayload({ socioId: flexiblePartnerB, custodiaId: flexibleFundB }), 'user-1');
  assert.equal(db.balances[flexibleFundA], 2000);
  assert.equal(db.balances[flexibleFundB], 1200);
  assert.equal(db.calls.filter((call) => call.sql.includes('INSERT INTO movimientos_custodia')).length, 2);
});

test('rechaza cambiar socio cuando el fondo nuevo no alcanza', async () => {
  const db = flexibleLoanClient({}, { [flexibleFundA]: 1000, [flexibleFundB]: 700 });
  await assert.rejects(editLoan(db.client as never, 'loan-1', editPayload({ socioId: flexiblePartnerB, custodiaId: flexibleFundB }), 'user-1'), (error: unknown) => (error as { code?: string }).code === 'INSUFFICIENT_CUSTODY_BALANCE');
});

for (const inherited of [false, true]) test(`elimina lógicamente un préstamo ${inherited ? 'heredado' : 'nuevo'} aunque tenga historial`, async () => {
  const db = flexibleLoanClient({ es_heredado: inherited, capital_pendiente: '700.00' });
  const result = await deleteLoan(db.client as never, 'loan-1', deleteLoanInput.parse({ motivo: 'Retiro confirmado' }), 'user-1');
  assert.equal(result.capitalDevuelto, '700.00');
  assert.equal(db.balances[flexibleFundA], 5700);
  assert.equal(db.calls.some((call) => call.sql.startsWith('SELECT EXISTS')), false);
  assert.equal(db.calls.some((call) => call.values.includes('ELIMINAR_LOGICO')), true);
});

test('al eliminar un incobrable devuelve solo su saldo pendiente y nunca duplica la devolución', async () => {
  const db = flexibleLoanClient({ estado: 'INCOBRABLE', capital_pendiente: '1000.00' });
  const result = await deleteLoan(db.client as never, 'loan-1', { motivo: 'Retiro confirmado' }, 'user-1');
  assert.equal(result.capitalDevuelto, '700.00');
  assert.equal(db.balances[flexibleFundA], 5700);
  await assert.rejects(deleteLoan(db.client as never, 'loan-1', { motivo: 'Segundo intento' }, 'user-1'), (error: unknown) => (error as { code?: string }).code === 'LOAN_ALREADY_DELETED');
  assert.equal(db.balances[flexibleFundA], 5700);
});

test('al eliminar un préstamo pagado o anulado no devuelve capital ya recuperado', async () => {
  for (const estado of ['PAGADO', 'ANULADO'] as const) {
    const db = flexibleLoanClient({ estado, capital_pendiente: estado === 'PAGADO' ? '0.00' : '1000.00' });
    const result = await deleteLoan(db.client as never, 'loan-1', { motivo: 'Retiro confirmado' }, 'user-1');
    assert.equal(result.capitalDevuelto, '0.00');
    assert.equal(db.balances[flexibleFundA], 5000);
    assert.equal(db.calls.some((call) => call.sql.includes('INSERT INTO movimientos_custodia')), false);
  }
});
