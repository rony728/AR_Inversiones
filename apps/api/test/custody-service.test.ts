import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustFundBalance, fundAdjustmentInput, transferBetweenCustodies, transferInput } from '../src/modules/operations/custody-service.js';
import { loanInput, createLoan } from '../src/modules/operations/loan-service.js';
import { registerExpense } from '../src/modules/operations/finance-service.js';

const alex = '11111111-1111-4111-8111-111111111111'; const brian = '22222222-2222-4222-8222-222222222222';
const alexProducts = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const alexLoans = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; const brianProducts = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; const brianLoans = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
type Fund = { id: string; socio_id: string; actividad: 'PRODUCTOS' | 'PRESTAMOS'; saldo_actual: string };

function custodyClient(initial: Record<string, number> = {}) {
  const funds = new Map<string, Fund>([
    [alexProducts, { id: alexProducts, socio_id: alex, actividad: 'PRODUCTOS', saldo_actual: String(initial[alexProducts] ?? 1000) }],
    [alexLoans, { id: alexLoans, socio_id: alex, actividad: 'PRESTAMOS', saldo_actual: String(initial[alexLoans] ?? 2000) }],
    [brianProducts, { id: brianProducts, socio_id: brian, actividad: 'PRODUCTOS', saldo_actual: String(initial[brianProducts] ?? 3000) }],
    [brianLoans, { id: brianLoans, socio_id: brian, actividad: 'PRESTAMOS', saldo_actual: String(initial[brianLoans] ?? 4000) }]
  ]);
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id,socio_id,actividad,saldo_actual')) return { rows: (values[0] as string[]).map((id) => funds.get(id)).filter(Boolean) };
    if (sql.startsWith('SELECT id,socio_id,saldo_actual FROM custodias')) return { rows: (values[0] as string[]).map((id) => funds.get(id)).filter(Boolean) };
    if (sql.startsWith('INSERT INTO transferencias_custodia')) return { rows: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }] };
    if (sql.startsWith('INSERT INTO ajustes_fondo')) return { rows: [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }] };
    if (sql.startsWith('INSERT INTO gastos')) return { rows: [{ id: '66666666-6666-4666-8666-666666666666' }] };
    if (sql.startsWith('UPDATE custodias SET saldo_actual=CASE')) { assert.match(sql, /\$2::numeric/); assert.match(sql, /\$4::numeric/); funds.get(String(values[0]))!.saldo_actual = String(values[1]); funds.get(String(values[2]))!.saldo_actual = String(values[3]); return { rows: [] }; }
    if (sql.startsWith('UPDATE custodias SET saldo_actual=')) { funds.get(String(values[1]))!.saldo_actual = String(values[0]); return { rows: [] }; }
    if (sql.startsWith('SELECT id FROM clientes') || sql.startsWith('SELECT id FROM socios')) return { rows: [{ id: values[0] }] };
    if (sql.startsWith('SELECT saldo_actual FROM custodias')) return { rows: [{ saldo_actual: funds.get(String(values[0]))?.saldo_actual }] };
    if (sql.startsWith('INSERT INTO prestamos ')) return { rows: [{ id: '99999999-9999-4999-8999-999999999999', socio_id: values[1], custodia_id: values[2], capital_original: values[6], capital_pendiente: values[6], tasa_mensual: values[5], fecha_proximo_pago: values[4], calcular_interes_desde: values[3], estado: 'ACTIVO' }] };
    if (sql.includes('INSERT INTO intereses_prestamo')) return { rows: [{ id: '88888888-8888-4888-8888-888888888888' }] };
    return { rows: [] };
  } };
  return { client, funds, calls };
}

const transfer = (overrides: Partial<ReturnType<typeof transferInput.parse>> = {}) => transferInput.parse({ socioOrigenId: alex, custodiaOrigenId: alexProducts, socioDestinoId: alex, custodiaDestinoId: alexLoans, monto: 250, observaciones: 'Redistribución operativa', ...overrides });

for (const [name, input] of [
  ['mismo socio PRODUCTOS a PRESTAMOS', transfer()],
  ['socios distintos en la misma actividad', transfer({ socioDestinoId: brian, custodiaDestinoId: brianProducts })],
  ['socios y actividades diferentes', transfer({ socioDestinoId: brian, custodiaDestinoId: brianLoans })]
] as const) test(`transfiere entre ${name} y conserva el total general`, async () => {
  const db = custodyClient(); const before = [...db.funds.values()].reduce((sum, fund) => sum + Number(fund.saldo_actual), 0);
  await transferBetweenCustodies(db.client as never, input, 'user-1');
  const after = [...db.funds.values()].reduce((sum, fund) => sum + Number(fund.saldo_actual), 0);
  assert.equal(after, before); assert.equal(db.calls.some((call) => call.sql.includes('FOR UPDATE')), true); assert.equal(db.calls.some((call) => call.values.includes('TRANSFERENCIA_FONDO')), true);
});

