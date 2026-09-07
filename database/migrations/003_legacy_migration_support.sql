BEGIN;

ALTER TYPE tipo_movimiento_inventario ADD VALUE IF NOT EXISTS 'MIGRACION_INICIAL';
ALTER TYPE tipo_movimiento_custodia ADD VALUE IF NOT EXISTS 'MIGRACION_INICIAL';

CREATE TABLE fuentes_migracion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_archivo varchar(260) NOT NULL,
  sha256 char(64) NOT NULL UNIQUE,
  tamano_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fuentes_migracion_sha256_valido CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT fuentes_migracion_tamano_valido CHECK (tamano_bytes > 0)
);

CREATE TABLE ejecuciones_migracion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fuente_id uuid NOT NULL REFERENCES fuentes_migracion(id) ON DELETE RESTRICT,
  modo varchar(20) NOT NULL,
  estado varchar(30) NOT NULL,
  ruta_respaldo text,
  reporte jsonb NOT NULL DEFAULT '{}'::jsonb,
  iniciado_at timestamptz NOT NULL DEFAULT now(),
  finalizado_at timestamptz,
  CONSTRAINT ejecuciones_migracion_modo_valido CHECK (modo IN ('PRUEBA', 'DEFINITIVA')),
  CONSTRAINT ejecuciones_migracion_estado_valido CHECK (estado IN ('INICIADA', 'COMPLETADA', 'FALLIDA'))
);

CREATE TABLE filas_migracion (
  id bigserial PRIMARY KEY,
  fuente_id uuid NOT NULL REFERENCES fuentes_migracion(id) ON DELETE RESTRICT,
  hoja varchar(120) NOT NULL,
  fila_excel integer NOT NULL,
  clave_fuente text,
  datos_fuente jsonb NOT NULL,
  transformacion jsonb,
  estado varchar(30) NOT NULL DEFAULT 'CONSERVADA',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filas_migracion_unica UNIQUE (fuente_id, hoja, fila_excel),
  CONSTRAINT filas_migracion_fila_valida CHECK (fila_excel > 0)
);

ALTER TABLE productos
  ADD COLUMN marca varchar(120),
  ADD COLUMN modelo varchar(120),
  ADD COLUMN sku varchar(120),
  ADD COLUMN codigo_barras varchar(160),
  ADD COLUMN control_serie boolean NOT NULL DEFAULT false,
  ADD COLUMN garantia_dias integer NOT NULL DEFAULT 0,
  ADD COLUMN precio_sugerido numeric(14,2),
  ADD COLUMN precio_minimo numeric(14,2),
  ADD COLUMN existencia_minima integer NOT NULL DEFAULT 0,
  ADD COLUMN fuente_migracion_id uuid REFERENCES fuentes_migracion(id) ON DELETE RESTRICT;

ALTER TABLE productos
  ADD CONSTRAINT productos_garantia_valida CHECK (garantia_dias >= 0),
  ADD CONSTRAINT productos_precios_migrados_validos CHECK ((precio_sugerido IS NULL OR precio_sugerido >= 0) AND (precio_minimo IS NULL OR precio_minimo >= 0)),
  ADD CONSTRAINT productos_existencia_minima_valida CHECK (existencia_minima >= 0);

ALTER TABLE prestamos DROP CONSTRAINT prestamos_fecha_valida;
ALTER TABLE prestamos ALTER COLUMN fecha_desembolso DROP NOT NULL;
ALTER TABLE prestamos
  ADD COLUMN es_heredado boolean NOT NULL DEFAULT false,
  ADD COLUMN fecha_proximo_pago_heredada date,
  ADD COLUMN interes_inicial_heredado numeric(14,2),
  ADD COLUMN calcular_interes_desde date,
  ADD COLUMN fuente_migracion_id uuid REFERENCES fuentes_migracion(id) ON DELETE RESTRICT,
  ADD CONSTRAINT prestamos_fecha_valida CHECK (fecha_desembolso IS NULL OR fecha_proximo_pago >= fecha_desembolso),
  ADD CONSTRAINT prestamos_interes_heredado_valido CHECK (interes_inicial_heredado IS NULL OR interes_inicial_heredado >= 0);

