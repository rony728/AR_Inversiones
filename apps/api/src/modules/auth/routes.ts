import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { query, withTransaction } from '../../db/pool.js';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { requireAuth } from '../../http/middleware/auth.js';

const credentials = z.object({ usuario: z.string().trim().min(3).max(80), password: z.string().min(8).max(200) });
const bootstrap = credentials.extend({ nombre: z.string().trim().min(2).max(160) });

const sign = (user: { id: string; usuario: string; nombre: string }) => ({
  token: jwt.sign({ sub: user.id, usuario: user.usuario }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }),
  user: { id: user.id, usuario: user.usuario, nombre: user.nombre }
});

export const authRouter = Router();

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const result = await query<{ id: string; nombre: string; usuario: string }>('SELECT id,nombre,usuario FROM usuarios WHERE id=$1 AND activo=true', [req.user!.id]);
  if (!result.rows[0]) throw new AppError(401, 'El usuario autenticado ya no está disponible.', 'UNAUTHORIZED');
  res.json({ user: result.rows[0] });
}));

authRouter.post('/bootstrap', asyncHandler(async (req, res) => {
  const input = bootstrap.parse(req.body);
  const result = await withTransaction(async (client) => {
    const existing = await client.query<{ count: string }>('SELECT count(*) FROM usuarios');
    if (Number(existing.rows[0].count) > 0) throw new AppError(409, 'Ya existe al menos un usuario.', 'BOOTSTRAP_COMPLETED');
    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
    const created = await client.query<{ id: string; nombre: string; usuario: string }>(
      'INSERT INTO usuarios (nombre, usuario, password_hash) VALUES ($1, $2, $3) RETURNING id, nombre, usuario',
      [input.nombre, input.usuario, passwordHash]
    );
    await writeAudit(client, { usuarioId: created.rows[0].id, entidadTipo: 'usuario', entidadId: created.rows[0].id, accion: 'CREAR_INICIAL', nuevos: created.rows[0] });
    return created.rows[0];
  });
  res.status(201).json(sign(result));
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const input = credentials.parse(req.body);
  const result = await query<{ id: string; nombre: string; usuario: string; password_hash: string }>(
    'SELECT id, nombre, usuario, password_hash FROM usuarios WHERE usuario = $1 AND activo = true', [input.usuario]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(input.password, user.password_hash))) throw new AppError(401, 'Credenciales inválidas.', 'INVALID_CREDENTIALS');
  res.json(sign(user));
}));
