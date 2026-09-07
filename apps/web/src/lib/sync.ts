import { api } from './api';
import { deviceId, markOperation, queuedOperations, type QueuedOperation } from './offline-db';

type SyncReply = { results: Array<{ id: string; status: 'APLICADA' | 'PENDIENTE' | 'RECHAZADA'; error?: string }> };
export async function synchronizePending() {
  if (!navigator.onLine) return { sent: 0, offline: true };
  const operations = await queuedOperations();
  if (!operations.length) return { sent: 0, offline: false };
  try {
    const reply = await api<SyncReply>('/sincronizacion', { method: 'POST', body: JSON.stringify({ deviceId: await deviceId(), deviceName: navigator.userAgent.slice(0, 120), operations: operations.slice(0, 50) }) });
    await Promise.all(operations.slice(0, 50).map(async (operation) => {
      const result = reply.results.find((item) => item.id === operation.id);
      if (!result) return markOperation(operation, 'ERROR', 'La API no confirmó la operación.');
      if (result.status === 'RECHAZADA') return markOperation(operation, 'ERROR', result.error);
      return markOperation(operation, result.status === 'APLICADA' ? 'ENVIADA' : 'PENDIENTE');
    }));
    return { sent: reply.results.length, offline: false };
  } catch (error) {
    await Promise.all(operations.map((operation) => markOperation(operation, 'ERROR', error instanceof Error ? error.message : 'Error de conexión')));
    return { sent: 0, offline: false };
  }
}

export function beginSyncListener() { const attempt = () => void synchronizePending(); window.addEventListener('online', attempt); attempt(); return () => window.removeEventListener('online', attempt); }
export type { QueuedOperation };
