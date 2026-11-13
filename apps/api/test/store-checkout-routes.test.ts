import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { app } from '../src/app.js';
import { checkoutConfiguration } from '../src/modules/store-orders/public-checkout-routes.js';

test('checkout cerrado por defecto, no expone datos comerciales sin confirmar', async () => {
  const settings = checkoutConfiguration();
  assert.equal(settings.enabled, false);
  assert.equal(settings.delivery.pickup, false);
  assert.equal(settings.delivery.shipping, false);
  assert.equal(settings.delivery.shippingFeeHnl, null);
  const response = await request(app).get('/api/v1/tienda/checkout-config');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body.data, settings);
});

test('POST pedidos rechazado cuando no hay configuración comercial, sin acceso a BD', async () => {
  const response = await request(app).post('/api/v1/tienda/pedidos')
    .send({ cliente_nombre:'No debería crearse un pedido' });
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'CHECKOUT_DISABLED');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('sigue prohibido usar APIs administrativas desde la tienda', async () => {
  const response = await request(app).get('/api/v1/tienda/checkout-config')
    .set('Origin', 'https://araccesorios.rtdev.uk');
  assert.equal(response.status, 200);
  const blocked = await request(app).post('/api/v1/tienda/pedidos')
    .set('Origin', 'https://origen-no-autorizado.example')
    .send({});
  assert.equal(blocked.status, 403);
});
