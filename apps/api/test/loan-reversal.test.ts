import assert from 'node:assert/strict';
import test from 'node:test';
import { registerLoanPayment, reverseLoanPayment } from '../src/modules/operations/loan-service.js';

type InterestState = { id: string; fecha_vencimiento: string; capital_base: string; monto_interes: string; saldo_pendiente: string; generado_por_pago_id: string | null; cancelado_at: string | null; cancelado_por_reversion_pago_id: string | null };
type PaymentState = { id: string; monto_total: string; monto_capital: string; fecha_pago: string; estado_prestamo_anterior: 'ACTIVO' | 'VENCIDO'; fecha_proximo_pago_anterior: string; revertido_at: string | null; order: number };

class LoanMemoryClient {
  loan = { id: 'loan-1', cliente_id: 'client-1', socio_id: 'partner-1', custodia_id: 'fund-1', capital_pendiente: '1000.00', tasa_mensual: '15', fecha_proximo_pago: '2026-10-01', calcular_interes_desde: '2026-09-01', estado: 'ACTIVO' as const };
  custody = 1000;
  interests: InterestState[] = [{ id: 'interest-1', fecha_vencimiento: '2026-10-01', capital_base: '1000.00', monto_interes: '150.00', saldo_pendiente: '150.00', generado_por_pago_id: null, cancelado_at: null, cancelado_por_reversion_pago_id: null }];
  payments: PaymentState[] = [];
  allocations: Array<{ pago_prestamo_id: string; interes_prestamo_id: string; monto_aplicado: string }> = [];
  custodyMovements = 0;

