import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';

export const MAX_PRODUCT_IMAGE_BYTES = 1_500_000;
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/webp'] as const;
export type ProductImageType = typeof PRODUCT_IMAGE_TYPES[number];
export type StoredProductImage = { contenido: Buffer; tipo_mime: string; tamano_bytes: number; hash_sha256: string };

export function requireStoredProductImage(image: StoredProductImage | undefined) {
  if (!image) throw new AppError(404, 'El producto no tiene imagen.', 'PRODUCT_IMAGE_NOT_FOUND');
  return image;
}

function hasJpegSignature(content: Buffer) {
  return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
}

function hasWebpSignature(content: Buffer) {
  return content.length >= 12
    && content.subarray(0, 4).toString('ascii') === 'RIFF'
    && content.subarray(8, 12).toString('ascii') === 'WEBP';
}

export function validateProductImage(content: Buffer, mimeType: string): asserts mimeType is ProductImageType {
  if (!PRODUCT_IMAGE_TYPES.includes(mimeType as ProductImageType)) {
    throw new AppError(415, 'La imagen debe estar en formato JPEG o WebP.', 'UNSUPPORTED_IMAGE_TYPE');
  }
  if (!content.length || content.length > MAX_PRODUCT_IMAGE_BYTES) {
    throw new AppError(413, 'La imagen optimizada no puede superar 1.5 MB.', 'PRODUCT_IMAGE_TOO_LARGE');
  }
  const validSignature = mimeType === 'image/jpeg' ? hasJpegSignature(content) : hasWebpSignature(content);
  if (!validSignature) throw new AppError(422, 'El contenido no corresponde al formato de imagen indicado.', 'INVALID_IMAGE_CONTENT');
}

export async function saveProductImage(client: PoolClient, input: {
  productId: string;
  content: Buffer;
  mimeType: string;
  userId?: string;
}) {
  validateProductImage(input.content, input.mimeType);
  const product = await client.query<{ id: string }>('SELECT id FROM productos WHERE id=$1 FOR UPDATE', [input.productId]);
  if (!product.rows[0]) throw new AppError(404, 'Producto no encontrado.', 'NOT_FOUND');
  const previous = await client.query<{ tipo_mime: string; tamano_bytes: number }>(
    'SELECT tipo_mime,tamano_bytes FROM producto_imagenes WHERE producto_id=$1',
    [input.productId]
  );
  const hash = createHash('sha256').update(input.content).digest('hex');
  const result = await client.query<{ producto_id: string; tipo_mime: string; tamano_bytes: number; hash_sha256: string; updated_at: string }>(
    `INSERT INTO producto_imagenes (producto_id,contenido,tipo_mime,tamano_bytes,hash_sha256)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (producto_id) DO UPDATE
       SET contenido=EXCLUDED.contenido,tipo_mime=EXCLUDED.tipo_mime,tamano_bytes=EXCLUDED.tamano_bytes,hash_sha256=EXCLUDED.hash_sha256
     RETURNING producto_id,tipo_mime,tamano_bytes,hash_sha256,updated_at`,
    [input.productId, input.content, input.mimeType, input.content.length, hash]
  );
  await writeAudit(client, {
    usuarioId: input.userId,
    entidadTipo: 'productos',
    entidadId: input.productId,
    accion: previous.rows[0] ? 'REEMPLAZAR_IMAGEN' : 'AGREGAR_IMAGEN',
    anteriores: previous.rows[0] ? { imagen: 'presente', tipoMime: previous.rows[0].tipo_mime, tamanoBytes: previous.rows[0].tamano_bytes } : { imagen: 'ausente' },
    nuevos: { imagen: 'presente', tipoMime: input.mimeType, tamanoBytes: input.content.length }
  });
  return result.rows[0];
}
