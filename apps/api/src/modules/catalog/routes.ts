import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError, asyncHandler } from '../../lib/errors.js';

type Resource = 'clientes' | 'categorias' | 'proveedores' | 'productos' | 'usuarios';
const resources: Record<Resource, { fields: readonly string[]; updateFields: readonly string[] }> = {
  clientes: { fields: ['nombre', 'identificacion', 'telefono', 'direccion', 'notas'], updateFields: ['nombre', 'identificacion', 'telefono', 'direccion', 'notas', 'activo'] },
  categorias: { fields: ['nombre'], updateFields: ['nombre', 'activo'] },
  proveedores: { fields: ['nombre', 'identificacion', 'telefono', 'direccion'], updateFields: ['nombre', 'identificacion', 'telefono', 'direccion', 'activo'] },
  productos: { fields: ['categoria_id', 'codigo', 'nombre', 'descripcion'], updateFields: ['categoria_id', 'codigo', 'nombre', 'descripcion', 'activo'] },
  usuarios: { fields: ['nombre', 'usuario', 'password_hash'], updateFields: ['nombre', 'usuario', 'activo'] }
};
const id = z.string().uuid();

function permitted(resource: Resource, source: Record<string, unknown>, keys: readonly string[]) {
  const values = keys.filter((key) => key in source).map((key) => source[key]);
  const fields = keys.filter((key) => key in source);
  if (!fields.length) throw new AppError(422, 'No hay campos válidos para actualizar.', 'VALIDATION_ERROR');
  return { fields, values };
}

export const catalogRouter = Router();

catalogRouter.get('/socios', asyncHandler(async (_req, res) => {
  const result = await query(`SELECT s.*, COALESCE(json_agg(json_build_object('id', c.id, 'actividad', c.actividad, 'saldo_actual', c.saldo_actual)) FILTER (WHERE c.id IS NOT NULL), '[]') AS custodias FROM socios s LEFT JOIN custodias c ON c.socio_id = s.id GROUP BY s.id ORDER BY s.nombre`);
  res.json({ data: result.rows });
}));

catalogRouter.post('/socios', asyncHandler(async (req, res) => {
  const input = z.object({ nombre: z.string().trim().min(2).max(120) }).parse(req.body);
  const partner = await withTransaction(async (client) => {
    const created = await client.query<{ id: string; nombre: string }>('INSERT INTO socios (nombre) VALUES ($1) RETURNING id, nombre', [input.nombre]);
    await client.query(`INSERT INTO custodias (socio_id, actividad) VALUES ($1, 'PRODUCTOS'), ($1, 'PRESTAMOS')`, [created.rows[0].id]);
    await writeAudit(client, { usuarioId: req.user?.id, entidadTipo: 'socio', entidadId: created.rows[0].id, accion: 'CREAR', nuevos: created.rows[0] });
    return created.rows[0];
  });
  res.status(201).json({ data: partner });
}));

catalogRouter.patch('/socios/:id', asyncHandler(async (req, res) => {
  const partnerId = id.parse(req.params.id);
  const input = z.object({ nombre: z.string().trim().min(2).max(120).optional(), activo: z.boolean().optional() }).refine((value) => value.nombre !== undefined || value.activo !== undefined).parse(req.body);
  const fields = Object.keys(input);
  const partner = await withTransaction(async (client) => {
    const before = await client.query('SELECT * FROM socios WHERE id = $1', [partnerId]);
    const result = await client.query(`UPDATE socios SET ${fields.map((field, index) => `${field} = $${index + 1}`).join(', ')} WHERE id = $${fields.length + 1} RETURNING *`, [...Object.values(input), partnerId]);
    if (!result.rows[0]) throw new AppError(404, 'Socio no encontrado.', 'NOT_FOUND');
    await writeAudit(client, { usuarioId: req.user?.id, entidadTipo: 'socio', entidadId: partnerId, accion: 'ACTUALIZAR', anteriores: before.rows[0], nuevos: result.rows[0] });
    return result.rows[0];
  });
  res.json({ data: partner });
}));

catalogRouter.post('/usuarios', asyncHandler(async (req, res) => {
  const input = z.object({ nombre: z.string().trim().min(2).max(160), usuario: z.string().trim().min(3).max(80), password: z.string().min(8).max(200) }).parse(req.body);
  const created = await withTransaction(async (client) => {
    const passwordHash = await bcrypt.hash(input.password, 12);
    const result = await client.query<{ id: string; nombre: string; usuario: string; activo: boolean }>(
      'INSERT INTO usuarios (nombre, usuario, password_hash) VALUES ($1, $2, $3) RETURNING id, nombre, usuario, activo',
      [input.nombre, input.usuario, passwordHash]
    );
    await writeAudit(client, { usuarioId: req.user?.id, entidadTipo: 'usuario', entidadId: result.rows[0].id, accion: 'CREAR', nuevos: result.rows[0] });
    return result.rows[0];
  });
  res.status(201).json({ data: created });
}));

catalogRouter.get('/:resource', asyncHandler(async (req, res) => {
  const resource = z.enum(['clientes', 'categorias', 'proveedores', 'productos', 'usuarios']).parse(req.params.resource) as Resource;
  const result = await query(`SELECT ${resource === 'usuarios' ? 'id, nombre, usuario, activo, created_at, updated_at' : '*'} FROM ${resource} ORDER BY created_at DESC`);
  res.json({ data: result.rows });
}));

catalogRouter.post('/:resource', asyncHandler(async (req, res) => {
  const resource = z.enum(['clientes', 'categorias', 'proveedores', 'productos']).parse(req.params.resource) as Resource;
  const { fields, values } = permitted(resource, req.body as Record<string, unknown>, resources[resource].fields);
  const created = await withTransaction(async (client) => {
    const result = await client.query(`INSERT INTO ${resource} (${fields.join(', ')}) VALUES (${fields.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING *`, values);
    await writeAudit(client, { usuarioId: req.user?.id, entidadTipo: resource, entidadId: result.rows[0].id, accion: 'CREAR', nuevos: result.rows[0] });
    return result.rows[0];
  });
  res.status(201).json({ data: created });
}));

catalogRouter.patch('/:resource/:id', asyncHandler(async (req, res) => {
  const resource = z.enum(['clientes', 'categorias', 'proveedores', 'productos', 'usuarios']).parse(req.params.resource) as Resource;
  const resourceId = id.parse(req.params.id);
  const { fields, values } = permitted(resource, req.body as Record<string, unknown>, resources[resource].updateFields);
  const set = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
  const updated = await withTransaction(async (client) => {
    const before = await client.query(`SELECT * FROM ${resource} WHERE id = $1`, [resourceId]);
    const result = await client.query(`UPDATE ${resource} SET ${set} WHERE id = $${fields.length + 1} RETURNING ${resource === 'usuarios' ? 'id, nombre, usuario, activo, created_at, updated_at' : '*'}`, [...values, resourceId]);
    if (!result.rows[0]) throw new AppError(404, 'Registro no encontrado.', 'NOT_FOUND');
    await writeAudit(client, { usuarioId: req.user?.id, entidadTipo: resource, entidadId: resourceId, accion: 'ACTUALIZAR', anteriores: before.rows[0], nuevos: result.rows[0] });
    return result.rows[0];
  });
  res.json({ data: updated });
}));
