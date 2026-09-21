import { normalizeApiBaseUrl, saveApiRuntimeSettings, type ApiRuntimeSettings } from './api-runtime';
import { pendingCount, resetOfflineDatabase } from './offline-db';
import { clearAllProductImageCache } from './product-images';
import { resetLocalSyncState } from './sync';

export class PendingOperationsError extends Error {
  constructor(public readonly count: number) {
    super(`Hay ${count} ${count === 1 ? 'operación pendiente' : 'operaciones pendientes'} de sincronizar. Sincronízalas antes de cambiar de servidor.`);
  }
}

type SwitchDependencies = {
  countPending?: typeof pendingCount;
  resetDatabase?: typeof resetOfflineDatabase;
  clearImages?: typeof clearAllProductImageCache;
  resetSync?: typeof resetLocalSyncState;
  reload?: () => void;
};

export async function changeApiServer(settings: ApiRuntimeSettings, targetUrl: string, dependencies: SwitchDependencies = {}) {
  const count = await (dependencies.countPending ?? pendingCount)();
  if (count > 0) throw new PendingOperationsError(count);
  const normalized = normalizeApiBaseUrl(targetUrl);
  const normalizedSettings: ApiRuntimeSettings = {
    ...settings,
    ...(settings.active === 'PRUEBAS' ? { testingUrl: normalized } : {}),
    ...(settings.active === 'PERSONALIZADA' ? { customUrl: normalized } : {}),
  };
  await (dependencies.resetDatabase ?? resetOfflineDatabase)();
  (dependencies.clearImages ?? clearAllProductImageCache)();
  (dependencies.resetSync ?? resetLocalSyncState)();
  sessionStorage.removeItem('ar-token');
  sessionStorage.removeItem('ar-user');
  saveApiRuntimeSettings(normalizedSettings);
  (dependencies.reload ?? (() => window.location.reload()))();
  return normalized;
}
