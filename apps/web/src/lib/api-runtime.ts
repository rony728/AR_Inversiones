export const PRODUCTION_API_URL = 'https://api-ar-inversiones.rtdev.uk/api/v1';
export const API_RUNTIME_STORAGE_KEY = 'ar-api-runtime-v1';

export type ApiEnvironment = 'PRODUCCION' | 'PRUEBAS' | 'PERSONALIZADA';
export type ApiRuntimeSettings = {
  active: ApiEnvironment;
  testingUrl?: string;
  customUrl?: string;
};

const buildTimeApiUrl = () => import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export function normalizeApiBaseUrl(value: string, pageProtocol = typeof window === 'undefined' ? '' : window.location.protocol) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Ingresa la dirección de la API.');
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { throw new Error('Ingresa una URL válida.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('La API debe utilizar HTTP o HTTPS.');
  if (parsed.username || parsed.password) throw new Error('La URL no debe contener credenciales.');
  if (parsed.search || parsed.hash) throw new Error('La URL no debe contener parámetros ni fragmentos.');
  if (pageProtocol === 'https:' && parsed.protocol !== 'https:') throw new Error('Una PWA abierta con HTTPS solo puede conectarse a una API HTTPS.');
  let path = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  while (/\/api\/v1\/api\/v1$/i.test(path)) path = path.replace(/\/api\/v1$/i, '');
  if (!/\/api\/v1$/i.test(path)) path = `${path}/api/v1`;
  parsed.pathname = path.replace(/^\/?/, '/');
  return parsed.toString().replace(/\/$/, '');
}

export function readApiRuntimeSettings(): ApiRuntimeSettings | null {
  try {
    const raw = localStorage.getItem(API_RUNTIME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ApiRuntimeSettings;
    if (!['PRODUCCION', 'PRUEBAS', 'PERSONALIZADA'].includes(parsed.active)) return null;
    return parsed;
  } catch { return null; }
}

export function getActiveApiConfig(): { environment: ApiEnvironment; baseUrl: string; overridden: boolean } {
  const settings = typeof localStorage === 'undefined' ? null : readApiRuntimeSettings();
  if (settings) {
    const candidate = settings.active === 'PRODUCCION' ? PRODUCTION_API_URL : settings.active === 'PRUEBAS' ? settings.testingUrl : settings.customUrl;
    if (candidate) {
      try { return { environment: settings.active, baseUrl: normalizeApiBaseUrl(candidate, ''), overridden: true }; } catch { /* Usa la configuración de compilación. */ }
    }
  }
  const baseUrl = normalizeApiBaseUrl(buildTimeApiUrl(), '');
  return { environment: baseUrl === PRODUCTION_API_URL ? 'PRODUCCION' : 'PRUEBAS', baseUrl, overridden: false };
}

export const getActiveApiBaseUrl = () => getActiveApiConfig().baseUrl;
export const isProductionApiUrl = (url = getActiveApiBaseUrl()) => normalizeApiBaseUrl(url, '') === PRODUCTION_API_URL;
export const getApiEnvironmentBadge = () => {
  const environment = getActiveApiConfig().environment;
  return environment === 'PRODUCCION' ? null : environment;
};

export function saveApiRuntimeSettings(settings: ApiRuntimeSettings) {
  localStorage.setItem(API_RUNTIME_STORAGE_KEY, JSON.stringify(settings));
}

export async function testApiConnection(value: string, request: typeof fetch = fetch) {
  const baseUrl = normalizeApiBaseUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await request(`${baseUrl}/health`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('La API no respondió correctamente.');
    return baseUrl;
  } catch {
    throw new Error('No se pudo conectar con esta API.');
  } finally { clearTimeout(timeout); }
}
