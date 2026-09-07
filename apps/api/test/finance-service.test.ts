import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/lib/errors.js';
import { distributionShareCents } from '../src/modules/operations/finance-service.js';
import { money } from '../src/modules/operations/inventory-service.js';

test('la distribucion divide la utilidad exactamente entre tres socios', () => {
  const share = distributionShareCents(9000);
  assert.equal(money(share), '3000.00');
});

test('la distribucion rechaza montos que no se dividen en centavos exactos', () => {
  assert.throws(() => distributionShareCents(100), (error) => error instanceof AppError && error.code === 'INVALID_DISTRIBUTION_AMOUNT');
});
