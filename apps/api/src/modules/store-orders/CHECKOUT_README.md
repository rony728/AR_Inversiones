# Checkout AR Accesorios — integración pendiente de activación

El servicio `src/modules/store-orders/public-checkout-routes.ts` expone configuración
y una ruta de pedidos que por defecto está deshabilitada; no activar sin completar
políticas de privacidad, tarifa real de envío, modalidades comerciales y controles de
abuso. Variables en `apps/api/.env.example`.

- `STORE_CHECKOUT_ENABLED=false`
- `STORE_PICKUP_ENABLED=false`
- `STORE_SHIPPING_ENABLED=false`
- `STORE_SHIPPING_FEE_HNL` sin valor hasta que exista tarifa real.

No modificar el inventario al crear pedidos. Las ventas se registran manualmente
en AR Inversiones. Cloudflare Pages requiere además habilitación independiente del
proxy POST. Ejecutar primero pruebas con base PostgreSQL aislada. No activar directamente
en producción ni exponer datos personales hasta aprobar privacidad y condiciones.

La creación de pedidos es un camino futuro validado y actualmente bloqueado.
