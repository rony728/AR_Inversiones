import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';

export const userCreateInput = z.object({ nombre: z.string().trim().min(2).max(160), usuario: z.string().trim().min(3).max(80), password: z.string().min(8).max(200) }).strict();
export const userUpdateInput = z.object({ nombre: z.string().trim().min(2).max(160).optional(), usuario: z.string().trim().min(3).max(80).optional(), activo: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'No hay cambios para guardar.');
export const passwordChangeInput = z.object({ password: z.string().min(8).max(200) }).strict();
type SafeUser = { id: string; nombre: string; usuario: string; activo: boolean; created_at?: string; updated_at?: string };

const safeColumns = 'id,nombre,usuario,activo,created_at,updated_at';

export async function createUser(client: PoolClient, input: z.infer<typeof userCreateInput>, actorId?: string) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = await client.query<SafeUser>(`INSERT INTO usuarios (nombre,usuario,password_hash) VALUES ($1,$2,$3) RETURNING ${safeColumns}`, [input.nombre, input.usuario, passwordHash]);
  await writeAudit(client, { usuarioId: actorId, entidadTipo: 'usuario', entidadId: result.rows[0].id, accion: 'CREAR', nuevos: result.rows[0] });
  return result.rows[0];
}

export async function updateUser(client: PoolClient, userId: string, input: z.infer<typeof userUpdateInput>, actorId?: string) {
  const before = await client.query<SafeUser>(`SELECT ${safeColumns} FROM usuarios WHERE id=$1`, [userId]);
  if (!before.rows[0]) throw new AppError(404, 'Usuario no encontrado.', 'NOT_FOUND');
  const entries = Object.entries(input); const set = entries.map(([field], index) => `${field}=$${index + 1}`).join(',');
  const result = await client.query<SafeUser>(`UPDATE usuarios SET ${set} WHERE id=$${entries.length + 1} RETURNING ${safeColumns}`, [...entries.map(([, value]) => value), userId]);
  const action = input.activo === undefined || input.activo === before.rows[0].activo ? 'ACTUALIZAR' : input.activo ? 'ACTIVAR' : 'DESACTIVAR';
  await writeAudit(client, { usuarioId: actorId, entidadTipo: 'usuario', entidadId: userId, accion: action, anteriores: before.rows[0], nuevos: result.rows[0] });
  return result.rows[0];
}

export async function changeUserPassword(client: PoolClient, userId: string, input: z.infer<typeof passwordChangeInput>, actorId?: string) {
  const user = await client.query<SafeUser>(`SELECT ${safeColumns} FROM usuarios WHERE id=$1`, [userId]);
  if (!user.rows[0]) throw new AppError(404, 'Usuario no encontrado.', 'NOT_FOUND');
  const passwordHash = await bcrypt.hash(input.password, 12);
  await client.query('UPDATE usuarios SET password_hash=$1 WHERE id=$2', [passwordHash, userId]);
  await writeAudit(client, { usuarioId: actorId, entidadTipo: 'usuario', entidadId: userId, accion: 'CAMBIAR_PASSWORD', anteriores: { credencialActualizada: false }, nuevos: { credencialActualizada: true } });
  return { id: userId, passwordChanged: true };
}
