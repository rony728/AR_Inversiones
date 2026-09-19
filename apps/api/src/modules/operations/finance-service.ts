import type { PoolClient } from "pg";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { money, toCents } from "./inventory-service.js";
import {
  getAvailableProfit,
  lockProfitDistributions,
  type ProfitCategory,
} from "./profit-service.js";

const uuid = z.string().uuid();
export const expenseInput = z.object({
  socioId: uuid,
  custodiaId: uuid,
  rubro: z.enum(["PRODUCTOS", "PRESTAMOS"]),
  concepto: z.string().trim().min(1).max(300),
  monto: z.coerce.number().positive(),
  fecha: z
    .string()
    .date()
    .default(() => new Date().toISOString().slice(0, 10)),
});

export const distributionInput = z.object({
  rubro: z.enum(["PRODUCTOS", "PRESTAMOS"]),
  fecha: z
    .string()
    .date()
    .default(() => new Date().toISOString().slice(0, 10)),
  utilidadTotal: z.coerce.number().positive(),
  observaciones: z.string().max(2000).optional(),
  coberturas: z
    .array(
      z.object({
        socioBeneficiarioId: uuid,
        socioCubridorId: uuid,
      }),
    )
    .default([]),
});

type Custody = { id: string; socio_id: string; actividad?: ProfitCategory; saldo_actual: string };

async function lockCustodies(client: PoolClient, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  const result = await client.query<Custody>(
    "SELECT id,socio_id,actividad,saldo_actual FROM custodias WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [uniqueIds],
  );
  if (result.rows.length !== uniqueIds.length)
    throw new AppError(
      422,
      "Uno de los fondos seleccionados no existe.",
      "INVALID_CUSTODY",
    );
  return new Map(result.rows.map((custody) => [custody.id, custody]));
}

export async function registerExpense(
  client: PoolClient,
  input: z.infer<typeof expenseInput>,
  userId?: string,
) {
  const custodias = await lockCustodies(client, [input.custodiaId]);
  const custody = custodias.get(input.custodiaId)!;
  if (custody.socio_id !== input.socioId || custody.actividad !== input.rubro)
    throw new AppError(
      422,
      "El fondo debe pertenecer al socio y rubro seleccionados.",
      "INVALID_CUSTODY",
    );
  const amountCents = toCents(input.monto);
  const balanceCents = toCents(Number(custody.saldo_actual));
  const expense = await client.query<{ id: string }>(
    "INSERT INTO gastos (socio_id,custodia_id,rubro,concepto,monto,fecha,estado,created_by) VALUES ($1,$2,$3,$4,$5,$6,'CONFIRMADO',$7) RETURNING id",
    [
      input.socioId,
      input.custodiaId,
      input.rubro,
      input.concepto,
      money(amountCents),
      input.fecha,
      userId ?? null,
    ],
  );
  const after = money(balanceCents - amountCents);
  await client.query("UPDATE custodias SET saldo_actual=$1 WHERE id=$2", [
    after,
    input.custodiaId,
  ]);
  await client.query(
    `INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id,created_by) VALUES ($1,'GASTO',$2,$3,$4,'GASTO',$5,$6)`,
    [
      input.custodiaId,
      money(-amountCents),
      custody.saldo_actual,
      after,
      expense.rows[0].id,
      userId ?? null,
    ],
  );
  await client.query(
    `INSERT INTO movimientos_financieros (tipo,fecha,monto,socio_id,referencia_tipo,referencia_id,descripcion) VALUES ('GASTO',$1,$2,$3,'GASTO',$4,$5)`,
    [
      input.fecha,
      money(amountCents),
      input.socioId,
      expense.rows[0].id,
      input.concepto,
    ],
  );
  await writeAudit(client, {
    usuarioId: userId,
    entidadTipo: "gasto",
    entidadId: expense.rows[0].id,
    accion: "CONFIRMAR",
    nuevos: {
      socioId: input.socioId,
      custodiaId: input.custodiaId,
      rubro: input.rubro,
      monto: money(amountCents),
      concepto: input.concepto,
    },
  });
  return {
    id: expense.rows[0].id,
    monto: money(amountCents),
    saldoCustodia: after,
  };
}

export function distributionShareCents(total: number) {
  const totalCents = toCents(total);
  if (totalCents % 3 !== 0)
    throw new AppError(
      422,
      "La utilidad total debe poder dividirse exactamente entre tres socios.",
      "INVALID_DISTRIBUTION_AMOUNT",
    );
  return totalCents / 3;
}

