import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { purchaseInput, registerPurchase, registerSale, saleInput } from './inventory-service.js';
import { badDebtInput, cancelLoan, changeNextPaymentDate, createLoan, declareBadDebt, deleteLoan, deleteLoanInput, editLoan, getLoanDetail, loanEditInput, loanInput, loanListSql, paymentInput, previewLoanPayment, recoveryInput, registerBadDebtRecovery, registerLoanPayment, rescheduleInput, reversalInput, reverseBadDebtRecovery, reverseLoanPayment, refreshOverdueLoans } from './loan-service.js';
import { transferBetweenCustodies, transferInput } from './custody-service.js';
import { distributionInput, expenseInput, registerExpense, registerProfitDistribution } from './finance-service.js';
import { approveInventoryAudit, inventoryAuditInput, startInventoryAudit } from './inventory-audit-service.js';
import { dashboardPeriodInput, getDashboard } from './dashboard-service.js';

const readModels = {
  compras: { table: 'compras', order: 'created_at' }, ventas: { table: 'ventas', order: 'created_at' },
  inventario: { table: 'inventario', order: 'updated_at' }, prestamos: { table: 'prestamos', order: 'created_at' },
  'pagos-prestamo': { table: 'pagos_prestamo', order: 'created_at' }, custodias: { table: 'custodias', order: 'created_at' },
  'movimientos-financieros': { table: 'movimientos_financieros', order: 'created_at' }, gastos: { table: 'gastos', order: 'created_at' },
  distribuciones: { table: 'distribuciones_utilidades', order: 'created_at' },
  auditorias: { table: 'auditorias_inventario', order: 'created_at' }, 'auditoria-sistema': { table: 'auditoria_sistema', order: 'created_at' },
  sincronizacion: { table: 'operaciones_sincronizacion', order: 'recibido_at' }
} as const;

export const operationsRouter = Router();

const syncRequest = z.object({
  deviceId: z.string().uuid(),
  deviceName: z.string().trim().min(1).max(120).default('Dispositivo PWA'),
  operations: z.array(z.object({
    id: z.string().uuid(), idempotencyKey: z.string().uuid(), entityType: z.string().trim().min(2).max(60),
    entityId: z.string().uuid(), action: z.enum(['CREATE', 'UPDATE', 'REVERSE']), payload: z.record(z.unknown())
  })).min(1).max(50)
});

