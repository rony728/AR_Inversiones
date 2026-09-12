-- Habilita transferencias entre fondos de socios distintos y registra ajustes
-- manuales trazables sin convertirlos en ingresos, gastos o utilidad.

BEGIN;

ALTER TYPE tipo_movimiento_custodia ADD VALUE IF NOT EXISTS 'AJUSTE_MANUAL_FONDO';

ALTER TABLE transferencias_custodia
  ADD COLUMN socio_destino_id uuid REFERENCES socios(id) ON DELETE RESTRICT;

UPDATE transferencias_custodia t
SET socio_destino_id = c.socio_id
FROM custodias c
WHERE c.id = t.custodia_destino_id
  AND t.socio_destino_id IS NULL;

ALTER TABLE transferencias_custodia
  ALTER COLUMN socio_destino_id SET NOT NULL;

CREATE TABLE ajustes_fondo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  socio_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  custodia_id uuid NOT NULL REFERENCES custodias(id) ON DELETE RESTRICT,
  saldo_anterior numeric(14,2) NOT NULL,
  saldo_nuevo numeric(14,2) NOT NULL,
  diferencia numeric(14,2) NOT NULL,
  motivo text NOT NULL,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ajustes_fondo_saldos_no_negativos CHECK (saldo_anterior >= 0 AND saldo_nuevo >= 0),
  CONSTRAINT ajustes_fondo_diferencia_valida CHECK (diferencia <> 0 AND saldo_nuevo = saldo_anterior + diferencia),
  CONSTRAINT ajustes_fondo_motivo_valido CHECK (char_length(btrim(motivo)) >= 3)
);

CREATE INDEX ajustes_fondo_custodia_fecha_idx ON ajustes_fondo (custodia_id, created_at DESC);

CREATE OR REPLACE FUNCTION validar_transferencia_custodia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM custodias c WHERE c.id = NEW.custodia_origen_id AND c.socio_id = NEW.socio_id) THEN
    RAISE EXCEPTION 'El fondo de origen debe pertenecer al socio de origen';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM custodias c WHERE c.id = NEW.custodia_destino_id AND c.socio_id = NEW.socio_destino_id) THEN
    RAISE EXCEPTION 'El fondo de destino debe pertenecer al socio de destino';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validar_ajuste_fondo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM custodias c WHERE c.id = NEW.custodia_id AND c.socio_id = NEW.socio_id) THEN
    RAISE EXCEPTION 'El fondo ajustado debe pertenecer al socio seleccionado';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER ajustes_fondo_validar_custodia
BEFORE INSERT OR UPDATE OF socio_id, custodia_id ON ajustes_fondo
FOR EACH ROW EXECUTE FUNCTION validar_ajuste_fondo();

COMMIT;
