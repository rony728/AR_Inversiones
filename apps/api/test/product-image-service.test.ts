import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { MAX_PRODUCT_IMAGE_BYTES, requireStoredProductImage, saveProductImage, validateProductImage } from '../src/modules/catalog/product-image-service.js';
import { productListSql } from '../src/modules/catalog/product-service.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const webp = Buffer.from('RIFF\u0004\u0000\u0000\u0000WEBPVP8 ', 'binary');

test('valida tipo, firma y tamaño de imagen', () => {
  assert.doesNotThrow(() => validateProductImage(jpeg, 'image/jpeg'));
  assert.doesNotThrow(() => validateProductImage(webp, 'image/webp'));
  assert.throws(() => validateProductImage(jpeg, 'image/png'), { code: 'UNSUPPORTED_IMAGE_TYPE' });
  assert.throws(() => validateProductImage(Buffer.from('no-image'), 'image/jpeg'), { code: 'INVALID_IMAGE_CONTENT' });
  assert.throws(() => validateProductImage(Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES + 1, 1), 'image/jpeg'), { code: 'PRODUCT_IMAGE_TOO_LARGE' });
});

test('distingue producto sin imagen y conserva tipo MIME del existente', () => {
  assert.throws(() => requireStoredProductImage(undefined), { code: 'PRODUCT_IMAGE_NOT_FOUND' });
  const stored = { contenido: jpeg, tipo_mime: 'image/jpeg', tamano_bytes: jpeg.length, hash_sha256: 'a'.repeat(64) };
  assert.equal(requireStoredProductImage(stored).tipo_mime, 'image/jpeg');
});

test('agrega y reemplaza una imagen auditando solo metadatos', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const fake = (hasImage: boolean) => ({ query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.includes('SELECT id FROM productos')) return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
    if (sql.includes('SELECT tipo_mime')) return { rows: hasImage ? [{ tipo_mime: 'image/jpeg', tamano_bytes: 500 }] : [] };
    if (sql.includes('RETURNING producto_id')) return { rows: [{ producto_id: '11111111-1111-4111-8111-111111111111', tipo_mime: 'image/jpeg', tamano_bytes: jpeg.length, hash_sha256: 'a'.repeat(64), updated_at: '2026-09-12' }] };
    return { rows: [] };
  } }) as unknown as PoolClient;
  await saveProductImage(fake(false), { productId: '11111111-1111-4111-8111-111111111111', content: jpeg, mimeType: 'image/jpeg' });
  let audit = calls.find((call) => call.sql.includes('INSERT INTO auditoria_sistema'))!;
  assert.equal(audit.values[3], 'AGREGAR_IMAGEN');
  assert.equal(audit.values.some((value) => Buffer.isBuffer(value)), false);
  calls.length = 0;
  await saveProductImage(fake(true), { productId: '11111111-1111-4111-8111-111111111111', content: jpeg, mimeType: 'image/jpeg' });
  audit = calls.find((call) => call.sql.includes('INSERT INTO auditoria_sistema'))!;
  assert.equal(audit.values[3], 'REEMPLAZAR_IMAGEN');
  assert.deepEqual(audit.values[4], { imagen: 'presente', tipoMime: 'image/jpeg', tamanoBytes: 500 });
});

test('el listado expone metadatos pero nunca el contenido binario', () => {
  assert.match(productListSql, /tiene_imagen/);
  assert.match(productListSql, /imagen_actualizada_at/);
  assert.doesNotMatch(productListSql, /pi\.contenido/);
});

test('la migración 009 es 1:1, deja productos existentes sin blob y limita tamaño', async () => {
  const sql = await readFile(new URL('../../../database/migrations/009_product_images.sql', import.meta.url), 'utf8');
  assert.match(sql, /producto_id uuid PRIMARY KEY REFERENCES productos\(id\)/);
  assert.match(sql, /contenido bytea NOT NULL/);
  assert.match(sql, /tamano_bytes <= 1500000/);
  assert.doesNotMatch(sql, /INSERT INTO producto_imagenes/i);
  assert.doesNotMatch(sql, /ALTER TABLE productos/i);
});
