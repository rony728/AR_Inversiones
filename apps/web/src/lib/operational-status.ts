import { useEffect, useState } from 'react';
import { api } from './api';
import { OFFLINE_QUEUE_CHANGED_EVENT, pendingCount } from './offline-db';
import { getSyncSnapshot, markSynchronized, subscribeSyncState, type SyncSnapshot } from './sync';

export type ActiveUser = { id: string; nombre: string };
export type OperationalMode = 'online' | 'local' | 'syncing';
export type OperationalStatus = { mode: OperationalMode; pending: number; lastSyncedAt: string | null; users: ActiveUser[]; now: number };

const STATUS_REFRESH_MS = 20_000;
export const PRESENCE_REFRESH_MS = 45_000;

export function formatLastSync(lastSyncedAt: string | null, now = Date.now()) {
  if (!lastSyncedAt) return '';
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(lastSyncedAt).getTime()) / 1000));
  if (elapsedSeconds < 60) return `Sincronizado hace ${elapsedSeconds} s`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `Sincronizado hace ${elapsedMinutes} min`;
  return `Sincronizado a las ${new Date(lastSyncedAt).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' })}`;
}

export function useOperationalStatus(): OperationalStatus {
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [pending, setPending] = useState(0);
  const [users, setUsers] = useState<ActiveUser[]>([]);
  const [sync, setSync] = useState<SyncSnapshot>(() => getSyncSnapshot());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;
    const refreshStatus = async () => {
      const online = navigator.onLine; if (active) { setBrowserOnline(online); setNow(Date.now()); }
      const currentPending = await pendingCount().catch(() => 0); if (active) setPending(currentPending);
      if (!online) { if (active) { setApiAvailable(false); setUsers([]); } return; }
      try {
        await api('/health');
        if (active) setApiAvailable(true);
        if (active && currentPending === 0) markSynchronized();
      } catch { if (active) { setApiAvailable(false); setUsers([]); } }
    };
    const refreshPresence = async () => {
      if (!navigator.onLine) { if (active) setUsers([]); return; }
      try {
        await api('/presencia/heartbeat', { method: 'POST' });
        if (!active) return;
        const result = await api<{ total: number; usuarios: ActiveUser[] }>('/presencia/activos');
        if (active) { setUsers(result.usuarios); setApiAvailable(true); }
      } catch { if (active) setUsers([]); }
    };
    const online = () => { void refreshStatus(); void refreshPresence(); };
    const offline = () => { setBrowserOnline(false); setApiAvailable(false); setUsers([]); void refreshStatus(); };
    const queueChanged = () => { void pendingCount().then((count) => { if (active) setPending(count); }).catch(() => undefined); };
    const unsubscribe = subscribeSyncState((snapshot) => { if (active) setSync(snapshot); });
    void refreshStatus(); void refreshPresence();
    window.addEventListener('online', online); window.addEventListener('offline', offline); window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, queueChanged);
    const statusTimer = window.setInterval(() => { void refreshStatus(); }, STATUS_REFRESH_MS);
    const presenceTimer = window.setInterval(() => { void refreshPresence(); }, PRESENCE_REFRESH_MS);
    return () => { active = false; unsubscribe(); window.removeEventListener('online', online); window.removeEventListener('offline', offline); window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, queueChanged); window.clearInterval(statusTimer); window.clearInterval(presenceTimer); };
  }, []);

  return { mode: sync.syncing ? 'syncing' : browserOnline && apiAvailable ? 'online' : 'local', pending, lastSyncedAt: sync.lastSyncedAt, users, now };
}
