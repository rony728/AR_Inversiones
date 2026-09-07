import { describe, expect, it } from 'vitest';
import { duplicateProductId, exceedsKnownBalance, productsFundOf, selectablePurchaseProducts } from './purchase-form';
import type { ProductRow } from './product-catalog';

describe('formulario de compras', () => {
  it('detecta productos repetidos e ignora líneas vacías', () => {
    expect(duplicateProductId([{ productoId: '', cantidad: 1, valor: 10 }, { productoId: 'p1', cantidad: 1, valor: 10 }])).toBeNull();
    expect(duplicateProductId([{ productoId: 'p1', cantidad: 1, valor: 10 }, { productoId: 'p1', cantidad: 2, valor: 20 }])).toBe('p1');
  });

  it('selecciona exclusivamente el fondo PRODUCTOS del socio', () => {
    const partner = { custodias: [{ id: 'prestamos', actividad: 'PRESTAMOS', saldo_actual: '9999' }, { id: 'productos', actividad: 'PRODUCTOS', saldo_actual: '500.25' }] };
    expect(productsFundOf(partner)).toEqual({ id: 'productos', balance: 500.25 });
  });

  it('compara el total y el saldo en centavos', () => {
    expect(exceedsKnownBalance(500, 500)).toBe(false);
    expect(exceedsKnownBalance(500, 500.01)).toBe(true);
    expect(exceedsKnownBalance(null, 900)).toBe(false);
  });

  it('ofrece solo productos activos no elegidos por otras líneas', () => {
    const products = [
      { id: 'actual', activo: true },
      { id: 'ocupado', activo: true },
      { id: 'inactivo', activo: false }
    ] as ProductRow[];
    expect(selectablePurchaseProducts(products, ['actual', 'ocupado'], 'actual').map((product) => product.id)).toEqual(['actual']);
  });
});
