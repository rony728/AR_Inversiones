-- Paso 16 AR Accesorios: pedidos independientes de ventas y movimientos de stock.
-- IMPORTANTE: solo DDL; no crea ventas, reservas, movimientos ni modifica existencias.
BEGIN;

CREATE TABLE pedidos_tienda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  referencia_cliente uuid UNIQUE,
  estado varchar(15) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'CONFIRMADO', 'COMPLETADO', 'CANCELADO')),
  cliente_nombre varchar(140) NOT NULL CHECK (length(btrim(cliente_nombre)) >= 2),
  cliente_telefono varchar(35) NOT NULL CHECK (length(btrim(cliente_telefono)) >= 7),
  cliente_email varchar(254),
  direccion_entrega text,
  instrucciones_entrega text,
  modalidad_entrega varchar(30) NOT NULL
    CHECK (modalidad_entrega IN ('RETIRO', 'ENVIO', 'CONTRA_ENTREGA')),
  metodo_pago varchar(30) NOT NULL
    CHECK (metodo_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'DEPOSITO', 'CONTRA_ENTREGA', 'ENLACE_PAGO')),
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  costo_envio numeric(14,2) NOT NULL DEFAULT 0 CHECK (costo_envio >= 0),
  total numeric(14,2) GENERATED ALWAYS AS (subtotal + costo_envio) STORED,
  notas_cliente text CHECK (notas_cliente IS NULL OR length(notas_cliente) <= 2000),
  notas_internas text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  creado_at timestamptz NOT NULL DEFAULT now(),
  actualizado_at timestamptz NOT NULL DEFAULT now(),
  confirmado_at timestamptz,
  completado_at timestamptz,
  cancelado_at timestamptz,
  CHECK (cliente_email IS NULL OR length(btrim(cliente_email)) > 3),
  CHECK (direccion_entrega IS NULL OR length(direccion_entrega) <= 2000),
  CHECK (instrucciones_entrega IS NULL OR length(instrucciones_entrega) <= 2000),
  CHECK (modalidad_entrega = 'RETIRO' OR nullif(btrim(direccion_entrega), '') IS NOT NULL)
);

CREATE TABLE pedido_tienda_detalles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES pedidos_tienda(id) ON DELETE CASCADE,
  producto_id uuid REFERENCES productos(id) ON DELETE SET NULL,
  producto_nombre varchar(300) NOT NULL,
  producto_codigo varchar(140),
  cantidad integer NOT NULL CHECK (cantidad BETWEEN 1 AND 99),
  precio_unitario numeric(14,2) NOT NULL CHECK (precio_unitario > 0),
  subtotal numeric(14,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
  creado_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, producto_id)
);
CREATE INDEX pedido_tienda_detalles_pedido_idx ON pedido_tienda_detalles(pedido_id);

CREATE TABLE pedido_tienda_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES pedidos_tienda(id) ON DELETE RESTRICT,
  estado_anterior varchar(15),
  estado_nuevo varchar(15) NOT NULL,
  accion varchar(40) NOT NULL CHECK (accion IN ('CREADO', 'CAMBIO_ESTADO', 'NOTA_INTERNA')),
  actor_usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  observacion varchar(2000),
  creado_at timestamptz NOT NULL DEFAULT now(),
  CHECK (estado_anterior IS NULL OR estado_anterior IN ('PENDIENTE','CONFIRMADO','COMPLETADO','CANCELADO')),
  CHECK (estado_nuevo IN ('PENDIENTE','CONFIRMADO','COMPLETADO','CANCELADO'))
);
CREATE INDEX pedido_tienda_eventos_pedido_idx ON pedido_tienda_eventos(pedido_id, creado_at);

-- El historial no debe editarse ni borrarse desde la API, incluso por error.
CREATE FUNCTION impedir_modificacion_eventos_tienda()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El historial de pedidos es inmutable';
END;
$$;
CREATE TRIGGER pedido_tienda_eventos_inmutables
  BEFORE UPDATE OR DELETE ON pedido_tienda_eventos
  FOR EACH ROW EXECUTE FUNCTION impedir_modificacion_eventos_tienda();

CREATE INDEX pedidos_tienda_estado_fecha_idx ON pedidos_tienda(estado, creado_at DESC);
CREATE INDEX pedidos_tienda_fecha_idx ON pedidos_tienda(creado_at DESC);

COMMENT ON TABLE pedidos_tienda IS 'Pedidos web pendientes de revisión, independientes de ventas, préstamos e inventario';
COMMENT ON TABLE pedido_tienda_detalles IS 'Detalle comercial con fotografía de precio/cantidad al crear el pedido';
COMMENT ON TABLE pedido_tienda_eventos IS 'Bitácora inmutable de creación y cambios de estado';
COMMENT ON COLUMN pedidos_tienda.referencia_cliente IS 'Identificador de idempotencia; evita crear el mismo pedido dos veces';
COMMENT ON COLUMN pedidos_tienda.total IS 'Total generado desde subtotal más envío, sin costo ni información financiera interna';

COMMIT;
