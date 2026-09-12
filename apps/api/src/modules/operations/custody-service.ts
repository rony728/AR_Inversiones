import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { money, toCents } from './inventory-service.js';

const uuid = z.string().uuid();
const reason = z.string().trim().min(3).max(2000);

export const transferInput = z.object({
  socioId: uuid.optional(),
  socioOrigenId: uuid.optional(),
  custodiaOrigenId: uuid,
  socioDestinoId: uuid.optional(),
  custodiaDestinoId: uuid,
  monto: z.coerce.number().positive(),
  observaciones: reason.optional()
}).superRefine((input, context) => {
  const legacy = Boolean(input.socioId && !input.socioOrigenId && !input.socioDestinoId);
  if (!input.socioOrigenId && !input.socioId) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Selecciona el socio de origen.', path: ['socioOrigenId'] });
  if (!input.socioDestinoId && !input.socioId) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Selecciona el socio de destino.', path: ['socioDestinoId'] });
  if (!legacy && !input.observaciones) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Indica un motivo de al menos 3 caracteres.', path: ['observaciones'] });
}).transform((input) => ({ ...input, socioOrigenId: input.socioOrigenId ?? input.socioId!, socioDestinoId: input.socioDestinoId ?? input.socioId!, observaciones: input.observaciones ?? 'Transferencia interna registrada antes de la actualización' })).refine((input) => input.custodiaOrigenId !== input.custodiaDestinoId, {
  message: 'Los fondos de origen y destino deben ser distintos.', path: ['custodiaDestinoId']
});

export const fundAdjustmentInput = z.object({
  socioId: uuid,
  custodiaId: uuid,
  nuevoSaldo: z.coerce.number().min(0),
  motivo: reason
});

type Custody = { id: string; socio_id: string; actividad: 'PRODUCTOS' | 'PRESTAMOS'; saldo_actual: string };

async function lockCustodies(client: PoolClient, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  const result = await client.query<Custody>('SELECT id,socio_id,actividad,saldo_actual FROM custodias WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [uniqueIds]);
  if (result.rows.length !== uniqueIds.length) throw new AppError(422, 'Uno de los fondos seleccionados no existe.', 'INVALID_CUSTODY');
  return new Map(result.rows.map((custody) => [custody.id, custody]));
}

export async function transferBetweenCustodies(client: PoolClient, input: z.infer<typeof transferInput>, userId?: string) {
  const custodias = await lockCustodies(client, [input.custodiaOrigenId, input.custodiaDestinoId]);
  const origin = custodias.get(input.custodiaOrigenId)!;
  const destination = custodias.get(input.custodiaDestinoId)!;
  if (origin.socio_id !== input.socioOrigenId || destination.socio_id !== input.socioDestinoId) throw new AppError(422, 'Cada fondo debe pertenecer al socio seleccionado.', 'INVALID_CUSTODY');
  const amountCents = toCents(input.monto); const originCents = toCents(Number(origin.saldo_actual)); const destinationCents = toCents(Number(destination.saldo_actual));
  if (originCents < amountCents) throw new AppError(422, 'El fondo de origen no tiene saldo suficiente.', 'INSUFFICIENT_CUSTODY_BALANCE');
  const transfer = await client.query<{ id: string }>('INSERT INTO transferencias_custodia (socio_id,socio_destino_id,custodia_origen_id,custodia_destino_id,monto,observaciones,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [input.socioOrigenId, input.socioDestinoId, origin.id, destination.id, money(amountCents), input.observaciones, userId ?? null]);
  const originAfter = money(originCents - amountCents); const destinationAfter = money(destinationCents + amountCents);
  await client.query('UPDATE custodias SET saldo_actual=CASE WHEN id=$1 THEN $2::numeric WHEN id=$3 THEN $4::numeric END WHERE id IN ($1,$3)', [origin.id, originAfter, destination.id, destinationAfter]);
  await client.query(`INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id,created_by) VALUES ($1,'TRANSFERENCIA_SALIDA',$2,$3,$4,'TRANSFERENCIA_CUSTODIA',$5,$6),($7,'TRANSFERENCIA_ENTRADA',$8,$9,$10,'TRANSFERENCIA_CUSTODIA',$5,$6)`, [origin.id, money(-amountCents), origin.saldo_actual, originAfter, transfer.rows[0].id, userId ?? null, destination.id, money(amountCents), destination.saldo_actual, destinationAfter]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'transferencia_custodia', entidadId: transfer.rows[0].id, accion: 'TRANSFERENCIA_FONDO', nuevos: { socioOrigenId: input.socioOrigenId, actividadOrigen: origin.actividad, custodiaOrigenId: origin.id, saldoOrigenAnterior: origin.saldo_actual, saldoOrigenNuevo: originAfter, socioDestinoId: input.socioDestinoId, actividadDestino: destination.actividad, custodiaDestinoId: destination.id, saldoDestinoAnterior: destination.saldo_actual, saldoDestinoNuevo: destinationAfter, monto: money(amountCents), motivo: input.observaciones } });
  return { id: transfer.rows[0].id, saldoOrigen: originAfter, saldoDestino: destinationAfter };
}

export async function adjustFundBalance(client: PoolClient, input: z.infer<typeof fundAdjustmentInput>, userId?: string) {
  const custodias = await lockCustodies(client, [input.custodiaId]);
  const custody = custodias.get(input.custodiaId)!;
  if (custody.socio_id !== input.socioId) throw new AppError(422, 'El fondo debe pertenecer al socio seleccionado.', 'INVALID_CUSTODY');
  const beforeCents = toCents(Number(custody.saldo_actual)); const afterCents = toCents(input.nuevoSaldo); const differenceCents = afterCents - beforeCents;
  if (differenceCents === 0) throw new AppError(422, 'El nuevo saldo debe ser diferente del saldo actual.', 'UNCHANGED_CUSTODY_BALANCE');
  const adjustment = await client.query<{ id: string }>('INSERT INTO ajustes_fondo (socio_id,custodia_id,saldo_anterior,saldo_nuevo,diferencia,motivo,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [input.socioId, custody.id, money(beforeCents), money(afterCents), money(differenceCents), input.motivo, userId ?? null]);
  await client.query('UPDATE custodias SET saldo_actual=$1 WHERE id=$2', [money(afterCents), custody.id]);
  await client.query(`INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id,created_by) VALUES ($1,'AJUSTE_MANUAL_FONDO',$2,$3,$4,'AJUSTE_MANUAL_FONDO',$5,$6)`, [custody.id, money(differenceCents), money(beforeCents), money(afterCents), adjustment.rows[0].id, userId ?? null]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'ajuste_fondo', entidadId: adjustment.rows[0].id, accion: 'AJUSTE_MANUAL_FONDO', anteriores: { socioId: input.socioId, custodiaId: custody.id, actividad: custody.actividad, saldo: money(beforeCents) }, nuevos: { socioId: input.socioId, custodiaId: custody.id, actividad: custody.actividad, saldo: money(afterCents), diferencia: money(differenceCents), motivo: input.motivo } });
  return { id: adjustment.rows[0].id, saldoAnterior: money(beforeCents), saldoNuevo: money(afterCents), diferencia: money(differenceCents) };
}
