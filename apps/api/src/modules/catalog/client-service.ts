import type { PoolClient } from 'pg';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';

const optionalText = (max?: number) => {
  const text = max ? z.string().max(max) : z.string();
  return text.trim().transform((value) => value || null).nullable().optional();
};

export const clientCreateInput = z.object({
  nombre: z.string().trim().min(1).max(180),
  identificacion: optionalText(80),
  telefono: optionalText(50),
  direccion: optionalText(),
  notas: optionalText()
}).strict();

export const clientUpdateInput = z.object({
  nombre: z.string().trim().min(1).max(180).optional(),
  identificacion: optionalText(80),
  telefono: optionalText(50),
  direccion: optionalText(),
  notas: optionalText(),
  activo: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'Debe indicar al menos un campo editable.');

export type ClientCreateInput = z.infer<typeof clientCreateInput>;
export type ClientUpdateInput = z.infer<typeof clientUpdateInput>;

export const clientListSql = `
  SELECT c.id,c.nombre,c.identificacion,c.telefono,c.direccion,c.notas,c.activo,c.created_at,c.updated_at,
         COALESCE(l.prestamos_activos,0)::integer AS prestamos_activos,
         COALESCE(l.prestamos_vencidos,0)::integer AS prestamos_vencidos,
         (COALESCE(l.prestamos_activos,0)+COALESCE(l.prestamos_vencidos,0))::integer AS prestamos_activos_vencidos,
         COALESCE(l.capital_pendiente,0)::numeric AS capital_pendiente_total
    FROM clientes c
    LEFT JOIN (
      SELECT cliente_id,
             count(*) FILTER (WHERE estado='ACTIVO') AS prestamos_activos,
             count(*) FILTER (WHERE estado='VENCIDO') AS prestamos_vencidos,
             COALESCE(sum(capital_pendiente) FILTER (WHERE estado IN ('ACTIVO','VENCIDO')),0) AS capital_pendiente
        FROM prestamos WHERE eliminado_at IS NULL GROUP BY cliente_id
    ) l ON l.cliente_id=c.id
   ORDER BY lower(c.nombre),c.id`;

function duplicateIdentification(error: unknown): never {
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code === '23505' && pgError.constraint === 'clientes_identificacion_unica') throw new AppError(409, 'Ya existe un cliente con esa identificación.', 'DUPLICATE_CLIENT_IDENTIFICATION');
  throw error;
}

export async function createClient(client: PoolClient, input: ClientCreateInput, userId?: string) {
  try {
    const result = await client.query(
      `INSERT INTO clientes (nombre,identificacion,telefono,direccion,notas)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.nombre, input.identificacion ?? null, input.telefono ?? null, input.direccion ?? null, input.notas ?? null]
    );
    await writeAudit(client, { usuarioId: userId, entidadTipo: 'cliente', entidadId: result.rows[0].id, accion: 'CREAR', nuevos: result.rows[0] });
    return result.rows[0];
  } catch (error) { return duplicateIdentification(error); }
}

export async function updateClient(client: PoolClient, clientId: string, input: ClientUpdateInput, userId?: string) {
  const beforeResult = await client.query('SELECT * FROM clientes WHERE id=$1 FOR UPDATE', [clientId]);
  const before = beforeResult.rows[0] as Record<string, unknown> | undefined;
  if (!before) throw new AppError(404, 'Cliente no encontrado.', 'NOT_FOUND');

  const fieldMap = { nombre: 'nombre', identificacion: 'identificacion', telefono: 'telefono', direccion: 'direccion', notas: 'notas', activo: 'activo' } as const;
  const entries = (Object.entries(input) as Array<[keyof typeof fieldMap, unknown]>).filter(([field, value]) => before[fieldMap[field]] !== value);
  if (!entries.length) throw new AppError(422, 'No hay cambios para guardar.', 'NO_CHANGES');

  try {
    const set = entries.map(([field], index) => `${fieldMap[field]}=$${index + 1}`).join(',');
    const result = await client.query(`UPDATE clientes SET ${set} WHERE id=$${entries.length + 1} RETURNING *`, [...entries.map(([, value]) => value), clientId]);
    const activeChange = entries.find(([field]) => field === 'activo');
    const action = activeChange ? (activeChange[1] ? 'REACTIVAR' : 'DESACTIVAR') : 'ACTUALIZAR';
    await writeAudit(client, { usuarioId: userId, entidadTipo: 'cliente', entidadId: clientId, accion: action, anteriores: before, nuevos: result.rows[0] });
    return result.rows[0];
  } catch (error) { return duplicateIdentification(error); }
}

export function summarizeClientLoans(loans: Array<{ estado: string; capital_pendiente: number | string }>) {
  return loans.reduce((summary, loan) => ({
    activos: summary.activos + (loan.estado === 'ACTIVO' ? 1 : 0),
    vencidos: summary.vencidos + (loan.estado === 'VENCIDO' ? 1 : 0),
    pagados: summary.pagados + (loan.estado === 'PAGADO' ? 1 : 0),
    capitalPendiente: summary.capitalPendiente + (loan.estado === 'ACTIVO' || loan.estado === 'VENCIDO' ? Number(loan.capital_pendiente) : 0)
  }), { activos: 0, vencidos: 0, pagados: 0, capitalPendiente: 0 });
}
