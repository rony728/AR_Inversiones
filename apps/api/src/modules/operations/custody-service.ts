import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { money, toCents } from './inventory-service.js';

const uuid = z.string().uuid();
export const transferInput = z.object({ socioId: uuid, custodiaOrigenId: uuid, custodiaDestinoId: uuid, monto: z.coerce.number().positive(), observaciones: z.string().max(2000).optional() }).refine((input) => input.custodiaOrigenId !== input.custodiaDestinoId, { message: 'Las custodias de origen y destino deben ser distintas.', path: ['custodiaDestinoId'] });

type Custody = { id: string; socio_id: string; actividad: 'PRODUCTOS' | 'PRESTAMOS'; saldo_actual: string };
export async function transferBetweenCustodies(client: PoolClient, input: z.infer<typeof transferInput>, userId?: string) {
  const custodias = await client.query<Custody>('SELECT id,socio_id,actividad,saldo_actual FROM custodias WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[input.custodiaOrigenId, input.custodiaDestinoId]]);
  if (custodias.rows.length !== 2 || custodias.rows.some((custody) => custody.socio_id !== input.socioId)) throw new AppError(422, 'Las custodias deben pertenecer al socio seleccionado.', 'INVALID_CUSTODY');
  const origin = custodias.rows.find((custody) => custody.id === input.custodiaOrigenId)!; const destination = custodias.rows.find((custody) => custody.id === input.custodiaDestinoId)!;
  if (origin.actividad === destination.actividad) throw new AppError(422, 'La transferencia debe ser entre PRODUCTOS y PRÉSTAMOS.', 'INVALID_TRANSFER');
  const amountCents = toCents(input.monto); const originCents = toCents(Number(origin.saldo_actual)); const destinationCents = toCents(Number(destination.saldo_actual));
  if (originCents < amountCents) throw new AppError(422, 'La custodia de origen no tiene saldo suficiente.', 'INSUFFICIENT_CUSTODY_BALANCE');
  const transfer = await client.query<{ id: string }>('INSERT INTO transferencias_custodia (socio_id,custodia_origen_id,custodia_destino_id,monto,observaciones,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [input.socioId, origin.id, destination.id, money(amountCents), input.observaciones ?? null, userId ?? null]);
  const originAfter = money(originCents - amountCents); const destinationAfter = money(destinationCents + amountCents);
  await client.query('UPDATE custodias SET saldo_actual=CASE WHEN id=$1 THEN $2 WHEN id=$3 THEN $4 END WHERE id IN ($1,$3)', [origin.id, originAfter, destination.id, destinationAfter]);
  await client.query(`INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id,created_by) VALUES ($1,'TRANSFERENCIA_SALIDA',$2,$3,$4,'TRANSFERENCIA_CUSTODIA',$5,$6),($7,'TRANSFERENCIA_ENTRADA',$8,$9,$10,'TRANSFERENCIA_CUSTODIA',$5,$6)`, [origin.id, money(-amountCents), origin.saldo_actual, originAfter, transfer.rows[0].id, userId ?? null, destination.id, money(amountCents), destination.saldo_actual, destinationAfter]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'transferencia_custodia', entidadId: transfer.rows[0].id, accion: 'CREAR', nuevos: { socioId: input.socioId, origen: origin.actividad, destino: destination.actividad, monto: money(amountCents) } });
  return { id: transfer.rows[0].id, origen: originAfter, destino: destinationAfter };
}
