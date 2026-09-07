# API de AR Inversiones

## Inicio local

1. Copie `.env.example` como `.env` y defina una clave JWT segura.
2. Ejecute primero las migraciones de `database/migrations` contra PostgreSQL.
3. Desde esta carpeta ejecute `npm run dev`.

La primera cuenta se crea una sola vez con `POST /api/v1/auth/bootstrap`. Después se usa `POST /api/v1/auth/login`; las demás rutas requieren `Authorization: Bearer <token>`.

## Rutas disponibles en esta etapa

- `GET /api/v1/health`
- `POST /api/v1/auth/bootstrap`, `POST /api/v1/auth/login`
- `GET|POST|PATCH /api/v1/catalogo/{clientes,categorias,proveedores,productos}`
- `GET|POST|PATCH /api/v1/catalogo/usuarios`
- `GET|POST|PATCH /api/v1/catalogo/socios`
- Lecturas protegidas: `/compras`, `/ventas`, `/inventario`, `/prestamos`, `/pagos-prestamo`, `/custodias`, `/movimientos-financieros`, `/gastos`, `/auditorias`, `/auditoria-sistema`, `/sincronizacion`.

`POST /api/v1/sincronizacion` recibe lotes de hasta 50 operaciones con UUID de dispositivo e idempotency key. Cada reintento se registra una sola vez en PostgreSQL. Mientras las reglas financieras de etapas posteriores no existan, las operaciones de compra, venta y préstamo quedan en estado `PENDIENTE` para su aplicación validada.

Las escrituras de operaciones financieras responden `501 STAGE_NOT_IMPLEMENTED` hasta que se implementen, con sus reglas aprobadas, en las etapas de inventario/ventas, préstamos, custodias, gastos y sincronización.
