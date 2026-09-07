import assert from 'node:assert/strict';
import test from 'node:test';
import { money, toCents } from '../src/modules/operations/inventory-service.js';

test('una transferencia conserva el total entre custodias', () => {
  const productosAntes = toCents(10000); const prestamosAntes = toCents(20000); const monto = toCents(2000);
  const productosDespues = productosAntes - monto; const prestamosDespues = prestamosAntes + monto;
  assert.equal(money(productosDespues), '8000.00');
  assert.equal(money(prestamosDespues), '22000.00');
  assert.equal(productosAntes + prestamosAntes, productosDespues + prestamosDespues);
});
