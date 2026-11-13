import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { changeStoreOrderStatus, createStoreOrder, orderCreateInput } from '../src/modules/store-orders/order-service.js';

const databaseUrl=process.env.TEST_DATABASE_URL;

test('pedido real en PostgreSQL aislado: creación, historial, estados y ventas intactas', { skip:!databaseUrl }, async()=>{
  const pool=new Pool({connectionString:databaseUrl});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const product=await client.query<{id:string}>(
      `SELECT p.id FROM productos p
       JOIN inventario i ON i.producto_id=p.id
       WHERE p.activo=true AND i.existencia>=2 AND p.precio_sugerido>0
       ORDER BY p.id LIMIT 1`
    );
    assert.ok(product.rows[0], 'La base aislada necesita un producto activo con stock.');
    const actor=(await client.query<{id:string}>('SELECT id FROM usuarios WHERE activo=true LIMIT 1')).rows[0];
    assert.ok(actor,'La base aislada necesita un usuario responsable.');
    const before=(await client.query(
      `SELECT (SELECT count(*) FROM ventas)::int AS ventas,
       (SELECT count(*) FROM movimientos_inventario)::int AS movimientos,
       (SELECT existencia FROM inventario WHERE producto_id=$1)::int AS stock`,
      [product.rows[0].id])).rows[0];
    const order=await createStoreOrder(client,orderCreateInput.parse({
      referenciaCliente:randomUUID(),nombre:'Comprador de prueba aislada',
      telefono:'99999999',modalidadEntrega:'RETIRO',metodoPago:'EFECTIVO',
      productos:[{productoId:product.rows[0].id,cantidad:2}],
    }),0);
    assert.equal(order.estado,'PENDIENTE');
    assert.ok(order.total>0);
    const [detail,event]=await Promise.all([
      client.query<{cantidad:number;subtotal:string}>('SELECT cantidad,subtotal FROM pedido_tienda_detalles WHERE pedido_id=$1',[order.id]),
      client.query('SELECT accion FROM pedido_tienda_eventos WHERE pedido_id=$1',[order.id]),
    ]);
    assert.equal(detail.rows[0].cantidad,2);
    assert.equal(event.rows[0].accion,'CREADO');
    await changeStoreOrderStatus(client,order.id,'CONFIRMADO',actor.id,'Pago y existencias verificados manualmente');
    await changeStoreOrderStatus(client,order.id,'COMPLETADO',actor.id,'Entrega verificada manualmente');
    await assert.rejects(()=>changeStoreOrderStatus(client,order.id,'PENDIENTE',actor.id,'Inválido'));
    const events=await client.query('SELECT accion,estado_nuevo FROM pedido_tienda_eventos WHERE pedido_id=$1 ORDER BY creado_at,id',[order.id]);
    assert.equal(events.rows.length,3);
    assert.deepEqual(events.rows.map((row)=>row.estado_nuevo).sort(),['COMPLETADO','CONFIRMADO','PENDIENTE']);
    const after=(await client.query(
      `SELECT (SELECT count(*) FROM ventas)::int AS ventas,
       (SELECT count(*) FROM movimientos_inventario)::int AS movimientos,
       (SELECT existencia FROM inventario WHERE producto_id=$1)::int AS stock`,[product.rows[0].id])).rows[0];
    assert.deepEqual(after,before,'Confirmar y completar pedidos no debe tocar ventas ni stock.');
  } finally {
    await client.query('ROLLBACK').catch(()=>undefined);
    client.release();await pool.end();
  }
});

test('dos reintentos simultáneos con la misma referencia crean solo un pedido', { skip:!databaseUrl }, async()=>{
  const pool=new Pool({connectionString:databaseUrl,max:3});
  try {
    const chosen=(await pool.query<{id:string}>(
      `SELECT p.id FROM productos p JOIN inventario i ON i.producto_id=p.id
       WHERE p.activo=true AND i.existencia>0 AND p.precio_sugerido>0 ORDER BY p.id LIMIT 1`
    )).rows[0];
    assert.ok(chosen);
    const reference=randomUUID();
    const draft=orderCreateInput.parse({
      referenciaCliente:reference,nombre:'Prueba de doble clic',telefono:'99999999',
      modalidadEntrega:'RETIRO',metodoPago:'EFECTIVO',
      productos:[{productoId:chosen.id,cantidad:1}],
    });
    const {createStoreOrderIdempotent}=await import('../src/modules/store-orders/order-service.js');
    const perform=async()=>{
      const connection=await pool.connect();
      try {
        await connection.query('BEGIN');
        const created=await createStoreOrderIdempotent(connection,draft,0);
        await connection.query('COMMIT');
        return created;
      } catch(error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {connection.release();}
    };
    const responses=await Promise.all([perform(),perform()]);
    assert.equal(responses[0].id,responses[1].id);
    assert.deepEqual(responses.map((item)=>item.repeated).sort(),[false,true]);
    const count=await pool.query<{total:string}>(
      'SELECT count(*)::text AS total FROM pedidos_tienda WHERE referencia_cliente=$1',[reference]
    );
    assert.equal(Number(count.rows[0].total),1);
    const events=await pool.query<{total:string}>(
      `SELECT count(*)::text AS total FROM pedido_tienda_eventos
        WHERE pedido_id=$1 AND accion='CREADO'`,[responses[0].id]
    );
    assert.equal(Number(events.rows[0].total),1);
  } finally {await pool.end();}
});
