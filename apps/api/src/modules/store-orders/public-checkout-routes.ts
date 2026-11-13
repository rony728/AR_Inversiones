import { Router } from 'express';
import { env } from '../../config/env.js';
import { withTransaction } from '../../db/pool.js';
import { createRateLimiter } from '../../http/middleware/security.js';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { createStoreOrderIdempotent, orderCreateInput } from './order-service.js';
import { storePaymentOptions, paymentAllowed } from './payment-methods.js';

export const publicCheckoutRouter = Router();

export function checkoutConfiguration() {
  const pickupEnabled = env.STORE_PICKUP_ENABLED;
  const shippingEnabled = env.STORE_SHIPPING_ENABLED
    && env.STORE_SHIPPING_FEE_HNL !== undefined;
  const methods = storePaymentOptions();
  return {
    enabled: env.STORE_CHECKOUT_ENABLED && (
      (pickupEnabled && methods.some((method) => method.enabled && method.deliveryModes.includes('RETIRO'))) ||
      (shippingEnabled && env.STORE_SHIPPING_PAYMENT_ENABLED &&
        methods.some((method) => method.enabled && method.deliveryModes.includes('ENVIO')))
    ),
    delivery: {
      pickup: pickupEnabled,
      pickupLocation: pickupEnabled ? env.STORE_PICKUP_LOCATION : null,
      shipping: shippingEnabled,
      shippingFeeHnl: shippingEnabled ? env.STORE_SHIPPING_FEE_HNL : null,
      shippingCoverage: shippingEnabled ? env.STORE_SHIPPING_COVERAGE : null,
      deliveryEstimate: shippingEnabled ? env.STORE_DELIVERY_ESTIMATE : null,
      cashOnDelivery: false,
    },
    confirmation: 'MANUAL',
    payment: {
      cashPickup: env.STORE_CHECKOUT_ENABLED && pickupEnabled,
      shippingPaymentConfigured: env.STORE_SHIPPING_PAYMENT_ENABLED &&
        methods.some((m) => m.enabled && m.deliveryModes.includes('ENVIO')),
      methods,
    },
    disclaimer: 'Disponibilidad sujeta a confirmación. Tu pedido será revisado antes de confirmar la venta.',
  };
}

publicCheckoutRouter.get('/checkout-config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: checkoutConfiguration() });
});

const submitLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60_000 });
publicCheckoutRouter.post('/pedidos', submitLimiter, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const config = checkoutConfiguration();
  if (!config.enabled) {
    throw new AppError(503, 'La recepción de pedidos aún no está habilitada.', 'CHECKOUT_DISABLED');
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new AppError(422, 'Datos del pedido inválidos.', 'VALIDATION_ERROR');
  }
  const { sitioWeb, ...payload } = req.body as Record<string, unknown>;
  if (sitioWeb !== undefined && sitioWeb !== '') {
    throw new AppError(422, 'Datos del pedido inválidos.', 'VALIDATION_ERROR');
  }
  const valid = orderCreateInput.safeParse(payload);
  if (!valid.success) throw new AppError(422, 'Datos del pedido inválidos.', 'VALIDATION_ERROR');
  const data = valid.data;

  const deliveryAvailable = data.modalidadEntrega === 'RETIRO'
    ? config.delivery.pickup
    : data.modalidadEntrega === 'ENVIO' && config.delivery.shipping;
  if (!deliveryAvailable ||
    (data.modalidadEntrega === 'ENVIO' && !config.payment.shippingPaymentConfigured) ||
    !paymentAllowed(config.payment.methods, data.metodoPago, data.modalidadEntrega)) {
    throw new AppError(422, 'Modalidad de entrega o método de pago no disponible.', 'CHECKOUT_METHOD_UNAVAILABLE');
  }

  // No crear pedidos duplicados aunque lleguen dos solicitudes simultáneas.
  // El lock y la consulta de idempotencia se realizan en la MISMA transacción.
  const shippingCents = data.modalidadEntrega === 'RETIRO'
    ? 0 : Math.round((config.delivery.shippingFeeHnl ?? 0) * 100);
  const result = await withTransaction((client) => createStoreOrderIdempotent(client, data, shippingCents));
  return res.status(result.repeated ? 200 : 201).json({ data: result });
}));
