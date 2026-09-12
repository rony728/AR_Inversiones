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
