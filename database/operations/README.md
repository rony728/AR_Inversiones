# Operación segura de datos

Las utilidades se ejecutan desde `apps/api` y toman la conexión exclusivamente de `DATABASE_URL`. Nunca escriba contraseñas ni tokens en comandos, archivos versionados o registros.

## Respaldo manual

```powershell
npm run backup
npm run backup -- --output ..\..\database\backups\antes-de-actualizar.dump
```

Cada respaldo de formato PostgreSQL personalizado se acompaña de un manifiesto con SHA-256. Guarde ambos archivos en un medio cifrado o repositorio de respaldos con acceso restringido. Los directorios de respaldos y exportaciones están ignorados por Git.

## Restauración

Primero valide la integridad sin tocar la base:

```powershell
npm run restore -- ..\..\database\backups\archivo.dump --confirm --dry-run
```

La restauración real elimina y recrea los objetos incluidos en el respaldo. Hágala únicamente sobre una base detenida o de recuperación y con una copia reciente verificada:

```powershell
npm run restore -- ..\..\database\backups\archivo.dump --confirm
```

## Exportación

```powershell
npm run export:data -- --format json
npm run export:data -- --format csv --output ..\..\database\exports\cierre-mensual --tables ventas,prestamos,pagos_prestamo
```

Las exportaciones omiten el valor de `password_hash`. Revise destinatarios y cifrado antes de compartir cualquier exportación, pues contiene datos operativos.
