import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { transferBetweenCustodies, transferInput } from '../src/modules/operations/custody-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL 001-008 admite transferencias internas y entre socios', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl }); const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const funds = (await client.query<{ socio_id: string; nombre: string; custodia_id: string; actividad: 'PRODUCTOS' | 'PRESTAMOS' }>(`SELECT s.id AS socio_id,s.nombre,c.id AS custodia_id,c.actividad FROM socios s JOIN custodias c ON c.socio_id=s.id WHERE s.nombre IN ('Alex','Brian','Rony') ORDER BY s.nombre,c.actividad`)).rows;
    assert.equal(funds.length, 6, 'El esquema de prueba debe incluir tres socios con dos fondos cada uno.');
    const fund = (partner: string, activity: 'PRODUCTOS' | 'PRESTAMOS') => funds.find((item) => item.nombre === partner && item.actividad === activity)!;
    await client.query('UPDATE custodias SET saldo_actual=10000 WHERE id=ANY($1::uuid[])', [funds.map((item) => item.custodia_id)]);
    const totalBefore = Number((await client.query<{ total: string }>('SELECT sum(saldo_actual) AS total FROM custodias WHERE id=ANY($1::uuid[])', [funds.map((item) => item.custodia_id)])).rows[0].total);
    const cases = [
      { origin: fund('Alex', 'PRESTAMOS'), destination: fund('Alex', 'PRODUCTOS'), amount: 500, reason: 'Prueba interna PostgreSQL' },
      { origin: fund('Brian', 'PRESTAMOS'), destination: fund('Rony', 'PRESTAMOS'), amount: 1000, reason: 'Prueba cruzada PostgreSQL' }
    ];
    for (const item of cases) await transferBetweenCustodies(client, transferInput.parse({ socioOrigenId: item.origin.socio_id, custodiaOrigenId: item.origin.custodia_id, socioDestinoId: item.destination.socio_id, custodiaDestinoId: item.destination.custodia_id, monto: item.amount, observaciones: item.reason }));
    const totalAfter = Number((await client.query<{ total: string }>('SELECT sum(saldo_actual) AS total FROM custodias WHERE id=ANY($1::uuid[])', [funds.map((item) => item.custodia_id)])).rows[0].total);
    assert.equal(totalAfter, totalBefore);
    assert.equal(Number((await client.query<{ count: string }>("SELECT count(*) FROM transferencias_custodia WHERE observaciones LIKE 'Prueba % PostgreSQL'")).rows[0].count), 2);
    assert.equal(Number((await client.query<{ count: string }>("SELECT count(*) FROM movimientos_custodia WHERE referencia_tipo='TRANSFERENCIA_CUSTODIA' AND referencia_id IN (SELECT id FROM transferencias_custodia WHERE observaciones LIKE 'Prueba % PostgreSQL')")).rows[0].count), 4);
    assert.equal(Number((await client.query<{ count: string }>("SELECT count(*) FROM auditoria_sistema WHERE entidad_tipo='transferencia_custodia' AND datos_nuevos->>'motivo' LIKE 'Prueba % PostgreSQL'")).rows[0].count), 2);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined); client.release(); await pool.end();
  }
});
