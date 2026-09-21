import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { paymentInput, registerLoanPayment, reverseLoanPayment } from '../src/modules/operations/loan-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL 001-011 registra, revierte y hace rollback de pagos con monto extra', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const schema = await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='pagos_prestamo' AND column_name='monto_extra'");
    assert.equal(schema.rows[0]?.column_name, 'monto_extra', 'Aplica primero la migración 011 en la base de pruebas.');
    const fund = (await client.query<{ socio_id: string; custodia_id: string }>("SELECT s.id AS socio_id,c.id AS custodia_id FROM socios s JOIN custodias c ON c.socio_id=s.id WHERE s.activo=true AND c.actividad='PRESTAMOS' ORDER BY s.nombre LIMIT 1")).rows[0];
    assert.ok(fund, 'La base de pruebas debe contener al menos un fondo PRESTAMOS.');
    await client.query('UPDATE custodias SET saldo_actual=1000 WHERE id=$1', [fund.custodia_id]);
    const customer = (await client.query<{ id: string }>("INSERT INTO clientes(nombre) VALUES ('Prueba PostgreSQL pago extra') RETURNING id")).rows[0];
    const loan = (await client.query<{ id: string }>("INSERT INTO prestamos (cliente_id,socio_id,custodia_id,fecha_desembolso,fecha_proximo_pago,tasa_mensual,capital_original,capital_pendiente,estado,calcular_interes_desde) VALUES ($1,$2,$3,'2098-12-15','2099-02-15',15,1300,1300,'ACTIVO','2098-12-15') RETURNING id", [customer.id, fund.socio_id, fund.custodia_id])).rows[0];
    await client.query("INSERT INTO intereses_prestamo (prestamo_id,fecha_vencimiento,capital_base,tasa_mensual,monto_interes,saldo_pendiente) VALUES ($1,'2099-01-15',1300,15,195,195)", [loan.id]);

    for (const [label, body] of [
      ['omitido', { fechaPago: '2099-01-15', monto: 200 }],
      ['cero', { fechaPago: '2099-01-15', monto: 200, montoExtra: 0 }],
    ] as const) {
      await client.query(`SAVEPOINT pago_${label}`);
      const result = await registerLoanPayment(client, loan.id, paymentInput.parse(body));
      assert.deepEqual({ interes: result.interes, capital: result.capital, capitalRestante: result.capitalRestante, montoExtra: result.montoExtra, totalRecibido: result.totalRecibido }, { interes: '195.00', capital: '5.00', capitalRestante: '1295.00', montoExtra: '0.00', totalRecibido: '200.00' });
      const extras = await client.query<{ total: string }>("SELECT count(*) AS total FROM movimientos_financieros WHERE referencia_id=$1 AND tipo='INGRESO_EXTRA_PRESTAMO'", [result.id]);
      assert.equal(Number(extras.rows[0].total), 0);
      await client.query(`ROLLBACK TO SAVEPOINT pago_${label}`);
    }

    await client.query('SAVEPOINT pago_extra');
    const paid = await registerLoanPayment(client, loan.id, paymentInput.parse({ fechaPago: '2099-01-15', monto: 200, montoExtra: 50 }));
    assert.deepEqual({ interes: paid.interes, capital: paid.capital, capitalRestante: paid.capitalRestante, montoExtra: paid.montoExtra, totalRecibido: paid.totalRecibido, saldoFondo: paid.saldoFondo }, { interes: '195.00', capital: '5.00', capitalRestante: '1295.00', montoExtra: '50.00', totalRecibido: '250.00', saldoFondo: '1250.00' });
    const stored = (await client.query<{ monto_extra: string }>('SELECT monto_extra FROM pagos_prestamo WHERE id=$1', [paid.id])).rows[0];
    assert.equal(stored.monto_extra, '50.00');
    assert.equal(Number((await client.query<{ total: string }>("SELECT count(*) AS total FROM movimientos_financieros WHERE referencia_id=$1 AND tipo='INGRESO_EXTRA_PRESTAMO'", [paid.id])).rows[0].total), 1);
    await reverseLoanPayment(client, loan.id, paid.id, { motivo: 'Prueba de reversión PostgreSQL' });
    assert.equal(Number((await client.query<{ saldo_actual: string }>('SELECT saldo_actual FROM custodias WHERE id=$1', [fund.custodia_id])).rows[0].saldo_actual), 1000);
    assert.equal(Number((await client.query<{ capital_pendiente: string }>('SELECT capital_pendiente FROM prestamos WHERE id=$1', [loan.id])).rows[0].capital_pendiente), 1300);
    await client.query('ROLLBACK TO SAVEPOINT pago_extra');

    const before = {
      fund: (await client.query('SELECT saldo_actual FROM custodias WHERE id=$1', [fund.custodia_id])).rows[0],
      loan: (await client.query('SELECT capital_pendiente,fecha_proximo_pago,estado FROM prestamos WHERE id=$1', [loan.id])).rows[0],
      payments: Number((await client.query<{ total: string }>('SELECT count(*) AS total FROM pagos_prestamo WHERE prestamo_id=$1', [loan.id])).rows[0].total),
    };
    await client.query('SAVEPOINT pago_fallido');
    const failingClient = new Proxy(client, {
      get(target, property, receiver) {
        if (property !== 'query') return Reflect.get(target, property, receiver);
        return async (sql: string, values?: unknown[]) => {
          if (sql.includes("'INGRESO_EXTRA_PRESTAMO'")) throw new Error('Fallo inyectado en movimiento extra');
          return target.query(sql, values);
        };
      },
    }) as PoolClient;
    await assert.rejects(registerLoanPayment(failingClient, loan.id, paymentInput.parse({ fechaPago: '2099-01-15', monto: 200, montoExtra: 50 })), /Fallo inyectado/);
    await client.query('ROLLBACK TO SAVEPOINT pago_fallido');
    assert.deepEqual((await client.query('SELECT saldo_actual FROM custodias WHERE id=$1', [fund.custodia_id])).rows[0], before.fund);
    assert.deepEqual((await client.query('SELECT capital_pendiente,fecha_proximo_pago,estado FROM prestamos WHERE id=$1', [loan.id])).rows[0], before.loan);
    assert.equal(Number((await client.query<{ total: string }>('SELECT count(*) AS total FROM pagos_prestamo WHERE prestamo_id=$1', [loan.id])).rows[0].total), before.payments);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
