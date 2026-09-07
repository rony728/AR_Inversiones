import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/lib/errors.js';
import { inventoryDifference } from '../src/modules/operations/inventory-audit-service.js';

test('calcula un faltante físico como ajuste negativo', () => {
  assert.equal(inventoryDifference(20, 17), -3);
});

test('calcula un sobrante físico como ajuste positivo', () => {
  assert.equal(inventoryDifference(4, 7), 3);
});

test('rechaza conteos negativos o fraccionarios', () => {
  assert.throws(() => inventoryDifference(4, -1), (error) => error instanceof AppError && error.code === 'INVALID_INVENTORY_COUNT');
  assert.throws(() => inventoryDifference(4, 3.5), (error) => error instanceof AppError && error.code === 'INVALID_INVENTORY_COUNT');
});
