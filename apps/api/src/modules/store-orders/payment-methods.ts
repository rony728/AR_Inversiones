import { env } from '../../config/env.js';

export const paymentIds = ['EFECTIVO', 'TRANSFERENCIA', 'DEPOSITO', 'CONTRA_ENTREGA', 'ENLACE_PAGO'] as const;
export type PaymentId = (typeof paymentIds)[number];
export type DeliveryId = 'RETIRO' | 'ENVIO';

export type PaymentOption = {
  id: PaymentId;
  label: string;
  description: string;
  enabled: boolean;
  deliveryModes: DeliveryId[];
  requiresManualVerification: boolean;
};

export function storePaymentOptions(): PaymentOption[] {
  // Ninguna opción supone que se recibió o verificó el pago.
  const hasBankDetails = Boolean(env.STORE_BANK_PAYMENT_INSTRUCTIONS?.trim());
  return [
    {
      id: 'EFECTIVO', label: 'Efectivo al retirar',
      description: 'Pago en efectivo al recoger, después de confirmar el pedido.',
      enabled: env.STORE_PICKUP_ENABLED, deliveryModes: ['RETIRO'],
      requiresManualVerification: true,
    },
    {
      id: 'TRANSFERENCIA', label: 'Transferencia bancaria',
      description: 'Elige una cuenta bancaria al registrar tu pedido y envía el comprobante para revisión.',
      enabled: env.STORE_TRANSFER_ENABLED && hasBankDetails,
      deliveryModes: ['RETIRO', 'ENVIO'], requiresManualVerification: true,
    },
    {
      id: 'DEPOSITO', label: 'Depósito bancario',
      description: 'Deposita en una de las cuentas indicadas al registrar tu pedido. Comprobaremos el pago.',
      enabled: env.STORE_DEPOSIT_ENABLED && hasBankDetails,
      deliveryModes: ['RETIRO', 'ENVIO'], requiresManualVerification: true,
    },
    {
      id: 'CONTRA_ENTREGA', label: 'Pago contra entrega',
      description: 'Paga al recibir tu paquete. Confirmaremos cobertura y condiciones antes del envío.',
      enabled: env.STORE_COD_ENABLED && env.STORE_SHIPPING_ENABLED,
      deliveryModes: ['ENVIO'], requiresManualVerification: true,
    },
    {
      id: 'ENLACE_PAGO', label: 'Tarjeta mediante enlace de pago',
      description: 'Enlace oficial por confirmar. Nunca se solicitan datos de tarjeta en esta tienda.',
      enabled: env.STORE_PAYMENT_LINK_ENABLED && Boolean(env.STORE_PAYMENT_LINK_URL),
      deliveryModes: ['RETIRO', 'ENVIO'], requiresManualVerification: true,
    },
  ];
}

export function paymentAllowed(
  methods: readonly PaymentOption[],
  method: string,
  delivery: string,
): boolean {
  return methods.some((option) =>
    option.id === method && option.enabled && option.deliveryModes.includes(delivery as DeliveryId));
}
