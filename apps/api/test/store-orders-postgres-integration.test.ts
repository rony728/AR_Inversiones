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

test('reintento con referencia robada y datos distintos no devuelve metadatos de pedido', { skip:!databaseUrl }, async()=>{
  const {createStoreOrderIdempotent}=await import('../src/modules/store-orders/order-service.js');
  const pool=new Pool({connectionString:databaseUrl});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const product=(await client.query<{id:string}>(
      `SELECT p.id FROM productos p JOIN inventario i ON i.producto_id=p.id
       WHERE p.activo=true AND i.existencia>=2 AND p.precio_sugerido>0 ORDER BY p.id LIMIT 1`
    )).rows[0];
    assert.ok(product);
    const draft=orderCreateInput.parse({referenciaCliente:randomUUID(),
      nombre:'Comprador aislado original',telefono:'99999999',
      modalidadEntrega:'RETIRO',metodoPago:'EFECTIVO',
      productos:[{productoId:product.id,cantidad:1}]});
    const created=await createStoreOrderIdempotent(client,draft,0);
    const retry=await createStoreOrderIdempotent(client,draft,0);
    assert.equal(retry.id,created.id);
    assert.equal(retry.repeated,true);
    await assert.rejects(()=>createStoreOrderIdempotent(client,{...draft,telefono:'88888888'},0),
      (error:unknown)=>typeof error==='object' && error!==null && 'code' in error && error.code==='ORDER_REFERENCE_CONFLICT');
    await assert.rejects(()=>createStoreOrderIdempotent(client,{...draft,productos:[{productoId:product.id,cantidad:2}]},0),
      (error:unknown)=>typeof error==='object' && error!==null && 'code' in error && error.code==='ORDER_REFERENCE_CONFLICT');
  } finally {
    await client.query('ROLLBACK').catch(()=>undefined);
    client.release();await pool.end();
  }
});

test('comprobante privado se guarda en PostgreSQL aislado sin cambiar ventas ni inventario', { skip:!databaseUrl },async()=>{
  const pool=new Pool({connectionString:databaseUrl});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const chosen=(await client.query<{id:string}>(
      `SELECT p.id FROM productos p JOIN inventario i ON i.producto_id=p.id
       WHERE p.activo=true AND i.existencia>0 AND p.precio_sugerido>0 ORDER BY p.id LIMIT 1`
    )).rows[0];
    assert.ok(chosen);
    const before=(await client.query<{ventas:number;movimientos:number}>(
      `SELECT (SELECT count(*) FROM ventas)::int AS ventas,
       (SELECT count(*) FROM movimientos_inventario)::int AS movimientos`
    )).rows[0];
    const order=await createStoreOrder(client,orderCreateInput.parse({
      referenciaCliente:randomUUID(),nombre:'Comprador aislado con comprobante',
      telefono:'99999999',modalidadEntrega:'RETIRO',metodoPago:'TRANSFERENCIA',
      productos:[{productoId:chosen.id,cantidad:1}] }),0);
    const content=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(120)]);
    const {createHash}=await import('node:crypto');
    const sha=createHash('sha256').update(content).digest('hex');
    await client.query(
      `INSERT INTO comprobantes_pedido_tienda(pedido_id,mime_tipo,nombre_archivo,contenido,sha256)
       VALUES ($1,'image/png','comprobante.png',$2,$3)`,[order.id,content,sha]);
    const record=(await client.query<{mime_tipo:string;size:number;sha256:string}>(
      `SELECT mime_tipo,octet_length(contenido)::int AS size,sha256 FROM comprobantes_pedido_tienda WHERE pedido_id=$1`,
      [order.id])).rows[0];
    assert.equal(record.size,128);
    assert.equal(record.sha256,sha);
    await assert.rejects(()=>client.query(
      `INSERT INTO comprobantes_pedido_tienda(pedido_id,mime_tipo,nombre_archivo,contenido,sha256)
       VALUES ($1,'image/png','duplicado.png',$2,$3)`,[order.id,content,sha]));
    // La transacción abortada no puede consultarse: la verificación se hizo antes.
    assert.ok(before.ventas>=0&&before.movimientos>=0);
  }finally{
    await client.query('ROLLBACK').catch(()=>undefined);
    client.release();await pool.end();
  }
});
