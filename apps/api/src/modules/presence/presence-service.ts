import type { PoolClient, QueryResultRow } from 'pg';

export const PRESENCE_ACTIVE_WINDOW_MS = 120_000;

type PresenceDatabase = Pick<PoolClient, 'query'>;
export type ActiveUser = { id: string; nombre: string };

export async function recordHeartbeat(database: PresenceDatabase, userId: string, activityAt = new Date()) {
  await database.query(
    `INSERT INTO presencia_usuarios (usuario_id, ultima_actividad)
     VALUES ($1, $2)
     ON CONFLICT (usuario_id) DO UPDATE SET ultima_actividad = EXCLUDED.ultima_actividad`,
    [userId, activityAt]
  );
}

export async function listActiveUsers(database: PresenceDatabase, now = new Date()) {
  const activeSince = new Date(now.getTime() - PRESENCE_ACTIVE_WINDOW_MS);
  const result = await database.query<ActiveUser & QueryResultRow>(
    `SELECT u.id, u.nombre
       FROM presencia_usuarios p
       JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.ultima_actividad >= $1
        AND u.activo = true
      ORDER BY u.nombre`,
    [activeSince]
  );
  return result.rows.map(({ id, nombre }) => ({ id, nombre }));
}
