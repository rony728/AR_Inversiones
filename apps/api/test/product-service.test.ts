import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { createProduct, updateProduct } from '../src/modules/catalog/product-service.js';

function fakeClient(rows: Record<string, unknown>[]) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT * FROM productos')) return { rows: [rows[0]] };
    if (sql.includes('INSERT INTO productos') || sql.startsWith('UPDATE productos')) return { rows };
    return { rows: [] };
  } } as unknown as PoolClient;
  return { client, calls };
}

test('crear producto inicia inventario en cero y registra auditoría', async () => {
  const id = '11111111-1111-4111-8111-111111111111'; const db = fakeClient([{ id, codigo: 'SKU-1', nombre: 'Producto' }]);
  await createProduct(db.client, { codigo: 'SKU-1', nombre: 'Producto', descripcion: null, categoriaId: null, precioVenta: 55, activo: true });
  const inventory = db.calls.find((call) => call.sql.includes('INSERT INTO inventario'))!;
  assert.match(inventory.sql, /VALUES \(\$1, 0, 0\)/); assert.deepEqual(inventory.values, [id]);
  assert.equal(db.calls.find((call) => call.sql.includes('INSERT INTO auditoria_sistema'))?.values[3], 'CREAR');
});

test('crea varios productos sin código usando NULL y conserva inventario independiente', async () => {
  for (const id of ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']) {
    const db = fakeClient([{ id, codigo: null, nombre: 'Sin código' }]);
    await createProduct(db.client, { codigo: null, nombre: 'Sin código', descripcion: null, categoriaId: null, precioVenta: 0, activo: true });
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO productos'))!;
    assert.equal(insert.values[0], null);
    assert.deepEqual(db.calls.find((call) => call.sql.includes('INSERT INTO inventario'))?.values, [id]);
  }
});

test('editar datos descriptivos conserva UUID y nunca actualiza inventario', async () => {
  const id = '11111111-1111-4111-8111-111111111111'; const db = fakeClient([{ id, codigo: 'SKU-1', nombre: 'Nuevo nombre', descripcion: 'Detalle', categoria_id: null, precio_sugerido: 55, activo: false }]);
  const updated = await updateProduct(db.client, id, { nombre: 'Nuevo nombre', descripcion: 'Detalle', categoriaId: null, precioVenta: 55, activo: false });
  assert.equal(updated.id, id);
  const update = db.calls.find((call) => call.sql.startsWith('UPDATE productos'))!;
  assert.match(update.sql, /nombre = \$1/); assert.match(update.sql, /descripcion = \$2/); assert.equal(update.values.at(-1), id);
  assert.equal(db.calls.some((call) => /UPDATE inventario|movimientos_inventario/.test(call.sql)), false);
  const audit = db.calls.find((call) => call.sql.includes('INSERT INTO auditoria_sistema'))!;
  assert.equal(audit.values[2], id); assert.equal(audit.values[3], 'ACTUALIZAR');
});

test('campos comerciales se guardan sin alterar stock y rechazan ofertas inválidas', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const db = fakeClient([{ id, codigo: 'SKU-1', nombre: 'Producto', precio_sugerido: 450, precio_oferta: null, fecha_inicio_oferta: null, fecha_fin_oferta: null }]);
  await createProduct(db.client, {
    codigo: 'SKU-1', nombre: 'Producto', descripcion: null, categoriaId: null,
    precioVenta: 450, activo: true, destacado: true, descripcionTienda: 'Destacado',
    precioOferta: 399, fechaInicioOferta: '2026-11-12T10:00:00Z', fechaFinOferta: '2026-12-01T10:00:00Z'
  });
  const insert = db.calls.find((call) => call.sql.includes('INSERT INTO productos'))!;
  assert.match(insert.sql, /descripcion_tienda, precio_oferta, fecha_inicio_oferta/);
  assert.equal(insert.values[6], true);
  assert.equal(insert.values[8], 399);
  const updated = await updateProduct(db.client, id, { destacado: true, precioOferta: 350 });
  assert.equal(updated.id, id);
  const update = db.calls.find((call) => call.sql.startsWith('UPDATE productos'))!;
  assert.match(update.sql, /destacado = \$1/);
  assert.match(update.sql, /precio_oferta = \$2/);
  assert.equal(db.calls.some((call) => /UPDATE inventario|movimientos_inventario/.test(call.sql)), false);

  await assert.rejects(
    createProduct(db.client, { codigo: null, nombre: 'Inválido', descripcion: null, categoriaId: null, precioVenta: 100, activo: true, precioOferta: 120 }),
    /inferior al precio normal/
  );
  await assert.rejects(updateProduct(db.client, id, { precioOferta: 600 }), /inferior al precio normal/);
  await assert.rejects(updateProduct(db.client, id, { fechaInicioOferta: '2026-12-05T10:00:00Z' }), /requieren un precio de oferta/);
});
