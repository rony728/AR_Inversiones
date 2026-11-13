import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app.js';

// Ejecutar SOLO contra PostgreSQL efímero; el script es una prueba destructiva
// de inserción sin COMMIT explícito y no debe apuntar a producción.
const connection=process.env.TEST_DATABASE_URL;
if (!connection || process.env.STORE_PROOF_UPLOAD_ENABLED!=='true' ||
    process.env.STORE_CHECKOUT_ENABLED!=='true' || process.env.NODE_ENV!=='test') {
  throw new Error('La prueba integral exige PostgreSQL aislado y flags explícitas de test.');
}

test('pedido con transferencia -> token -> comprobante privado, sin alterar stock ni ventas',async()=>{
 const pool=new Pool({connectionString:connection});
 try{
  const product=(await pool.query<{id:string}>(`SELECT p.id FROM productos p
    JOIN inventario i ON i.producto_id=p.id WHERE p.activo=true
    AND i.existencia>=1 AND p.precio_sugerido>0 ORDER BY p.id LIMIT 1`)).rows[0];
  assert.ok(product);
  const before=(await pool.query<{stock:number;ventas:number;movimientos:number}>(`
    SELECT (SELECT existencia::int FROM inventario WHERE producto_id=$1) AS stock,
    (SELECT count(*)::int FROM ventas) AS ventas,
    (SELECT count(*)::int FROM movimientos_inventario) AS movimientos`,[product.id])).rows[0];
  const ref=randomUUID();
  const create=await request(app).post('/api/v1/tienda/pedidos').send({
    referenciaCliente:ref,nombre:'Comprador de integración aislada',
    telefono:'99999999',modalidadEntrega:'RETIRO',metodoPago:'TRANSFERENCIA',
    productos:[{productoId:product.id,cantidad:1}],sitioWeb:'',
  });
  assert.equal(create.status,201,JSON.stringify(create.body));
  assert.equal(create.body.data.estado,'PENDIENTE');
  assert.ok(typeof create.body.data.proofUploadToken==='string');
  assert.equal(create.body.data.bankAccounts,undefined,'No se publican bancos no aprobados');
  const orderId=create.body.data.id;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(200)]);
  const body={token:create.body.data.proofUploadToken,fileName:'prueba.png',
    mimeType:'image/png',dataBase64:png.toString('base64')};
  const upload=await request(app).post('/api/v1/tienda/pedidos/'+orderId+'/comprobante').send(body);
  assert.equal(upload.status,201,JSON.stringify(upload.body));
  assert.deepEqual(upload.body.data,{received:true,verified:false});
  const duplicate=await request(app).post('/api/v1/tienda/pedidos/'+orderId+'/comprobante').send(body);
  assert.equal(duplicate.status,409);
  const saved=(await pool.query<{size:number}>(`
    SELECT octet_length(contenido)::int AS size FROM comprobantes_pedido_tienda
    WHERE pedido_id=$1`,[orderId])).rows[0];
  assert.equal(saved.size,png.length);
  const after=(await pool.query<{stock:number;ventas:number;movimientos:number}>(`
    SELECT (SELECT existencia::int FROM inventario WHERE producto_id=$1) AS stock,
    (SELECT count(*)::int FROM ventas) AS ventas,
    (SELECT count(*)::int FROM movimientos_inventario) AS movimientos`,[product.id])).rows[0];
  assert.deepEqual(after,before);
  const admin=await request(app).get('/api/v1/pedidos-tienda/'+orderId+'/comprobante');
  assert.equal(admin.status,401,'Sin autenticación no se puede descargar comprobante');
 }finally{await pool.end();}
});
