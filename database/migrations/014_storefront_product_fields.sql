-- AR Accesorios: campos comerciales aditivos en productos
-- Paso 04/24. No modifica inventario, ventas, compras ni préstamos.
BEGIN;

ALTER TABLE productos
  ADD COLUMN slug varchar(300),
  ADD COLUMN destacado boolean NOT NULL DEFAULT false,
  ADD COLUMN descripcion_tienda text,
  ADD COLUMN precio_oferta numeric(14,2),
  ADD COLUMN fecha_inicio_oferta timestamptz,
  ADD COLUMN fecha_fin_oferta timestamptz;

ALTER TABLE productos
  ADD CONSTRAINT productos_descripcion_tienda_longitud CHECK
    (descripcion_tienda IS NULL OR length(descripcion_tienda) <= 5000),
  ADD CONSTRAINT productos_precio_oferta_positivo CHECK
    (precio_oferta IS NULL OR precio_oferta > 0),
  ADD CONSTRAINT productos_fechas_oferta_orden CHECK
    (fecha_inicio_oferta IS NULL OR fecha_fin_oferta IS NULL
     OR fecha_inicio_oferta < fecha_fin_oferta);

-- Los slug incluyen el UUID completo: no colisionan con nombres repetidos.
-- El slug se conserva al cambiar el nombre del producto para no romper enlaces.
CREATE OR REPLACE FUNCTION asignar_slug_producto()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prefijo text;
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    prefijo := regexp_replace(
      regexp_replace(
        translate(lower(NEW.nombre),
          'áàäâéèëêíìïîóòöôúùüûñ',
          'aaaaeeeeiiiioooouuuun'),
        '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)', '', 'g');
    IF prefijo = '' THEN prefijo := 'producto'; END IF;
    NEW.slug := left(prefijo, 260) || '-' || replace(NEW.id::text, '-', '');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER productos_asignar_slug
BEFORE INSERT OR UPDATE OF slug ON productos
FOR EACH ROW EXECUTE FUNCTION asignar_slug_producto();

-- Backfill usando la misma regla que futuros INSERT.
UPDATE productos SET slug = NULL WHERE slug IS NULL;

ALTER TABLE productos
  ALTER COLUMN slug SET NOT NULL,
  ADD CONSTRAINT productos_slug_no_vacio CHECK (btrim(slug) <> ''),
  ADD CONSTRAINT productos_slug_formato CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
CREATE UNIQUE INDEX productos_slug_unico_idx ON productos (slug);

COMMENT ON COLUMN productos.slug IS 'URL publica estable generada automáticamente; no cambia al renombrar';
COMMENT ON COLUMN productos.destacado IS 'Indica si el producto aparece destacado en AR Accesorios';
COMMENT ON COLUMN productos.descripcion_tienda IS 'Descripción comercial opcional; si falta, usar descripcion';
COMMENT ON COLUMN productos.precio_oferta IS 'Precio promocional opcional, distinto del precio normal precio_sugerido';
COMMENT ON COLUMN productos.fecha_inicio_oferta IS 'Inicio de vigencia de la oferta; NULL implica sin límite inicial';
COMMENT ON COLUMN productos.fecha_fin_oferta IS 'Fin de vigencia de la oferta; NULL implica sin límite final';

COMMIT;
