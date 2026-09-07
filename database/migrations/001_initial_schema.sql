BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE actividad_custodia AS ENUM ('PRODUCTOS', 'PRESTAMOS');
CREATE TYPE estado_prestamo AS ENUM ('ACTIVO', 'VENCIDO', 'PAGADO', 'ANULADO');
CREATE TYPE estado_documento AS ENUM ('BORRADOR', 'CONFIRMADO', 'REVERSADO', 'ANULADO');
CREATE TYPE tipo_movimiento_inventario AS ENUM ('COMPRA', 'VENTA', 'AJUSTE_AUDITORIA', 'REVERSO');
CREATE TYPE tipo_movimiento_custodia AS ENUM ('COMPRA', 'VENTA', 'DESEMBOLSO_PRESTAMO', 'PAGO_PRESTAMO', 'GASTO', 'TRANSFERENCIA_SALIDA', 'TRANSFERENCIA_ENTRADA', 'DISTRIBUCION_UTILIDAD', 'COBERTURA_DISTRIBUCION', 'REVERSO');
CREATE TYPE tipo_movimiento_financiero AS ENUM ('INGRESO_VENTA', 'COSTO_VENTA', 'COMPRA_INVENTARIO', 'DESEMBOLSO_PRESTAMO', 'COBRO_CAPITAL', 'INGRESO_INTERES', 'GASTO', 'DISTRIBUCION_UTILIDAD', 'REVERSO');
CREATE TYPE estado_auditoria_inventario AS ENUM ('ABIERTA', 'APROBADA', 'CANCELADA');
CREATE TYPE estado_sincronizacion AS ENUM ('PENDIENTE', 'PROCESANDO', 'APLICADA', 'RECHAZADA');

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar(160) NOT NULL,
  usuario varchar(80) NOT NULL,
  password_hash text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_usuario_unico UNIQUE (usuario),
  CONSTRAINT usuarios_nombre_no_vacio CHECK (btrim(nombre) <> ''),
  CONSTRAINT usuarios_usuario_no_vacio CHECK (btrim(usuario) <> '')
);

CREATE TABLE socios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar(120) NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT socios_nombre_unico UNIQUE (nombre),
  CONSTRAINT socios_nombre_no_vacio CHECK (btrim(nombre) <> '')
);

CREATE TABLE clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar(180) NOT NULL,
  identificacion varchar(80),
  telefono varchar(50),
  direccion text,
  notas text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clientes_nombre_no_vacio CHECK (btrim(nombre) <> '')
);
CREATE UNIQUE INDEX clientes_identificacion_unica ON clientes (identificacion) WHERE identificacion IS NOT NULL;

CREATE TABLE categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar(120) NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categorias_nombre_unico UNIQUE (nombre),
  CONSTRAINT categorias_nombre_no_vacio CHECK (btrim(nombre) <> '')
);

CREATE TABLE proveedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar(180) NOT NULL,
  identificacion varchar(80),
  telefono varchar(50),
  direccion text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proveedores_nombre_no_vacio CHECK (btrim(nombre) <> '')
);

CREATE TABLE productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id uuid REFERENCES categorias(id) ON DELETE RESTRICT,
  codigo varchar(80) NOT NULL,
  nombre varchar(200) NOT NULL,
  descripcion text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT productos_codigo_unico UNIQUE (codigo),
  CONSTRAINT productos_codigo_no_vacio CHECK (btrim(codigo) <> ''),
  CONSTRAINT productos_nombre_no_vacio CHECK (btrim(nombre) <> '')
);

CREATE TABLE custodias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  socio_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  actividad actividad_custodia NOT NULL,
  saldo_actual numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custodias_socio_actividad_unica UNIQUE (socio_id, actividad),
  CONSTRAINT custodias_saldo_no_negativo CHECK (saldo_actual >= 0)
);

