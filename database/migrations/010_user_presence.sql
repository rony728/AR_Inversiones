BEGIN;

CREATE TABLE presencia_usuarios (
  usuario_id uuid PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  ultima_actividad timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX presencia_usuarios_ultima_actividad_idx
  ON presencia_usuarios (ultima_actividad);

COMMIT;
