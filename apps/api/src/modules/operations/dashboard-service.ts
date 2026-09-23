import type { PoolClient } from 'pg';
import { z } from 'zod';

export const dashboardPeriodInput = z.object({
  desde: z.string().date(),
  hasta: z.string().date()
}).refine((period) => period.desde <= period.hasta, { message: 'La fecha inicial no puede ser posterior a la fecha final.', path: ['hasta'] });

type DashboardRow = {
  ventas_periodo: string; ganancia_ventas: string; gastos_productos: string; gastos_prestamos: string; intereses_cobrados: string; extras_cobrados: string;
  recuperaciones_incobrables: string; perdidas_prestamo: string; capital_prestado_actual: string; prestamos_vencidos: number; fondos_totales: string; valor_inventario: string;
};

export function netPeriodProfit(income: number, expenses: number) { return income - expenses; }

export async function getDashboard(client: PoolClient, desde: string, hasta: string) {
  const summary = await client.query<DashboardRow>(`SELECT
    COALESCE((SELECT sum(total) FROM ventas WHERE estado='CONFIRMADO' AND fecha::date BETWEEN $1 AND $2),0) AS ventas_periodo,
    COALESCE((SELECT sum(ganancia_total) FROM ventas WHERE estado='CONFIRMADO' AND fecha::date BETWEEN $1 AND $2),0) AS ganancia_ventas,
    COALESCE((SELECT sum(monto) FROM gastos WHERE estado='CONFIRMADO' AND rubro='PRODUCTOS' AND fecha BETWEEN $1 AND $2),0) AS gastos_productos,
    COALESCE((SELECT sum(monto) FROM gastos WHERE estado='CONFIRMADO' AND rubro='PRESTAMOS' AND fecha BETWEEN $1 AND $2),0) AS gastos_prestamos,
    COALESCE((SELECT sum(pp.monto_interes) FROM pagos_prestamo pp JOIN prestamos p ON p.id=pp.prestamo_id WHERE p.eliminado_at IS NULL AND pp.revertido_at IS NULL AND pp.fecha_pago BETWEEN $1 AND $2),0) AS intereses_cobrados,
    COALESCE((SELECT sum(pp.monto_extra) FROM pagos_prestamo pp JOIN prestamos p ON p.id=pp.prestamo_id WHERE p.eliminado_at IS NULL AND pp.revertido_at IS NULL AND pp.fecha_pago BETWEEN $1 AND $2),0) AS extras_cobrados,
    COALESCE((SELECT sum(r.monto) FROM recuperaciones_incobrables r JOIN prestamos p ON p.id=r.prestamo_id WHERE p.eliminado_at IS NULL AND r.revertido_at IS NULL AND r.fecha BETWEEN $1 AND $2),0) AS recuperaciones_incobrables,
    COALESCE((SELECT sum(pi.capital_declarado) FROM prestamos_incobrables pi JOIN prestamos p ON p.id=pi.prestamo_id WHERE p.eliminado_at IS NULL AND pi.fecha_declaracion BETWEEN $1 AND $2),0) AS perdidas_prestamo,
    COALESCE((SELECT sum(capital_pendiente) FROM prestamos WHERE eliminado_at IS NULL AND estado IN ('ACTIVO','VENCIDO')),0) AS capital_prestado_actual,
    (SELECT count(*)::int FROM prestamos WHERE eliminado_at IS NULL AND estado='VENCIDO') AS prestamos_vencidos,
    COALESCE((SELECT sum(saldo_actual) FROM custodias),0) AS fondos_totales,
    COALESCE((SELECT sum(existencia*costo_promedio_unitario) FROM inventario),0) AS valor_inventario`, [desde, hasta]);
  const row = summary.rows[0];
  const actividad = await client.query(`SELECT * FROM (
    SELECT v.id,'VENTA'::text AS tipo,v.fecha,v.total AS monto,'Venta confirmada'::text AS descripcion,string_agg(DISTINCT s.nombre,', ' ORDER BY s.nombre) AS socio,string_agg(DISTINCT p.nombre,', ' ORDER BY p.nombre) AS productos FROM ventas v JOIN detalle_ventas d ON d.venta_id=v.id JOIN socios s ON s.id=d.socio_id JOIN productos p ON p.id=d.producto_id WHERE v.estado='CONFIRMADO' GROUP BY v.id
    UNION ALL SELECT c.id,'COMPRA',c.fecha::timestamp,c.total,'Compra de inventario',s.nombre,NULL::text FROM compras c JOIN socios s ON s.id=c.socio_id WHERE c.estado='CONFIRMADO'
    UNION ALL SELECT p.id,'PRESTAMO',COALESCE(p.fecha_desembolso,p.created_at::date)::timestamp,p.capital_original,'Préstamo desembolsado',s.nombre,NULL::text FROM prestamos p JOIN socios s ON s.id=p.socio_id WHERE p.eliminado_at IS NULL AND p.es_heredado=false AND p.estado<>'ANULADO'
    UNION ALL SELECT pp.id,'PAGO_PRESTAMO',pp.fecha_pago::timestamp,pp.monto_total+pp.monto_extra,concat('Pago de préstamo · interés L ',pp.monto_interes,' · capital L ',pp.monto_capital,' · extra L ',pp.monto_extra),s.nombre,NULL::text FROM pagos_prestamo pp JOIN prestamos p ON p.id=pp.prestamo_id JOIN socios s ON s.id=p.socio_id WHERE p.eliminado_at IS NULL AND pp.revertido_at IS NULL
    UNION ALL SELECT g.id,'GASTO',g.fecha::timestamp,g.monto,g.concepto,s.nombre,NULL::text FROM gastos g JOIN socios s ON s.id=g.socio_id WHERE g.estado='CONFIRMADO'
    UNION ALL SELECT t.id,'TRANSFERENCIA_FONDOS',t.fecha,t.monto,'Transferencia entre fondos',concat(so.nombre,' → ',sd.nombre),NULL::text FROM transferencias_custodia t JOIN socios so ON so.id=t.socio_id JOIN socios sd ON sd.id=t.socio_destino_id
    UNION ALL SELECT d.id,'DISTRIBUCION_UTILIDAD',d.fecha::timestamp,d.utilidad_total,concat('Distribución de utilidad ',COALESCE(d.rubro::text,'sin clasificar')),NULL::text,NULL::text FROM distribuciones_utilidades d
  ) actividad WHERE fecha::date BETWEEN $1 AND $2 ORDER BY fecha DESC LIMIT 12`, [desde, hasta]);
  const ventas = Number(row.ventas_periodo); const gananciaVentas = Number(row.ganancia_ventas); const gastosProductos = Number(row.gastos_productos); const gastosPrestamos = Number(row.gastos_prestamos); const intereses = Number(row.intereses_cobrados); const extras = Number(row.extras_cobrados); const otrosIngresos = Number(row.recuperaciones_incobrables); const perdidasPrestamo = Number(row.perdidas_prestamo);
  const gananciaProductos = netPeriodProfit(gananciaVentas, gastosProductos); const gananciaPrestamos = netPeriodProfit(intereses + extras + otrosIngresos, gastosPrestamos);
  return {
    periodo: { desde, hasta },
    indicadores: { ventas, gananciaProductos, gananciaPrestamos, gastosProductos, gastosPrestamos, intereses, extras, capitalPrestadoActual: Number(row.capital_prestado_actual), prestamosVencidos: Number(row.prestamos_vencidos), fondosTotales: Number(row.fondos_totales), valorInventario: Number(row.valor_inventario) },
    resultado: { PRODUCTOS: { ingresos: ventas, gananciaVentas, gastos: gastosProductos, gananciaOperativa: gananciaProductos }, PRESTAMOS: { ingresos: intereses + extras + otrosIngresos, intereses, extras, recuperaciones: otrosIngresos, gastos: gastosPrestamos, perdidas: perdidasPrestamo, gananciaOperativa: gananciaPrestamos } },
    actividad: actividad.rows
  };
}
