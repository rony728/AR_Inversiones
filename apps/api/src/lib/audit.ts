import type { PoolClient } from 'pg';

export async function writeAudit(client: PoolClient, input: {
  usuarioId?: string; entidadTipo: string; entidadId: string; accion: string; anteriores?: unknown; nuevos?: unknown;
}) {
  await client.query(
    `INSERT INTO auditoria_sistema (usuario_id, entidad_tipo, entidad_id, accion, datos_anteriores, datos_nuevos)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.usuarioId ?? null, input.entidadTipo, input.entidadId, input.accion, input.anteriores ?? null, input.nuevos ?? null]
  );
}
