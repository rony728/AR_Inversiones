import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { money, toCents } from './inventory-service.js';
import { requireActiveClient } from './client-guard.js';

const uuid = z.string().uuid();
const isoDate = z.string().date();
export const loanInput = z.object({ clienteId: uuid, socioId: uuid, custodiaId: uuid, capital: z.coerce.number().positive(), tasaMensual: z.coerce.number().min(0).max(100).default(15), fechaDesembolso: isoDate.default(() => new Date().toISOString().slice(0, 10)), fechaProximoPago: isoDate.optional(), observaciones: z.string().max(2000).optional() });
export const paymentInput = z.object({ fechaPago: isoDate.default(() => new Date().toISOString().slice(0, 10)), monto: z.coerce.number().positive() });
export type LoanInput = z.infer<typeof loanInput>;

type Loan = { id: string; socio_id: string; custodia_id: string; capital_pendiente: string; tasa_mensual: string; fecha_proximo_pago: string; calcular_interes_desde?: string | null; estado: 'ACTIVO' | 'VENCIDO' | 'PAGADO' | 'ANULADO' };
type Interest = { id: string; fecha_vencimiento: string; saldo_pendiente: string };

export function addMonth(date: string) { const [year, month, day] = date.split('-').map(Number); const targetMonth = month === 12 ? 1 : month + 1; const targetYear = month === 12 ? year + 1 : year; const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate(); return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`; }
function interestAmount(capital: number, rate: number) { return money(toCents(capital * (rate / 100))); }
async function lockLoansCustody(client: PoolClient, custodyId: string, partnerId: string) { const result = await client.query<{ saldo_actual: string }>(`SELECT saldo_actual FROM custodias WHERE id=$1 AND socio_id=$2 AND actividad='PRESTAMOS' FOR UPDATE`, [custodyId, partnerId]); if (!result.rows[0]) throw new AppError(422, 'El fondo debe ser PRESTAMOS y pertenecer al socio indicado.', 'INVALID_CUSTODY'); return Number(result.rows[0].saldo_actual); }
async function createInterest(client: PoolClient, loan: Loan, dueDate: string) { const capital = Number(loan.capital_pendiente); const rate = Number(loan.tasa_mensual); const amount = interestAmount(capital, rate); await client.query(`INSERT INTO intereses_prestamo (prestamo_id,fecha_vencimiento,capital_base,tasa_mensual,monto_interes,saldo_pendiente) VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (prestamo_id,fecha_vencimiento) DO NOTHING`, [loan.id, dueDate, money(toCents(capital)), rate, amount]); }

export async function accrueLoanInterest(client: PoolClient, loan: Loan, through: string) {
  let nextDate = loan.fecha_proximo_pago; let overdue = false;
  while (nextDate <= through) { if (!loan.calcular_interes_desde || nextDate >= loan.calcular_interes_desde) await createInterest(client, loan, nextDate); overdue = true; nextDate = addMonth(nextDate); }
  if (overdue) await client.query(`UPDATE prestamos SET fecha_proximo_pago=$1, estado='VENCIDO' WHERE id=$2`, [nextDate, loan.id]);
  return { ...loan, fecha_proximo_pago: nextDate, estado: overdue ? 'VENCIDO' as const : loan.estado };
}

export async function refreshOverdueLoans(client: PoolClient, through: string) {
  const result = await client.query<Loan>(`SELECT id,socio_id,custodia_id,capital_pendiente,tasa_mensual,fecha_proximo_pago,calcular_interes_desde,estado FROM prestamos WHERE estado IN ('ACTIVO','VENCIDO') FOR UPDATE`);
  for (const loan of result.rows) await accrueLoanInterest(client, loan, through);
}

export async function createLoan(client: PoolClient, input: LoanInput, userId?: string) {
  await requireActiveClient(client, input.clienteId);
  const capitalCents = toCents(input.capital); const balance = await lockLoansCustody(client, input.custodiaId, input.socioId);
  if (toCents(balance) < capitalCents) throw new AppError(422, 'El fondo de préstamos no tiene saldo suficiente.', 'INSUFFICIENT_CUSTODY_BALANCE');
  const nextDate = input.fechaProximoPago ?? addMonth(input.fechaDesembolso);
  const loanResult = await client.query<Loan>(`INSERT INTO prestamos (cliente_id,socio_id,custodia_id,fecha_desembolso,fecha_proximo_pago,tasa_mensual,capital_original,capital_pendiente,estado,observaciones,created_by,calcular_interes_desde) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'ACTIVO',$8,$9,$4) RETURNING id,socio_id,custodia_id,capital_pendiente,tasa_mensual,fecha_proximo_pago,calcular_interes_desde,estado`, [input.clienteId, input.socioId, input.custodiaId, input.fechaDesembolso, nextDate, input.tasaMensual, money(capitalCents), input.observaciones ?? null, userId ?? null]);
  const loan = loanResult.rows[0]; await createInterest(client, loan, nextDate);
  const after = money(toCents(balance) - capitalCents);
  await client.query('UPDATE custodias SET saldo_actual=$1 WHERE id=$2', [after, input.custodiaId]);
  await client.query(`INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id,created_by) VALUES ($1,'DESEMBOLSO_PRESTAMO',$2,$3,$4,'PRESTAMO',$5,$6)`, [input.custodiaId, money(-capitalCents), balance, after, loan.id, userId ?? null]);
  await client.query(`INSERT INTO movimientos_financieros (tipo,fecha,monto,socio_id,referencia_tipo,referencia_id,descripcion) VALUES ('DESEMBOLSO_PRESTAMO',$1,$2,$3,'PRESTAMO',$4,$5)`, [input.fechaDesembolso, money(capitalCents), input.socioId, loan.id, input.observaciones ?? 'Desembolso de préstamo']);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'prestamo', entidadId: loan.id, accion: 'CREAR', nuevos: { capital: money(capitalCents), tasaMensual: input.tasaMensual, fechaProximoPago: nextDate } });
  return { id: loan.id, capitalPendiente: money(capitalCents), fechaProximoPago: nextDate };
}

export async function registerLoanPayment(client: PoolClient, loanId: string, input: z.infer<typeof paymentInput>, userId?: string) {
  const locked = await client.query<Loan>(`SELECT id,socio_id,custodia_id,capital_pendiente,tasa_mensual,fecha_proximo_pago,calcular_interes_desde,estado FROM prestamos WHERE id=$1 FOR UPDATE`, [loanId]);
  if (!locked.rows[0] || locked.rows[0].estado === 'PAGADO' || locked.rows[0].estado === 'ANULADO') throw new AppError(422, 'El préstamo no está disponible para recibir pagos.', 'INVALID_LOAN_STATE');
  const loan = await accrueLoanInterest(client, locked.rows[0], input.fechaPago);
  const interests = await client.query<Interest>(`SELECT id,fecha_vencimiento,saldo_pendiente FROM intereses_prestamo WHERE prestamo_id=$1 AND saldo_pendiente>0 ORDER BY fecha_vencimiento FOR UPDATE`, [loanId]);
  const requiredInterestCents = interests.rows.reduce((sum, interest) => sum + toCents(Number(interest.saldo_pendiente)), 0); const capitalCents = toCents(Number(loan.capital_pendiente)); const paidCents = toCents(input.monto);
  if (paidCents < requiredInterestCents) throw new AppError(422, 'El pago debe cubrir por completo el interés pendiente.', 'INSUFFICIENT_INTEREST_PAYMENT');
  if (paidCents > requiredInterestCents + capitalCents) throw new AppError(422, 'El pago excede el total adeudado.', 'EXCESSIVE_PAYMENT');
  const paidCapitalCents = paidCents - requiredInterestCents; const nextCapitalCents = capitalCents - paidCapitalCents; const custodyBalance = await lockLoansCustody(client, loan.custodia_id, loan.socio_id);
  const payment = await client.query<{ id: string }>(`INSERT INTO pagos_prestamo (prestamo_id,custodia_id,fecha_pago,monto_total,monto_interes,monto_capital,saldo_capital_anterior,saldo_capital_posterior,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [loanId, loan.custodia_id, input.fechaPago, money(paidCents), money(requiredInterestCents), money(paidCapitalCents), money(capitalCents), money(nextCapitalCents), userId ?? null]);
  for (const interest of interests.rows) { const amountCents = toCents(Number(interest.saldo_pendiente)); await client.query('UPDATE intereses_prestamo SET saldo_pendiente=0 WHERE id=$1', [interest.id]); await client.query('INSERT INTO pagos_intereses_prestamo (pago_prestamo_id,interes_prestamo_id,monto_aplicado) VALUES ($1,$2,$3)', [payment.rows[0].id, interest.id, money(amountCents)]); }
  let nextDue = loan.fecha_proximo_pago; if (interests.rows.some((interest) => interest.fecha_vencimiento === nextDue)) nextDue = addMonth(nextDue);
  const state = nextCapitalCents === 0 ? 'PAGADO' : 'ACTIVO';
  await client.query('UPDATE prestamos SET capital_pendiente=$1,fecha_proximo_pago=$2,estado=$3 WHERE id=$4', [money(nextCapitalCents), nextDue, state, loanId]);
  if (nextCapitalCents > 0) await createInterest(client, { ...loan, capital_pendiente: money(nextCapitalCents), fecha_proximo_pago: nextDue }, nextDue);
  const after = money(toCents(custodyBalance) + paidCents);
  await client.query('UPDATE custodias SET saldo_actual=$1 WHERE id=$2', [after, loan.custodia_id]);
  await client.query(`INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id,created_by) VALUES ($1,'PAGO_PRESTAMO',$2,$3,$4,'PAGO_PRESTAMO',$5,$6)`, [loan.custodia_id, money(paidCents), custodyBalance, after, payment.rows[0].id, userId ?? null]);
  if (requiredInterestCents) await client.query(`INSERT INTO movimientos_financieros (tipo,fecha,monto,socio_id,referencia_tipo,referencia_id,descripcion) VALUES ('INGRESO_INTERES',$1,$2,$3,'PAGO_PRESTAMO',$4,'Interés de préstamo')`, [input.fechaPago, money(requiredInterestCents), loan.socio_id, payment.rows[0].id]);
  if (paidCapitalCents) await client.query(`INSERT INTO movimientos_financieros (tipo,fecha,monto,socio_id,referencia_tipo,referencia_id,descripcion) VALUES ('COBRO_CAPITAL',$1,$2,$3,'PAGO_PRESTAMO',$4,'Recuperación de capital')`, [input.fechaPago, money(paidCapitalCents), loan.socio_id, payment.rows[0].id]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'pago_prestamo', entidadId: payment.rows[0].id, accion: 'REGISTRAR', nuevos: { interes: money(requiredInterestCents), capital: money(paidCapitalCents), capitalPendiente: money(nextCapitalCents) } });
  return { id: payment.rows[0].id, interes: money(requiredInterestCents), capital: money(paidCapitalCents), capitalPendiente: money(nextCapitalCents), estado: state, fechaProximoPago: nextDue };
}

export async function changeNextPaymentDate(client: PoolClient, loanId: string, nextDate: string, userId?: string) {
  const result = await client.query<Loan>('SELECT id,socio_id,custodia_id,capital_pendiente,tasa_mensual,fecha_proximo_pago,calcular_interes_desde,estado FROM prestamos WHERE id=$1 FOR UPDATE', [loanId]); const loan = result.rows[0]; if (!loan || loan.estado === 'PAGADO' || loan.estado === 'ANULADO') throw new AppError(422, 'No se puede modificar la fecha de este préstamo.', 'INVALID_LOAN_STATE');
  const before = loan.fecha_proximo_pago; await client.query('UPDATE prestamos SET fecha_proximo_pago=$1 WHERE id=$2', [nextDate, loanId]);
  await client.query(`UPDATE intereses_prestamo SET fecha_vencimiento=$1 WHERE prestamo_id=$2 AND fecha_vencimiento=$3 AND saldo_pendiente>0`, [nextDate, loanId, before]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'prestamo', entidadId: loanId, accion: 'CAMBIAR_FECHA_PROXIMO_PAGO', anteriores: { fechaProximoPago: before }, nuevos: { fechaProximoPago: nextDate } });
  return { id: loanId, fechaProximoPago: nextDate };
}
