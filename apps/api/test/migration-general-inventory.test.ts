import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('el dry-run migra el inventario inicial general sin propietarios de socios', async () => {
  const reportPath = resolve(import.meta.dirname, '../../../database/migration/reports/stage11-dry-run.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.counts.initialInventoryRows, 38);
  assert.equal('missingInventoryOwners' in report.requiredStartupInputs, false);
  assert.equal('productsRequiringInventoryOwner' in report.inconsistencies, false);
  assert.deepEqual(Object.keys(report.requiredStartupInputs), ['missingCustodyBalances']);
});
