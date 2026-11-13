import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';

const orderItemInput = z.object({
  productoId: z.string().uuid(),
  cantidad: z.number().int().min(1).max(99)
}).strict();
export const orderCreateInput = z.object({
  referenciaCliente: z.string().uuid(),
  nombre: z.string().trim().min(2).max(140),
  telefono: z.string().trim().min(7).max(35),
  email: z.string().trim().email().max(254).optional(),
  direccionEntrega: z.string().trim().min(5).max(2000).optional(),
  instruccionesEntrega: z.string().trim().max(2000).optional(),
  modalidadEntrega: z.enum(['RETIRO','ENVIO','CONTRA_ENTREGA']),
  metodoPago: z.enum(['EFECTIVO','TRANSFERENCIA','DEPOSITO','CONTRA_ENTREGA','ENLACE_PAGO']),
  notasCliente: z.string().trim().max(2000).optional(),
  productos: z.array(orderItemInput).min(1).max(40)
}).strict().superRefine((input, context) => {
  if (input.modalidadEntrega !== 'RETIRO' && !input.direccionEntrega) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['direccionEntrega'], message: 'Se requiere dirección para la entrega.' });
  }
  if (new Set(input.productos.map((item) => item.productoId)).size !== input.productos.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['productos'], message: 'Hay productos duplicados.' });
  }
});

export type OrderDraft = z.infer<typeof orderCreateInput>;
export type OrderStatus = 'PENDIENTE' | 'CONFIRMADO' | 'COMPLETADO' | 'CANCELADO';
const permitted: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDIENTE: ['CONFIRMADO','CANCELADO'],
  CONFIRMADO: ['COMPLETADO','CANCELADO'],
  COMPLETADO: [], CANCELADO: []
};
export function validateOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!permitted[from]?.includes(to)) {
    throw new AppError(409, 'Cambio de estado no permitido.', 'ORDER_TRANSITION_INVALID');
  }
}
export function toCents(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1e10) throw new AppError(422, 'Precio inválido.', 'INVALID_PRICE');
  const cents = Math.round(number * 100);
  if (!Number.isSafeInteger(cents)) throw new AppError(422, 'Precio inválido.', 'INVALID_PRICE');
  return cents;
}

