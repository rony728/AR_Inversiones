import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { asyncHandler } from '../../lib/errors.js';
import { listActiveUsers, recordHeartbeat, type ActiveUser } from './presence-service.js';

type PresenceDependencies = {
  heartbeat: (userId: string) => Promise<void>;
  activeUsers: () => Promise<ActiveUser[]>;
};

const defaultDependencies: PresenceDependencies = {
  heartbeat: (userId) => recordHeartbeat(pool, userId),
  activeUsers: () => listActiveUsers(pool)
};

export function createPresenceRouter(dependencies: PresenceDependencies = defaultDependencies) {
  const router = Router();
  router.post('/heartbeat', asyncHandler(async (req, res) => {
    await dependencies.heartbeat(req.user!.id);
    res.status(204).end();
  }));
  router.get('/activos', asyncHandler(async (_req, res) => {
    const usuarios = await dependencies.activeUsers();
    res.json({ total: usuarios.length, usuarios });
  }));
  return router;
}

export const presenceRouter = createPresenceRouter();
