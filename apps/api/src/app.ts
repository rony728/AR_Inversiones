import cors from 'cors';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { corsOrigins, env } from './config/env.js';
import { AppError, errorHandler } from './lib/errors.js';
import { apiRouter } from './http/routes.js';
import { apiSecurityHeaders, createRateLimiter } from './http/middleware/security.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);
app.use(pinoHttp({
  genReqId: (req, res) => String(req.headers['x-request-id'] ?? res.getHeader('x-request-id') ?? randomUUID()),
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.password_hash'],
  customLogLevel: (_req, res, error) => (res.statusCode === 501 ? 'info' : (error || res.statusCode >= 500 ? 'error' : 'info'))
}));
app.use((req, res, next) => { res.setHeader('X-Request-Id', String(req.id)); next(); });
app.use(apiSecurityHeaders);
app.use(cors({ origin: (origin, callback) => { if (!origin || corsOrigins.includes(origin)) return callback(null, true); return callback(new AppError(403, 'Origen no permitido por CORS.', 'CORS_FORBIDDEN')); }, credentials: false, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'], maxAge: 600 }));
app.use(express.json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
app.use('/api/v1/auth', createRateLimiter({ max: env.AUTH_RATE_LIMIT_MAX, windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS }));
app.use('/api/v1', apiRouter);
app.use(errorHandler);