CREATE TABLE inventario_inicial_migracion (
  fuente_id uuid NOT NULL REFERENCES fuentes_migracion(id) ON DELETE RESTRICT,
  producto_legacy_id uuid NOT NULL,
  producto_id uuid REFERENCES productos(id) ON DELETE RESTRICT,
  socio_id uuid REFERENCES socios(id) ON DELETE RESTRICT,
  existencia_fuente integer NOT NULL,
  existencia_aplicada integer NOT NULL,
  costo_unitario numeric(14,4) NOT NULL,
  estado varchar(30) NOT NULL,
  observaciones text,
  PRIMARY KEY (fuente_id, producto_legacy_id),
  CONSTRAINT inventario_inicial_cantidades_validas CHECK (existencia_fuente >= 0 AND existencia_aplicada >= 0),
  CONSTRAINT inventario_inicial_costo_valido CHECK (costo_unitario >= 0),
  CONSTRAINT inventario_inicial_estado_valido CHECK (estado IN ('EXCLUIDO', 'PENDIENTE_SOCIO', 'APLICADO'))
);

CREATE TABLE ventas_historicas (
  id uuid PRIMARY KEY,
  fuente_id uuid NOT NULL REFERENCES fuentes_migracion(id) ON DELETE RESTRICT,
  producto_legacy_id uuid,
  producto_nombre varchar(200),
  cantidad integer NOT NULL,
  costo_unitario numeric(14,4) NOT NULL,
  precio_unitario numeric(14,4) NOT NULL,
  total numeric(14,2) NOT NULL,
  ganancia numeric(14,2) NOT NULL,
  vendedor_original text,
  fecha date,
  observaciones text,
  hoja_origen varchar(120),
  fila_origen integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ventas_historicas_cantidad_valida CHECK (cantidad > 0)
);

CREATE TABLE pagos_intereses_historicos (
  id uuid PRIMARY KEY,
  fuente_id uuid NOT NULL REFERENCES fuentes_migracion(id) ON DELETE RESTRICT,
  cliente_id uuid REFERENCES clientes(id) ON DELETE RESTRICT,
  cliente_nombre varchar(180),
  capital_referencia numeric(14,2) NOT NULL,
  interes_pagado numeric(14,2) NOT NULL,
  tasa_catalogo numeric(7,4),
  tasa_inferida numeric(7,4),
  fecha_pago date,
  socio_id uuid REFERENCES socios(id) ON DELETE RESTRICT,
  responsable_original text,
  observaciones text,
  hoja_origen varchar(120),
  fila_origen integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pagos_intereses_historicos_montos_validos CHECK (capital_referencia >= 0 AND interes_pagado >= 0)
);

CREATE TABLE movimientos_financieros_legacy (
  id uuid PRIMARY KEY,
  fuente_id uuid NOT NULL REFERENCES fuentes_migracion(id) ON DELETE RESTRICT,
  tipo varchar(80) NOT NULL,
  monto numeric(14,2) NOT NULL,
  fecha date,
  socio_id uuid REFERENCES socios(id) ON DELETE RESTRICT,
  afecta_saldo_inicial boolean NOT NULL DEFAULT false,
  observaciones text,
  hoja_origen varchar(120),
  fila_origen integer,
  columna_origen integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE distribuciones_utilidades_historicas (
  id uuid PRIMARY KEY,
  fuente_id uuid NOT NULL REFERENCES fuentes_migracion(id) ON DELETE RESTRICT,
  socio_id uuid REFERENCES socios(id) ON DELETE RESTRICT,
  socio_original text,
  monto numeric(14,2) NOT NULL,
  fecha_pago date,
  tipo varchar(100) NOT NULL,
  observaciones text,
  hoja_origen varchar(120),
  fila_origen integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distribuciones_historicas_monto_valido CHECK (monto >= 0)
);

CREATE INDEX filas_migracion_fuente_hoja_idx ON filas_migracion (fuente_id, hoja, fila_excel);
CREATE INDEX ventas_historicas_fuente_idx ON ventas_historicas (fuente_id);
CREATE INDEX pagos_intereses_historicos_cliente_fecha_idx ON pagos_intereses_historicos (cliente_id, fecha_pago);
CREATE INDEX movimientos_financieros_legacy_fuente_idx ON movimientos_financieros_legacy (fuente_id);
CREATE INDEX distribuciones_historicas_fuente_idx ON distribuciones_utilidades_historicas (fuente_id);

COMMIT;
