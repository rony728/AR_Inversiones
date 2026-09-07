import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = 'APP_ERROR') {
    super(message);
  }
}

export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => void Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) return res.status(422).json({ error: 'VALIDATION_ERROR', details: error.flatten() });
  if (error instanceof AppError) return res.status(error.status).json({ error: error.code, message: error.message });
  const parsed = error as { type?: string; status?: number; message?: string };
  if (parsed.type === 'entity.parse.failed') return res.status(400).json({ error: 'MALFORMED_JSON', message: 'El cuerpo JSON no es válido.' });
  if (parsed.type === 'entity.too.large' || parsed.status === 413) return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'El cuerpo de la solicitud excede el límite permitido.' });
  const pgError = error as { code?: string; detail?: string };
  if (pgError.code === '23505') return res.status(409).json({ error: 'CONFLICT', message: 'El registro ya existe.' });
  if (pgError.code === '23503' || pgError.code === '23514') return res.status(422).json({ error: 'INTEGRITY_ERROR', message: 'La operación viola una restricción de integridad.' });
  req.log?.error({ err: error }, 'Error no controlado en la API');
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Error interno del servidor.' });
}
