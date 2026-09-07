import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { money, toCents } from './inventory-service.js';

const uuid = z.string().uuid();
export const expenseInput = z.object({
  socioId: uuid,
  custodiaId: uuid,
  concepto: z.string().trim().min(1).max(300),
  monto: z.coerce.number().positive(),
  fecha: z.string().date().default(() => new Date().toISOString().slice(0, 10))
});

export const distributionInput = z.object({
  fecha: z.string().date().default(() => new Date().toISOString().slice(0, 10)),
  utilidadTotal: z.coerce.number().positive(),
  observaciones: z.string().max(2000).optional(),
  socios: z.array(z.object({
    socioBeneficiarioId: uuid,
    custodiaId: uuid,
    socioCubridorId: uuid.optional(),
    custodiaCoberturaId: uuid.optional()
  })).length(3)
});

type Custody = { id: string; socio_id: string; saldo_actual: string };
type DistributionPartner = z.infer<typeof distributionInput>['socios'][number];

async function lockCustodies(client: PoolClient, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  const result = await client.query<Custody>('SELECT id,socio_id,saldo_actual FROM custodias WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [uniqueIds]);
  if (result.rows.length !== uniqueIds.length) throw new AppError(422, 'Uno de los fondos seleccionados no existe.', 'INVALID_CUSTODY');
  return new Map(result.rows.map((custody) => [custody.id, custody]));
}

export async function registerExpense(client: PoolClient, input: z.infer<typeof expenseInput>, userId?: string) {
  const custodias = await lockCustodies(client, [input.custodiaId]);
  const custody = custodias.get(input.custodiaId)!;
  if (custody.socio_id !== input.socioId) throw new AppError(422, 'El fondo debe pertenecer al socio seleccionado.', 'INVALID_CUSTODY');
  const amountCents = toCents(input.monto); const balanceCents = toCents(Number(custody.saldo_actual));
  if (balanceCents < amountCents) throw new AppError(422, 'El fondo no tiene saldo suficiente para registrar el gasto.', 'INSUFFICIENT_CUSTODY_BALANCE');
  const expense = await client.query<{ id: string }>('INSERT INTO gastos (socio_id,custodia_id,concepto,monto,fecha,estado,created_by) VALUES ($1,$2,$3,$4,$5,\'CONFIRMADO\',$6) RETURNING id', [input.socioId, input.custodiaId, input.concepto, money(amountCents), input.fecha, userId ?? null]);
  const after = money(balanceCents - amountCents);
  await client.query('UPDATE custodias SET saldo_actual=$1 WHERE id=$2', [after, input.custodiaId]);
  await client.query(`INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id,created_by) VALUES ($1,'GASTO',$2,$3,$4,'GASTO',$5,$6)`, [input.custodiaId, money(-amountCents), custody.saldo_actual, after, expense.rows[0].id, userId ?? null]);
  await client.query(`INSERT INTO movimientos_financieros (tipo,fecha,monto,socio_id,referencia_tipo,referencia_id,descripcion) VALUES ('GASTO',$1,$2,$3,'GASTO',$4,$5)`, [input.fecha, money(amountCents), input.socioId, expense.rows[0].id, input.concepto]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'gasto', entidadId: expense.rows[0].id, accion: 'CONFIRMAR', nuevos: { socioId: input.socioId, custodiaId: input.custodiaId, monto: money(amountCents), concepto: input.concepto } });
  return { id: expense.rows[0].id, monto: money(amountCents), saldoCustodia: after };
}

export function distributionShareCents(total: number) {
  const totalCents = toCents(total);
  if (totalCents % 3 !== 0) throw new AppError(422, 'La utilidad total debe poder dividirse exactamente entre tres socios.', 'INVALID_DISTRIBUTION_AMOUNT');
  return totalCents / 3;
}

