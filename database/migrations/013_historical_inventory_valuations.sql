ALTER TYPE tipo_movimiento_inventario
  ADD VALUE IF NOT EXISTS 'VALORIZACION_HISTORICA';

BEGIN;

CREATE TABLE valorizaciones_inventario_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  existencia_verificada integer NOT NULL,
  costo_anterior numeric(14,4) NOT NULL,
  costo_nuevo numeric(14,4) NOT NULL,
  fecha_referencia date NOT NULL,
  motivo text NOT NULL,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valorizaciones_existencia_positiva CHECK (existencia_verificada > 0),
  CONSTRAINT valorizaciones_costos_validos CHECK (costo_anterior >= 0 AND costo_nuevo > 0),
  CONSTRAINT valorizaciones_costo_distinto CHECK (costo_anterior <> costo_nuevo),
  CONSTRAINT valorizaciones_motivo_no_vacio CHECK (length(btrim(motivo)) >= 3)
);

CREATE INDEX valorizaciones_inventario_producto_fecha_idx
  ON valorizaciones_inventario_historico (producto_id, fecha_referencia DESC, created_at DESC);

COMMIT;
