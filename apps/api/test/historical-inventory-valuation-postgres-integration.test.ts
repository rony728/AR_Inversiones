import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  historicalInventoryValuationInput,
  valueHistoricalInventory,
} from '../src/modules/operations/historical-inventory-valuation-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL valoriza stock heredado y revierte toda la operación ante un fallo', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const table = await client.query<{ name: string | null }>("SELECT to_regclass('public.valorizaciones_inventario_historico')::text AS name");
    assert.equal(table.rows[0].name, 'valorizaciones_inventario_historico', 'Aplica primero la migración 013 en la base de pruebas.');

    const product = (await client.query<{ id: string }>(
      `INSERT INTO productos (codigo,nombre) VALUES ($1,$2) RETURNING id`,
      [`TEST-VAL-${randomUUID()}`, 'Producto histórico temporal'],
    )).rows[0];
    await client.query('INSERT INTO inventario (producto_id,existencia,costo_promedio_unitario) VALUES ($1,3,0)', [product.id]);
    const countsBefore = (await client.query<{ purchases: string; custody: string; financial: string }>(
      `SELECT (SELECT count(*) FROM compras)::text AS purchases,
        (SELECT count(*) FROM movimientos_custodia)::text AS custody,
        (SELECT count(*) FROM movimientos_financieros)::text AS financial`,
    )).rows[0];

    const result = await valueHistoricalInventory(client, historicalInventoryValuationInput.parse({
      productoId: product.id,
      existenciaEsperada: 3,
      costoUnitario: 250,
      fechaReferencia: '2026-09-20',
      motivo: 'Existencia anterior a la puesta en producción',
    }));
    const inventory = (await client.query<{ existencia: number; costo: string }>(
      'SELECT existencia,costo_promedio_unitario AS costo FROM inventario WHERE producto_id=$1',
      [product.id],
    )).rows[0];
    assert.deepEqual({ existencia: inventory.existencia, costo: Number(inventory.costo) }, { existencia: 3, costo: 250 });
    assert.equal(Number((await client.query<{ count: string }>('SELECT count(*) FROM valorizaciones_inventario_historico WHERE id=$1', [result.id])).rows[0].count), 1);
    assert.equal(Number((await client.query<{ count: string }>("SELECT count(*) FROM movimientos_inventario WHERE referencia_tipo='VALORIZACION_HISTORICA' AND referencia_id=$1 AND cantidad=0", [result.id])).rows[0].count), 1);
    assert.equal(Number((await client.query<{ count: string }>("SELECT count(*) FROM auditoria_sistema WHERE entidad_tipo='valorizacion_inventario_historico' AND entidad_id=$1", [result.id])).rows[0].count), 1);
    const countsAfter = (await client.query<{ purchases: string; custody: string; financial: string }>(
      `SELECT (SELECT count(*) FROM compras)::text AS purchases,
        (SELECT count(*) FROM movimientos_custodia)::text AS custody,
        (SELECT count(*) FROM movimientos_financieros)::text AS financial`,
    )).rows[0];
    assert.deepEqual(countsAfter, countsBefore);

    await client.query('UPDATE inventario SET costo_promedio_unitario=0 WHERE producto_id=$1', [product.id]);
    await client.query('SAVEPOINT valorizacion_fallida');
    await client.query(`CREATE FUNCTION pg_temp.rechazar_auditoria_valorizacion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entidad_tipo='valorizacion_inventario_historico' THEN RAISE EXCEPTION 'fallo inducido'; END IF; RETURN NEW; END $$`);
    await client.query(`CREATE TRIGGER prueba_rechazar_auditoria_valorizacion BEFORE INSERT ON auditoria_sistema FOR EACH ROW EXECUTE FUNCTION pg_temp.rechazar_auditoria_valorizacion()`);
    await assert.rejects(valueHistoricalInventory(client, historicalInventoryValuationInput.parse({
      productoId: product.id,
      existenciaEsperada: 3,
      costoUnitario: 300,
      fechaReferencia: '2026-09-20',
      motivo: 'Prueba controlada de rollback',
    })));
    await client.query('ROLLBACK TO SAVEPOINT valorizacion_fallida');
    const afterRollback = (await client.query<{ existencia: number; costo: string }>(
      'SELECT existencia,costo_promedio_unitario AS costo FROM inventario WHERE producto_id=$1',
      [product.id],
    )).rows[0];
    assert.deepEqual({ existencia: afterRollback.existencia, costo: Number(afterRollback.costo) }, { existencia: 3, costo: 0 });
    assert.equal(Number((await client.query<{ count: string }>('SELECT count(*) FROM valorizaciones_inventario_historico WHERE producto_id=$1', [product.id])).rows[0].count), 1);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
