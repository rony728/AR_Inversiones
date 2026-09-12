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
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/tests/001_integrity_smoke_test.sql
```

No hay tablas ni funciones genéricas de aportes o retiros: toda variación de custodia debe estar enlazada a una operación autorizada. Los saldos iniciales de las seis custodias permanecen en cero hasta la puesta en marcha y migración aprobada.

`inventario` es el stock general de AR Inversiones y conserva un único costo promedio ponderado por producto. Las compras y ventas registran el socio únicamente para identificar la custodia PRODUCTOS que pagó o recibió el dinero.

La migración inicial, sus reglas explícitas, la plantilla de saldos/propiedad y el reporte de simulación están documentados en `database/migration/README.md`.

La eliminación lógica definida desde la migración `006` aplica a cualquier préstamo. La migración `007` agrega tipos de movimiento específicos para registrar, sin alterar el historial, las variaciones automáticas del fondo PRESTAMOS causadas por editar capital/socio o retirar un préstamo de la cartera.
