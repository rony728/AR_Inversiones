import 'fake-indexeddb/auto';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { pendingCount, queueMutation, resetOfflineDatabase } from './offline-db';
import { subscribeSyncState, synchronizePending, type SyncSnapshot } from './sync';

beforeAll(async () => { await resetOfflineDatabase(); });
afterEach(() => { vi.unstubAllGlobals(); });

test('una operación creada sin conexión se envía una vez y no se duplica en sincronizaciones posteriores', async () => {
  vi.stubGlobal('navigator', { onLine: true, userAgent: 'vitest' });
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  const operation = await queueMutation('ventas', 'venta', '33333333-3333-4333-8333-333333333333', 'CREATE', { id: '33333333-3333-4333-8333-333333333333', cantidad: 1 });
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ id: operation.id, status: 'APLICADA' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);

  const snapshots: SyncSnapshot[] = []; const unsubscribe = subscribeSyncState((snapshot) => snapshots.push({ ...snapshot }));
  expect(await synchronizePending()).toEqual({ sent: 1, offline: false }); unsubscribe();
  expect(await pendingCount()).toBe(0);
  expect(snapshots.some((snapshot) => snapshot.syncing)).toBe(true);
  expect(snapshots.at(-1)?.syncing).toBe(false); expect(snapshots.at(-1)?.lastSyncedAt).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).operations[0].idempotencyKey).toBe(operation.idempotencyKey);
  expect(await synchronizePending()).toEqual({ sent: 0, offline: false });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('sin conectividad no intenta enviar y conserva la cola local', async () => {
  vi.stubGlobal('navigator', { onLine: false, userAgent: 'vitest' });
  await queueMutation('ventas', 'venta', '44444444-4444-4444-8444-444444444444', 'CREATE', { cantidad: 1 });
  expect(await synchronizePending()).toEqual({ sent: 0, offline: true });
  expect(await pendingCount()).toBe(1);
});
