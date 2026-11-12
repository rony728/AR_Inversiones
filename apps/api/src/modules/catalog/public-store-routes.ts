import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { createRateLimiter } from '../../http/middleware/security.js';

export const publicStoreRouter = Router();

// Public endpoints are intentionally read-only. Never reuse the private productListSql:
// it contains purchase costs and other administrative fields.
publicStoreRouter.use(createRateLimiter({ max: 120, windowMs: 60_000 }));

const uuid = z.string().uuid();
const slugSchema = z.string().min(1).max(300).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const listParams = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  q: z.string().trim().max(100).optional(),
  categoria: uuid.optional(),
  orden: z.enum(['nombre', 'precio_asc', 'precio_desc', 'recientes']).default('nombre'),
  destacados: z.enum(['true', 'false']).optional()
}).strict();

export const STORE_PRODUCT_COLUMNS = `
  p.id, p.slug, p.codigo, p.nombre,
  COALESCE(NULLIF(p.descripcion_tienda, ''), p.descripcion) AS descripcion,
  p.categoria_id, c.nombre AS categoria,
  p.marca, p.modelo, p.destacado,
  COALESCE(p.precio_sugerido, 0)::numeric AS precio_normal,
  CASE WHEN p.precio_oferta IS NOT NULL
    AND p.precio_oferta > 0 AND p.precio_oferta < COALESCE(p.precio_sugerido, 0)
    AND (p.fecha_inicio_oferta IS NULL OR p.fecha_inicio_oferta <= CURRENT_TIMESTAMP)
    AND (p.fecha_fin_oferta IS NULL OR p.fecha_fin_oferta > CURRENT_TIMESTAMP)
    THEN p.precio_oferta ELSE NULL END AS precio_oferta,
  COALESCE(i.existencia, 0)::integer AS cantidad_disponible,
  (COALESCE(i.existencia, 0) > 0 AND COALESCE(p.precio_sugerido, 0) > 0)::boolean AS disponible,
  (pi.producto_id IS NOT NULL)::boolean AS tiene_imagen,
  pi.updated_at AS imagen_actualizada_at,
  p.created_at
`;

const STORE_FROM = `
  FROM productos p
  LEFT JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN inventario i ON i.producto_id = p.id
  LEFT JOIN producto_imagenes pi ON pi.producto_id = p.id
`;

function publicReadHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
  next();
}

publicStoreRouter.get('/categorias', publicReadHeaders, asyncHandler(async (_req, res) => {
  const result = await query(
    `SELECT c.id, c.nombre, COUNT(p.id)::integer AS total_productos
       FROM categorias c JOIN productos p ON p.categoria_id = c.id AND p.activo = true
      GROUP BY c.id, c.nombre ORDER BY c.nombre`
  );
  res.json({ data: result.rows });
}));

publicStoreRouter.get('/productos', publicReadHeaders, asyncHandler(async (req, res) => {
  const parsed = listParams.safeParse(req.query);
  if (!parsed.success) throw new AppError(422, 'Parámetros de búsqueda inválidos.', 'VALIDATION_ERROR');
  const { page, limit, q, categoria, orden, destacados } = parsed.data;
  const filters: string[] = ['p.activo = true'];
  const values: unknown[] = [];
  if (q) {
    values.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    filters.push(`(p.nombre ILIKE $${values.length} ESCAPE '\\' OR p.descripcion ILIKE $${values.length} ESCAPE '\\' OR p.codigo ILIKE $${values.length} ESCAPE '\\')`);
  }
  if (categoria) { values.push(categoria); filters.push(`p.categoria_id = $${values.length}`); }
  if (destacados) { values.push(destacados === 'true'); filters.push(`p.destacado = $${values.length}`); }
  const where = filters.join(' AND ');
  const order = {
    nombre: 'p.nombre ASC, p.id ASC',
    precio_asc: 'precio_normal ASC, p.id ASC',
    precio_desc: 'precio_normal DESC, p.id ASC',
    recientes: 'p.created_at DESC, p.id DESC'
  }[orden];

  const total = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM productos p WHERE ${where}`, values
  );
  const totalCount = Number(total.rows[0]?.total ?? 0);
  const list = await query(
    `SELECT ${STORE_PRODUCT_COLUMNS} ${STORE_FROM} WHERE ${where}
      ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, (page - 1) * limit]
  );
  res.json({ data: list.rows, pagination: { page, limit, total: totalCount, totalPaginas: Math.ceil(totalCount / limit) } });
}));

publicStoreRouter.get('/productos/:slug', publicReadHeaders, asyncHandler(async (req, res) => {
  const slug = slugSchema.safeParse(req.params.slug);
  if (!slug.success) throw new AppError(404, 'Producto no encontrado.', 'NOT_FOUND');
  const result = await query(
    `SELECT ${STORE_PRODUCT_COLUMNS} ${STORE_FROM} WHERE p.activo = true AND p.slug = $1`,
    [slug.data]
  );
  if (!result.rows[0]) throw new AppError(404, 'Producto no encontrado.', 'NOT_FOUND');
  res.json({ data: result.rows[0] });
}));

publicStoreRouter.get('/imagenes/:id', asyncHandler(async (req, res) => {
  const parsed = uuid.safeParse(req.params.id);
  if (!parsed.success) throw new AppError(404, 'Imagen no encontrada.', 'NOT_FOUND');
  const result = await query<{
    contenido: Buffer; tipo_mime: string; tamano_bytes: number; hash_sha256: string;
  }>(
    `SELECT pi.contenido, pi.tipo_mime, pi.tamano_bytes, pi.hash_sha256
       FROM producto_imagenes pi
       JOIN productos p ON p.id = pi.producto_id AND p.activo = true
      WHERE pi.producto_id = $1`,
    [parsed.data]
  );
  const image = result.rows[0];
  if (!image) throw new AppError(404, 'Imagen no encontrada.', 'NOT_FOUND');
  const etag = `"${image.hash_sha256}"`;
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  // Images are intended to be embedded by the separate storefront frontend.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('ETag', etag);
  if (req.header('if-none-match') === etag) return res.status(304).end();
  res.type(image.tipo_mime);
  res.setHeader('Content-Length', image.tamano_bytes);
  return res.send(image.contenido);
}));
