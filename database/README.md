# Base de datos de AR Inversiones

Las migraciones son SQL estándar para PostgreSQL 14 o superior. La extensión `pgcrypto` proporciona UUID generados por el servidor; los UUID creados offline también pueden insertarse directamente.

## Orden de ejecución

```powershell
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/001_initial_schema.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/002_seed_socios_y_custodias.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/003_legacy_migration_support.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/tests/001_integrity_smoke_test.sql
```

No hay tablas ni funciones genéricas de aportes o retiros: toda variación de custodia debe estar enlazada a una operación autorizada. Los saldos iniciales de las seis custodias permanecen en cero hasta la puesta en marcha y migración aprobada.

`inventario_por_socio` conserva la titularidad financiera exigida: el ingreso de una venta se asigna a la custodia PRODUCTOS del socio que financió las unidades vendidas. El costo promedio se mantiene por producto y socio.

La migración inicial, sus reglas explícitas, la plantilla de saldos/propiedad y el reporte de simulación están documentados en `database/migration/README.md`.
