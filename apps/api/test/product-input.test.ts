import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryCreateInput, categoryUpdateInput, productCreateInput, productUpdateInput } from '../src/modules/catalog/product-input.js';

test('un producto nuevo inicia sin aceptar stock ni costo manual', () => {
  const valid = productCreateInput.parse({ codigo: 'SKU-001', nombre: 'Producto', descripcion: 'Descripción', categoriaId: null, precioVenta: 250, activo: true });
  assert.equal(valid.precioVenta, 250);
  assert.throws(() => productCreateInput.parse({ ...valid, cantidadDisponible: 10 }));
  assert.throws(() => productCreateInput.parse({ ...valid, costoPromedio: 100 }));
});

test('la edición permite categoría nula y rechaza campos contables', () => {
  assert.deepEqual(productUpdateInput.parse({ descripcion: null, categoriaId: null, activo: false }), { descripcion: null, categoriaId: null, activo: false });
  assert.throws(() => productUpdateInput.parse({ existencia: 0 }));
  assert.throws(() => productUpdateInput.parse({}));
});

test('las categorías se crean y desactivan con datos válidos', () => {
  assert.equal(categoryCreateInput.parse({ nombre: 'Accesorios' }).nombre, 'Accesorios');
  assert.deepEqual(categoryUpdateInput.parse({ activo: false }), { activo: false });
  assert.throws(() => categoryCreateInput.parse({ nombre: '' }));
});