test('permite transferir el saldo completo y deja el origen en cero', async () => {
  const db = custodyClient({ [alexProducts]: 250 }); await transferBetweenCustodies(db.client as never, transfer(), 'user-1'); assert.equal(db.funds.get(alexProducts)?.saldo_actual, '0.00');
});

test('rechaza saldo insuficiente y origen igual al destino', async () => {
  const db = custodyClient({ [alexProducts]: 100 }); await assert.rejects(transferBetweenCustodies(db.client as never, transfer(), 'user-1'), (error: unknown) => (error as { code?: string }).code === 'INSUFFICIENT_CUSTODY_BALANCE');
  assert.equal(transferInput.safeParse({ ...transfer(), custodiaDestinoId: alexProducts }).success, false);
});

test('mantiene compatibles las transferencias internas pendientes del formato anterior', () => {
  const parsed = transferInput.parse({ socioId: alex, custodiaOrigenId: alexProducts, custodiaDestinoId: alexLoans, monto: 10 });
  assert.equal(parsed.socioOrigenId, alex); assert.equal(parsed.socioDestinoId, alex); assert.match(parsed.observaciones, /actualización/);
});

for (const [name, current, next, difference] of [['positivo', 3000, 3250, '250.00'], ['negativo', 3000, 2800, '-200.00'], ['hasta cero', 3000, 0, '-3000.00']] as const) test(`registra ajuste manual ${name} con auditoría`, async () => {
  const db = custodyClient({ [alexLoans]: current }); const result = await adjustFundBalance(db.client as never, fundAdjustmentInput.parse({ socioId: alex, custodiaId: alexLoans, nuevoSaldo: next, motivo: 'Diferencia confirmada en auditoría' }), 'user-1');
  assert.equal(result.diferencia, difference); assert.equal(db.funds.get(alexLoans)?.saldo_actual, Number(next).toFixed(2)); assert.equal(db.calls.some((call) => call.sql.includes('AJUSTE_MANUAL_FONDO')), true); assert.equal(db.calls.some((call) => call.sql.includes('INSERT INTO movimientos_financieros')), false);
});

test('rechaza saldo negativo, saldo sin cambio y motivo inválido', async () => {
  assert.equal(fundAdjustmentInput.safeParse({ socioId: alex, custodiaId: alexLoans, nuevoSaldo: -1, motivo: 'Corrección' }).success, false);
  assert.equal(fundAdjustmentInput.safeParse({ socioId: alex, custodiaId: alexLoans, nuevoSaldo: 10, motivo: 'No' }).success, false);
  const db = custodyClient({ [alexLoans]: 3000 }); await assert.rejects(adjustFundBalance(db.client as never, fundAdjustmentInput.parse({ socioId: alex, custodiaId: alexLoans, nuevoSaldo: 3000, motivo: 'Sin diferencia real' })), (error: unknown) => (error as { code?: string }).code === 'UNCHANGED_CUSTODY_BALANCE');
});

test('un préstamo posterior usa el saldo ajustado como única fuente de verdad', async () => {
  const db = custodyClient({ [alexLoans]: 3000 }); await adjustFundBalance(db.client as never, fundAdjustmentInput.parse({ socioId: alex, custodiaId: alexLoans, nuevoSaldo: 3500, motivo: 'Corrección de saldo inicial' }), 'user-1');
  await createLoan(db.client as never, loanInput.parse({ clienteId: '77777777-7777-4777-8777-777777777777', socioId: alex, custodiaId: alexLoans, capital: 1000, tasaMensual: 15, fechaDesembolso: '2026-09-12' }), 'user-1');
  assert.equal(db.funds.get(alexLoans)?.saldo_actual, '2500.00');
});

test('un gasto posterior usa el saldo ajustado como única fuente de verdad', async () => {
  const db = custodyClient({ [alexProducts]: 3000 }); await adjustFundBalance(db.client as never, fundAdjustmentInput.parse({ socioId: alex, custodiaId: alexProducts, nuevoSaldo: 3500, motivo: 'Corrección de saldo inicial' }), 'user-1');
  await registerExpense(db.client as never, { socioId: alex, custodiaId: alexProducts, concepto: 'Gasto operativo verificado', monto: 500, fecha: '2026-09-12' }, 'user-1');
  assert.equal(db.funds.get(alexProducts)?.saldo_actual, '3000.00');
});
