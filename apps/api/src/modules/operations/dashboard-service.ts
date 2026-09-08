import type { PoolClient } from 'pg';
import { z } from 'zod';
import { calculateOperatingProfitCents } from './profit-service.js';

export const dashboardPeriodInput = z.object({
  desde: z.string().date(),
  hasta: z.string().date()
}).refine((period) => period.desde <= period.hasta, { message: 'La fecha inicial no puede ser posterior a la fecha final.', path: ['hasta'] });

type DashboardRow = {
  ventas_periodo: string; ganancia_ventas: string; gastos_periodo: string; intereses_cobrados: string;
  recuperaciones_incobrables: string; perdidas_prestamo: string; capital_prestado_actual: string; prestamos_vencidos: number; fondos_totales: string; valor_inventario: string;
};

export function netPeriodProfit(salesProfit: number, interest: number, expenses: number, otherIncome = 0, loanLosses = 0) {
  return calculateOperatingProfitCents({ ganancia_ventas: String(salesProfit), intereses_cobrados: String(interest), recuperaciones_incobrables: String(otherIncome), gastos: String(expenses), perdidas_prestamo: String(loanLosses) }) / 100;
}

export async function getDashboard(client: PoolClient, desde: string, hasta: string) {
  const summary = await client.query<DashboardRow>(`SELECT
    COALESCE((SELECT sum(total) FROM ventas WHERE estado='CONFIRMADO' AND fecha::date BETWEEN $1 AND $2),0) AS ventas_periodo,
    COALESCE((SELECT sum(ganancia_total) FROM ventas WHERE estado='CONFIRMADO' AND fecha::date BETWEEN $1 AND $2),0) AS ganancia_ventas,
    COALESCE((SELECT sum(monto) FROM gastos WHERE estado='CONFIRMADO' AND fecha BETWEEN $1 AND $2),0) AS gastos_periodo,
    COALESCE((SELECT sum(monto_interes) FROM pagos_prestamo WHERE revertido_at IS NULL AND fecha_pago BETWEEN $1 AND $2),0) AS intereses_cobrados,
    COALESCE((SELECT sum(monto) FROM recuperaciones_incobrables WHERE revertido_at IS NULL AND fecha BETWEEN $1 AND $2),0) AS recuperaciones_incobrables,
    COALESCE((SELECT sum(capital_declarado) FROM prestamos_incobrables WHERE fecha_declaracion BETWEEN $1 AND $2),0) AS perdidas_prestamo,
    COALESCE((SELECT sum(capital_pendiente) FROM prestamos WHERE estado IN ('ACTIVO','VENCIDO')),0) AS capital_prestado_actual,
    (SELECT count(*)::int FROM prestamos WHERE estado='VENCIDO') AS prestamos_vencidos,
    COALESCE((SELECT sum(saldo_actual) FROM custodias),0) AS fondos_totales,
    COALESCE((SELECT sum(existencia*costo_promedio_unitario) FROM inventario),0) AS valor_inventario`, [desde, hasta]);
  const row = summary.rows[0];
  const actividad = await client.query(`SELECT * FROM (
    SELECT id,'VENTA'::text AS tipo,fecha AS fecha,total AS monto,'Venta confirmada'::text AS descripcion FROM ventas WHERE estado='CONFIRMADO'
    UNION ALL SELECT id,'COMPRA',fecha::timestamp,total,'Compra de inventario' FROM compras WHERE estado='CONFIRMADO'
    UNION ALL SELECT id,'PRESTAMO',COALESCE(fecha_desembolso,created_at::date)::timestamp,capital_original,'Préstamo desembolsado' FROM prestamos WHERE es_heredado=false AND estado<>'ANULADO'
    UNION ALL SELECT id,'PAGO_PRESTAMO',fecha_pago::timestamp,monto_total,concat('Pago de préstamo · interés L ',monto_interes,' · capital L ',monto_capital) FROM pagos_prestamo WHERE revertido_at IS NULL
    UNION ALL SELECT id,'GASTO',fecha::timestamp,monto,concepto FROM gastos WHERE estado='CONFIRMADO'
    UNION ALL SELECT id,'TRANSFERENCIA_FONDOS',fecha,monto,'Transferencia entre fondos del mismo socio' FROM transferencias_custodia
    UNION ALL SELECT id,'DISTRIBUCION_UTILIDAD',fecha::timestamp,utilidad_total,'Distribución de utilidad' FROM distribuciones_utilidades
  ) actividad WHERE fecha::date BETWEEN $1 AND $2 ORDER BY fecha DESC LIMIT 12`, [desde, hasta]);
  const ventas = Number(row.ventas_periodo); const gananciaVentas = Number(row.ganancia_ventas); const gastos = Number(row.gastos_periodo); const intereses = Number(row.intereses_cobrados); const otrosIngresos = Number(row.recuperaciones_incobrables); const perdidasPrestamo = Number(row.perdidas_prestamo);
  return {
    periodo: { desde, hasta },
    indicadores: { ventas, gananciaNeta: netPeriodProfit(gananciaVentas, intereses, gastos, otrosIngresos, perdidasPrestamo), gastos, intereses, capitalPrestadoActual: Number(row.capital_prestado_actual), prestamosVencidos: Number(row.prestamos_vencidos), fondosTotales: Number(row.fondos_totales), valorInventario: Number(row.valor_inventario) },
    resultado: { ventas, gananciaVentas, intereses, otrosIngresos, gastos, perdidasPrestamo, gananciaNeta: netPeriodProfit(gananciaVentas, intereses, gastos, otrosIngresos, perdidasPrestamo) },
    actividad: actividad.rows
  };
}
