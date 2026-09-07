# Matriz de validación integral — etapa 13

Ejecute estos casos sobre una base PostgreSQL de pruebas recién migrada; no use la base de producción. Las pruebas unitarias y de interfaz se ejecutan con `npm test` en `apps/api` y `apps/web`.

| Caso | Acción | Resultado esperado |
| --- | --- | --- |
| Venta | Comprar 1 unidad por L300 y venderla por L500 | Inventario -1; custodia PRODUCTOS +L500 respecto al saldo tras la compra; costo L300; ganancia L200. |
| Interés inicial | Préstamo de L5,000 al 15% | Capital pendiente L5,000 e interés del período L750. |
| Pago solo interés | Registrar L750 con interés pendiente L750 | Capital sin cambio; custodia PRESTAMOS +L750; ingreso de interés L750. |
| Pago mixto | Registrar L1,750 con interés L750 | L750 a interés, L1,000 a capital y capital restante L4,000. |
| Pagos inválidos | Intentar pagar menos que el interés o más que interés + capital | La API responde 422 con `INSUFFICIENT_INTEREST_PAYMENT` o `EXCESSIVE_PAYMENT`; no hay movimientos nuevos. |
| Mora | Avanzar fecha posterior al vencimiento y refrescar préstamos | Se genera un interés simple por cada mes vencido y el estado es `VENCIDO`. |
| Transferencia | Mover L2,000 de PRODUCTOS a PRESTAMOS | PRODUCTOS -L2,000, PRESTAMOS +L2,000, total igual y sin utilidad. |
| Auditoría | Iniciar, contar una diferencia y aprobar | Se conserva el conteo, se crea `AJUSTE_AUDITORIA` y no se reescribe el movimiento original. |
| Offline y reintento | Crear venta sin red, recuperar red y sincronizar dos veces | La primera confirmación vacía la cola; la segunda no crea una venta adicional por la clave de idempotencia. |

Antes de cada ejecución, verifique que las custodias seleccionadas pertenecen al socio correspondiente y que existe saldo suficiente. Conserve el resultado de la suite y el identificador de respaldo anterior a la prueba.
