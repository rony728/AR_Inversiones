import { Router } from 'express';
import { env } from '../../config/env.js';
import { withTransaction, query } from '../../db/pool.js';
import { createRateLimiter } from '../../http/middleware/security.js';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { createStoreOrder, orderCreateInput } from './order-service.js';

export const publicCheckoutRouter = Router();

export function checkoutConfiguration() {
  const pickupEnabled = env.STORE_CHECKOUT_ENABLED && env.STORE_PICKUP_ENABLED;
  const shippingEnabled = env.STORE_CHECKOUT_ENABLED && env.STORE_SHIPPING_ENABLED
    && env.STORE_SHIPPING_FEE_HNL !== undefined;
  return {
    enabled: pickupEnabled || shippingEnabled,
    delivery: {
      pickup: pickupEnabled,
      shipping: shippingEnabled,
      shippingFeeHnl: shippingEnabled ? env.STORE_SHIPPING_FEE_HNL! : null,
      cashOnDelivery: false,
    },
    payment: {
      cashPickup: pickupEnabled,
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

  if (data.modalidadEntrega === 'RETIRO') {
    if (!config.delivery.pickup || data.metodoPago !== 'EFECTIVO') {
      throw new AppError(422, 'Método de retiro o pago no disponible.', 'CHECKOUT_METHOD_UNAVAILABLE');
    }
  } else if (data.modalidadEntrega === 'ENVIO') {
    if (!config.delivery.shipping || data.metodoPago !== 'EFECTIVO') {
      throw new AppError(422, 'Envío o forma de pago no disponible.', 'CHECKOUT_METHOD_UNAVAILABLE');
    }
  } else {
    throw new AppError(422, 'Modalidad de entrega no disponible.', 'CHECKOUT_METHOD_UNAVAILABLE');
  }

  // La referencia se conserva ante reintentos, pero nunca se exponen datos del comprador.
  const existing = await query<{ id: string; numero: string; estado: string }>(
    'SELECT id, numero, estado FROM pedidos_tienda WHERE referencia_cliente=$1', [data.referenciaCliente]);
  if (existing.rows[0]) {
    const row = existing.rows[0];
    return res.status(200).json({ data: { id: row.id, numero: row.numero, estado: row.estado, repeated: true } });
  }

  const shippingCents = data.modalidadEntrega === 'RETIRO'
    ? 0 : Math.round((config.delivery.shippingFeeHnl ?? 0) * 100);
  const result = await withTransaction((client) => createStoreOrder(client, data, shippingCents));
  return res.status(201).json({ data: { ...result, repeated: false } });
}));
