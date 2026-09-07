BEGIN;

-- Solo transforma instalaciones creadas con el modelo anterior por socio.
-- Las instalaciones nuevas ya crean `inventario` en la migración 001.
DO $$
BEGIN
  IF to_regclass('public.inventario_por_socio') IS NOT NULL THEN
    CREATE TABLE inventario_general_nuevo (
      producto_id uuid PRIMARY KEY REFERENCES productos(id) ON DELETE RESTRICT,
      existencia integer NOT NULL DEFAULT 0 CHECK (existencia >= 0),
      costo_promedio_unitario numeric(14,4) NOT NULL DEFAULT 0 CHECK (costo_promedio_unitario >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO inventario_general_nuevo (producto_id, existencia, costo_promedio_unitario, updated_at)
    SELECT producto_id, sum(existencia)::integer,
           CASE WHEN sum(existencia) = 0 THEN 0 ELSE round(sum(existencia * costo_promedio_unitario) / sum(existencia), 4) END,
           max(updated_at)
      FROM inventario_por_socio GROUP BY producto_id;
    ALTER TABLE inventario_por_socio RENAME TO inventario_por_socio_legacy;
    ALTER TABLE inventario_general_nuevo RENAME TO inventario;
    ALTER TABLE movimientos_inventario DROP COLUMN socio_id;
    ALTER TABLE detalles_auditoria_inventario DROP CONSTRAINT detalles_auditoria_producto_socio_unico;
    ALTER TABLE detalles_auditoria_inventario DROP COLUMN socio_id;
    ALTER TABLE detalles_auditoria_inventario ADD CONSTRAINT detalles_auditoria_producto_unico UNIQUE (auditoria_id, producto_id);
    ALTER TABLE inventario_inicial_migracion DROP COLUMN socio_id;
    ALTER TABLE inventario_inicial_migracion DROP CONSTRAINT inventario_inicial_estado_valido;
    ALTER TABLE inventario_inicial_migracion ADD CONSTRAINT inventario_inicial_estado_valido CHECK (estado IN ('EXCLUIDO', 'APLICADO'));
    DROP INDEX IF EXISTS movimientos_inventario_producto_socio_fecha_idx;
    CREATE INDEX movimientos_inventario_producto_fecha_idx ON movimientos_inventario (producto_id, created_at DESC);
  END IF;
END $$;

COMMIT;
