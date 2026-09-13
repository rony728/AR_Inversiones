# Base de datos de AR Inversiones

Las migraciones son SQL estándar para PostgreSQL 14 o superior. La extensión `pgcrypto` proporciona UUID generados por el servidor; los UUID creados offline también pueden insertarse directamente.

## Orden de ejecución

```powershell
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/001_initial_schema.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/002_seed_socios_y_custodias.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/003_legacy_migration_support.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/004_inventario_general_del_negocio.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/005_complete_loan_management.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/006_soft_delete_legacy_loans.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/007_flexible_loan_adjustments.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/008_cross_partner_transfers_and_fund_adjustments.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/009_product_images.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/010_user_presence.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/tests/001_integrity_smoke_test.sql
```

No hay tablas ni funciones genéricas de aportes o retiros: toda variación de custodia debe estar enlazada a una operación autorizada. Los saldos iniciales de las seis custodias permanecen en cero hasta la puesta en marcha y migración aprobada.

`inventario` es el stock general de AR Inversiones y conserva un único costo promedio ponderado por producto. Las compras y ventas registran el socio únicamente para identificar la custodia PRODUCTOS que pagó o recibió el dinero.

La migración inicial, sus reglas explícitas, la plantilla de saldos/propiedad y el reporte de simulación están documentados en `database/migration/README.md`.

La eliminación lógica definida desde la migración `006` aplica a cualquier préstamo. La migración `007` agrega tipos de movimiento específicos para registrar, sin alterar el historial, las variaciones automáticas del fondo PRESTAMOS causadas por editar capital/socio o retirar un préstamo de la cartera.

La migración `008` permite transferencias entre fondos de socios distintos y crea `ajustes_fondo`. Cada ajuste conserva saldo anterior, saldo nuevo, diferencia, motivo, usuario y fecha; además genera un movimiento `AJUSTE_MANUAL_FONDO` y auditoría. Deliberadamente no genera `movimientos_financieros`: es una corrección excepcional del saldo bajo responsabilidad, no una venta, ingreso, gasto, utilidad ni distribución. Así, los KPIs y la utilidad disponible no se alteran accidentalmente.

La migración `009` agrega `producto_imagenes`, una relación opcional 1:1 con `productos`. Los productos existentes permanecen sin imagen (no se crean blobs de relleno). La API guarda únicamente JPEG/WebP optimizados de hasta 1.5 MB y el listado de productos expone metadatos, nunca el contenido binario.

La migración `010` agrega `presencia_usuarios`, una relación temporal 1:1 con `usuarios`. Cada heartbeat reemplaza la hora de actividad del usuario autenticado; la consulta de presencia ignora registros con más de dos minutos y no genera entradas de auditoría.
