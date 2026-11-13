import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { changeStoreOrderStatus } from './order-service.js';

export const adminStoreOrdersRouter = Router();

const listParams = z.object({
  estado: z.enum(['PENDIENTE','CONFIRMADO','COMPLETADO','CANCELADO']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
const orderId = z.string().uuid();
const changeInput = z.object({
  estado: z.enum(['CONFIRMADO','COMPLETADO','CANCELADO']),
  observacion: z.string().trim().min(3).max(2000),
  version: z.number().int().positive(),
}).strict();
const noteInput = z.object({
  observacion: z.string().trim().min(3).max(2000),
  version: z.number().int().positive(),
}).strict();

// All endpoints are mounted AFTER requireAuth. Additionally reject deactivated
// accounts, including a bearer token issued before the account was disabled.
adminStoreOrdersRouter.use(asyncHandler(async (req, _res, next) => {
  const actorId = req.user?.id;
  if (!actorId || !orderId.safeParse(actorId).success)
    throw new AppError(401, 'Autenticación requerida.', 'UNAUTHORIZED');
  const user = await query<{ id: string }>('SELECT id FROM usuarios WHERE id=$1 AND activo=true', [actorId]);
  if (!user.rows[0]) throw new AppError(403, 'La cuenta no está activa.', 'ACCOUNT_INACTIVE');
  next();
}));

adminStoreOrdersRouter.get('/', asyncHandler(async (req, res) => {
  const filter = listParams.parse(req.query);
  const values: unknown[] = [];
  const condition = filter.estado ? 'WHERE estado=$1' : '';
  if (filter.estado) values.push(filter.estado);
  const count = await query<{total: string}>(`SELECT count(*)::text AS total FROM pedidos_tienda ${condition}`, values);
  const offset = (filter.page - 1) * filter.limit;
  const rows = await query(
    `SELECT id,numero,estado,cliente_nombre,modalidad_entrega,
      metodo_pago,subtotal,costo_envio,total,version,creado_at,actualizado_at
      FROM pedidos_tienda ${condition}
      ORDER BY creado_at DESC, numero DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,
    [...values,filter.limit,offset]
  );
  res.setHeader('Cache-Control','no-store');
  res.json({ data: rows.rows, pagination: { page:filter.page, limit:filter.limit, total:Number(count.rows[0]?.total ?? 0) } });
}));

adminStoreOrdersRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = orderId.parse(req.params.id);
  const order = await query('SELECT * FROM pedidos_tienda WHERE id=$1', [id]);
  if (!order.rows[0]) throw new AppError(404,'Pedido no encontrado.','NOT_FOUND');
  const [details, events] = await Promise.all([
    query(`SELECT id,producto_nombre,producto_codigo,cantidad,precio_unitario,subtotal
      FROM pedido_tienda_detalles WHERE pedido_id=$1 ORDER BY creado_at,id`,[id]),
    query(`SELECT e.id,e.accion,e.estado_anterior,e.estado_nuevo,e.observacion,e.creado_at,
      u.usuario AS actor_usuario FROM pedido_tienda_eventos e
      LEFT JOIN usuarios u ON u.id=e.actor_usuario_id WHERE e.pedido_id=$1
      ORDER BY e.creado_at,e.id`,[id]),
  ]);
  res.setHeader('Cache-Control','no-store');
  res.json({ data: { ...order.rows[0], detalles:details.rows, eventos:events.rows } });
}));

adminStoreOrdersRouter.post('/:id/estado', asyncHandler(async (req, res) => {
  const id = orderId.parse(req.params.id);
  const input = changeInput.parse(req.body);
  const actor = req.user!.id;
  const updated = await withTransaction(async (client) => {
    const current = await client.query<{version: number}>(
      'SELECT version FROM pedidos_tienda WHERE id=$1 FOR UPDATE',[id]
    );
    if (!current.rows[0]) throw new AppError(404,'Pedido no encontrado.','NOT_FOUND');
    if (current.rows[0].version !== input.version) throw new AppError(409,'El pedido cambió. Actualiza antes de continuar.','ORDER_VERSION_CONFLICT');
    return changeStoreOrderStatus(client,id,input.estado,actor,input.observacion);
  });
  res.setHeader('Cache-Control','no-store');
  res.json({data:updated});
}));

adminStoreOrdersRouter.post('/:id/notas', asyncHandler(async (req, res) => {
  const id = orderId.parse(req.params.id);
  const input = noteInput.parse(req.body);
  const actor = req.user!.id;
  const updated = await withTransaction(async (client) => {
    const current = await client.query<{estado: string; version:number}>(
      'SELECT estado,version FROM pedidos_tienda WHERE id=$1 FOR UPDATE',[id]
    );
    if (!current.rows[0]) throw new AppError(404,'Pedido no encontrado.','NOT_FOUND');
    if (current.rows[0].version !== input.version) throw new AppError(409,'El pedido cambió. Actualiza antes de continuar.','ORDER_VERSION_CONFLICT');
    const result = await client.query(
      'UPDATE pedidos_tienda SET notas_internas=$1,version=version+1,actualizado_at=now() WHERE id=$2 RETURNING version',
      [input.observacion,id]
    );
    await client.query(
      `INSERT INTO pedido_tienda_eventos (pedido_id,estado_anterior,estado_nuevo,accion,actor_usuario_id,observacion)
       VALUES ($1,$2,$2,'NOTA_INTERNA',$3,$4)`,
      [id,current.rows[0].estado,actor,input.observacion]
    );
    await writeAudit(client, { usuarioId:actor, entidadTipo:'pedidos_tienda', entidadId:id,
      accion:'NOTA_INTERNA', nuevos:{ version:result.rows[0].version, notaRegistrada:true } });
    return result.rows[0];
  });
  res.setHeader('Cache-Control','no-store');
  res.json({data:updated});
}));
