BEGIN;

ALTER TABLE prestamos
  ADD COLUMN IF NOT EXISTS eliminado_at timestamptz,
  ADD COLUMN IF NOT EXISTS eliminado_por uuid REFERENCES usuarios(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS motivo_eliminacion text,
  ADD COLUMN IF NOT EXISTS estado_antes_eliminacion estado_prestamo;

ALTER TABLE prestamos
  DROP CONSTRAINT IF EXISTS prestamos_eliminacion_completa;

ALTER TABLE prestamos
  ADD CONSTRAINT prestamos_eliminacion_completa CHECK (
    (eliminado_at IS NULL AND eliminado_por IS NULL AND motivo_eliminacion IS NULL AND estado_antes_eliminacion IS NULL)
    OR
    (eliminado_at IS NOT NULL AND eliminado_por IS NOT NULL AND btrim(motivo_eliminacion) <> '' AND estado_antes_eliminacion IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS prestamos_eliminados_idx ON prestamos (eliminado_at DESC) WHERE eliminado_at IS NOT NULL;

-- Dos períodos distintos pueden compartir fecha cuando un pago anticipado reinicia
-- el ciclo mensual tomando como referencia la fecha real del pago.
ALTER TABLE intereses_prestamo DROP CONSTRAINT IF EXISTS intereses_prestamo_periodo_unico;
CREATE INDEX IF NOT EXISTS intereses_prestamo_fecha_idx ON intereses_prestamo (prestamo_id, fecha_vencimiento);

COMMIT;
