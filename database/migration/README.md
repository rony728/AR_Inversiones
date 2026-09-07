# Migración inicial de AR Inversiones

La fuente autorizada es `AR_Inversiones_Migracion_V2.xlsx`. El importador calcula SHA-256, analiza las hojas, aplica únicamente las decisiones aprobadas de `stage11-rules.json` y conserva cada fila original en `filas_migracion`.

## Mapeo

| Hoja | Destino | Tratamiento |
|---|---|---|
| Productos | `productos`, `inventario_inicial_migracion`, `inventario_por_socio` | Se aplican las exclusiones, existencias y precios decididos. El código técnico `MIG-xxxxxxxx` se deriva del UUID. El stock requiere socio propietario. |
| Clientes | `clientes` | Se conservan los 121 UUID y los nombres parecidos permanecen separados. |
| Préstamos activos | `prestamos`, `intereses_prestamo` | Se conserva capital, tasa aprobada, interés inicial y próxima fecha. La fecha de desembolso queda nula y no se calcula interés retroactivo anterior a la migración. |
| Pagos históricos | `pagos_intereses_historicos` | Se conservan por cliente porque el archivo no identifica de forma fiable el préstamo individual. No modifican custodias ni capital actual. |
| Ventas históricas | `ventas_historicas` | Se conservan como legado porque las 82 filas carecen de fecha y socio financiador. No modifican stock, utilidad actual ni custodias. |
| Movimientos legacy | `movimientos_financieros_legacy` | Se conservan como referencia y no afectan saldos iniciales. |
| Distribuciones históricas | `distribuciones_utilidades_historicas` | Se conservan individualmente y no descuentan las custodias iniciales. `Prestado a AR` permanece como texto histórico. |
| Pendientes revisión | `filas_migracion` | Las 86 decisiones se conservan y las reglas aplicadas quedan en el reporte. |
| Compras | Sin registros | El libro no contiene una hoja de compras; la conciliación esperada es cero. |

## Datos requeridos para la puesta en marcha

Copiar `stage11-input.example.json` como `stage11-input.json` y completar:

- los seis saldos independientes de custodia;
- el socio propietario del inventario mediante `defaultPartner` o `byProductId`.

No se acepta un saldo negativo ni un socio distinto de Rony, Alex o Brian. El reporte de simulación enumera los productos que todavía necesitan propietario.

## Ejecución

Aplicar primero las migraciones de esquema:

```powershell
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/001_initial_schema.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/002_seed_socios_y_custodias.sql
psql -v ON_ERROR_STOP=1 -d ar_inversiones -f database/migrations/003_legacy_migration_support.sql
```

Generar y revisar la simulación:

```powershell
cd apps/api
npm run migration:dry-run -- --config ../../database/migration/stage11-input.json
```

Ejecutar la migración definitiva únicamente después de revisar el reporte:

```powershell
npm run migration:apply
```

La ejecución definitiva exige tablas operativas vacías, crea un respaldo JSON antes de cambiar datos, usa una transacción serializable y valida cantidades, capital, intereses, ventas, compras, inventario y custodias antes de confirmar. Un SHA-256 ya completado no se importa de nuevo.
