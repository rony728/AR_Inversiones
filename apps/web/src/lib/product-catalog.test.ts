import { describe, expect, it } from 'vitest';
import { filterProducts, sortProducts, type ProductRow } from './product-catalog';

const products: ProductRow[] = [
  { id: '1', codigo: 'CAF-01', nombre: 'Café molido', categoria_id: 'a', categoria: 'Alimentos', cantidad_disponible: 0, costo_promedio: 120, precio_venta: 180, existencia_minima: 2, activo: true },
  { id: '2', codigo: 'MIG-002', nombre: 'Vaso', categoria_id: null, categoria: null, cantidad_disponible: 8, costo_promedio: 20, precio_venta: 35, existencia_minima: 0, activo: false }
];

describe('catálogo de productos', () => {
  it('busca por código, nombre o categoría sin distinguir acentos ni mayúsculas', () => {
    expect(filterProducts(products, 'cafe')).toEqual([products[0]]);
    expect(filterProducts(products, 'ALIMENTOS')).toEqual([products[0]]);
    expect(filterProducts(products, 'mig-002')).toEqual([products[1]]);
  });

  it('ordena existencias y valores numéricamente', () => {
    expect(sortProducts(products, 'cantidad', 'desc').map((row) => row.id)).toEqual(['2', '1']);
    expect(sortProducts(products, 'precio', 'asc').map((row) => row.id)).toEqual(['2', '1']);
  });
});
