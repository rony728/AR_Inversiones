import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { productCreateInput, productUpdateInput } from './product-input.js';

export type ProductCreateInput = z.infer<typeof productCreateInput>;
export type ProductUpdateInput = z.infer<typeof productUpdateInput>;

export const productListSql = `
  SELECT p.id, p.codigo, p.nombre, p.descripcion, p.categoria_id, c.nombre AS categoria,
         COALESCE(i.existencia, 0)::integer AS cantidad_disponible,
         COALESCE(i.costo_promedio_unitario, 0)::numeric AS costo_promedio,
         COALESCE(p.precio_sugerido, 0)::numeric AS precio_venta,
         COALESCE(p.existencia_minima, 0)::integer AS existencia_minima,
         p.marca, p.modelo, p.codigo_barras, p.control_serie, p.garantia_dias, p.precio_minimo,
         p.activo, p.created_at, p.updated_at,
         (pi.producto_id IS NOT NULL) AS tiene_imagen,
         pi.tipo_mime AS imagen_tipo_mime, pi.tamano_bytes AS imagen_tamano_bytes,
         pi.updated_at AS imagen_actualizada_at
    FROM productos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN inventario i ON i.producto_id = p.id
    LEFT JOIN producto_imagenes pi ON pi.producto_id = p.id
   ORDER BY p.nombre, p.codigo
`;

export async function createProduct(client: PoolClient, input: ProductCreateInput, userId?: string) {
  const result = await client.query(
    `INSERT INTO productos (codigo, sku, nombre, descripcion, categoria_id, precio_sugerido, activo)
     VALUES ($1, $1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.codigo, input.nombre, input.descripcion, input.categoriaId, input.precioVenta, input.activo]
  );
  await client.query('INSERT INTO inventario (producto_id, existencia, costo_promedio_unitario) VALUES ($1, 0, 0)', [result.rows[0].id]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'productos', entidadId: result.rows[0].id, accion: 'CREAR', nuevos: result.rows[0] });
  return result.rows[0];
}

export async function updateProduct(client: PoolClient, productId: string, input: ProductUpdateInput, userId?: string) {
  const fieldMap = { codigo: 'codigo', nombre: 'nombre', descripcion: 'descripcion', categoriaId: 'categoria_id', precioVenta: 'precio_sugerido', activo: 'activo' } as const;
  const entries = Object.entries(input) as Array<[keyof typeof fieldMap, unknown]>;
  const before = await client.query('SELECT * FROM productos WHERE id = $1', [productId]);
  if (!before.rows[0]) throw new AppError(404, 'Producto no encontrado.', 'NOT_FOUND');
  const set = entries.map(([field], index) => `${fieldMap[field]} = $${index + 1}`).join(', ');
  const result = await client.query(`UPDATE productos SET ${set} WHERE id = $${entries.length + 1} RETURNING *`, [...entries.map(([, value]) => value), productId]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'productos', entidadId: productId, accion: 'ACTUALIZAR', anteriores: before.rows[0], nuevos: result.rows[0] });
  return result.rows[0];
}