export async function registerProfitDistribution(
  client: PoolClient,
  input: z.infer<typeof distributionInput>,
  userId?: string,
) {
  const shareCents = distributionShareCents(input.utilidadTotal);
  const totalCents = shareCents * 3;
  await lockProfitDistributions(client);
  const profit = await getAvailableProfit(client, input.fecha, input.rubro);
  if (profit.availableCents <= 0)
    throw new AppError(
      422,
      "No hay utilidad disponible para distribuir.",
      "NO_AVAILABLE_PROFIT",
    );
  if (totalCents > profit.availableCents)
    throw new AppError(
      422,
      "La distribución supera la utilidad disponible.",
      "INSUFFICIENT_AVAILABLE_PROFIT",
    );
  const activePartners = await client.query<{
    id: string;
    nombre: string;
    custodia_id: string;
    saldo_actual: string;
  }>(
    `SELECT s.id,s.nombre,c.id AS custodia_id,c.saldo_actual FROM socios s JOIN custodias c ON c.socio_id=s.id AND c.actividad=$1 WHERE s.activo=true ORDER BY s.nombre FOR UPDATE OF c`,
    [input.rubro],
  );
  if (activePartners.rows.length !== 3)
    throw new AppError(
      422,
      "La distribución requiere los tres socios activos con su fondo del rubro.",
      "INVALID_DISTRIBUTION_PARTNERS",
    );
  const custodias = new Map(
    activePartners.rows.map((p) => [
      p.custodia_id,
      { id: p.custodia_id, socio_id: p.id, saldo_actual: p.saldo_actual },
    ]),
  );
  const distribution = await client.query<{ id: string }>(
    "INSERT INTO distribuciones_utilidades (fecha,utilidad_total,monto_por_socio,rubro,observaciones,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [
      input.fecha,
      money(totalCents),
      money(shareCents),
      input.rubro,
      input.observaciones ?? null,
      userId ?? null,
    ],
  );
  const balances = new Map(
    [...custodias.entries()].map(([id, custody]) => [
      id,
      toCents(Number(custody.saldo_actual)),
    ]),
  );
  const pendingMovements: Array<{
    custody: Custody;
    cents: number;
    beneficiaryId: string;
    covererId: string;
    type: "DISTRIBUCION_UTILIDAD" | "COBERTURA_DISTRIBUCION";
  }> = [];
  for (const partner of activePartners.rows) {
    const own = custodias.get(partner.custodia_id)!;
    const ownDebit = Math.max(
      0,
      Math.min(balances.get(own.id) ?? 0, shareCents),
    );
    if (ownDebit > 0) {
      pendingMovements.push({
        custody: own,
        cents: ownDebit,
        beneficiaryId: partner.id,
        covererId: partner.id,
        type: "DISTRIBUCION_UTILIDAD",
      });
      balances.set(own.id, (balances.get(own.id) ?? 0) - ownDebit);
    }
    const shortage = shareCents - ownDebit;
    if (shortage > 0) {
      const choice = input.coberturas.find(
        (item) => item.socioBeneficiarioId === partner.id,
      );
      if (!choice || choice.socioCubridorId === partner.id)
        throw new AppError(
          422,
          `Debes seleccionar quién cubre el faltante de ${partner.nombre}.`,
          "DISTRIBUTION_COVERAGE_REQUIRED",
        );
      const cover = activePartners.rows.find(
        (item) => item.id === choice.socioCubridorId,
      );
      if (!cover)
        throw new AppError(
          422,
          "El socio cubridor no es válido.",
          "INVALID_COVERAGE_CUSTODY",
        );
      balances.set(
        cover.custodia_id,
        (balances.get(cover.custodia_id) ?? 0) - shortage,
      );
      pendingMovements.push({
        custody: custodias.get(cover.custodia_id)!,
        cents: shortage,
        beneficiaryId: partner.id,
        covererId: cover.id,
        type: "COBERTURA_DISTRIBUCION",
      });
    }
  }
  for (const movement of pendingMovements) {
    const before = toCents(Number(movement.custody.saldo_actual));
    const alreadyDebited = pendingMovements
      .slice(0, pendingMovements.indexOf(movement))
      .filter((item) => item.custody.id === movement.custody.id)
      .reduce((sum, item) => sum + item.cents, 0);
    const prior = before - alreadyDebited;
    const after = prior - movement.cents;
    await client.query(
      "INSERT INTO cuotas_distribucion_utilidad (distribucion_id,socio_beneficiario_id,socio_cubridor_id,custodia_id,monto) VALUES ($1,$2,$3,$4,$5)",
      [
        distribution.rows[0].id,
        movement.beneficiaryId,
        movement.covererId,
        movement.custody.id,
        money(movement.cents),
      ],
    );
    await client.query("UPDATE custodias SET saldo_actual=$1 WHERE id=$2", [
      money(after),
      movement.custody.id,
    ]);
    await client.query(
      `INSERT INTO movimientos_custodia (custodia_id,tipo,variacion,saldo_anterior,saldo_posterior,referencia_tipo,referencia_id,created_by) VALUES ($1,$2,$3,$4,$5,'DISTRIBUCION_UTILIDAD',$6,$7)`,
      [
        movement.custody.id,
        movement.type,
        money(-movement.cents),
        money(prior),
        money(after),
        distribution.rows[0].id,
        userId ?? null,
      ],
    );
    await client.query(
      `INSERT INTO movimientos_financieros (tipo,fecha,monto,socio_id,referencia_tipo,referencia_id,descripcion) VALUES ('DISTRIBUCION_UTILIDAD',$1,$2,$3,'DISTRIBUCION_UTILIDAD',$4,$5)`,
      [
        input.fecha,
        money(movement.cents),
        movement.covererId,
        distribution.rows[0].id,
        input.observaciones ?? "Distribución de utilidad",
      ],
    );
  }
  const remainingCents = profit.availableCents - totalCents;
  await writeAudit(client, {
    usuarioId: userId,
    entidadTipo: "distribucion_utilidad",
    entidadId: distribution.rows[0].id,
    accion: "CONFIRMAR",
    nuevos: {
      rubro: input.rubro,
      utilidadDisponibleAntes: money(profit.availableCents),
      utilidadTotal: money(totalCents),
      utilidadRestante: money(remainingCents),
      montoPorSocio: money(shareCents),
      coberturas: input.coberturas,
    },
  });
  return {
    id: distribution.rows[0].id,
    utilidadDisponibleAntes: money(profit.availableCents),
    utilidadTotal: money(totalCents),
    utilidadRestante: money(remainingCents),
    montoPorSocio: money(shareCents),
  };
}
