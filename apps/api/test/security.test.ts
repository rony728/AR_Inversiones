import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';
import { app } from '../src/app.js';
import { errorHandler } from '../src/lib/errors.js';
import { createRateLimiter } from '../src/http/middleware/security.js';

test('la API aplica cabeceras de seguridad y correlación de solicitud', async () => {
  const response = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(response.headers['x-request-id']);
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('la API rechaza orígenes CORS no autorizados y JSON inválido', async () => {
  const cors = await request(app).get('/api/v1/health').set('Origin', 'https://no-autorizado.example');
  assert.equal(cors.status, 403);
  assert.equal(cors.body.error, 'CORS_FORBIDDEN');
  const malformed = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error, 'MALFORMED_JSON');
});

test('el límite de intentos bloquea solicitudes posteriores dentro de su ventana', async () => {
  const limited = express();
  limited.use(createRateLimiter({ max: 1, windowMs: 60_000 }));
  limited.get('/', (_req, res) => res.sendStatus(204));
  limited.use(errorHandler);
  assert.equal((await request(limited).get('/')).status, 204);
  const rejected = await request(limited).get('/');
  assert.equal(rejected.status, 429);
  assert.equal(rejected.body.error, 'RATE_LIMITED');
});