operationsRouter.post('/sincronizacion', asyncHandler(async (req, res) => {
  const input = syncRequest.parse(req.body);
  const results = await withTransaction(async (client) => {
    await client.query(`INSERT INTO dispositivos_sincronizacion (id, nombre, ultimo_sync_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, ultimo_sync_at = now()`, [input.deviceId, input.deviceName]);
    const replies: Array<{ id: string; status: 'PENDIENTE' | 'APLICADA' | 'RECHAZADA' }> = [];
    for (const operation of input.operations) {
      const inserted = await client.query<{ estado: 'PENDIENTE' | 'APLICADA' | 'RECHAZADA'; inserted: boolean }>(
        `INSERT INTO operaciones_sincronizacion (id, dispositivo_id, clave_idempotencia, entidad_tipo, entidad_id, tipo_operacion, payload, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDIENTE')
         ON CONFLICT (clave_idempotencia) DO UPDATE SET intento_count = operaciones_sincronizacion.intento_count + 1
         RETURNING estado, (xmax = 0) AS inserted`,
        [operation.id, input.deviceId, operation.idempotencyKey, operation.entityType, operation.entityId, operation.action, operation.payload]
      );
      let status = inserted.rows[0].estado;
      if (inserted.rows[0].inserted && operation.action === 'CREATE' && operation.entityType === 'compra') {
        await registerPurchase(client, purchaseInput.parse(operation.payload));
        status = 'APLICADA';
        await client.query(`UPDATE operaciones_sincronizacion SET estado='APLICADA', aplicado_at=now() WHERE clave_idempotencia=$1`, [operation.idempotencyKey]);
      }
      if (inserted.rows[0].inserted && operation.action === 'CREATE' && operation.entityType === 'venta') {
        await registerSale(client, saleInput.parse(operation.payload));
        status = 'APLICADA';
        await client.query(`UPDATE operaciones_sincronizacion SET estado='APLICADA', aplicado_at=now() WHERE clave_idempotencia=$1`, [operation.idempotencyKey]);
      }
      if (inserted.rows[0].inserted && operation.action === 'CREATE' && operation.entityType === 'prestamo') {
        await createLoan(client, loanInput.parse(operation.payload));
        status = 'APLICADA';
        await client.query(`UPDATE operaciones_sincronizacion SET estado='APLICADA', aplicado_at=now() WHERE clave_idempotencia=$1`, [operation.idempotencyKey]);
      }
      if (inserted.rows[0].inserted && operation.action === 'CREATE' && operation.entityType === 'pago_prestamo') {
        const payload = z.object({ prestamoId: z.string().uuid(), fechaPago: z.string().date().optional(), monto: z.coerce.number().positive() }).parse(operation.payload);
        await registerLoanPayment(client, payload.prestamoId, paymentInput.parse({ fechaPago: payload.fechaPago, monto: payload.monto }));
        status = 'APLICADA';
        await client.query(`UPDATE operaciones_sincronizacion SET estado='APLICADA', aplicado_at=now() WHERE clave_idempotencia=$1`, [operation.idempotencyKey]);
      }
      if (inserted.rows[0].inserted && operation.action === 'CREATE' && operation.entityType === 'transferencia_custodia') {
        await transferBetweenCustodies(client, transferInput.parse(operation.payload));
        status = 'APLICADA';
        await client.query(`UPDATE operaciones_sincronizacion SET estado='APLICADA', aplicado_at=now() WHERE clave_idempotencia=$1`, [operation.idempotencyKey]);
      }
      if (inserted.rows[0].inserted && operation.action === 'CREATE' && operation.entityType === 'gasto') {
        await registerExpense(client, expenseInput.parse(operation.payload));
        status = 'APLICADA';
        await client.query(`UPDATE operaciones_sincronizacion SET estado='APLICADA', aplicado_at=now() WHERE clave_idempotencia=$1`, [operation.idempotencyKey]);
      }
      if (inserted.rows[0].inserted && operation.action === 'CREATE' && operation.entityType === 'distribucion_utilidad') {
        await registerProfitDistribution(client, distributionInput.parse(operation.payload));
        status = 'APLICADA';
        await client.query(`UPDATE operaciones_sincronizacion SET estado='APLICADA', aplicado_at=now() WHERE clave_idempotencia=$1`, [operation.idempotencyKey]);
      }
      if (inserted.rows[0].inserted && operation.action === 'CREATE' && operation.entityType === 'auditoria_inventario') {
        await startInventoryAudit(client, inventoryAuditInput.parse({ ...operation.payload, id: operation.entityId }), req.user?.id);
        status = 'APLICADA';
        await client.query(`UPDATE operaciones_sincronizacion SET estado='APLICADA', aplicado_at=now() WHERE clave_idempotencia=$1`, [operation.idempotencyKey]);
      }
      replies.push({ id: operation.id, status });
    }
    return replies;
  });
  res.status(202).json({ results });
}));

operationsRouter.get('/dashboard', asyncHandler(async (req, res) => {
  const period = dashboardPeriodInput.parse(req.query);
  const result = await withTransaction(async (client) => { await refreshOverdueLoans(client, new Date().toISOString().slice(0, 10)); return getDashboard(client, period.desde, period.hasta); });
  res.json({ data: result });
}));

operationsRouter.post('/compras', asyncHandler(async (req, res) => {
  const input = purchaseInput.parse(req.body);
  const result = await withTransaction((client) => registerPurchase(client, input, req.user?.id));
  res.status(201).json({ data: result });
}));

operationsRouter.post('/ventas', asyncHandler(async (req, res) => {
  const input = saleInput.parse(req.body);
  const result = await withTransaction((client) => registerSale(client, input, req.user?.id));
  res.status(201).json({ data: result });
}));

operationsRouter.post('/prestamos', asyncHandler(async (req, res) => {
  const input = loanInput.parse(req.body);
  const result = await withTransaction((client) => createLoan(client, input, req.user?.id));
  res.status(201).json({ data: result });
}));

operationsRouter.post('/transferencias-custodia', asyncHandler(async (req, res) => {
  const input = transferInput.parse(req.body);
  const result = await withTransaction((client) => transferBetweenCustodies(client, input, req.user?.id));
  res.status(201).json({ data: result });
}));

