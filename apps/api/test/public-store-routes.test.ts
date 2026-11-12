import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { app } from '../src/app.js';
import { query } from '../src/db/pool.js';

const storefront = 'https://araccesorios.rtdev.uk';
const allowedKeys = new Set([
  'id', 'slug', 'codigo', 'nombre', 'descripcion', 'categoria_id', 'categoria',
  'marca', 'modelo', 'destacado', 'precio_normal', 'precio_oferta',
  'cantidad_disponible', 'disponible', 'tiene_imagen', 'imagen_actualizada_at', 'created_at'
]);

test('la tienda permite lectura pública sin token y oculta campos administrativos', async () => {
  const response = await request(app).get('/api/v1/tienda/productos?limit=10')
    .set('Origin', storefront);
  assert.equal(response.status, 200);
  assert.equal(response.headers['access-control-allow-origin'], storefront);
  assert.ok(Array.isArray(response.body.data));
  assert.ok(response.body.pagination.total >= response.body.data.length);
  for (const item of response.body.data) {
    assert.ok(Object.keys(item).every((key) => allowedKeys.has(key)), JSON.stringify(Object.keys(item)));
    assert.equal(typeof item.slug, 'string');
    assert.ok(!('costo_promedio' in item));
    assert.ok(!('precio_minimo' in item));
    assert.ok(!('contenido' in item));
  }
});

test('paginación, ordenación, filtro de destacados y búsqueda son seguros', async () => {
  const page = await request(app).get('/api/v1/tienda/productos?limit=2&page=1&orden=precio_asc');
  assert.equal(page.status, 200);
  assert.ok(page.body.data.length <= 2);
  const featured = await request(app).get('/api/v1/tienda/productos?destacados=true');
  assert.equal(featured.status, 200);
  assert.ok(featured.body.data.every((p: {destacado: boolean}) => p.destacado));
  const search = await request(app).get('/api/v1/tienda/productos').query({q: 'accesorio'});
  assert.equal(search.status, 200);
  for (const special of ['%', '_', '\\']) {
    const literalSearch = await request(app).get('/api/v1/tienda/productos').query({ q: special });
    assert.equal(literalSearch.status, 200, `Búsqueda de caracter especial ${JSON.stringify(special)}`);
  }
  const malicious = await request(app).get('/api/v1/tienda/productos?orden=precio;DROP%20TABLE%20productos');
  assert.equal(malicious.status, 422);
  const excess = await request(app).get('/api/v1/tienda/productos?limit=5000');
  assert.equal(excess.status, 422);
});

test('detalle por slug y categorías públicas funcionan', async () => {
  const list = await request(app).get('/api/v1/tienda/productos?limit=1');
  assert.equal(list.status, 200);
  if (list.body.data.length) {
    const first = list.body.data[0];
    const detail = await request(app).get('/api/v1/tienda/productos/' + first.slug);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.id, first.id);
  }
  const categories = await request(app).get('/api/v1/tienda/categorias');
  assert.equal(categories.status, 200);
  assert.ok(Array.isArray(categories.body.data));
  assert.ok(categories.body.data.every((c: Record<string, unknown>) =>
    Object.keys(c).every((key) => ['id', 'nombre', 'total_productos'].includes(key))));
});




test('solo publica fotografías de productos activos y respeta ETag', async () => {
  const rows = await query<{ id: string }>(`SELECT p.id FROM productos p JOIN producto_imagenes pi ON pi.producto_id=p.id WHERE p.activo = true LIMIT 1`);
  if (!rows.rows[0]) return;
  const imageUrl = '/api/v1/tienda/imagenes/' + rows.rows[0].id;
  const image = await request(app).get(imageUrl).set('Origin', storefront);
  assert.equal(image.status, 200);
  assert.ok(['image/jpeg','image/webp'].includes(image.headers['content-type']));
  assert.ok(image.headers.etag);
  assert.equal(image.headers['cross-origin-resource-policy'], 'cross-origin');
  const notModified = await request(app).get(imageUrl).set('If-None-Match', image.headers.etag);
  assert.equal(notModified.status, 304);
});

test('los endpoints administrativos conservan autenticación y CORS separado', async () => {
  const privateCatalog = await request(app).get('/api/v1/catalogo/productos');
  assert.equal(privateCatalog.status, 401);
  const crossOriginPrivate = await request(app).get('/api/v1/catalogo/productos')
    .set('Origin', storefront);
  assert.equal(crossOriginPrivate.status, 403);
  const unknownOrigin = await request(app).get('/api/v1/tienda/categorias')
    .set('Origin', 'https://origen-no-admitido.example');
  assert.equal(unknownOrigin.status, 403);
  const invalidImage = await request(app).get('/api/v1/tienda/imagenes/invalid');
  assert.equal(invalidImage.status, 404);
});
