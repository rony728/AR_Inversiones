BEGIN;

ALTER TABLE ajustes_fondo
  DROP CONSTRAINT IF EXISTS ajustes_fondo_saldos_no_negativos;

COMMIT;
