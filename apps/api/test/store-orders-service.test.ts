import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { AppError } from '../src/lib/errors.js';
import { changeStoreOrderStatus, createStoreOrder, orderCreateInput, toCents, validateOrderTransition } from '../src/modules/store-orders/order-service.js';

const uuid1='11111111-1111-4111-8111-111111111111';
const uuid2='22222222-2222-4222-8222-222222222222';
const orderId='33333333-3333-4333-8333-333333333333';
const actor='44444444-4444-4444-8444-444444444444';
const draft = {
  referenciaCliente:uuid2, nombre:'Comprador de prueba', telefono:'99999999',
  modalidadEntrega:'RETIRO', metodoPago:'EFECTIVO',
  productos:[{productoId:uuid1,cantidad:2}]
} as const;

function mockDb(outOfStock=false) {
  const calls: Array<{sql:string;values:unknown[]}> = [];
  const db={
    async query(sql:string, values:unknown[]=[]) {
      calls.push({sql,values});
      if(sql.includes('FROM productos')) return {rows:[{id:uuid1,nombre:'Cable USB',codigo:'CB1',
        existencia:outOfStock?1:8,precio_actual:'150.50'}]};
      if(sql.includes('INSERT INTO pedidos_tienda (')) return {rows:[{id:orderId,numero:'12',estado:'PENDIENTE'}]};
      if(sql.includes('FROM pedidos_tienda WHERE')) return {rows:[{id:orderId,estado:'PENDIENTE'}]};
      return {rows:[]};
    }
  };
  return {client:db as unknown as PoolClient,calls};
}

test('validación: no permite productos duplicados ni entrega sin dirección', () => {
  assert.equal(orderCreateInput.safeParse({...draft,productos:[draft.productos[0],draft.productos[0]]}).success,false);
  assert.equal(orderCreateInput.safeParse({...draft,modalidadEntrega:'ENVIO'}).success,false);
  assert.equal(orderCreateInput.safeParse({...draft,productos:[{productoId:uuid1,cantidad:100}]}).success,false);
});
test('transiciones: terminales no admiten cambios y no se salta confirmación', () => {
  validateOrderTransition('PENDIENTE','CONFIRMADO');
  validateOrderTransition('CONFIRMADO','COMPLETADO');
  assert.throws(()=>validateOrderTransition('PENDIENTE','COMPLETADO'),AppError);
  assert.throws(()=>validateOrderTransition('CANCELADO','CONFIRMADO'),AppError);
  assert.throws(()=>validateOrderTransition('COMPLETADO','PENDIENTE'),AppError);
});
test('precios se calculan en centavos, no se aceptan valores inválidos', () => {
  assert.equal(toCents('150.50'),15050);
  assert.throws(()=>toCents(-1),AppError);
  assert.throws(()=>toCents(Infinity),AppError);
});
test('crea pedido y detalles como snapshot, registra eventos sin tocar stock', async () => {
  const {client,calls}=mockDb();
  const created=await createStoreOrder(client,orderCreateInput.parse(draft),0);
  assert.deepEqual(created,{id:orderId,numero:'12',estado:'PENDIENTE',subtotal:301,costoEnvio:0,total:301});
  assert.ok(calls.some((q)=>q.sql.includes('INSERT INTO pedido_tienda_detalles')));
  assert.ok(calls.some((q)=>q.sql.includes('INSERT INTO pedido_tienda_eventos')));
  assert.ok(calls.some((q)=>q.sql.includes('INSERT INTO auditoria_sistema')));
  assert.ok(!calls.some((q)=>/\b(UPDATE|INSERT|DELETE)\s+(INTO\s+|FROM\s+)?(inventario|ventas|detalle_ventas|movimientos_inventario)\b/i.test(q.sql)));
});
test('agotado: rechaza pedido antes de insertar cualquier cabecera', async () => {
  const {client,calls}=mockDb(true);
  await assert.rejects(()=>createStoreOrder(client,orderCreateInput.parse(draft),0),AppError);
  assert.equal(calls.some((q)=>q.sql.includes('INSERT INTO pedidos_tienda')),false);
});
test('cambio de estado incluye actor obligatorio, bitácora y auditoría', async () => {
  const {client,calls}=mockDb();
  const result=await changeStoreOrderStatus(client,orderId,'CONFIRMADO',actor,'Pedido revisado');
  assert.equal(result.estado,'CONFIRMADO');
  assert.ok(calls.some((q)=>q.sql.includes('UPDATE pedidos_tienda')));
  assert.ok(calls.some((q)=>q.sql.includes('INSERT INTO pedido_tienda_eventos')));
  assert.ok(calls.some((q)=>q.sql.includes('INSERT INTO auditoria_sistema')));
  assert.ok(!calls.some((q)=>q.sql.includes('UPDATE inventario')));
});