-- Existencia y costo promedio ponderado por producto y socio financiador.
CREATE TABLE inventario_por_socio (
  producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  socio_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  existencia integer NOT NULL DEFAULT 0,
  costo_promedio_unitario numeric(14,4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (producto_id, socio_id),
  CONSTRAINT inventario_existencia_no_negativa CHECK (existencia >= 0),
  CONSTRAINT inventario_costo_no_negativo CHECK (costo_promedio_unitario >= 0)
);

CREATE TABLE compras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id uuid REFERENCES proveedores(id) ON DELETE RESTRICT,
  socio_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  custodia_id uuid NOT NULL REFERENCES custodias(id) ON DELETE RESTRICT,
  fecha date NOT NULL,
  estado estado_documento NOT NULL DEFAULT 'BORRADOR',
  total numeric(14,2) NOT NULL DEFAULT 0,
  observaciones text,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compras_total_no_negativo CHECK (total >= 0)
);

CREATE TABLE detalle_compras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id uuid NOT NULL REFERENCES compras(id) ON DELETE RESTRICT,
  producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad integer NOT NULL,
  costo_unitario numeric(14,4) NOT NULL,
  subtotal numeric(14,2) NOT NULL,
  CONSTRAINT detalle_compras_cantidad_positiva CHECK (cantidad > 0),
  CONSTRAINT detalle_compras_costo_no_negativo CHECK (costo_unitario >= 0),
  CONSTRAINT detalle_compras_subtotal_no_negativo CHECK (subtotal >= 0)
);

CREATE TABLE ventas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES clientes(id) ON DELETE RESTRICT,
  fecha timestamptz NOT NULL DEFAULT now(),
  estado estado_documento NOT NULL DEFAULT 'BORRADOR',
  total numeric(14,2) NOT NULL DEFAULT 0,
  ganancia_total numeric(14,2) NOT NULL DEFAULT 0,
  observaciones text,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ventas_total_no_negativo CHECK (total >= 0)
);

CREATE TABLE detalle_ventas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id uuid NOT NULL REFERENCES ventas(id) ON DELETE RESTRICT,
  producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  socio_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  custodia_id uuid NOT NULL REFERENCES custodias(id) ON DELETE RESTRICT,
  cantidad integer NOT NULL,
  precio_unitario numeric(14,4) NOT NULL,
  costo_unitario numeric(14,4) NOT NULL,
  subtotal numeric(14,2) NOT NULL,
  costo_total numeric(14,2) NOT NULL,
  ganancia numeric(14,2) NOT NULL,
  CONSTRAINT detalle_ventas_cantidad_positiva CHECK (cantidad > 0),
  CONSTRAINT detalle_ventas_importes_no_negativos CHECK (precio_unitario >= 0 AND costo_unitario >= 0 AND subtotal >= 0 AND costo_total >= 0)
);

CREATE TABLE movimientos_inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  socio_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  tipo tipo_movimiento_inventario NOT NULL,
  cantidad integer NOT NULL,
  existencia_anterior integer NOT NULL,
  existencia_posterior integer NOT NULL,
  costo_unitario numeric(14,4),
  referencia_tipo varchar(60) NOT NULL,
  referencia_id uuid NOT NULL,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movimientos_inventario_existencias_no_negativas CHECK (existencia_anterior >= 0 AND existencia_posterior >= 0),
  CONSTRAINT movimientos_inventario_cambio_valido CHECK (existencia_posterior = existencia_anterior + cantidad)
);

CREATE TABLE prestamos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  socio_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  custodia_id uuid NOT NULL REFERENCES custodias(id) ON DELETE RESTRICT,
  fecha_desembolso date NOT NULL,
  fecha_proximo_pago date NOT NULL,
  tasa_mensual numeric(7,4) NOT NULL DEFAULT 15.0000,
  capital_original numeric(14,2) NOT NULL,
  capital_pendiente numeric(14,2) NOT NULL,
  estado estado_prestamo NOT NULL DEFAULT 'ACTIVO',
  observaciones text,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prestamos_tasa_valida CHECK (tasa_mensual >= 0 AND tasa_mensual <= 100),
  CONSTRAINT prestamos_capital_valido CHECK (capital_original > 0 AND capital_pendiente >= 0 AND capital_pendiente <= capital_original),
  CONSTRAINT prestamos_fecha_valida CHECK (fecha_proximo_pago >= fecha_desembolso)
);

