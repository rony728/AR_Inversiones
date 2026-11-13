import { Router } from 'express';
import { authRouter } from '../modules/auth/routes.js';
import { catalogRouter } from '../modules/catalog/routes.js';
import { publicStoreRouter } from '../modules/catalog/public-store-routes.js';
import { publicCheckoutRouter } from '../modules/store-orders/public-checkout-routes.js';
import { adminStoreOrdersRouter } from '../modules/store-orders/admin-routes.js';
import { operationsRouter } from '../modules/operations/routes.js';
import { presenceRouter } from '../modules/presence/routes.js';
import { requireAuth } from './middleware/auth.js';

export const apiRouter = Router();
apiRouter.get('/health', (_req, res) => res.json({ status: 'ok' }));
apiRouter.use('/auth', authRouter);
// Public catalog is intentionally mounted before requireAuth.
apiRouter.use('/tienda', publicStoreRouter);
apiRouter.use('/tienda', publicCheckoutRouter);
apiRouter.use(requireAuth);
apiRouter.use('/catalogo', catalogRouter);
apiRouter.use('/pedidos-tienda', adminStoreOrdersRouter);
apiRouter.use('/presencia', presenceRouter);
apiRouter.use('/', operationsRouter);
