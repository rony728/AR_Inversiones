import type { PoolClient } from "pg";
import { toCents } from "./inventory-service.js";

export type ProfitCategory = "PRODUCTOS" | "PRESTAMOS";
export type CategoryProfit = {
  rubro: ProfitCategory;
  ingresos: string;
  costos: string;
  gastos: string;
  perdidas: string;
  distribuido: string;
};

export function categoryOperatingProfitCents(row: CategoryProfit) {
  return (
    toCents(Number(row.ingresos)) -
    toCents(Number(row.costos)) -
    toCents(Number(row.gastos))
  );
}

export function categoryAvailableProfitCents(row: CategoryProfit) {
  return Math.max(
    0,
    categoryOperatingProfitCents(row) - toCents(Number(row.distribuido)),
  );
}

export async function lockProfitDistributions(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(1095914054)");
}

export async function getProfitSummary(
  client: PoolClient,
  throughDate: string,
) {
  const result = await client.query<CategoryProfit>(
    `WITH rubros(rubro) AS (VALUES ('PRODUCTOS'::actividad_custodia),('PRESTAMOS'::actividad_custodia))
    SELECT r.rubro::text AS rubro,
      CASE WHEN r.rubro='PRODUCTOS' THEN COALESCE((SELECT sum(total) FROM ventas WHERE estado='CONFIRMADO' AND fecha::date<=$1),0)
           ELSE COALESCE((SELECT sum(monto_interes+monto_extra) FROM pagos_prestamo WHERE revertido_at IS NULL AND fecha_pago<=$1),0)
                + COALESCE((SELECT sum(monto) FROM recuperaciones_incobrables WHERE revertido_at IS NULL AND fecha<=$1),0) END AS ingresos,
      CASE WHEN r.rubro='PRODUCTOS' THEN COALESCE((SELECT sum(total-ganancia_total) FROM ventas WHERE estado='CONFIRMADO' AND fecha::date<=$1),0) ELSE 0 END AS costos,
      COALESCE((SELECT sum(monto) FROM gastos WHERE estado='CONFIRMADO' AND rubro=r.rubro AND fecha<=$1),0) AS gastos,
      CASE WHEN r.rubro='PRESTAMOS' THEN COALESCE((SELECT sum(capital_declarado) FROM prestamos_incobrables WHERE fecha_declaracion<=$1),0) ELSE 0 END AS perdidas,
      COALESCE((SELECT sum(utilidad_total) FROM distribuciones_utilidades WHERE rubro=r.rubro AND fecha<=$1),0) AS distribuido
    FROM rubros r`,
    [throughDate],
  );
  return result.rows.map((row) => ({
    ...row,
    gananciaOperativa: (categoryOperatingProfitCents(row) / 100).toFixed(2),
    disponible: (categoryAvailableProfitCents(row) / 100).toFixed(2),
  }));
}

export async function getAvailableProfit(
  client: PoolClient,
  throughDate: string,
  rubro: ProfitCategory,
) {
  const components = (await getProfitSummary(client, throughDate)).find(
    (row) => row.rubro === rubro,
  )!;
  return {
    components,
    availableCents: categoryAvailableProfitCents(components),
  };
}
