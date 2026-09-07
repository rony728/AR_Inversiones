import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../src/app.js';

test('health es público', async () => {
  const response = await request(app).get('/api/v1/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
});

test('las rutas de negocio requieren autenticación', async () => {
  const response = await request(app).get('/api/v1/clientes');
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'UNAUTHORIZED');
});

test('las operaciones de venta validan la carga antes de iniciar una transacción', async () => {
  const token = jwt.sign({ sub: '00000000-0000-0000-0000-000000000001', usuario: 'prueba' }, 'development-only-secret-change-this-123');
  const response = await request(app).post('/api/v1/ventas').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 422);
  assert.equal(response.body.error, 'VALIDATION_ERROR');
});

test('el dashboard exige un rango de fechas válido antes de consultar datos', async () => {
  const token = jwt.sign({ sub: '00000000-0000-0000-0000-000000000001', usuario: 'prueba' }, 'development-only-secret-change-this-123');
  const response = await request(app).get('/api/v1/dashboard').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 422);
  assert.equal(response.body.error, 'VALIDATION_ERROR');
});
