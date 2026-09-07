import { describe, expect, it } from 'vitest';
import type { ProductRow } from './product-catalog';
import { filterActiveClients, requestedQuantities, saleLineEstimate, saleTotals, validateSaleLines } from './sale-form';

const products = [
  { id: 'p1', codigo: 'CAM-01', nombre: 'Cámara', activo: true, cantidad_disponible: 5, costo_promedio: 100.004, precio_venta: 150 },
  { id: 'p2', codigo: 'TRI-01', nombre: 'Trípode', activo: true, cantidad_disponible: 2, costo_promedio: 50, precio_venta: 80 }
] as ProductRow[];

describe('formulario de ventas', () => {
  it('calcula subtotal, costo y ganancia con redondeo monetario por unidad', () => {
    expect(saleLineEstimate({ productoId: 'p1', cantidad: 2, valor: 150 }, products[0])).toEqual({ subtotal: 300, cost: 200, profit: 100 });
    expect(saleTotals([{ productoId: 'p1', cantidad: 2, valor: 150 }, { productoId: 'p2', cantidad: 1, valor: 80 }], products)).toEqual({ subtotal: 380, cost: 250, profit: 130 });
  });

  it('permite vender exactamente al costo y rechaza precios inferiores', () => {
    expect(validateSaleLines([{ productoId: 'p1', cantidad: 1, valor: 100 }], products)).toBeNull();
    expect(validateSaleLines([{ productoId: 'p1', cantidad: 1, valor: 99.99 }], products)?.code).toBe('BELOW_COST');
  });

  it('valida cantidades y el inventario conjunto defensivamente', () => {
    expect(validateSaleLines([{ productoId: 'p1', cantidad: 1.5, valor: 150 }], products)?.code).toBe('INVALID_QUANTITY');
    expect(requestedQuantities([{ productoId: 'p1', cantidad: 3, valor: 150 }, { productoId: 'p1', cantidad: 3, valor: 150 }]).get('p1')).toBe(6);
    expect(validateSaleLines([{ productoId: 'p1', cantidad: 3, valor: 150 }, { productoId: 'p1', cantidad: 3, valor: 150 }], products)?.code).toBe('INSUFFICIENT_STOCK');
    expect(validateSaleLines([{ productoId: 'p2', cantidad: 3, valor: 80 }], products)?.code).toBe('INSUFFICIENT_STOCK');
  });

  it('rechaza productos repetidos', () => {
    expect(validateSaleLines([{ productoId: 'p1', cantidad: 1, valor: 150 }, { productoId: 'p1', cantidad: 1, valor: 150 }], products)?.code).toBe('DUPLICATE_PRODUCT');
  });

  it('busca clientes activos por nombre sin distinguir acentos ni mayúsculas', () => {
    const clients = [{ id: 'c1', nombre: 'José López', activo: true }, { id: 'c2', nombre: 'Ana', activo: false }];
    expect(filterActiveClients(clients, 'JOSE').map((client) => client.id)).toEqual(['c1']);
    expect(filterActiveClients(clients, '').map((client) => client.id)).toEqual(['c1']);
  });
});
