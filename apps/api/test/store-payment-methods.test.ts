import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentAllowed, storePaymentOptions, type PaymentOption } from '../src/modules/store-orders/payment-methods.js';

test('catálogo público no ofrece cuentas ficticias ni habilita métodos no configurados', () => {
  const options = storePaymentOptions();
  assert.deepEqual(options.map(({id}) => id), [
    'EFECTIVO','TRANSFERENCIA','DEPOSITO','CONTRA_ENTREGA','ENLACE_PAGO',
  ]);
  assert.equal(paymentAllowed(options,'EFECTIVO','RETIRO'),true);
  assert.equal(paymentAllowed(options,'EFECTIVO','ENVIO'),false);
  assert.equal(paymentAllowed(options,'TRANSFERENCIA','ENVIO'),false);
  assert.equal(paymentAllowed(options,'DEPOSITO','RETIRO'),false);
  assert.equal(paymentAllowed(options,'CONTRA_ENTREGA','ENVIO'),false);
  assert.equal(paymentAllowed(options,'ENLACE_PAGO','RETIRO'),false);
  assert.ok(options.every((option) => option.requiresManualVerification));
});

test('un método solo puede aceptarse cuando está habilitado y permitido para la entrega', () => {
  const methods: PaymentOption[] = [
    {id:'TRANSFERENCIA',label:'Transferencia',description:'Verificación manual',
      enabled:true,deliveryModes:['RETIRO','ENVIO'],requiresManualVerification:true},
    {id:'CONTRA_ENTREGA',label:'Contra entrega',description:'Por mensajería',
      enabled:false,deliveryModes:['ENVIO'],requiresManualVerification:true},
  ];
  assert.equal(paymentAllowed(methods,'TRANSFERENCIA','RETIRO'),true);
  assert.equal(paymentAllowed(methods,'TRANSFERENCIA','ENVIO'),true);
  assert.equal(paymentAllowed(methods,'TRANSFERENCIA','CONTRA_ENTREGA'),false);
  assert.equal(paymentAllowed(methods,'CONTRA_ENTREGA','ENVIO'),false);
  assert.equal(paymentAllowed(methods,'TARJETA_DIRECTA','ENVIO'),false);
});
