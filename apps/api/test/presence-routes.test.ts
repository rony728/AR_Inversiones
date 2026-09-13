import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { requireAuth } from '../src/http/middleware/auth.js';
import { errorHandler } from '../src/lib/errors.js';
import { createPresenceRouter } from '../src/modules/presence/routes.js';

const authenticatedUserId = '11111111-1111-4111-8111-111111111111';
const token = jwt.sign({ sub: authenticatedUserId, usuario: 'rony' }, 'development-only-secret-change-this-123');

function testApp(heartbeat: (userId: string) => Promise<void>, activeUsers = async () => [{ id: authenticatedUserId, nombre: 'Rony' }, { id: '22222222-2222-4222-8222-222222222222', nombre: 'Brian' }]) {
  const app = express(); app.use(express.json()); app.use('/presencia', requireAuth, createPresenceRouter({ heartbeat, activeUsers })); app.use(errorHandler); return app;
}

test('heartbeat exige autenticación', async () => {
  const response = await request(testApp(async () => undefined)).post('/presencia/heartbeat');
  assert.equal(response.status, 401); assert.equal(response.body.error, 'UNAUTHORIZED');
});

test('heartbeat toma el usuario del JWT e ignora un usuario arbitrario del cuerpo', async () => {
  let receivedUserId = '';
  const response = await request(testApp(async (userId) => { receivedUserId = userId; }))
    .post('/presencia/heartbeat').set('Authorization', `Bearer ${token}`).send({ usuario_id: '99999999-9999-4999-8999-999999999999' });
  assert.equal(response.status, 204); assert.equal(receivedUserId, authenticatedUserId);
});

test('usuarios activos devuelve total y nombres sin datos sensibles', async () => {
  const response = await request(testApp(async () => undefined)).get('/presencia/activos').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200); assert.equal(response.body.total, 2);
  assert.deepEqual(response.body.usuarios, [{ id: authenticatedUserId, nombre: 'Rony' }, { id: '22222222-2222-4222-8222-222222222222', nombre: 'Brian' }]);
  assert.equal(JSON.stringify(response.body).includes('password'), false);
});