-- Cada período de interés se conserva separado; nunca se capitaliza.
CREATE TABLE intereses_prestamo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestamo_id uuid NOT NULL REFERENCES prestamos(id) ON DELETE RESTRICT,
  fecha_vencimiento date NOT NULL,
  capital_base numeric(14,2) NOT NULL,
  tasa_mensual numeric(7,4) NOT NULL,
  monto_interes numeric(14,2) NOT NULL,
  saldo_pendiente numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intereses_prestamo_periodo_unico UNIQUE (prestamo_id, fecha_vencimiento),
  CONSTRAINT intereses_prestamo_montos_validos CHECK (capital_base >= 0 AND tasa_mensual >= 0 AND monto_interes >= 0 AND saldo_pendiente >= 0 AND saldo_pendiente <= monto_interes)
);

CREATE TABLE pagos_prestamo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestamo_id uuid NOT NULL REFERENCES prestamos(id) ON DELETE RESTRICT,
  custodia_id uuid NOT NULL REFERENCES custodias(id) ON DELETE RESTRICT,
  fecha_pago date NOT NULL,
  monto_total numeric(14,2) NOT NULL,
  monto_interes numeric(14,2) NOT NULL,
  monto_capital numeric(14,2) NOT NULL,
  saldo_capital_anterior numeric(14,2) NOT NULL,
  saldo_capital_posterior numeric(14,2) NOT NULL,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pagos_prestamo_montos_validos CHECK (monto_total > 0 AND monto_interes >= 0 AND monto_capital >= 0 AND monto_total = monto_interes + monto_capital),
  CONSTRAINT pagos_prestamo_capital_valido CHECK (saldo_capital_anterior >= saldo_capital_posterior AND saldo_capital_posterior >= 0 AND monto_capital = saldo_capital_anterior - saldo_capital_posterior)
);

CREATE TABLE pagos_intereses_prestamo (
  pago_prestamo_id uuid NOT NULL REFERENCES pagos_prestamo(id) ON DELETE RESTRICT,
  interes_prestamo_id uuid NOT NULL REFERENCES intereses_prestamo(id) ON DELETE RESTRICT,
  monto_aplicado numeric(14,2) NOT NULL,
  PRIMARY KEY (pago_prestamo_id, interes_prestamo_id),
  CONSTRAINT pagos_intereses_monto_positivo CHECK (monto_aplicado > 0)
);

CREATE TABLE gastos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  socio_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  custodia_id uuid NOT NULL REFERENCES custodias(id) ON DELETE RESTRICT,
  concepto varchar(300) NOT NULL,
  monto numeric(14,2) NOT NULL,
  fecha date NOT NULL,
  estado estado_documento NOT NULL DEFAULT 'CONFIRMADO',
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gastos_concepto_no_vacio CHECK (btrim(concepto) <> ''),
  CONSTRAINT gastos_monto_positivo CHECK (monto > 0)
);

CREATE TABLE transferencias_custodia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  socio_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  custodia_origen_id uuid NOT NULL REFERENCES custodias(id) ON DELETE RESTRICT,
  custodia_destino_id uuid NOT NULL REFERENCES custodias(id) ON DELETE RESTRICT,
  monto numeric(14,2) NOT NULL,
  fecha timestamptz NOT NULL DEFAULT now(),
  observaciones text,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transferencias_custodias_distintas CHECK (custodia_origen_id <> custodia_destino_id),
  CONSTRAINT transferencias_monto_positivo CHECK (monto > 0)
);

CREATE TABLE distribuciones_utilidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  utilidad_total numeric(14,2) NOT NULL,
  monto_por_socio numeric(14,2) NOT NULL,
  observaciones text,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distribuciones_montos_validos CHECK (utilidad_total > 0 AND monto_por_socio > 0 AND utilidad_total = monto_por_socio * 3)
);

