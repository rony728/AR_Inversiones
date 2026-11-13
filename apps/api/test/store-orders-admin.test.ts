import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { app } from '../src/app.js';

test('API administrativa exige sesión para listado y detalle de pedidos', async () => {
  const base='/api/v1/pedidos-tienda';
  const urls=[base,base+'/11111111-1111-4111-8111-111111111111'];
  for(const url of urls){
    const response=await request(app).get(url);
    assert.equal(response.status,401);
    assert.equal(response.body.error,'UNAUTHORIZED');
  }
});

test('actualizar estados y notas sin autenticación devuelve 401 y no escribe datos', async () => {
  const base='/api/v1/pedidos-tienda/11111111-1111-4111-8111-111111111111';
  for(const url of [base+'/estado',base+'/notas']){
    const response=await request(app).post(url).send({
      estado:'CONFIRMADO', observacion:'Prueba de sesión requerida',version:1,
    });
    assert.equal(response.status,401);
    assert.equal(response.body.error,'UNAUTHORIZED');
  }
});

test('rutas de pedidos del panel no están montadas como endpoint público de tienda', async () => {
  const response=await request(app).get('/api/v1/tienda/pedidos-tienda');
  assert.notEqual(response.status,200);
});

test('el formulario público continúa bloqueado y separado de ventas', async () => {
  const response=await request(app).post('/api/v1/tienda/pedidos').send({});
  assert.equal(response.status,503);
  assert.equal(response.body.error,'CHECKOUT_DISABLED');
});
