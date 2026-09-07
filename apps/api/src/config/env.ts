import 'dotenv/config';
import { z } from 'zod';

const booleanFromEnv = z.enum(['true', 'false']).transform((value) => value === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('postgresql://localhost/ar_inversiones'),
  JWT_SECRET: z.string().min(32).default('development-only-secret-change-this-123'),
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default('12h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  TRUST_PROXY: booleanFromEnv.default('false'),
  DATABASE_SSL: booleanFromEnv.default('false'),
  REQUEST_BODY_LIMIT: z.string().regex(/^\d+(kb|mb)$/i).default('1mb'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(20),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86_400_000).default(900_000)
});

export const env = schema.parse(process.env);
export const corsOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);

if (env.NODE_ENV === 'production') {
  if (env.JWT_SECRET.includes('development-only') || env.JWT_SECRET.includes('CAMBIAR')) throw new Error('JWT_SECRET inseguro en producción.');
  if (!process.env.CORS_ORIGIN || !corsOrigins.length) throw new Error('CORS_ORIGIN es obligatorio en producción.');
}
