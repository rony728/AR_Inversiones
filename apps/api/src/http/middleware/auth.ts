import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return next(new AppError(401, 'Autenticación requerida.', 'UNAUTHORIZED'));
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string; usuario: string };
    req.user = { id: payload.sub, usuario: payload.usuario };
    return next();
  } catch {
    return next(new AppError(401, 'Token inválido o vencido.', 'UNAUTHORIZED'));
  }
}
