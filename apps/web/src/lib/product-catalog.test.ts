import { describe, expect, it } from 'vitest';
import { emptyProductFilters, filterProducts, productProfit, sortProducts, uniqueNumericValues, type ProductRow } from './product-catalog';

const products: ProductRow[] = [
  { id: '1', codigo: 'CAF-01', nombre: 'Café molido', descripcion: null, categoria_id: 'a', categoria: 'Alimentos', cantidad_disponible: 0, costo_promedio: 120, precio_venta: 180, existencia_minima: 2, activo: true },
  { id: '2', codigo: 'MIG-002', nombre: 'Vaso', descripcion: null, categoria_id: null, categoria: null, cantidad_disponible: 8, costo_promedio: 20, precio_venta: 35, existencia_minima: 0, activo: false }
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

  it('filtra por categoría, estado y presencia de existencia', () => {
    expect(filterProducts(products, { ...emptyProductFilters, categoryId: 'a' })).toEqual([products[0]]);
    expect(filterProducts(products, { ...emptyProductFilters, status: 'inactive' })).toEqual([products[1]]);
    expect(filterProducts(products, { ...emptyProductFilters, stock: 'without' })).toEqual([products[0]]);
    expect(filterProducts(products, { ...emptyProductFilters, stock: 'with' })).toEqual([products[1]]);
  });

  it('filtra valores exactos de existencia, costo y precio como números', () => {
    expect(filterProducts(products, { ...emptyProductFilters, stockValue: '8' })).toEqual([products[1]]);
    expect(filterProducts(products, { ...emptyProductFilters, costValue: '120.00' })).toEqual([products[0]]);
    expect(filterProducts(products, { ...emptyProductFilters, priceValue: '35' })).toEqual([products[1]]);
  });

  it('deriva opciones numéricas únicas y ordenadas de los productos cargados', () => {
    const repeated = [...products, { ...products[1], id: '3', cantidad_disponible: '8', costo_promedio: '55', precio_venta: '95' }];
    expect(uniqueNumericValues(repeated, 'cantidad_disponible')).toEqual([0, 8]);
    expect(uniqueNumericValues(repeated, 'costo_promedio')).toEqual([20, 55, 120]);
    expect(uniqueNumericValues(repeated, 'precio_venta')).toEqual([35, 95, 180]);
  });

  it('ordena código, categoría y estado en ambos sentidos', () => {
    expect(sortProducts(products, 'codigo', 'asc').map((row) => row.id)).toEqual(['1', '2']);
    expect(sortProducts(products, 'categoria', 'desc').map((row) => row.id)).toEqual(['1', '2']);
    expect(sortProducts(products, 'estado', 'asc').map((row) => row.id)).toEqual(['2', '1']);
    expect(sortProducts(products, 'estado', 'desc').map((row) => row.id)).toEqual(['1', '2']);
  });

  it('calcula ganancia y margen sobre precio sin modificar datos financieros', () => {
    expect(productProfit({ costo_promedio: 55, precio_venta: 95 })).toEqual({ profit: 40, margin: 42.10526315789473 });
    expect(productProfit({ costo_promedio: 0, precio_venta: 0 })).toEqual({ profit: 0, margin: 0 });
  });
});
