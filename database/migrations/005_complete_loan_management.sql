-- Ejecutar una sola vez con psql. Los valores nuevos de enum se confirman antes de usarlos.
ALTER TYPE estado_prestamo ADD VALUE IF NOT EXISTS 'INCOBRABLE';
ALTER TYPE estado_prestamo ADD VALUE IF NOT EXISTS 'RECUPERADO';
ALTER TYPE tipo_movimiento_custodia ADD VALUE IF NOT EXISTS 'RECUPERACION_INCOBRABLE';
ALTER TYPE tipo_movimiento_financiero ADD VALUE IF NOT EXISTS 'PERDIDA_PRESTAMO';
ALTER TYPE tipo_movimiento_financiero ADD VALUE IF NOT EXISTS 'RECUPERACION_INCOBRABLE';

BEGIN;

ALTER TABLE intereses_prestamo
  ADD COLUMN IF NOT EXISTS cancelado_at timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_cancelacion text,
  ADD COLUMN IF NOT EXISTS cancelado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL;

ALTER TABLE pagos_prestamo
  ADD COLUMN IF NOT EXISTS revertido_at timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_reversion text,
  ADD COLUMN IF NOT EXISTS revertido_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estado_prestamo_anterior estado_prestamo,
  ADD COLUMN IF NOT EXISTS fecha_proximo_pago_anterior date;

CREATE TABLE IF NOT EXISTS reprogramaciones_prestamo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestamo_id uuid NOT NULL REFERENCES prestamos(id) ON DELETE RESTRICT,
  fecha_anterior date NOT NULL,
  fecha_nueva date NOT NULL,
  motivo text NOT NULL,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reprogramaciones_motivo_no_vacio CHECK (btrim(motivo) <> '')
);

CREATE TABLE IF NOT EXISTS prestamos_incobrables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestamo_id uuid NOT NULL UNIQUE REFERENCES prestamos(id) ON DELETE RESTRICT,
  fecha_declaracion date NOT NULL,
  capital_declarado numeric(14,2) NOT NULL,
  intereses_cancelados numeric(14,2) NOT NULL,
  saldo_pendiente numeric(14,2) NOT NULL,
  motivo text NOT NULL,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incobrables_montos_validos CHECK (capital_declarado > 0 AND intereses_cancelados >= 0 AND saldo_pendiente >= 0 AND saldo_pendiente <= capital_declarado),
  CONSTRAINT incobrables_motivo_no_vacio CHECK (btrim(motivo) <> '')
);

CREATE TABLE IF NOT EXISTS recuperaciones_incobrables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incobrable_id uuid NOT NULL REFERENCES prestamos_incobrables(id) ON DELETE RESTRICT,
  prestamo_id uuid NOT NULL REFERENCES prestamos(id) ON DELETE RESTRICT,
  custodia_id uuid NOT NULL REFERENCES custodias(id) ON DELETE RESTRICT,
  fecha date NOT NULL,
  monto numeric(14,2) NOT NULL,
  saldo_anterior numeric(14,2) NOT NULL,
  saldo_posterior numeric(14,2) NOT NULL,
  observaciones text,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revertido_at timestamptz,
  motivo_reversion text,
  revertido_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT recuperaciones_monto_positivo CHECK (monto > 0 AND saldo_anterior >= saldo_posterior AND saldo_posterior >= 0 AND monto = saldo_anterior - saldo_posterior)
);

CREATE TABLE IF NOT EXISTS anulaciones_prestamo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestamo_id uuid NOT NULL UNIQUE REFERENCES prestamos(id) ON DELETE RESTRICT,
  fecha date NOT NULL,
  capital_devuelto numeric(14,2) NOT NULL,
  intereses_cancelados numeric(14,2) NOT NULL,
  motivo text NOT NULL,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT anulaciones_motivo_no_vacio CHECK (btrim(motivo) <> '')
);

CREATE INDEX IF NOT EXISTS reprogramaciones_prestamo_idx ON reprogramaciones_prestamo (prestamo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recuperaciones_incobrables_idx ON recuperaciones_incobrables (prestamo_id, fecha DESC);

DROP TRIGGER IF EXISTS prestamos_incobrables_updated_at ON prestamos_incobrables;
CREATE TRIGGER prestamos_incobrables_updated_at BEFORE UPDATE ON prestamos_incobrables FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();

COMMIT;
