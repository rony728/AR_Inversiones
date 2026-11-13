-- Comprobantes privados para pedidos web. Aplicar primero en PostgreSQL aislado.
-- No modifica ventas, inventario ni pedidos existentes.
BEGIN;
CREATE TABLE comprobantes_pedido_tienda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL UNIQUE REFERENCES pedidos_tienda(id) ON DELETE RESTRICT,
  mime_tipo varchar(32) NOT NULL CHECK (mime_tipo IN ('image/jpeg','image/png')),
  nombre_archivo varchar(140) NOT NULL,
  contenido bytea NOT NULL CHECK (octet_length(contenido) BETWEEN 100 AND 614400),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comprobantes_pedido_tienda_creado_idx ON comprobantes_pedido_tienda(creado_at);
COMMENT ON TABLE comprobantes_pedido_tienda IS 'Comprobantes privados aportados por el comprador: sin confirmación automática del pago';
COMMIT;
