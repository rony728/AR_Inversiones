import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { requireActiveClient } from './client-guard.js';

const uuid = z.string().uuid();
const itemBase = z.object({ productoId: uuid, cantidad: z.coerce.number().int().positive() });
export const purchaseInput = z.object({ proveedorId: uuid.nullish(), socioId: uuid, custodiaId: uuid, fecha: z.string().date().default(() => new Date().toISOString().slice(0, 10)), observaciones: z.string().max(2000).optional(), items: z.array(itemBase.extend({ costoUnitario: z.coerce.number().min(0) })).min(1) });
// El socio de una venta identifica el fondo que recibe el dinero; no es dueño del producto.
export const saleInput = z.object({ clienteId: uuid.nullish(), fecha: z.string().datetime().optional(), observaciones: z.string().max(2000).optional(), items: z.array(itemBase.extend({ socioId: uuid, custodiaId: uuid, precioUnitario: z.coerce.number().positive() })).min(1) });
export type PurchaseInput = z.infer<typeof purchaseInput>;
export type SaleInput = z.infer<typeof saleInput>;

export const toCents = (value: number) => Math.round(value * 100);
export const money = (cents: number) => (cents / 100).toFixed(2);
export const weightedAverage = (stock: number, average: number, quantity: number, cost: number) => Math.round((((stock * average) + (quantity * cost)) / (stock + quantity)) * 10000) / 10000;
export function saleLineAmounts(quantity: number, price: number, averageCost: number) {
  const priceUnitCents = toCents(price);
  const costUnitCents = toCents(averageCost);
  const subtotalCents = quantity * priceUnitCents;
  const costCents = quantity * costUnitCents;
  return { priceUnitCents, costUnitCents, subtotalCents, costCents, profitCents: subtotalCents - costCents };
}
export const saleFinancialDate = (date?: string) => date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

function unique(keys: string[]) { if (new Set(keys).size !== keys.length) throw new AppError(422, 'Un producto no puede repetirse dentro de la misma operación.', 'DUPLICATE_ITEM'); }
async function lockProduct(client: PoolClient, productId: string) { const result = await client.query<{ id: string; nombre: string }>('SELECT id,nombre FROM productos WHERE id = $1 AND activo = true FOR UPDATE', [productId]); if (!result.rows[0]) throw new AppError(422, 'El producto no existe o está inactivo.', 'INVALID_PRODUCT'); return result.rows[0]; }
async function lockProductsCustody(client: PoolClient, custodyId: string, partnerId: string) { const result = await client.query<{ saldo_actual: string }>(`SELECT saldo_actual FROM custodias WHERE id = $1 AND socio_id = $2 AND actividad = 'PRODUCTOS' FOR UPDATE`, [custodyId, partnerId]); if (!result.rows[0]) throw new AppError(422, 'El fondo debe ser PRODUCTOS y pertenecer al socio indicado.', 'INVALID_CUSTODY'); return Number(result.rows[0].saldo_actual); }
async function lockInventory(client: PoolClient, productId: string) {
  await client.query(`INSERT INTO inventario (producto_id,existencia,costo_promedio_unitario) VALUES ($1,0,0) ON CONFLICT (producto_id) DO NOTHING`, [productId]);
  return (await client.query<{ existencia: number; costo_promedio_unitario: string }>('SELECT existencia,costo_promedio_unitario FROM inventario WHERE producto_id=$1 FOR UPDATE', [productId])).rows[0];
}

export async function registerPurchase(client: PoolClient, input: PurchaseInput, userId?: string) {
  unique(input.items.map((item) => item.productoId));
  const items = input.items.map((item) => ({ ...item, subtotalCents: toCents(item.cantidad * item.costoUnitario) }));
  const totalCents = items.reduce((sum, item) => sum + item.subtotalCents, 0);
  const balance = await lockProductsCustody(client, input.custodiaId, input.socioId);
  if (toCents(balance) < totalCents) throw new AppError(422, 'El fondo no tiene saldo suficiente para esta compra.', 'INSUFFICIENT_CUSTODY_BALANCE');
  const purchase = await client.query<{ id: string }>(`INSERT INTO compras (proveedor_id,socio_id,custodia_id,fecha,estado,total,observaciones,created_by) VALUES ($1,$2,$3,$4,'CONFIRMADO',$5,$6,$7) RETURNING id`, [input.proveedorId ?? null, input.socioId, input.custodiaId, input.fecha, money(totalCents), input.observaciones ?? null, userId ?? null]);
  for (const item of items) {
    await lockProduct(client, item.productoId); const prior = await lockInventory(client, item.productoId);
    const stock = prior.existencia; const average = Number(prior.costo_promedio_unitario); const newStock = stock + item.cantidad; const newAverage = weightedAverage(stock, average, item.cantidad, item.costoUnitario);
    await client.query('UPDATE inventario SET existencia=$1,costo_promedio_unitario=$2,updated_at=now() WHERE producto_id=$3', [newStock, newAverage, item.productoId]);
    await client.query('INSERT INTO detalle_compras (compra_id,producto_id,cantidad,costo_unitario,subtotal) VALUES ($1,$2,$3,$4,$5)', [purchase.rows[0].id, item.productoId, item.cantidad, item.costoUnitario, money(item.subtotalCents)]);
    await client.query(`INSERT INTO movimientos_inventario (producto_id,tipo,cantidad,existencia_anterior,existencia_posterior,costo_unitario,referencia_tipo,referencia_id,created_by) VALUES ($1,'COMPRA',$2,$3,$4,$5,'COMPRA',$6,$7)`, [item.productoId, item.cantidad, stock, newStock, item.costoUnitario, purchase.rows[0].id, userId ?? null]);
  }
  const newBalance = money(toCents(balance) - totalCents);
  await client.query('UPDATE custodias SET saldo_actual=$1 WHERE id=$2', [newBalance, input.custodiaId]);
  await client.query(`INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id,created_by) VALUES ($1,'COMPRA',$2,$3,$4,'COMPRA',$5,$6)`, [input.custodiaId, money(-totalCents), balance, newBalance, purchase.rows[0].id, userId ?? null]);
  await client.query(`INSERT INTO movimientos_financieros (tipo,fecha,monto,socio_id,referencia_tipo,referencia_id,descripcion) VALUES ('COMPRA_INVENTARIO',$1,$2,$3,'COMPRA',$4,$5)`, [input.fecha, money(totalCents), input.socioId, purchase.rows[0].id, input.observaciones ?? 'Compra de inventario']);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'compra', entidadId: purchase.rows[0].id, accion: 'CONFIRMAR', nuevos: { total: money(totalCents), socioId: input.socioId } });
  return { id: purchase.rows[0].id, total: money(totalCents) };
}

