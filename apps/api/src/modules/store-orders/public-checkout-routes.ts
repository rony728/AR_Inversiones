import { Router } from 'express';
import { env } from '../../config/env.js';
import { withTransaction } from '../../db/pool.js';
import { createRateLimiter } from '../../http/middleware/security.js';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { createStoreOrderIdempotent, orderCreateInput } from './order-service.js';
import { storePaymentOptions, paymentAllowed } from './payment-methods.js';
import { receiptBankAccounts } from './bank-instructions.js';
import { canUploadProof,createProofToken,parseProofUpload,validateProofToken } from './payment-proof.js';
import { z } from 'zod';
import { query } from '../../db/pool.js';

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
  // Prevalidar el archivo bancario ANTES de insertar pedidos. Si está corrupto o
  // carece de permisos seguros, la operación falla sin guardar un pedido a medias.
  const approvedBanks = receiptBankAccounts(data.metodoPago, true, config.enabled,
    env.STORE_BANK_PUBLICATION_ENABLED, env.STORE_BANK_ACCOUNTS_FILE);
  const result = await withTransaction((client) => createStoreOrderIdempotent(client, data, shippingCents));
  // Una repetición idempotente no devuelve instrucciones bancarias.
  const banks = result.repeated ? [] : approvedBanks;
  const proofToken = !result.repeated && env.STORE_PROOF_UPLOAD_ENABLED &&
    canUploadProof(data.metodoPago,result.estado)
    ? createProofToken(result.id,data.referenciaCliente,env.JWT_SECRET) : undefined;
  return res.status(result.repeated ? 200 : 201).json({
    data: { ...result, ...(banks.length ? { bankAccounts: banks } : {}),
      ...(proofToken ? { proofUploadToken: proofToken } : {}) }
  });
}));


// Carga privada a través de comprobante y token de pedido efímero. Por defecto 503.
const proofLimiter=createRateLimiter({max:3,windowMs:15*60_000});
publicCheckoutRouter.post('/pedidos/:id/comprobante',proofLimiter,asyncHandler(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if (!env.STORE_CHECKOUT_ENABLED || !env.STORE_PROOF_UPLOAD_ENABLED) {
    throw new AppError(503,'Carga de comprobantes desactivada.','PROOF_UPLOAD_DISABLED');
  }
  const id=z.string().uuid().parse(req.params.id);
  let proof:ReturnType<typeof parseProofUpload>;
  try { proof=parseProofUpload(req.body); }
  catch { throw new AppError(422,'Comprobante inválido: usa una imagen JPG o PNG de hasta 600 KB.','INVALID_PAYMENT_PROOF'); }
  const order=await query<{id:string;referencia_cliente:string;metodo_pago:string;estado:string}>(
    'SELECT id,referencia_cliente,metodo_pago,estado FROM pedidos_tienda WHERE id=$1',[id]);
  const row=order.rows[0];
  if (!row || !validateProofToken(proof.token,id,row.referencia_cliente,env.JWT_SECRET) ||
    !canUploadProof(row.metodo_pago,row.estado)) {
    throw new AppError(403,'Comprobante no autorizado para este pedido.','PROOF_FORBIDDEN');
  }
  const result=await query(
    `INSERT INTO comprobantes_pedido_tienda (pedido_id,mime_tipo,nombre_archivo,contenido,sha256)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (pedido_id) DO NOTHING RETURNING id`,
    [id,proof.mimeType,proof.fileName,proof.content,proof.sha256]);
  if (!result.rows[0]) throw new AppError(409,'Este pedido ya tiene comprobante. Contacta por WhatsApp para reemplazarlo.','PROOF_EXISTS');
  res.status(201).json({data:{received:true,verified:false}});
}));
