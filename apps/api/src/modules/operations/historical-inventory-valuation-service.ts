import type { PoolClient } from 'pg';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';

const uuid = z.string().uuid();

export const historicalInventoryValuationInput = z.object({
  productoId: uuid,
  existenciaEsperada: z.coerce.number().int().positive(),
  costoUnitario: z.coerce.number().positive().max(9999999999.9999),
  fechaReferencia: z.string().date(),
  motivo: z.string().trim().min(3).max(2000),
}).strict();

export type HistoricalInventoryValuationInput = z.infer<typeof historicalInventoryValuationInput>;

export async function valueHistoricalInventory(
  client: PoolClient,
  input: HistoricalInventoryValuationInput,
  userId?: string,
) {
  const locked = await client.query<{
    id: string;
    nombre: string;
    existencia: number;
    costo_promedio_unitario: string;
  }>(
    `SELECT p.id,p.nombre,i.existencia,i.costo_promedio_unitario
     FROM productos p
     JOIN inventario i ON i.producto_id=p.id
     WHERE p.id=$1
     FOR UPDATE OF i`,
    [input.productoId],
  );
  const product = locked.rows[0];
  if (!product) {
    throw new AppError(404, 'El producto o su inventario no existe.', 'INVENTORY_NOT_FOUND');
  }
  if (product.existencia <= 0) {
    throw new AppError(422, 'La valorización histórica requiere existencia disponible mayor que cero.', 'HISTORICAL_STOCK_REQUIRED');
  }
  if (product.existencia !== input.existenciaEsperada) {
    throw new AppError(409, 'La existencia cambió. Actualiza la información antes de valorizar.', 'STALE_INVENTORY');
  }

  const previousCost = Number(product.costo_promedio_unitario);
  if (previousCost !== 0) {
    throw new AppError(409, 'El producto ya tiene costo. La valorización histórica solo aplica a inventario sin valorizar.', 'HISTORICAL_COST_ALREADY_SET');
  }
  const newCost = Math.round(input.costoUnitario * 10000) / 10000;
  if (newCost <= 0) {
    throw new AppError(422, 'El costo histórico debe ser mayor que cero.', 'INVALID_HISTORICAL_COST');
  }

  const valuation = await client.query<{ id: string }>(
    `INSERT INTO valorizaciones_inventario_historico
       (producto_id,existencia_verificada,costo_anterior,costo_nuevo,fecha_referencia,motivo,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [product.id, product.existencia, previousCost, newCost, input.fechaReferencia, input.motivo, userId ?? null],
  );
  const valuationId = valuation.rows[0].id;

  await client.query(
    'UPDATE inventario SET costo_promedio_unitario=$1,updated_at=now() WHERE producto_id=$2',
    [newCost, product.id],
  );
  await client.query(
    `INSERT INTO movimientos_inventario
       (producto_id,tipo,cantidad,existencia_anterior,existencia_posterior,costo_unitario,referencia_tipo,referencia_id,created_by)
     VALUES ($1,'VALORIZACION_HISTORICA',0,$2,$2,$3,'VALORIZACION_HISTORICA',$4,$5)`,
    [product.id, product.existencia, newCost, valuationId, userId ?? null],
  );
  await writeAudit(client, {
    usuarioId: userId,
    entidadTipo: 'valorizacion_inventario_historico',
    entidadId: valuationId,
    accion: 'VALORIZAR_INVENTARIO_HISTORICO',
    anteriores: { productoId: product.id, existencia: product.existencia, costoPromedioUnitario: previousCost },
    nuevos: {
      productoId: product.id,
      producto: product.nombre,
      existencia: product.existencia,
      costoPromedioUnitario: newCost,
      fechaReferencia: input.fechaReferencia,
      motivo: input.motivo,
    },
  });

  return {
    id: valuationId,
    productoId: product.id,
    producto: product.nombre,
    existencia: product.existencia,
    costoAnterior: previousCost.toFixed(4),
    costoNuevo: newCost.toFixed(4),
    fechaReferencia: input.fechaReferencia,
  };
}
