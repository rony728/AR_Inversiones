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
- Imágenes de producto: `GET|PATCH /api/v1/catalogo/productos/:id/imagen`. El `PATCH` recibe JPEG/WebP binario optimizado de hasta 1.5 MB; el listado devuelve solo metadatos y nunca incluye el blob.
- `GET|POST|PATCH /api/v1/catalogo/usuarios`
- `GET|POST|PATCH /api/v1/catalogo/socios`
- Presencia autenticada: `POST /api/v1/presencia/heartbeat` y `GET /api/v1/presencia/activos`. Solo se devuelven identificador y nombre de usuarios activos durante los últimos dos minutos; los heartbeats no generan auditoría.
- Lecturas protegidas: `/compras`, `/ventas`, `/inventario`, `/prestamos`, `/pagos-prestamo`, `/custodias`, `/movimientos-financieros`, `/gastos`, `/auditorias`, `/auditoria-sistema`, `/sincronizacion`.
- Fondos: `POST /transferencias-custodia` admite origen y destino independientes, incluso entre socios, y `POST /ajustes-fondo` registra correcciones justificadas sin afectar las métricas de ingresos, gastos o utilidad.

`POST /api/v1/sincronizacion` recibe lotes de hasta 50 operaciones con UUID de dispositivo e idempotency key. Cada reintento se registra una sola vez en PostgreSQL. Mientras las reglas financieras de etapas posteriores no existan, las operaciones de compra, venta y préstamo quedan en estado `PENDIENTE` para su aplicación validada.

Las escrituras de operaciones financieras responden `501 STAGE_NOT_IMPLEMENTED` hasta que se implementen, con sus reglas aprobadas, en las etapas de inventario/ventas, préstamos, custodias, gastos y sincronización.

Las imágenes no se agregan a la cola offline ni a IndexedDB. El catálogo de texto conserva su copia local actual y muestra el placeholder cuando la imagen autenticada no está disponible. Esta decisión evita base64 pesado y reintentos duplicados; la creación y edición de Productos continúa requiriendo conexión, igual que antes.