// Only internal services may call these methods. Public checkout route is NOT enabled in step 16.
// Shipping amount MUST be set server-side, never accepted from the customer's browser.
export async function createStoreOrder(
  client: PoolClient, input: OrderDraft, shippingCents: number
) {
  const parsed = orderCreateInput.parse(input);
  if (!Number.isSafeInteger(shippingCents) || shippingCents < 0 || shippingCents > 10_000_000) {
    throw new AppError(422, 'Costo de envío inválido.', 'INVALID_SHIPPING');
  }
  const snapshots: Array<{ id: string; name: string; code: string | null; quantity: number; cents: number }> = [];
  for (const line of parsed.productos) {
    const result = await client.query<{
      id: string; nombre: string; codigo: string | null; existencia: number; precio_actual: string;
    }>(
      `SELECT p.id, p.nombre, p.codigo,
       COALESCE(i.existencia, 0)::integer AS existencia,
       CASE WHEN p.precio_oferta > 0 AND p.precio_oferta < p.precio_sugerido
         AND (p.fecha_inicio_oferta IS NULL OR p.fecha_inicio_oferta <= CURRENT_TIMESTAMP)
         AND (p.fecha_fin_oferta IS NULL OR p.fecha_fin_oferta > CURRENT_TIMESTAMP)
         THEN p.precio_oferta ELSE p.precio_sugerido END AS precio_actual
       FROM productos p LEFT JOIN inventario i ON i.producto_id = p.id
       WHERE p.id=$1 AND p.activo=true FOR SHARE OF p`, [line.productoId]
    );
    const row = result.rows[0];
    if (!row || row.existencia < line.cantidad) {
      throw new AppError(409, 'Uno de los productos no tiene existencia suficiente.', 'OUT_OF_STOCK');
    }
    const cents = toCents(row.precio_actual);
    if (cents <= 0) throw new AppError(409, 'Uno de los productos no tiene precio válido.', 'PRICE_UNAVAILABLE');
    snapshots.push({ id: row.id, name: row.nombre, code: row.codigo, quantity: line.cantidad, cents });
  }
  const subtotalCents = snapshots.reduce((sum, item) => sum + item.cents * item.quantity, 0);
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents > 1e12) {
    throw new AppError(422, 'Total inválido.', 'INVALID_TOTAL');
  }
  const order = await client.query<{id: string; numero: string; estado: OrderStatus}>(
    `INSERT INTO pedidos_tienda (referencia_cliente,cliente_nombre,cliente_telefono,cliente_email,direccion_entrega,instrucciones_entrega,modalidad_entrega,metodo_pago,notas_cliente,subtotal,costo_envio)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id,numero,estado`,
    [parsed.referenciaCliente,parsed.nombre,parsed.telefono,parsed.email ?? null,
      parsed.direccionEntrega ?? null,parsed.instruccionesEntrega ?? null,parsed.modalidadEntrega,
      parsed.metodoPago,parsed.notasCliente ?? null,(subtotalCents/100).toFixed(2),
      (shippingCents/100).toFixed(2)]
  );
  const created = order.rows[0];
  for (const item of snapshots) {
    await client.query(
      `INSERT INTO pedido_tienda_detalles (pedido_id,producto_id,producto_nombre,producto_codigo,cantidad,precio_unitario)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [created.id,item.id,item.name,item.code,item.quantity,(item.cents/100).toFixed(2)]
    );
  }
  await client.query(
    `INSERT INTO pedido_tienda_eventos (pedido_id,estado_anterior,estado_nuevo,accion)
     VALUES ($1,NULL,'PENDIENTE','CREADO')`, [created.id]
  );
  await writeAudit(client, {
    entidadTipo: 'pedidos_tienda', entidadId: created.id, accion: 'CREAR',
    nuevos: { estado:'PENDIENTE', numero:created.numero, lineas:snapshots.length,
      subtotal:subtotalCents/100, costoEnvio:shippingCents/100 }
  });
  // Does NOT touch ventas, detalle_ventas, inventario or movimientos_inventario.
  return { id:created.id, numero:created.numero, estado:created.estado,
    subtotal:subtotalCents/100, costoEnvio:shippingCents/100, total:(subtotalCents+shippingCents)/100 };
}

export async function changeStoreOrderStatus(
  client: PoolClient, orderId: string, next: OrderStatus, actorId: string, observation?: string
) {
  if (!z.string().uuid().safeParse(orderId).success || !z.string().uuid().safeParse(actorId).success) {
    throw new AppError(422, 'Identificador inválido.', 'VALIDATION_ERROR');
  }
  if (observation && observation.length > 2000) throw new AppError(422, 'Observación excesiva.', 'VALIDATION_ERROR');
  const lookup = await client.query<{id: string; estado: OrderStatus}>(
    'SELECT id,estado FROM pedidos_tienda WHERE id=$1 FOR UPDATE', [orderId]
  );
  const current = lookup.rows[0];
  if (!current) throw new AppError(404, 'Pedido no encontrado.', 'NOT_FOUND');
  validateOrderTransition(current.estado, next);
  const dateColumn: Record<string, string> = {
    CONFIRMADO:'confirmado_at', COMPLETADO:'completado_at', CANCELADO:'cancelado_at'
  };
  await client.query(
    `UPDATE pedidos_tienda SET estado=$1,version=version+1,actualizado_at=now(),${dateColumn[next]}=now()
     WHERE id=$2`, [next,orderId]
  );
  await client.query(
    `INSERT INTO pedido_tienda_eventos (pedido_id,estado_anterior,estado_nuevo,accion,actor_usuario_id,observacion)
     VALUES ($1,$2,$3,'CAMBIO_ESTADO',$4,$5)`,
    [orderId,current.estado,next,actorId,observation ?? null]
  );
  await writeAudit(client, {
    usuarioId:actorId, entidadTipo:'pedidos_tienda', entidadId:orderId,
    accion:'CAMBIO_ESTADO', anteriores:{estado:current.estado}, nuevos:{estado:next}
  });
  return { id:orderId, estado:next };
}

/**
 * Atomic idempotency for simultaneous checkout retries.
 * The advisory lock lives only inside the calling transaction; it serializes
 * requests with the same customer-generated reference before the UNIQUE insert.
 * The caller MUST execute this function within withTransaction.
 */
export async function createStoreOrderIdempotent(
  client: PoolClient, input: OrderDraft, shippingCents: number
) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', [input.referenciaCliente]);
  const lookup = await client.query<{
    id:string; numero:string; estado:OrderStatus;
    subtotal:string; costo_envio:string; total:string;
    cliente_nombre:string;cliente_telefono:string;cliente_email:string|null;
    direccion_entrega:string|null;instrucciones_entrega:string|null;
    notas_cliente:string|null;modalidad_entrega:string;metodo_pago:string;
  }>(
    `SELECT id,numero,estado,subtotal,costo_envio,total,cliente_nombre,cliente_telefono,
       cliente_email,direccion_entrega,instrucciones_entrega,notas_cliente,modalidad_entrega,metodo_pago
     FROM pedidos_tienda WHERE referencia_cliente=$1`,
    [input.referenciaCliente]
  );
  if (lookup.rows[0]) {
    // La referencia NO es una autorización para consultar pedidos ajenos.
    // Un reintento solo tiene éxito cuando coinciden todos los datos originales.
    const row=lookup.rows[0];
    const matches = row.cliente_nombre===input.nombre && row.cliente_telefono===input.telefono &&
      (row.cliente_email??null)===(input.email??null) &&
      (row.direccion_entrega??null)===(input.direccionEntrega??null) &&
      (row.instrucciones_entrega??null)===(input.instruccionesEntrega??null) &&
      (row.notas_cliente??null)===(input.notasCliente??null) &&
      row.modalidad_entrega===input.modalidadEntrega && row.metodo_pago===input.metodoPago &&
      Math.round(Number(row.costo_envio)*100)===shippingCents;
    if (!matches) throw new AppError(409,'La referencia del pedido ya fue utilizada.','ORDER_REFERENCE_CONFLICT');
    const items=await client.query<{producto_id:string;cantidad:number}>(
      'SELECT producto_id,cantidad FROM pedido_tienda_detalles WHERE pedido_id=$1',[row.id]
    );
    const original=new Map(items.rows.map(item=>[item.producto_id,item.cantidad]));
    if (original.size!==input.productos.length ||
        input.productos.some(item=>original.get(item.productoId)!==item.cantidad)) {
      throw new AppError(409,'La referencia del pedido ya fue utilizada.','ORDER_REFERENCE_CONFLICT');
    }
    return {id:row.id,numero:row.numero,estado:row.estado,subtotal:Number(row.subtotal),
      costoEnvio:Number(row.costo_envio),total:Number(row.total),repeated:true};
  }
  return { ...(await createStoreOrder(client,input,shippingCents)), repeated:false };
}
