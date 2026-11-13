# Panel de pedidos web — AR Inversiones

El módulo `/pedidos-web` está dentro de la aplicación autenticada de AR Inversiones.

Los endpoints `/api/v1/pedidos-tienda` requieren JWT válido y cuenta activa. Únicamente permiten listado, detalle, cambiar estados y guardar notas con auditoría. No hay rutas públicas que expongan datos personales.

Estados: PENDIENTE → CONFIRMADO → COMPLETADO, o CANCELADO desde los dos primeros. Estados terminales no admiten cambios.

Toda actualización requiere motivo, `version` vigente, bloqueo de fila en transacción y actor real del JWT. Guardar una nota no cambia el estado; confirmar o completar no registra venta, no cobra y no descuenta inventario.

**Restricción actual:** AR Inversiones no diferencia roles; cualquier operador autenticado con cuenta activa hereda acceso. Se recomienda RBAC si se quiere separar permisos administrativos antes de lanzamiento. La tienda pública continúa sin aceptar pedidos hasta autorización y validaciones.
