import { useEffect, useState } from 'react';
import { api } from './api';
import { cacheList, getCachedList, type LocalStore } from './offline-db';

export function useOfflineList(store: LocalStore, path: string) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]); const [offline, setOffline] = useState(false);
  useEffect(() => { let active = true; api<{ data: Record<string, unknown>[] }>(path).then(async (result) => { await cacheList(store, result.data); if (active) { setRows(result.data); setOffline(false); } }).catch(async () => { const cached = await getCachedList(store); if (active) { setRows(cached); setOffline(true); } }); return () => { active = false; }; }, [store, path]);
  return { rows, offline };
}
