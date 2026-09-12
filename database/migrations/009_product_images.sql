BEGIN;

CREATE TABLE producto_imagenes (
  producto_id uuid PRIMARY KEY REFERENCES productos(id) ON DELETE CASCADE,
  contenido bytea NOT NULL,
  tipo_mime varchar(40) NOT NULL,
  tamano_bytes integer NOT NULL,
  hash_sha256 varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT producto_imagenes_tipo_valido CHECK (tipo_mime IN ('image/jpeg', 'image/webp')),
  CONSTRAINT producto_imagenes_tamano_valido CHECK (tamano_bytes > 0 AND tamano_bytes <= 1500000),
  CONSTRAINT producto_imagenes_hash_valido CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT producto_imagenes_contenido_coherente CHECK (octet_length(contenido) = tamano_bytes)
);

CREATE TRIGGER producto_imagenes_updated_at
BEFORE UPDATE ON producto_imagenes
FOR EACH ROW EXECUTE FUNCTION establecer_updated_at();

COMMIT;
