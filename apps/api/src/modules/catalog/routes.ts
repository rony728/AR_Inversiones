import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { categoryCreateInput, categoryUpdateInput, productCreateInput, productUpdateInput } from './product-input.js';
import { clientCreateInput, clientListSql, clientUpdateInput, createClient, summarizeClientLoans, updateClient } from './client-service.js';

type Resource = 'categorias' | 'proveedores' | 'productos' | 'usuarios';
const resources: Record<Resource, { fields: readonly string[]; updateFields: readonly string[] }> = {
  categorias: { fields: ['nombre'], updateFields: ['nombre', 'activo'] },
  proveedores: { fields: ['nombre', 'identificacion', 'telefono', 'direccion'], updateFields: ['nombre', 'identificacion', 'telefono', 'direccion', 'activo'] },
  productos: { fields: [], updateFields: [] },
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

catalogRouter.get('/clientes', asyncHandler(async (_req, res) => {
  const result = await query(clientListSql);
  res.json({ data: result.rows });
}));

catalogRouter.get('/clientes/:id', asyncHandler(async (req, res) => {
  const clientId = id.parse(req.params.id);
  const detail = await withTransaction(async (client) => {
    const clientResult = await client.query('SELECT * FROM clientes WHERE id=$1', [clientId]);
    if (!clientResult.rows[0]) throw new AppError(404, 'Cliente no encontrado.', 'NOT_FOUND');
    const loansResult = await client.query(
      `SELECT id,fecha_desembolso,capital_original,capital_pendiente,tasa_mensual,fecha_proximo_pago,estado
         FROM prestamos WHERE cliente_id=$1 ORDER BY fecha_desembolso DESC NULLS LAST,created_at DESC`, [clientId]
    );
    const salesResult = await client.query(
      `SELECT id,fecha,total,ganancia_total,estado
         FROM ventas WHERE cliente_id=$1 ORDER BY fecha DESC,created_at DESC`, [clientId]
    );
    const loanSummary = summarizeClientLoans(loansResult.rows as Array<{ estado: string; capital_pendiente: string }>);
    const confirmedSales = salesResult.rows.filter((sale) => sale.estado === 'CONFIRMADO');
    const soldTotal = confirmedSales.reduce((sum, sale) => sum + Number(sale.total), 0);
    return {
      cliente: clientResult.rows[0],
      resumen: { prestamosActivos: loanSummary.activos, prestamosVencidos: loanSummary.vencidos, capitalPendienteTotal: loanSummary.capitalPendiente, prestamosPagados: loanSummary.pagados, cantidadVentas: confirmedSales.length, totalVendido: soldTotal },
      prestamos: loansResult.rows,
      ventas: salesResult.rows
    };
  });
  res.json({ data: detail });
}));

catalogRouter.post('/clientes', asyncHandler(async (req, res) => {
  const input = clientCreateInput.parse(req.body);
  const created = await withTransaction((client) => createClient(client, input, req.user?.id));
  res.status(201).json({ data: created });
}));

catalogRouter.patch('/clientes/:id', asyncHandler(async (req, res) => {
  const clientId = id.parse(req.params.id);
  const input = clientUpdateInput.parse(req.body);
  const updated = await withTransaction((client) => updateClient(client, clientId, input, req.user?.id));
  res.json({ data: updated });
}));

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

catalogRouter.post('/categorias', asyncHandler(async (req, res) => {
  const input = categoryCreateInput.parse(req.body);
  const created = await withTransaction(async (client) => {
    const result = await client.query('INSERT INTO categorias (nombre) VALUES ($1) RETURNING *', [input.nombre]);
    await writeAudit(client, { usuarioId: req.user?.id, entidadTipo: 'categorias', entidadId: result.rows[0].id, accion: 'CREAR', nuevos: result.rows[0] });
    return result.rows[0];
  });
  res.status(201).json({ data: created });
}));

catalogRouter.patch('/categorias/:id', asyncHandler(async (req, res) => {
  const categoryId = id.parse(req.params.id);
  const input = categoryUpdateInput.parse(req.body);
  const entries = Object.entries(input);
  const updated = await withTransaction(async (client) => {
    const before = await client.query('SELECT * FROM categorias WHERE id = $1', [categoryId]);
    if (!before.rows[0]) throw new AppError(404, 'Categoría no encontrada.', 'NOT_FOUND');
    const set = entries.map(([field], index) => `${field} = $${index + 1}`).join(', ');
    const result = await client.query(`UPDATE categorias SET ${set} WHERE id = $${entries.length + 1} RETURNING *`, [...entries.map(([, value]) => value), categoryId]);
    await writeAudit(client, { usuarioId: req.user?.id, entidadTipo: 'categorias', entidadId: categoryId, accion: 'ACTUALIZAR', anteriores: before.rows[0], nuevos: result.rows[0] });
    return result.rows[0];
  });
  res.json({ data: updated });
}));

catalogRouter.get('/productos', asyncHandler(async (_req, res) => {
  const result = await query(`
    SELECT p.id, p.codigo, p.nombre, p.categoria_id, c.nombre AS categoria,
           COALESCE(i.existencia, 0)::integer AS cantidad_disponible,
           COALESCE(i.costo_promedio_unitario, 0)::numeric AS costo_promedio,
           COALESCE(p.precio_sugerido, 0)::numeric AS precio_venta,
           COALESCE(p.existencia_minima, 0)::integer AS existencia_minima,
           p.activo, p.created_at, p.updated_at
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      LEFT JOIN inventario i ON i.producto_id = p.id
     ORDER BY p.nombre, p.codigo
  `);
  res.json({ data: result.rows });
}));

catalogRouter.post('/productos', asyncHandler(async (req, res) => {
  const input = productCreateInput.parse(req.body);
  const created = await withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO productos (codigo, sku, nombre, categoria_id, precio_sugerido, activo)
       VALUES ($1, $1, $2, $3, $4, $5)
       RETURNING *`,
      [input.codigo, input.nombre, input.categoriaId, input.precioVenta, input.activo]
    );
    await client.query(
      'INSERT INTO inventario (producto_id, existencia, costo_promedio_unitario) VALUES ($1, 0, 0)',
      [result.rows[0].id]
    );
    await writeAudit(client, { usuarioId: req.user?.id, entidadTipo: 'productos', entidadId: result.rows[0].id, accion: 'CREAR', nuevos: result.rows[0] });
    return result.rows[0];
  });
  res.status(201).json({ data: created });
}));

catalogRouter.patch('/productos/:id', asyncHandler(async (req, res) => {
  const productId = id.parse(req.params.id);
  const input = productUpdateInput.parse(req.body);
  const fieldMap = { codigo: 'codigo', nombre: 'nombre', categoriaId: 'categoria_id', precioVenta: 'precio_sugerido', activo: 'activo' } as const;
  const entries = Object.entries(input) as Array<[keyof typeof fieldMap, unknown]>;
  const updated = await withTransaction(async (client) => {
    const before = await client.query('SELECT * FROM productos WHERE id = $1', [productId]);
    if (!before.rows[0]) throw new AppError(404, 'Producto no encontrado.', 'NOT_FOUND');
    const set = entries.map(([field], index) => `${fieldMap[field]} = $${index + 1}`).join(', ');
    const result = await client.query(
      `UPDATE productos SET ${set} WHERE id = $${entries.length + 1} RETURNING *`,
      [...entries.map(([, value]) => value), productId]
    );
    await writeAudit(client, { usuarioId: req.user?.id, entidadTipo: 'productos', entidadId: productId, accion: 'ACTUALIZAR', anteriores: before.rows[0], nuevos: result.rows[0] });
    return result.rows[0];
  });
  res.json({ data: updated });
}));

catalogRouter.get('/:resource', asyncHandler(async (req, res) => {
  const resource = z.enum(['categorias', 'proveedores', 'productos', 'usuarios']).parse(req.params.resource) as Resource;
  const result = await query(`SELECT ${resource === 'usuarios' ? 'id, nombre, usuario, activo, created_at, updated_at' : '*'} FROM ${resource} ORDER BY created_at DESC`);
  res.json({ data: result.rows });
}));

catalogRouter.post('/:resource', asyncHandler(async (req, res) => {
  const resource = z.literal('proveedores').parse(req.params.resource) as Resource;
  const { fields, values } = permitted(resource, req.body as Record<string, unknown>, resources[resource].fields);
  const created = await withTransaction(async (client) => {
    const result = await client.query(`INSERT INTO ${resource} (${fields.join(', ')}) VALUES (${fields.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING *`, values);
    await writeAudit(client, { usuarioId: req.user?.id, entidadTipo: resource, entidadId: result.rows[0].id, accion: 'CREAR', nuevos: result.rows[0] });
    return result.rows[0];
  });
  res.status(201).json({ data: created });
}));

catalogRouter.patch('/:resource/:id', asyncHandler(async (req, res) => {
  const resource = z.enum(['proveedores', 'usuarios']).parse(req.params.resource) as Resource;
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