export async function registerProfitDistribution(client: PoolClient, input: z.infer<typeof distributionInput>, userId?: string) {
  const shareCents = distributionShareCents(input.utilidadTotal);
  const totalCents = shareCents * 3;
  const activePartners = await client.query<{ id: string }>('SELECT id FROM socios WHERE activo = true ORDER BY nombre');
  const activeIds = new Set(activePartners.rows.map((partner) => partner.id));
  const beneficiaryIds = input.socios.map((item) => item.socioBeneficiarioId);
  if (activeIds.size !== 3 || beneficiaryIds.some((id) => !activeIds.has(id)) || new Set(beneficiaryIds).size !== 3) throw new AppError(422, 'La distribución debe incluir exactamente a Rony, Alex y Brian una vez cada uno.', 'INVALID_DISTRIBUTION_PARTNERS');
  const custodyIds = input.socios.flatMap((item) => [item.custodiaId, item.custodiaCoberturaId]).filter(Boolean) as string[];
  const custodias = await lockCustodies(client, custodyIds);
  const distribution = await client.query<{ id: string }>('INSERT INTO distribuciones_utilidades (fecha,utilidad_total,monto_por_socio,observaciones,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [input.fecha, money(totalCents), money(shareCents), input.observaciones ?? null, userId ?? null]);
  const balances = new Map([...custodias.entries()].map(([id, custody]) => [id, toCents(Number(custody.saldo_actual))]));
  const pendingMovements: Array<{ custody: Custody; cents: number; beneficiaryId: string; covererId: string; type: 'DISTRIBUCION_UTILIDAD' | 'COBERTURA_DISTRIBUCION' }> = [];
  for (const partner of input.socios) {
    const own = custodias.get(partner.custodiaId);
    if (!own || own.socio_id !== partner.socioBeneficiarioId) throw new AppError(422, 'El fondo base debe pertenecer al socio beneficiario.', 'INVALID_CUSTODY');
    const ownDebit = Math.min(balances.get(own.id) ?? 0, shareCents);
    if (ownDebit > 0) { pendingMovements.push({ custody: own, cents: ownDebit, beneficiaryId: partner.socioBeneficiarioId, covererId: partner.socioBeneficiarioId, type: 'DISTRIBUCION_UTILIDAD' }); balances.set(own.id, (balances.get(own.id) ?? 0) - ownDebit); }
    const shortage = shareCents - ownDebit;
    if (shortage > 0) addCoverage(partner, custodias, balances, pendingMovements, shortage);
  }
  for (const movement of pendingMovements) {
    const before = toCents(Number(movement.custody.saldo_actual)); const alreadyDebited = pendingMovements.slice(0, pendingMovements.indexOf(movement)).filter((item) => item.custody.id === movement.custody.id).reduce((sum, item) => sum + item.cents, 0);
    const prior = before - alreadyDebited; const after = prior - movement.cents;
    await client.query('INSERT INTO cuotas_distribucion_utilidad (distribucion_id,socio_beneficiario_id,socio_cubridor_id,custodia_id,monto) VALUES ($1,$2,$3,$4,$5)', [distribution.rows[0].id, movement.beneficiaryId, movement.covererId, movement.custody.id, money(movement.cents)]);
    await client.query('UPDATE custodias SET saldo_actual=$1 WHERE id=$2', [money(after), movement.custody.id]);
    await client.query(`INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id,created_by) VALUES ($1,$2,$3,$4,$5,'DISTRIBUCION_UTILIDAD',$6,$7)`, [movement.custody.id, movement.type, money(-movement.cents), money(prior), money(after), distribution.rows[0].id, userId ?? null]);
    await client.query(`INSERT INTO movimientos_financieros (tipo,fecha,monto,socio_id,referencia_tipo,referencia_id,descripcion) VALUES ('DISTRIBUCION_UTILIDAD',$1,$2,$3,'DISTRIBUCION_UTILIDAD',$4,$5)`, [input.fecha, money(movement.cents), movement.covererId, distribution.rows[0].id, input.observaciones ?? 'Distribución de utilidad']);
  }
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'distribucion_utilidad', entidadId: distribution.rows[0].id, accion: 'CONFIRMAR', nuevos: { utilidadTotal: money(totalCents), montoPorSocio: money(shareCents) } });
  return { id: distribution.rows[0].id, utilidadTotal: money(totalCents), montoPorSocio: money(shareCents) };
}

function addCoverage(partner: DistributionPartner, custodias: Map<string, Custody>, balances: Map<string, number>, movements: Array<{ custody: Custody; cents: number; beneficiaryId: string; covererId: string; type: 'DISTRIBUCION_UTILIDAD' | 'COBERTURA_DISTRIBUCION' }>, shortage: number) {
  if (!partner.socioCubridorId || !partner.custodiaCoberturaId) throw new AppError(422, 'Debes seleccionar el socio y el fondo que cubrirá la diferencia.', 'DISTRIBUTION_COVERAGE_REQUIRED');
  const cover = custodias.get(partner.custodiaCoberturaId);
  if (!cover || cover.socio_id !== partner.socioCubridorId) throw new AppError(422, 'El fondo de cobertura debe pertenecer al socio cubridor.', 'INVALID_COVERAGE_CUSTODY');
  const coverBalance = balances.get(cover.id) ?? 0;
  if (coverBalance < shortage) throw new AppError(422, 'El fondo de cobertura no tiene saldo suficiente para cubrir la diferencia.', 'INSUFFICIENT_COVERAGE_BALANCE');
  balances.set(cover.id, coverBalance - shortage);
  movements.push({ custody: cover, cents: shortage, beneficiaryId: partner.socioBeneficiarioId, covererId: partner.socioCubridorId, type: 'COBERTURA_DISTRIBUCION' });
}
