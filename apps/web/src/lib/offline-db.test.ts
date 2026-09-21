import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { cacheList, getCachedList, pendingCount, queueMutation, resetOfflineDatabase } from './offline-db';

test('IndexedDB conserva una operación pendiente y una copia local', async () => {
  await resetOfflineDatabase();
  await cacheList('productos', [{ id: '11111111-1111-4111-8111-111111111111', nombre: 'Producto local' }]);
  await queueMutation('productos', 'producto', '22222222-2222-4222-8222-222222222222', 'CREATE', { id: '22222222-2222-4222-8222-222222222222', nombre: 'Nuevo producto' });
  expect((await getCachedList('productos')).length).toBe(2);
  expect(await pendingCount()).toBe(1);
});

test('la limpieza por cambio de servidor elimina copias sincronizadas y permite abrir una base nueva', async () => {
  await resetOfflineDatabase();
  await cacheList('clientes', [{ id: '33333333-3333-4333-8333-333333333333', nombre: 'Servidor anterior' }]);
  expect(await getCachedList('clientes')).toHaveLength(1);
  await resetOfflineDatabase();
  expect(await getCachedList('clientes')).toEqual([]);
  expect(await pendingCount()).toBe(0);
});