  async query(sql: string, values: unknown[] = []) {
    if (sql.startsWith('SELECT id,cliente_id,socio_id')) return { rows: [{ ...this.loan }] };
    if (sql.startsWith('SELECT id,fecha_vencimiento,capital_base,monto_interes,saldo_pendiente FROM intereses_prestamo WHERE prestamo_id')) return { rows: this.interests.filter((item) => Number(item.saldo_pendiente) > 0 && !item.cancelado_at).map((item) => ({ ...item })) };
    if (sql.startsWith('INSERT INTO pagos_prestamo ')) { const id = `payment-${this.payments.length + 1}`; this.payments.push({ id, fecha_pago: String(values[2]), monto_total: String(values[3]), monto_capital: String(values[5]), estado_prestamo_anterior: values[9] as 'ACTIVO' | 'VENCIDO', fecha_proximo_pago_anterior: String(values[10]), revertido_at: null, order: this.payments.length + 1 }); return { rows: [{ id }] }; }
    if (sql === 'UPDATE intereses_prestamo SET saldo_pendiente=0 WHERE id=$1') { this.interests.find((item) => item.id === values[0])!.saldo_pendiente = '0.00'; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pagos_intereses_prestamo')) { this.allocations.push({ pago_prestamo_id: String(values[0]), interes_prestamo_id: String(values[1]), monto_aplicado: String(values[2]) }); return { rows: [] }; }
    if (sql.startsWith('UPDATE prestamos SET capital_pendiente=')) { this.loan.capital_pendiente = String(values[0]); this.loan.fecha_proximo_pago = String(values[1]); this.loan.estado = values[2] as typeof this.loan.estado; return { rows: [] }; }
    if (sql.startsWith('SELECT id,cancelado_at,cancelado_por_reversion_pago_id')) { const found = this.interests.find((item) => item.fecha_vencimiento === values[1]); return { rows: found ? [{ ...found }] : [] }; }
    if (sql.startsWith('INSERT INTO intereses_prestamo ')) { const interest: InterestState = { id: `interest-${this.interests.length + 1}`, fecha_vencimiento: String(values[1]), capital_base: String(values[2]), monto_interes: String(values[4]), saldo_pendiente: String(values[4]), generado_por_pago_id: values[5] ? String(values[5]) : null, cancelado_at: null, cancelado_por_reversion_pago_id: null }; this.interests.push(interest); return { rows: [{ id: interest.id }] }; }
    if (sql.startsWith('UPDATE intereses_prestamo SET capital_base=')) { const item = this.interests.find((interest) => interest.id === values[4])!; Object.assign(item, { capital_base: String(values[0]), monto_interes: String(values[2]), saldo_pendiente: String(values[2]), generado_por_pago_id: values[3] ? String(values[3]) : null, cancelado_at: null, cancelado_por_reversion_pago_id: null }); return { rows: [] }; }
    if (sql.startsWith('SELECT saldo_actual FROM custodias')) return { rows: [{ saldo_actual: this.custody.toFixed(2) }] };
    if (sql.startsWith('UPDATE custodias SET saldo_actual=')) { this.custody = Number(values[0]); return { rows: [] }; }
    if (sql.includes('INSERT INTO movimientos_custodia')) { this.custodyMovements++; return { rows: [] }; }
    if (sql.startsWith('SELECT id,monto_total,monto_capital,fecha_pago')) { const found = this.payments.find((payment) => payment.id === values[0]); return { rows: found ? [{ ...found }] : [] }; }
    if (sql.startsWith('SELECT id FROM pagos_prestamo WHERE prestamo_id')) { const current = this.payments.find((payment) => payment.id === values[1])!; return { rows: this.payments.filter((payment) => !payment.revertido_at && payment.order > current.order).slice(0, 1) }; }
    if (sql.startsWith('SELECT interes_prestamo_id,monto_aplicado')) return { rows: this.allocations.filter((allocation) => allocation.pago_prestamo_id === values[0]).map((allocation) => ({ ...allocation })) };
    if (sql.startsWith('UPDATE intereses_prestamo SET saldo_pendiente=saldo_pendiente+')) { const item = this.interests.find((interest) => interest.id === values[1])!; item.saldo_pendiente = (Number(item.saldo_pendiente) + Number(values[0])).toFixed(2); return { rows: [] }; }
    if (sql.startsWith('SELECT id,fecha_vencimiento,capital_base,monto_interes,saldo_pendiente FROM intereses_prestamo WHERE generado_por_pago_id')) return { rows: this.interests.filter((item) => item.generado_por_pago_id === values[0] && !item.cancelado_at).map((item) => ({ ...item })) };
    if (sql.startsWith('UPDATE intereses_prestamo SET saldo_pendiente=0,cancelado_at=now()')) { const item = this.interests.find((interest) => interest.id === values[3])!; Object.assign(item, { saldo_pendiente: '0.00', cancelado_at: 'now', cancelado_por_reversion_pago_id: String(values[2]) }); return { rows: [] }; }
    if (sql.startsWith('UPDATE pagos_prestamo SET revertido_at=now()')) { this.payments.find((payment) => payment.id === values[2])!.revertido_at = 'now'; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO reversiones_operacion')) return { rows: [{ id: `reversal-${values[0]}` }] };
    return { rows: [] };
  }

  pendingInterest() { return this.interests.filter((item) => !item.cancelado_at).reduce((sum, item) => sum + Number(item.saldo_pendiente), 0); }
}

test('revertir un pago solo de interés restaura el período original y cancela únicamente el siguiente', async () => {
  const db = new LoanMemoryClient();
  const payment = await registerLoanPayment(db as never, db.loan.id, { fechaPago: '2026-09-15', monto: 150 });
  assert.equal(db.pendingInterest(), 150);
  await reverseLoanPayment(db as never, db.loan.id, payment.id, { motivo: 'Pago duplicado' });
  assert.equal(db.loan.capital_pendiente, '1000.00');
  assert.equal(db.pendingInterest(), 150);
  assert.equal(db.interests[0].saldo_pendiente, '150.00');
  assert.equal(db.interests[1].cancelado_por_reversion_pago_id, payment.id);
});

test('revertir un abono restaura capital e interés y cancela el período calculado sobre el capital reducido', async () => {
  const db = new LoanMemoryClient();
  const payment = await registerLoanPayment(db as never, db.loan.id, { fechaPago: '2026-09-15', monto: 350 });
  assert.equal(db.loan.capital_pendiente, '800.00');
  assert.equal(db.interests[1].capital_base, '800.00');
  await reverseLoanPayment(db as never, db.loan.id, payment.id, { motivo: 'Monto incorrecto' });
  assert.equal(db.loan.capital_pendiente, '1000.00');
  assert.equal(db.pendingInterest(), 150);
  assert.equal(db.interests[1].cancelado_at, 'now');
});

test('un pago nuevo reactiva el mismo período cancelado con el capital correcto sin duplicarlo', async () => {
  const db = new LoanMemoryClient();
  const first = await registerLoanPayment(db as never, db.loan.id, { fechaPago: '2026-09-15', monto: 350 });
  await reverseLoanPayment(db as never, db.loan.id, first.id, { motivo: 'Corrección' });
  const second = await registerLoanPayment(db as never, db.loan.id, { fechaPago: '2026-09-16', monto: 250 });
  assert.equal(db.interests.length, 2);
  assert.equal(db.interests[1].generado_por_pago_id, second.id);
  assert.equal(db.interests[1].capital_base, '900.00');
  assert.equal(db.interests[1].monto_interes, '135.00');
  assert.equal(db.interests[1].cancelado_at, null);
});

test('los pagos se revierten en orden inverso y cada paso conserva un solo período pendiente', async () => {
  const db = new LoanMemoryClient();
  const paymentA = await registerLoanPayment(db as never, db.loan.id, { fechaPago: '2026-09-15', monto: 150 });
  const paymentB = await registerLoanPayment(db as never, db.loan.id, { fechaPago: '2026-10-15', monto: 150 });
  await assert.rejects(reverseLoanPayment(db as never, db.loan.id, paymentA.id, { motivo: 'Fuera de orden' }), (error: unknown) => (error as { code?: string }).code === 'REVERSE_ORDER_REQUIRED');
  await reverseLoanPayment(db as never, db.loan.id, paymentB.id, { motivo: 'Revertir B' });
  assert.equal(db.pendingInterest(), 150);
  await reverseLoanPayment(db as never, db.loan.id, paymentA.id, { motivo: 'Revertir A' });
  assert.equal(db.pendingInterest(), 150);
  assert.equal(db.loan.capital_pendiente, '1000.00');
  assert.equal(db.loan.fecha_proximo_pago, '2026-10-01');
});

test('una segunda reversión se rechaza sin crear movimientos adicionales', async () => {
  const db = new LoanMemoryClient();
  const payment = await registerLoanPayment(db as never, db.loan.id, { fechaPago: '2026-09-15', monto: 150 });
  await reverseLoanPayment(db as never, db.loan.id, payment.id, { motivo: 'Primera reversión' });
  const movements = db.custodyMovements;
  await assert.rejects(reverseLoanPayment(db as never, db.loan.id, payment.id, { motivo: 'Segunda reversión' }), (error: unknown) => (error as { code?: string }).code === 'INVALID_PAYMENT');
  assert.equal(db.custodyMovements, movements);
});
