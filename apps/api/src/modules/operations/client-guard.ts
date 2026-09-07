import type { PoolClient } from 'pg';
import { AppError } from '../../lib/errors.js';

export async function requireActiveClient(client: PoolClient, clientId: string) {
  const result = await client.query('SELECT id FROM clientes WHERE id=$1 AND activo=true FOR SHARE', [clientId]);
  if (!result.rows[0]) throw new AppError(422, 'El cliente no existe o está inactivo.', 'INVALID_CLIENT');
}
