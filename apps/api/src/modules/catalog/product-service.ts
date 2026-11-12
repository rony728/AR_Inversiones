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
         p.activo, p.slug, p.destacado, p.descripcion_tienda, p.precio_oferta,
         p.fecha_inicio_oferta, p.fecha_fin_oferta, p.created_at, p.updated_at,
         (pi.producto_id IS NOT NULL) AS tiene_imagen,
         pi.tipo_mime AS imagen_tipo_mime, pi.tamano_bytes AS imagen_tamano_bytes,
         pi.updated_at AS imagen_actualizada_at
    FROM productos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN inventario i ON i.producto_id = p.id
    LEFT JOIN producto_imagenes pi ON pi.producto_id = p.id
   ORDER BY p.nombre, p.codigo
`;

function validateCommercialFields(
  price: number,
  offer: number | null,
  start: string | null,
  end: string | null
) {
  if (offer !== null && (!Number.isFinite(price) || offer >= price)) {
    throw new AppError(422, 'El precio de oferta debe ser inferior al precio normal.', 'INVALID_OFFER_PRICE');
  }
  if (offer === null && (start !== null || end !== null)) {
    throw new AppError(422, 'Las fechas de oferta requieren un precio de oferta.', 'OFFER_PRICE_REQUIRED');
  }
  if (start !== null && end !== null && Date.parse(start) >= Date.parse(end)) {
    throw new AppError(422, 'La fecha de fin debe ser posterior al inicio.', 'INVALID_OFFER_DATES');
  }
}

export async function createProduct(client: PoolClient, input: ProductCreateInput, userId?: string) {
  validateCommercialFields(input.precioVenta, input.precioOferta ?? null, input.fechaInicioOferta ?? null, input.fechaFinOferta ?? null);
  const result = await client.query(
    `INSERT INTO productos (codigo, sku, nombre, descripcion, categoria_id, precio_sugerido, activo, destacado, descripcion_tienda, precio_oferta, fecha_inicio_oferta, fecha_fin_oferta)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [input.codigo || null, input.nombre, input.descripcion, input.categoriaId, input.precioVenta, input.activo,
      input.destacado ?? false, input.descripcionTienda ?? null, input.precioOferta ?? null,
      input.fechaInicioOferta ?? null, input.fechaFinOferta ?? null]
  );
  await client.query('INSERT INTO inventario (producto_id, existencia, costo_promedio_unitario) VALUES ($1, 0, 0)', [result.rows[0].id]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'productos', entidadId: result.rows[0].id, accion: 'CREAR', nuevos: result.rows[0] });
  return result.rows[0];
}

export async function updateProduct(client: PoolClient, productId: string, input: ProductUpdateInput, userId?: string) {
  const fieldMap = {
    codigo: 'codigo', nombre: 'nombre', descripcion: 'descripcion',
    categoriaId: 'categoria_id', precioVenta: 'precio_sugerido', activo: 'activo',
    destacado: 'destacado', descripcionTienda: 'descripcion_tienda',
    precioOferta: 'precio_oferta', fechaInicioOferta: 'fecha_inicio_oferta',
    fechaFinOferta: 'fecha_fin_oferta'
  } as const;
  const entries = Object.entries(input) as Array<[keyof typeof fieldMap, unknown]>;
  const before = await client.query('SELECT * FROM productos WHERE id = $1', [productId]);
  if (!before.rows[0]) throw new AppError(404, 'Producto no encontrado.', 'NOT_FOUND');
  const current = before.rows[0];
  validateCommercialFields(
    Number(input.precioVenta ?? current.precio_sugerido ?? 0),
    input.precioOferta !== undefined ? input.precioOferta : (current.precio_oferta == null ? null : Number(current.precio_oferta)),
    input.fechaInicioOferta !== undefined ? input.fechaInicioOferta : (current.fecha_inicio_oferta ? new Date(current.fecha_inicio_oferta).toISOString() : null),
    input.fechaFinOferta !== undefined ? input.fechaFinOferta : (current.fecha_fin_oferta ? new Date(current.fecha_fin_oferta).toISOString() : null)
  );

  const set = entries.map(([field], index) => `${fieldMap[field]} = $${index + 1}`).join(', ');
  const values = entries.map(([field, value]) => field === 'codigo' ? (value || null) : value);
  const codeIndex = entries.findIndex(([field]) => field === 'codigo');
  const result = await client.query(`UPDATE productos SET ${set}${codeIndex >= 0 ? `, sku = $${codeIndex + 1}` : ''} WHERE id = $${entries.length + 1} RETURNING *`, [...values, productId]);
  await writeAudit(client, { usuarioId: userId, entidadTipo: 'productos', entidadId: productId, accion: 'ACTUALIZAR', anteriores: before.rows[0], nuevos: result.rows[0] });
  return result.rows[0];
}
