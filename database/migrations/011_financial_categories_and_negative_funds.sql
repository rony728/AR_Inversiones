BEGIN;

-- Los códigos comerciales son opcionales; la unicidad solo aplica cuando existen.
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_codigo_unico;
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_codigo_no_vacio;
ALTER TABLE productos ALTER COLUMN codigo DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS productos_codigo_unico_no_nulo
  ON productos (codigo) WHERE codigo IS NOT NULL;

-- Los fondos pueden quedar negativos como resultado de operaciones legítimas.
ALTER TABLE custodias DROP CONSTRAINT IF EXISTS custodias_saldo_no_negativo;
ALTER TABLE movimientos_custodia DROP CONSTRAINT IF EXISTS movimientos_custodia_saldos_validos;
ALTER TABLE movimientos_custodia ADD CONSTRAINT movimientos_custodia_cambio_valido
  CHECK (saldo_posterior = saldo_anterior + variacion);

-- El rubro de los gastos históricos se obtiene de la custodia efectivamente debitada.
ALTER TABLE gastos ADD COLUMN rubro actividad_custodia;
UPDATE gastos g SET rubro = c.actividad FROM custodias c WHERE c.id = g.custodia_id;
ALTER TABLE gastos ALTER COLUMN rubro SET NOT NULL;

-- El extra es explícito y nunca forma parte del monto aplicado a capital/interés.
ALTER TABLE pagos_prestamo ADD COLUMN monto_extra numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE pagos_prestamo ADD CONSTRAINT pagos_prestamo_extra_valido CHECK (monto_extra >= 0);

ALTER TYPE tipo_movimiento_financiero ADD VALUE IF NOT EXISTS 'INGRESO_EXTRA_PRESTAMO';

-- Las distribuciones nuevas identifican la utilidad que consumen por rubro.
ALTER TABLE distribuciones_utilidades ADD COLUMN rubro actividad_custodia;
UPDATE distribuciones_utilidades d
SET rubro = x.actividad
FROM (
  SELECT q.distribucion_id, min(c.actividad::text)::actividad_custodia AS actividad
  FROM cuotas_distribucion_utilidad q
  JOIN custodias c ON c.id = q.custodia_id
  GROUP BY q.distribucion_id
  HAVING count(DISTINCT c.actividad) = 1
) x
WHERE x.distribucion_id = d.id;

CREATE INDEX IF NOT EXISTS gastos_rubro_fecha_idx ON gastos (rubro, fecha) WHERE estado = 'CONFIRMADO';
CREATE INDEX IF NOT EXISTS distribuciones_rubro_fecha_idx ON distribuciones_utilidades (rubro, fecha);

COMMIT;