operationsRouter.post('/gastos', asyncHandler(async (req, res) => {
  const input = expenseInput.parse(req.body);
  const result = await withTransaction((client) => registerExpense(client, input, req.user?.id));
  res.status(201).json({ data: result });
}));

operationsRouter.post('/distribuciones', asyncHandler(async (req, res) => {
  const input = distributionInput.parse(req.body);
  const result = await withTransaction((client) => registerProfitDistribution(client, input, req.user?.id));
  res.status(201).json({ data: result });
}));

operationsRouter.get('/auditorias', asyncHandler(async (_req, res) => {
  const result = await query(
    `SELECT a.*, count(d.id)::integer AS productos_contados,
      count(d.id) FILTER (WHERE d.diferencia <> 0)::integer AS diferencias_encontradas
     FROM auditorias_inventario a LEFT JOIN detalles_auditoria_inventario d ON d.auditoria_id=a.id
     GROUP BY a.id ORDER BY a.created_at DESC LIMIT 200`
  );
  res.json({ data: result.rows });
}));

operationsRouter.get('/auditorias/:id', asyncHandler(async (req, res) => {
  const auditId = z.string().uuid().parse(req.params.id);
  const audit = await query('SELECT * FROM auditorias_inventario WHERE id=$1', [auditId]);
  if (!audit.rows[0]) throw new AppError(404, 'Auditoría de inventario no encontrada.', 'NOT_FOUND');
  const details = await query(
    `SELECT d.*,p.codigo,p.nombre AS producto
     FROM detalles_auditoria_inventario d JOIN productos p ON p.id=d.producto_id
     WHERE d.auditoria_id=$1 ORDER BY p.nombre`, [auditId]
  );
  res.json({ data: { ...audit.rows[0], detalles: details.rows } });
}));

operationsRouter.post('/auditorias', asyncHandler(async (req, res) => {
  const input = inventoryAuditInput.parse(req.body);
  const result = await withTransaction((client) => startInventoryAudit(client, input, req.user?.id));
  res.status(201).json({ data: result });
}));

operationsRouter.post('/auditorias/:id/aprobar', asyncHandler(async (req, res) => {
  const auditId = z.string().uuid().parse(req.params.id);
  const result = await withTransaction((client) => approveInventoryAudit(client, auditId, req.user?.id));
  res.json({ data: result });
}));

operationsRouter.post('/prestamos/:id/pagos', asyncHandler(async (req, res) => {
  const loanId = z.string().uuid().parse(req.params.id); const input = paymentInput.parse(req.body);
  const result = await withTransaction((client) => registerLoanPayment(client, loanId, input, req.user?.id));
  res.status(201).json({ data: result });
}));

operationsRouter.patch('/prestamos/:id', asyncHandler(async (req, res) => {
  const loanId = z.string().uuid().parse(req.params.id); const input = loanEditInput.parse(req.body);
  const result = await withTransaction((client) => editLoan(client, loanId, input, req.user?.id));
  res.json({ data: result });
}));

operationsRouter.post('/prestamos/:id/eliminar', asyncHandler(async (req, res) => {
  const loanId = z.string().uuid().parse(req.params.id); const input = deleteLoanInput.parse(req.body);
  const result = await withTransaction((client) => deleteLoan(client, loanId, input, req.user?.id));
  res.json({ data: result });
}));

operationsRouter.get('/prestamos/:id/liquidacion', asyncHandler(async (req, res) => {
  const loanId = z.string().uuid().parse(req.params.id);
  const input = z.object({ fechaPago: z.string().date(), monto: z.coerce.number().positive().optional() }).parse(req.query);
  const result = await withTransaction((client) => previewLoanPayment(client, loanId, input.fechaPago, input.monto));
  res.json({ data: result });
}));

operationsRouter.patch('/prestamos/:id/fecha-proximo-pago', asyncHandler(async (req, res) => {
  const loanId = z.string().uuid().parse(req.params.id); const input = rescheduleInput.parse(req.body);
  const result = await withTransaction((client) => changeNextPaymentDate(client, loanId, input, req.user?.id));
  res.json({ data: result });
}));

operationsRouter.post('/prestamos/:id/incobrable', asyncHandler(async (req, res) => {
  const loanId = z.string().uuid().parse(req.params.id); const input = badDebtInput.parse(req.body);
  res.status(201).json({ data: await withTransaction((client) => declareBadDebt(client, loanId, input, req.user?.id)) });
}));