CREATE TABLE cuotas_distribucion_utilidad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribucion_id uuid NOT NULL REFERENCES distribuciones_utilidades(id) ON DELETE RESTRICT,
  socio_beneficiario_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  socio_cubridor_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  custodia_id uuid NOT NULL REFERENCES custodias(id) ON DELETE RESTRICT,
  monto numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cuotas_distribucion_monto_positivo CHECK (monto > 0)
);

CREATE TABLE auditorias_inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_inicio timestamptz NOT NULL DEFAULT now(),
  fecha_aprobacion timestamptz,
  estado estado_auditoria_inventario NOT NULL DEFAULT 'ABIERTA',
  observaciones text,
  iniciado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  aprobado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auditorias_aprobacion_estado CHECK ((estado = 'APROBADA') = (fecha_aprobacion IS NOT NULL))
);

CREATE TABLE detalles_auditoria_inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auditoria_id uuid NOT NULL REFERENCES auditorias_inventario(id) ON DELETE RESTRICT,
  producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  socio_id uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  existencia_sistema integer NOT NULL,
  existencia_fisica integer NOT NULL,
  diferencia integer NOT NULL,
  CONSTRAINT detalles_auditoria_producto_socio_unico UNIQUE (auditoria_id, producto_id, socio_id),
  CONSTRAINT detalles_auditoria_existencias_no_negativas CHECK (existencia_sistema >= 0 AND existencia_fisica >= 0),
  CONSTRAINT detalles_auditoria_diferencia_valida CHECK (diferencia = existencia_fisica - existencia_sistema)
);

CREATE TABLE movimientos_custodia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custodia_id uuid NOT NULL REFERENCES custodias(id) ON DELETE RESTRICT,
  tipo tipo_movimiento_custodia NOT NULL,
  variacion numeric(14,2) NOT NULL,
  saldo_anterior numeric(14,2) NOT NULL,
  saldo_posterior numeric(14,2) NOT NULL,
  referencia_tipo varchar(60) NOT NULL,
  referencia_id uuid NOT NULL,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movimientos_custodia_variacion_no_cero CHECK (variacion <> 0),
  CONSTRAINT movimientos_custodia_saldos_validos CHECK (saldo_anterior >= 0 AND saldo_posterior >= 0 AND saldo_posterior = saldo_anterior + variacion)
);

CREATE TABLE movimientos_financieros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo tipo_movimiento_financiero NOT NULL,
  fecha date NOT NULL,
  monto numeric(14,2) NOT NULL,
  socio_id uuid REFERENCES socios(id) ON DELETE RESTRICT,
  referencia_tipo varchar(60) NOT NULL,
  referencia_id uuid NOT NULL,
  descripcion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movimientos_financieros_monto_positivo CHECK (monto > 0)
);

CREATE TABLE reversiones_operacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_original_tipo varchar(60) NOT NULL,
  operacion_original_id uuid NOT NULL,
  operacion_reverso_tipo varchar(60) NOT NULL,
  operacion_reverso_id uuid NOT NULL,
  motivo text NOT NULL,
  created_by uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reversiones_origen_unico UNIQUE (operacion_original_tipo, operacion_original_id),
  CONSTRAINT reversiones_motivo_no_vacio CHECK (btrim(motivo) <> '')
);

