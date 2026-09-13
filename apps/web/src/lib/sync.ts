import { api } from './api';
import { deviceId, markOperation, queuedOperations, type QueuedOperation } from './offline-db';

type SyncReply = { results: Array<{ id: string; status: 'APLICADA' | 'PENDIENTE' | 'RECHAZADA'; error?: string }> };
export type SyncSnapshot = { syncing: boolean; lastSyncedAt: string | null };
const LAST_SYNC_KEY = 'ar-last-sync-at';
const listeners = new Set<(snapshot: SyncSnapshot) => void>();
const storedLastSync = () => { try { return localStorage.getItem(LAST_SYNC_KEY); } catch { return null; } };
let syncSnapshot: SyncSnapshot = { syncing: false, lastSyncedAt: typeof localStorage === 'undefined' ? null : storedLastSync() };

function updateSyncSnapshot(update: Partial<SyncSnapshot>) {
  syncSnapshot = { ...syncSnapshot, ...update };
  listeners.forEach((listener) => listener(syncSnapshot));
}

export function markSynchronized(at = new Date()) {
  const lastSyncedAt = at.toISOString();
  try { localStorage.setItem(LAST_SYNC_KEY, lastSyncedAt); } catch { /* El estado en memoria sigue disponible. */ }
  updateSyncSnapshot({ lastSyncedAt });
}

export const getSyncSnapshot = () => syncSnapshot;
export function subscribeSyncState(listener: (snapshot: SyncSnapshot) => void) { listeners.add(listener); return () => listeners.delete(listener); }

export async function synchronizePending() {
  if (!navigator.onLine) return { sent: 0, offline: true };
  const operations = await queuedOperations();
  if (!operations.length) return { sent: 0, offline: false };
  updateSyncSnapshot({ syncing: true });
  try {
    const reply = await api<SyncReply>('/sincronizacion', { method: 'POST', body: JSON.stringify({ deviceId: await deviceId(), deviceName: navigator.userAgent.slice(0, 120), operations: operations.slice(0, 50) }) });
    await Promise.all(operations.slice(0, 50).map(async (operation) => {
      const result = reply.results.find((item) => item.id === operation.id);
      if (!result) return markOperation(operation, 'ERROR', 'La API no confirmó la operación.');
      if (result.status === 'RECHAZADA') return markOperation(operation, 'ERROR', result.error);
      return markOperation(operation, result.status === 'APLICADA' ? 'ENVIADA' : 'PENDIENTE');
    }));
    markSynchronized();
    return { sent: reply.results.length, offline: false };
  } catch (error) {
    await Promise.all(operations.map((operation) => markOperation(operation, 'ERROR', error instanceof Error ? error.message : 'Error de conexión')));
    return { sent: 0, offline: false };
  } finally {
    updateSyncSnapshot({ syncing: false });
  }
}

export function beginSyncListener() { const attempt = () => void synchronizePending(); window.addEventListener('online', attempt); attempt(); return () => window.removeEventListener('online', attempt); }
export type { QueuedOperation };