operationsRouter.post('/prestamos/:id/recuperaciones', asyncHandler(async (req, res) => {
  const loanId = z.string().uuid().parse(req.params.id); const input = recoveryInput.parse(req.body);
  res.status(201).json({ data: await withTransaction((client) => registerBadDebtRecovery(client, loanId, input, req.user?.id)) });
}));

operationsRouter.post('/prestamos/:id/recuperaciones/:recoveryId/revertir', asyncHandler(async (req, res) => {
  const params = z.object({ id: z.string().uuid(), recoveryId: z.string().uuid() }).parse(req.params); const input = reversalInput.parse(req.body);
  res.json({ data: await withTransaction((client) => reverseBadDebtRecovery(client, params.id, params.recoveryId, input, req.user?.id)) });
}));

operationsRouter.post('/prestamos/:id/anular', asyncHandler(async (req, res) => {
  const loanId = z.string().uuid().parse(req.params.id); const input = badDebtInput.parse(req.body);
  res.json({ data: await withTransaction((client) => cancelLoan(client, loanId, input, req.user?.id)) });
}));

operationsRouter.post('/prestamos/:id/pagos/:paymentId/revertir', asyncHandler(async (req, res) => {
  const params = z.object({ id: z.string().uuid(), paymentId: z.string().uuid() }).parse(req.params); const input = reversalInput.parse(req.body);
  res.json({ data: await withTransaction((client) => reverseLoanPayment(client, params.id, params.paymentId, input, req.user?.id)) });
}));

operationsRouter.get('/prestamos/pagos-historicos', asyncHandler(async (_req, res) => {
  const result = await query(`SELECT h.id,h.cliente_nombre,COALESCE(c.nombre,h.cliente_nombre) AS cliente,h.capital_referencia,h.interes_pagado,h.tasa_catalogo,h.tasa_inferida,h.fecha_pago,s.nombre AS socio,h.responsable_original,h.observaciones FROM pagos_intereses_historicos h LEFT JOIN clientes c ON c.id=h.cliente_id LEFT JOIN socios s ON s.id=h.socio_id ORDER BY h.fecha_pago DESC NULLS LAST,h.created_at DESC`);
  res.json({ data: result.rows });
}));

operationsRouter.get('/prestamos/:id', asyncHandler(async (req, res) => {
  const loanId = z.string().uuid().parse(req.params.id);
  const result = await withTransaction(async (client) => { await refreshOverdueLoans(client, new Date().toISOString().slice(0, 10)); return getLoanDetail(client, loanId); });
  res.json({ data: result });
}));

operationsRouter.get('/prestamos', asyncHandler(async (_req, res) => {
  const rows = await withTransaction(async (client) => { await refreshOverdueLoans(client, new Date().toISOString().slice(0, 10)); return client.query(`${loanListSql} ORDER BY CASE p.estado WHEN 'VENCIDO' THEN 0 WHEN 'ACTIVO' THEN 1 WHEN 'INCOBRABLE' THEN 2 ELSE 3 END,p.fecha_proximo_pago,p.created_at DESC LIMIT 500`); });
  res.json({ data: rows.rows });
}));

operationsRouter.get('/:resource', asyncHandler(async (req, res) => {
  const resource = z.enum(['compras', 'ventas', 'inventario', 'pagos-prestamo', 'custodias', 'movimientos-financieros', 'gastos', 'distribuciones', 'auditorias', 'auditoria-sistema', 'sincronizacion']).parse(req.params.resource);
  const model = readModels[resource];
  const result = await query(`SELECT * FROM ${model.table} ORDER BY ${model.order} DESC LIMIT 200`);
  res.json({ data: result.rows });
}));

// Las escrituras financieras quedan deliberadamente cerradas hasta sus etapas de reglas de negocio.
operationsRouter.post('/:resource', (req, _res, next) => {
  const resource = z.enum(['pagos-prestamo', 'sincronizacion']).safeParse(req.params.resource);
  if (!resource.success) return next(new AppError(404, 'Recurso no encontrado.', 'NOT_FOUND'));
  return next(new AppError(501, `La escritura de ${resource.data} se implementará en su etapa de negocio aprobada.`, 'STAGE_NOT_IMPLEMENTED'));
});
