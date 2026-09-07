import { Router } from 'express';
import { authRouter } from '../modules/auth/routes.js';
import { catalogRouter } from '../modules/catalog/routes.js';
import { operationsRouter } from '../modules/operations/routes.js';
import { requireAuth } from './middleware/auth.js';

export const apiRouter = Router();
apiRouter.get('/health', (_req, res) => res.json({ status: 'ok' }));
apiRouter.use('/auth', authRouter);
apiRouter.use(requireAuth);
apiRouter.use('/catalogo', catalogRouter);
apiRouter.use('/', operationsRouter);
