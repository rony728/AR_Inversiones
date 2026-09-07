import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../lib/errors.js';

export function apiSecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
}

type Bucket = { count: number; resetAt: number };
export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now(); const key = req.ip || req.socket.remoteAddress || 'unknown'; const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1; buckets.set(key, bucket);
    res.setHeader('RateLimit-Limit', max); res.setHeader('RateLimit-Remaining', Math.max(0, max - bucket.count)); res.setHeader('RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));
    if (bucket.count > max) return next(new AppError(429, 'Demasiados intentos. Intenta nuevamente más tarde.', 'RATE_LIMITED'));
    next();
  };
}
