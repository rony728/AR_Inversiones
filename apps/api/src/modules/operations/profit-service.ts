import type { PoolClient } from 'pg';
import { toCents } from './inventory-service.js';

export type ProfitComponents = {
  ganancia_ventas: string;
  intereses_cobrados: string;
  recuperaciones_incobrables: string;
  gastos: string;
  perdidas_prestamo: string;
  distribuciones_previas: string;
};

export function calculateOperatingProfitCents(input: Omit<ProfitComponents, 'distribuciones_previas'>) {
  return toCents(Number(input.ganancia_ventas))
    + toCents(Number(input.intereses_cobrados))
    + toCents(Number(input.recuperaciones_incobrables))
    - toCents(Number(input.gastos))
    - toCents(Number(input.perdidas_prestamo));
}

export function calculateAvailableProfitCents(input: ProfitComponents) {
  return calculateOperatingProfitCents(input) - toCents(Number(input.distribuciones_previas));
}

export async function lockProfitDistributions(client: PoolClient) {
  await client.query('SELECT pg_advisory_xact_lock(1095914054)');
}

export async function getAvailableProfit(client: PoolClient, throughDate: string) {
  const result = await client.query<ProfitComponents>(`SELECT
    COALESCE((SELECT sum(ganancia_total) FROM ventas WHERE estado='CONFIRMADO' AND fecha::date<=$1),0) AS ganancia_ventas,
    COALESCE((SELECT sum(monto_interes) FROM pagos_prestamo WHERE revertido_at IS NULL AND fecha_pago<=$1),0) AS intereses_cobrados,
    COALESCE((SELECT sum(monto) FROM recuperaciones_incobrables WHERE revertido_at IS NULL AND fecha<=$1),0) AS recuperaciones_incobrables,
    COALESCE((SELECT sum(monto) FROM gastos WHERE estado='CONFIRMADO' AND fecha<=$1),0) AS gastos,
    COALESCE((SELECT sum(capital_declarado) FROM prestamos_incobrables WHERE fecha_declaracion<=$1),0) AS perdidas_prestamo,
    COALESCE((SELECT sum(utilidad_total) FROM distribuciones_utilidades WHERE fecha<=$1),0) AS distribuciones_previas`, [throughDate]);
  const components = result.rows[0];
  return { components, availableCents: calculateAvailableProfitCents(components) };
}
