-- Permite identificar de forma explícita los ajustes automáticos de fondos
-- causados por la edición o eliminación lógica de un préstamo.
ALTER TYPE tipo_movimiento_custodia ADD VALUE IF NOT EXISTS 'AJUSTE_PRESTAMO';
ALTER TYPE tipo_movimiento_financiero ADD VALUE IF NOT EXISTS 'AJUSTE_PRESTAMO';
