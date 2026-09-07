# Funcionamiento offline

La PWA conserva en IndexedDB las colecciones de productos, clientes, ventas, compras, préstamos, pagos de préstamo, inventario, custodias, movimientos financieros y configuración.

Las lecturas conectadas actualizan la copia local. Si la API no está disponible, las pantallas muestran la última copia guardada. `queueMutation` registra cambios locales junto con una operación UUID e idempotency key; las futuras pantallas de escritura la utilizarán para compras, ventas, préstamos, pagos, gastos y ajustes.

Al recuperar conectividad, `synchronizePending` envía lotes de hasta 50 operaciones. La API registra cada una con una restricción única de idempotencia, por lo que reintentos o envíos repetidos no generan duplicados. Las operaciones financieras permanecen pendientes en el servidor hasta que sus validadores transaccionales se implementen en las etapas de negocio.