export async function registerSale(client: PoolClient, input: SaleInput, userId?: string) {
  unique(input.items.map((item) => item.productoId));
  if (input.clienteId) await requireActiveClient(client, input.clienteId);
  const financialDate = saleFinancialDate(input.fecha);
  const sale = await client.query<{ id: string }>(`INSERT INTO ventas (cliente_id,fecha,estado,total,ganancia_total,observaciones,created_by) VALUES ($1,COALESCE($2::timestamptz,now()),'BORRADOR',0,0,$3,$4) RETURNING id`, [input.clienteId ?? null, input.fecha ?? null, input.observaciones ?? null, userId ?? null]);
  let totalCents = 0; let profitCents = 0; const custodyChanges = new Map<string, { before: number; amountCents: number }>();
  for (const item of input.items) {
    const product = await lockProduct(client, item.productoId); const balance = await lockProductsCustody(client, item.custodiaId, item.socioId); const inventory = await lockInventory(client, item.productoId);
    if (inventory.existencia < item.cantidad) throw new AppError(422, `No hay inventario suficiente de ${product.nombre} para completar la venta.`, 'INSUFFICIENT_STOCK');
    const costUnit = Number(inventory.costo_promedio_unitario); const amounts = saleLineAmounts(item.cantidad, item.precioUnitario, costUnit);
    if (amounts.priceUnitCents < amounts.costUnitCents) throw new AppError(422, `El precio de venta de ${product.nombre} no puede ser menor que su costo promedio.`, 'SALE_BELOW_COST');
    const { subtotalCents, costCents, profitCents: itemProfit } = amounts; const afterStock = inventory.existencia - item.cantidad;
    await client.query('UPDATE inventario SET existencia=$1,updated_at=now() WHERE producto_id=$2', [afterStock, item.productoId]);
    await client.query(`INSERT INTO detalle_ventas (venta_id,producto_id,socio_id,custodia_id,cantidad,precio_unitario,costo_unitario,subtotal,costo_total,ganancia) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [sale.rows[0].id, item.productoId, item.socioId, item.custodiaId, item.cantidad, item.precioUnitario, costUnit, money(subtotalCents), money(costCents), money(itemProfit)]);
    await client.query(`INSERT INTO movimientos_inventario (producto_id,tipo,cantidad,existencia_anterior,existencia_posterior,costo_unitario,referencia_tipo,referencia_id,created_by) VALUES ($1,'VENTA',$2,$3,$4,$5,'VENTA',$6,$7)`, [item.productoId, -item.cantidad, inventory.existencia, afterStock, costUnit, sale.rows[0].id, userId ?? null]);
    const change = custodyChanges.get(item.custodiaId) ?? { before: balance, amountCents: 0 }; change.amountCents += subtotalCents; custodyChanges.set(item.custodiaId, change);
    await client.query(`INSERT INTO movimientos_financieros (tipo,fecha,monto,socio_id,referencia_tipo,referencia_id,descripcion) VALUES ('INGRESO_VENTA',$1,$2,$3,'VENTA',$4,$5), ('COSTO_VENTA',$1,$6,$3,'VENTA',$4,$5)`, [financialDate, money(subtotalCents), item.socioId, sale.rows[0].id, input.observaciones ?? 'Venta de inventario', money(costCents)]);
    totalCents += subtotalCents; profitCents += itemProfit;
  }
  for (const [custodyId, change] of custodyChanges) { const after = money(toCents(change.before) + change.amountCents); await client.query('UPDATE custodias SET saldo_actual=$1 WHERE id=$2', [after, custodyId]); await client.query(`INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id,created_by) VALUES ($1,'VENTA',$2,$3,$4,'VENTA',$5,$6)`, [custodyId, money(change.amountCents), change.before, after, sale.rows[0].id, userId ?? null]); }
  await client.query(`UPDATE ventas SET estado='CONFIRMADO',total=$1,ganancia_total=$2 WHERE id=$3`, [money(totalCents), money(profitCents), sale.rows[0].id]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'venta', entidadId: sale.rows[0].id, accion: 'CONFIRMAR', nuevos: { fecha: financialDate, total: money(totalCents), ganancia: money(profitCents) } });
  return { id: sale.rows[0].id, total: money(totalCents), ganancia: money(profitCents) };
}
