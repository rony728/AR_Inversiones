import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';

const server = app.listen(env.PORT, env.HOST, () => console.log(`AR Inversiones API escuchando en http://${env.HOST}:${env.PORT}`));
let closing = false;
async function shutdown(exitCode = 0) {
  if (closing) return; closing = true;
  server.close(() => void pool.end().finally(() => process.exit(exitCode)));
  setTimeout(() => void pool.end().finally(() => process.exit(exitCode)), 10_000).unref();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('uncaughtException', (error) => { console.error(error); void shutdown(1); });
process.on('unhandledRejection', (error) => { console.error(error); void shutdown(1); });
