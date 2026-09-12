import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { saveProductImage } from '../src/modules/catalog/product-image-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL con migración 009 guarda una imagen 1:1 y conserva inventario', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl }); const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const table = await client.query<{ name: string | null }>("SELECT to_regclass('public.producto_imagenes')::text AS name");
    assert.equal(table.rows[0].name, 'producto_imagenes', 'Aplica primero la migración 009 en la base de pruebas.');
    const product = await client.query<{ id: string }>('SELECT id FROM productos ORDER BY created_at LIMIT 1');
    assert.ok(product.rows[0], 'La base de pruebas debe contener al menos un producto.');
    const before = await client.query<{ existencia: number; costo: string }>('SELECT existencia,costo_promedio_unitario AS costo FROM inventario WHERE producto_id=$1', [product.rows[0].id]);
    const content = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    await saveProductImage(client, { productId: product.rows[0].id, content, mimeType: 'image/jpeg' });
    const stored = await client.query<{ tipo_mime: string; tamano_bytes: number; contenido: Buffer }>('SELECT tipo_mime,tamano_bytes,contenido FROM producto_imagenes WHERE producto_id=$1', [product.rows[0].id]);
    assert.equal(stored.rows.length, 1); assert.equal(stored.rows[0].tipo_mime, 'image/jpeg'); assert.equal(stored.rows[0].tamano_bytes, content.length); assert.deepEqual(stored.rows[0].contenido, content);
    const after = await client.query<{ existencia: number; costo: string }>('SELECT existencia,costo_promedio_unitario AS costo FROM inventario WHERE producto_id=$1', [product.rows[0].id]);
    assert.deepEqual(after.rows[0], before.rows[0]);
    const audit = await client.query<{ accion: string; datos_anteriores: unknown; datos_nuevos: unknown }>("SELECT accion,datos_anteriores,datos_nuevos FROM auditoria_sistema WHERE entidad_tipo='productos' AND entidad_id=$1 ORDER BY created_at DESC LIMIT 1", [product.rows[0].id]);
    assert.match(audit.rows[0].accion, /AGREGAR_IMAGEN|REEMPLAZAR_IMAGEN/); assert.equal(JSON.stringify(audit.rows[0]).includes(content.toString('base64')), false);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined); client.release(); await pool.end();
  }
});