CREATE TABLE auditoria_sistema (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  dispositivo_id uuid,
  entidad_tipo varchar(60) NOT NULL,
  entidad_id uuid NOT NULL,
  accion varchar(80) NOT NULL,
  datos_anteriores jsonb,
  datos_nuevos jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dispositivos_sincronizacion (
  id uuid PRIMARY KEY,
  nombre varchar(120) NOT NULL,
  usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  ultimo_sync_at timestamptz,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispositivos_nombre_no_vacio CHECK (btrim(nombre) <> '')
);

CREATE TABLE operaciones_sincronizacion (
  id uuid PRIMARY KEY,
  dispositivo_id uuid NOT NULL REFERENCES dispositivos_sincronizacion(id) ON DELETE RESTRICT,
  clave_idempotencia uuid NOT NULL,
  entidad_tipo varchar(60) NOT NULL,
  entidad_id uuid NOT NULL,
  tipo_operacion varchar(30) NOT NULL,
  payload jsonb NOT NULL,
  estado estado_sincronizacion NOT NULL DEFAULT 'PENDIENTE',
  intento_count integer NOT NULL DEFAULT 0,
  error_detalle text,
  recibido_at timestamptz NOT NULL DEFAULT now(),
  aplicado_at timestamptz,
  CONSTRAINT operaciones_sync_idempotencia_unica UNIQUE (clave_idempotencia),
  CONSTRAINT operaciones_sync_intentos_no_negativos CHECK (intento_count >= 0)
);

CREATE INDEX compras_fecha_idx ON compras (fecha);
CREATE INDEX detalle_compras_compra_idx ON detalle_compras (compra_id);
CREATE INDEX ventas_fecha_idx ON ventas (fecha);
CREATE INDEX detalle_ventas_venta_idx ON detalle_ventas (venta_id);
CREATE INDEX movimientos_inventario_producto_socio_fecha_idx ON movimientos_inventario (producto_id, socio_id, created_at DESC);
CREATE INDEX prestamos_cliente_estado_idx ON prestamos (cliente_id, estado);
CREATE INDEX prestamos_vencimiento_idx ON prestamos (fecha_proximo_pago) WHERE estado IN ('ACTIVO', 'VENCIDO');
CREATE INDEX intereses_prestamo_pendientes_idx ON intereses_prestamo (prestamo_id, fecha_vencimiento) WHERE saldo_pendiente > 0;
CREATE INDEX pagos_prestamo_prestamo_fecha_idx ON pagos_prestamo (prestamo_id, fecha_pago DESC);
CREATE INDEX movimientos_custodia_fecha_idx ON movimientos_custodia (custodia_id, created_at DESC);
CREATE INDEX movimientos_financieros_fecha_tipo_idx ON movimientos_financieros (fecha, tipo);
CREATE INDEX auditoria_sistema_entidad_idx ON auditoria_sistema (entidad_tipo, entidad_id, created_at DESC);
CREATE INDEX operaciones_sync_estado_idx ON operaciones_sincronizacion (estado, recibido_at);

CREATE OR REPLACE FUNCTION establecer_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION validar_custodia_de_socio() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actividad_esperada actividad_custodia;
BEGIN
  IF TG_TABLE_NAME = 'compras' THEN actividad_esperada := 'PRODUCTOS';
  ELSIF TG_TABLE_NAME = 'prestamos' THEN actividad_esperada := 'PRESTAMOS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM custodias c WHERE c.id = NEW.custodia_id AND c.socio_id = NEW.socio_id AND (actividad_esperada IS NULL OR c.actividad = actividad_esperada)) THEN
    RAISE EXCEPTION 'La custodia debe pertenecer al socio y actividad correspondiente';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validar_detalle_venta_custodia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM custodias c WHERE c.id = NEW.custodia_id AND c.socio_id = NEW.socio_id AND c.actividad = 'PRODUCTOS') THEN
    RAISE EXCEPTION 'La venta debe ingresar a la custodia PRODUCTOS del socio financiador';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validar_transferencia_custodia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM custodias c WHERE c.id = NEW.custodia_origen_id AND c.socio_id = NEW.socio_id)
     OR NOT EXISTS (SELECT 1 FROM custodias c WHERE c.id = NEW.custodia_destino_id AND c.socio_id = NEW.socio_id) THEN
    RAISE EXCEPTION 'Las dos custodias de una transferencia deben pertenecer al mismo socio';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validar_pago_prestamo_custodia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM prestamos p JOIN custodias c ON c.id = NEW.custodia_id
    WHERE p.id = NEW.prestamo_id AND c.id = p.custodia_id
  ) THEN
    RAISE EXCEPTION 'El pago debe ingresar a la custodia PRESTAMOS del socio que desembolsó el préstamo';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION validar_cuota_distribucion_custodia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM custodias c WHERE c.id = NEW.custodia_id AND c.socio_id = NEW.socio_cubridor_id) THEN
    RAISE EXCEPTION 'La custodia de distribución debe pertenecer al socio que cubre el monto';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION verificar_dos_custodias_por_socio() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE socio_uuid uuid; cantidad integer;
