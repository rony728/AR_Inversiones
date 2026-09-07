# Producción en Termux y Cloudflare Tunnel

La API se enlaza por defecto a `127.0.0.1`; así no queda expuesta en la red local. Cloudflare Tunnel será el único publicador del servicio.

## PostgreSQL local

En Termux, instale los paquetes y cree el clúster una vez:

```sh
pkg update && pkg install nodejs-lts postgresql cloudflared
initdb -D "$PREFIX/var/lib/postgresql"
pg_ctl -D "$PREFIX/var/lib/postgresql" -l "$PREFIX/var/lib/postgresql/server.log" start
createuser ar_inversiones
createdb -O ar_inversiones ar_inversiones
```

Copie `apps/api/.env.example` a `apps/api/.env` y, para producción, defina como mínimo:

```ini
NODE_ENV=production
HOST=127.0.0.1
DATABASE_URL=postgresql://ar_inversiones:CONTRASENA_LOCAL@127.0.0.1:5432/ar_inversiones
JWT_SECRET=clave-aleatoria-unica-de-mas-de-32-caracteres
CORS_ORIGIN=https://app.su-dominio.example
TRUST_PROXY=true
DATABASE_SSL=false
```

No suba `.env`, respaldos, exportaciones ni tokens. Restrinja los permisos del directorio de aplicación y conserve la clave de PostgreSQL fuera del historial del terminal.

Instale, aplique las migraciones en orden y arranque:

```sh
cd /ruta/al/proyecto/apps/api
npm ci --omit=dev
psql "$DATABASE_URL" -f ../../database/migrations/001_initial_schema.sql
psql "$DATABASE_URL" -f ../../database/migrations/002_seed_socios_y_custodias.sql
psql "$DATABASE_URL" -f ../../database/migrations/003_legacy_migration_support.sql
psql "$DATABASE_URL" -f ../../database/migrations/004_inventario_general_del_negocio.sql
npm start
```

## Cloudflare Tunnel

Configure el hostname del túnel para que apunte a `http://127.0.0.1:3000`. Mantenga el token fuera de archivos versionados y ejecútelo desde una sesión de servicio:

```sh
export CLOUDFLARE_TUNNEL_TOKEN='token-entregado-por-cloudflare'
cloudflared tunnel run --token "$CLOUDFLARE_TUNNEL_TOKEN"
```

Actualice `CORS_ORIGIN` con el origen HTTPS real de la PWA y reinicie la API. Pruebe salud desde el túnel y ejecute un respaldo verificado antes de cada actualización.
