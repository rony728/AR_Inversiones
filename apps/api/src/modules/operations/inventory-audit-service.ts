import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';

const uuid = z.string().uuid();
export const inventoryAuditInput = z.object({ id: uuid.optional(), observaciones: z.string().trim().max(2000).optional(), items: z.array(z.object({ productoId: uuid, existenciaFisica: z.coerce.number().int().min(0) })).min(1) });
export type InventoryAuditInput = z.infer<typeof inventoryAuditInput>;
export function inventoryDifference(systemStock: number, physicalStock: number) { if (!Number.isInteger(systemStock) || !Number.isInteger(physicalStock) || systemStock < 0 || physicalStock < 0) throw new AppError(422, 'Las existencias deben ser números enteros no negativos.', 'INVALID_INVENTORY_COUNT'); return physicalStock - systemStock; }
function assertUnique(items: InventoryAuditInput['items']) { const keys = items.map((item) => item.productoId); if (new Set(keys).size !== keys.length) throw new AppError(422, 'No se puede contar dos veces el mismo producto.', 'DUPLICATE_AUDIT_ITEM'); }
async function lockInventory(client: PoolClient, productoId: string) {
  const valid = await client.query('SELECT 1 FROM productos WHERE id=$1 AND activo=true', [productoId]);
  if (!valid.rowCount) throw new AppError(422, 'El producto seleccionado no existe o está inactivo.', 'INVALID_AUDIT_ITEM');
  await client.query(`INSERT INTO inventario (producto_id,existencia,costo_promedio_unitario) VALUES ($1,0,0) ON CONFLICT (producto_id) DO NOTHING`, [productoId]);
  return (await client.query<{ existencia: number; costo_promedio_unitario: string }>('SELECT existencia,costo_promedio_unitario FROM inventario WHERE producto_id=$1 FOR UPDATE', [productoId])).rows[0];
}
export async function startInventoryAudit(client: PoolClient, input: InventoryAuditInput, userId?: string) {
  assertUnique(input.items); const audit = await client.query<{ id: string }>(`INSERT INTO auditorias_inventario (id,observaciones,iniciado_por) VALUES (COALESCE($1::uuid,gen_random_uuid()),$2,$3) RETURNING id`, [input.id ?? null, input.observaciones ?? null, userId ?? null]);
  const details: Array<{ productoId: string; existenciaSistema: number; existenciaFisica: number; diferencia: number }> = [];
  for (const item of [...input.items].sort((a, b) => a.productoId.localeCompare(b.productoId))) { const inventory = await lockInventory(client, item.productoId); const difference = inventoryDifference(inventory.existencia, item.existenciaFisica); await client.query(`INSERT INTO detalles_auditoria_inventario (auditoria_id,producto_id,existencia_sistema,existencia_fisica,diferencia) VALUES ($1,$2,$3,$4,$5)`, [audit.rows[0].id, item.productoId, inventory.existencia, item.existenciaFisica, difference]); details.push({ productoId: item.productoId, existenciaSistema: inventory.existencia, existenciaFisica: item.existenciaFisica, diferencia: difference }); }
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'auditoria_inventario', entidadId: audit.rows[0].id, accion: 'INICIAR', nuevos: { observaciones: input.observaciones ?? null, detalles: details } });
  return { id: audit.rows[0].id, estado: 'ABIERTA' as const, detalles: details };
}
export async function approveInventoryAudit(client: PoolClient, auditId: string, userId?: string) {
  const audit = await client.query<{ id: string; estado: string }>('SELECT id,estado FROM auditorias_inventario WHERE id=$1 FOR UPDATE', [auditId]); if (!audit.rows[0]) throw new AppError(404, 'Auditoría de inventario no encontrada.', 'NOT_FOUND'); if (audit.rows[0].estado !== 'ABIERTA') throw new AppError(409, 'Solo se puede aprobar una auditoría abierta.', 'AUDIT_NOT_OPEN');
  const details = await client.query<{ producto_id: string; existencia_sistema: number; existencia_fisica: number; diferencia: number }>('SELECT producto_id,existencia_sistema,existencia_fisica,diferencia FROM detalles_auditoria_inventario WHERE auditoria_id=$1 ORDER BY producto_id', [auditId]);
  if (!details.rowCount) throw new AppError(422, 'La auditoría no contiene productos.', 'EMPTY_AUDIT');
  for (const detail of details.rows) { const inventory = await lockInventory(client, detail.producto_id); if (inventory.existencia !== detail.existencia_sistema) throw new AppError(409, 'El inventario cambió después del conteo. Inicia una nueva auditoría para evitar sobrescribir movimientos posteriores.', 'AUDIT_STALE_INVENTORY'); if (detail.diferencia !== 0) { await client.query('UPDATE inventario SET existencia=$1,updated_at=now() WHERE producto_id=$2', [detail.existencia_fisica, detail.producto_id]); await client.query(`INSERT INTO movimientos_inventario (producto_id,tipo,cantidad,existencia_anterior,existencia_posterior,costo_unitario,referencia_tipo,referencia_id,created_by) VALUES ($1,'AJUSTE_AUDITORIA',$2,$3,$4,$5,'AUDITORIA_INVENTARIO',$6,$7)`, [detail.producto_id, detail.diferencia, detail.existencia_sistema, detail.existencia_fisica, inventory.costo_promedio_unitario, auditId, userId ?? null]); } }
  const approved = await client.query(`UPDATE auditorias_inventario SET estado='APROBADA',fecha_aprobacion=now(),aprobado_por=$2 WHERE id=$1 RETURNING *`, [auditId, userId ?? null]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'auditoria_inventario', entidadId: auditId, accion: 'APROBAR_AJUSTES', anteriores: { estado: 'ABIERTA' }, nuevos: { estado: 'APROBADA', detalles: details.rows } }); return approved.rows[0];
}