BEGIN
  IF TG_TABLE_NAME = 'socios' THEN
    socio_uuid := NEW.id;
  ELSE
    socio_uuid := COALESCE(NEW.socio_id, OLD.socio_id);
  END IF;
  IF EXISTS (SELECT 1 FROM socios WHERE id = socio_uuid) THEN
    SELECT count(*) INTO cantidad FROM custodias WHERE socio_id = socio_uuid;
    IF cantidad <> 2 OR EXISTS (SELECT 1 FROM custodias WHERE socio_id = socio_uuid GROUP BY socio_id HAVING count(DISTINCT actividad) <> 2) THEN
      RAISE EXCEPTION 'Cada socio debe conservar exactamente una custodia PRODUCTOS y una PRESTAMOS';
    END IF;
  END IF;
  RETURN NULL;
END; $$;

CREATE TRIGGER usuarios_updated_at BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER socios_updated_at BEFORE UPDATE ON socios FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER clientes_updated_at BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER categorias_updated_at BEFORE UPDATE ON categorias FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER proveedores_updated_at BEFORE UPDATE ON proveedores FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER productos_updated_at BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER custodias_updated_at BEFORE UPDATE ON custodias FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER compras_updated_at BEFORE UPDATE ON compras FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER ventas_updated_at BEFORE UPDATE ON ventas FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER prestamos_updated_at BEFORE UPDATE ON prestamos FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER gastos_updated_at BEFORE UPDATE ON gastos FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER auditorias_inventario_updated_at BEFORE UPDATE ON auditorias_inventario FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER dispositivos_updated_at BEFORE UPDATE ON dispositivos_sincronizacion FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();
CREATE TRIGGER compras_validar_custodia BEFORE INSERT OR UPDATE OF socio_id, custodia_id ON compras FOR EACH ROW EXECUTE FUNCTION validar_custodia_de_socio();
CREATE TRIGGER prestamos_validar_custodia BEFORE INSERT OR UPDATE OF socio_id, custodia_id ON prestamos FOR EACH ROW EXECUTE FUNCTION validar_custodia_de_socio();
CREATE TRIGGER gastos_validar_custodia BEFORE INSERT OR UPDATE OF socio_id, custodia_id ON gastos FOR EACH ROW EXECUTE FUNCTION validar_custodia_de_socio();
CREATE TRIGGER detalle_ventas_validar_custodia BEFORE INSERT OR UPDATE OF socio_id, custodia_id ON detalle_ventas FOR EACH ROW EXECUTE FUNCTION validar_detalle_venta_custodia();
CREATE TRIGGER transferencias_validar_custodias BEFORE INSERT OR UPDATE ON transferencias_custodia FOR EACH ROW EXECUTE FUNCTION validar_transferencia_custodia();
CREATE TRIGGER pagos_prestamo_validar_custodia BEFORE INSERT OR UPDATE OF prestamo_id, custodia_id ON pagos_prestamo FOR EACH ROW EXECUTE FUNCTION validar_pago_prestamo_custodia();
CREATE TRIGGER cuotas_distribucion_validar_custodia BEFORE INSERT OR UPDATE OF socio_cubridor_id, custodia_id ON cuotas_distribucion_utilidad FOR EACH ROW EXECUTE FUNCTION validar_cuota_distribucion_custodia();
CREATE CONSTRAINT TRIGGER custodias_dos_por_socio AFTER INSERT OR UPDATE OR DELETE ON custodias DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verificar_dos_custodias_por_socio();
CREATE CONSTRAINT TRIGGER socios_dos_custodias AFTER INSERT ON socios DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verificar_dos_custodias_por_socio();

COMMIT;
