import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { adjustFundBalance, fundAdjustmentInput } from '../src/modules/operations/custody-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL permite ajustes negativos, conserva movimiento y auditoría, y revierte fallos', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fund = (await client.query<{ socio_id: string; custodia_id: string }>(`SELECT s.id AS socio_id,c.id AS custodia_id FROM socios s JOIN custodias c ON c.socio_id=s.id WHERE s.nombre='Brian' AND c.actividad='PRODUCTOS' LIMIT 1`)).rows[0];
    assert.ok(fund, 'El esquema de prueba debe incluir el fondo PRODUCTOS de Brian.');
    const remainingConstraint = await client.query(`SELECT 1 FROM pg_constraint WHERE conrelid='ajustes_fondo'::regclass AND conname='ajustes_fondo_saldos_no_negativos'`);
    assert.equal(remainingConstraint.rowCount, 0, 'La migración 012 debe estar aplicada en la base de pruebas.');
    const cases = [[0, -3000], [1000, -500], [-500, -900], [-900, 0], [-900, 700]] as const;
    for (const [before, after] of cases) {
      await client.query('UPDATE custodias SET saldo_actual=$1 WHERE id=$2', [before, fund.custodia_id]);
      const result = await adjustFundBalance(client, fundAdjustmentInput.parse({ socioId: fund.socio_id, custodiaId: fund.custodia_id, nuevoSaldo: after, motivo: `Prueba transición ${before} a ${after}` }));
      assert.equal(Number(result.saldoNuevo), after);
      assert.equal(Number((await client.query<{ saldo_actual: string }>('SELECT saldo_actual FROM custodias WHERE id=$1', [fund.custodia_id])).rows[0].saldo_actual), after);
      assert.equal(Number((await client.query<{ count: string }>(`SELECT count(*) FROM movimientos_custodia WHERE referencia_tipo='AJUSTE_MANUAL_FONDO' AND referencia_id=$1`, [result.id])).rows[0].count), 1);
      assert.equal(Number((await client.query<{ count: string }>(`SELECT count(*) FROM auditoria_sistema WHERE entidad_tipo='ajuste_fondo' AND entidad_id=$1 AND accion='AJUSTE_MANUAL_FONDO'`, [result.id])).rows[0].count), 1);
    }

    await client.query('UPDATE custodias SET saldo_actual=125 WHERE id=$1', [fund.custodia_id]);
    const countsBefore = (await client.query<{ adjustments: string; movements: string }>(`SELECT (SELECT count(*) FROM ajustes_fondo)::text AS adjustments,(SELECT count(*) FROM movimientos_custodia)::text AS movements`)).rows[0];
    await client.query('SAVEPOINT ajuste_fallido');
    await client.query(`CREATE FUNCTION pg_temp.rechazar_auditoria_ajuste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entidad_tipo='ajuste_fondo' THEN RAISE EXCEPTION 'fallo de auditoría inducido'; END IF; RETURN NEW; END $$`);
    await client.query(`CREATE TRIGGER prueba_rechazar_auditoria_ajuste BEFORE INSERT ON auditoria_sistema FOR EACH ROW EXECUTE FUNCTION pg_temp.rechazar_auditoria_ajuste()`);
    await assert.rejects(adjustFundBalance(client, fundAdjustmentInput.parse({ socioId: fund.socio_id, custodiaId: fund.custodia_id, nuevoSaldo: -3000, motivo: 'Prueba de rollback transaccional' })));
    await client.query('ROLLBACK TO SAVEPOINT ajuste_fallido');
    assert.equal(Number((await client.query<{ saldo_actual: string }>('SELECT saldo_actual FROM custodias WHERE id=$1', [fund.custodia_id])).rows[0].saldo_actual), 125);
    const countsAfter = (await client.query<{ adjustments: string; movements: string }>(`SELECT (SELECT count(*) FROM ajustes_fondo)::text AS adjustments,(SELECT count(*) FROM movimientos_custodia)::text AS movements`)).rows[0];
    assert.deepEqual(countsAfter, countsBefore);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
