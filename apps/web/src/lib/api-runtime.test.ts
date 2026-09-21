// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiBlob } from './api';
import { API_RUNTIME_STORAGE_KEY, getActiveApiBaseUrl, getActiveApiConfig, getApiEnvironmentBadge, normalizeApiBaseUrl, PRODUCTION_API_URL, readApiRuntimeSettings, saveApiRuntimeSettings, testApiConnection } from './api-runtime';
import { changeApiServer, PendingOperationsError } from './api-switch';

describe('API activa en runtime', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

  it('sin override utiliza VITE_API_URL y normaliza el slash final', () => {
    expect(getActiveApiBaseUrl()).toBe(normalizeApiBaseUrl(import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1', ''));
    expect(getActiveApiBaseUrl()).not.toMatch(/\/$/);
  });

  it('persiste y resuelve Producción, Pruebas y Personalizada después de releer', () => {
    saveApiRuntimeSettings({ active: 'PRODUCCION', testingUrl: 'https://tests.example/api/v1', customUrl: 'https://custom.example/api/v1' });
    expect(getActiveApiConfig()).toMatchObject({ environment: 'PRODUCCION', baseUrl: PRODUCTION_API_URL });
    expect(getApiEnvironmentBadge()).toBeNull();
    saveApiRuntimeSettings({ ...readApiRuntimeSettings()!, active: 'PRUEBAS' });
    expect(getActiveApiBaseUrl()).toBe('https://tests.example/api/v1'); expect(getApiEnvironmentBadge()).toBe('PRUEBAS');
    saveApiRuntimeSettings({ ...readApiRuntimeSettings()!, active: 'PERSONALIZADA' });
    expect(getActiveApiBaseUrl()).toBe('https://custom.example/api/v1'); expect(getApiEnvironmentBadge()).toBe('PERSONALIZADA');
    expect(JSON.parse(localStorage.getItem(API_RUNTIME_STORAGE_KEY)!)).toMatchObject({ active: 'PERSONALIZADA' });
  });

  it('todas las llamadas JSON y de imagen consultan la URL runtime vigente', async () => {
    saveApiRuntimeSettings({ active: 'PRUEBAS', testingUrl: 'https://tests.example/api/v1/' });
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })).mockResolvedValueOnce(new Response(new Blob(['image']), { status: 200 }));
    await api('/catalogo/productos'); await apiBlob('/catalogo/productos/1/imagen');
    expect(request.mock.calls[0][0]).toBe('https://tests.example/api/v1/catalogo/productos');
    expect(request.mock.calls[1][0]).toBe('https://tests.example/api/v1/catalogo/productos/1/imagen');
  });

  it('Probar conexión consulta health sin cambiar el servidor activo', async () => {
    saveApiRuntimeSettings({ active: 'PRODUCCION' });
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(testApiConnection('https://tests.example/api/v1/', request)).resolves.toBe('https://tests.example/api/v1');
    expect(request).toHaveBeenCalledWith('https://tests.example/api/v1/health', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(request.mock.calls[0][1]).not.toHaveProperty('headers');
    expect(request.mock.calls[0][1]).not.toHaveProperty('credentials');
    expect(getActiveApiBaseUrl()).toBe(PRODUCTION_API_URL);
  });

  it('normaliza rutas y rechaza URL inválida, credenciales y mixed content', () => {
    expect(normalizeApiBaseUrl('https://server.example//api/v1/api/v1/')).toBe('https://server.example/api/v1');
    expect(normalizeApiBaseUrl('https://server.example')).toBe('https://server.example/api/v1');
    expect(() => normalizeApiBaseUrl('javascript:alert(1)')).toThrow(/HTTP o HTTPS/);
    expect(() => normalizeApiBaseUrl('https://user:secret@server.example/api/v1')).toThrow(/credenciales/);
    expect(() => normalizeApiBaseUrl('http://server.example/api/v1', 'https:')).toThrow(/API HTTPS/);
    expect(normalizeApiBaseUrl('http://localhost:3004/api/v1', 'http:')).toBe('http://localhost:3004/api/v1');
  });

  it('cambiar servidor limpia datos y sesión, guarda configuración y recarga', async () => {
    sessionStorage.setItem('ar-token', 'secret'); sessionStorage.setItem('ar-user', '{}');
    const resetDatabase = vi.fn().mockResolvedValue(undefined); const clearImages = vi.fn(); const resetSync = vi.fn(); const reload = vi.fn();
    await changeApiServer({ active: 'PRUEBAS', testingUrl: 'https://tests.example/api/v1' }, 'https://tests.example/api/v1', { countPending: async () => 0, resetDatabase, clearImages, resetSync, reload });
    expect(resetDatabase).toHaveBeenCalled(); expect(clearImages).toHaveBeenCalled(); expect(resetSync).toHaveBeenCalled(); expect(reload).toHaveBeenCalled();
    expect(sessionStorage.getItem('ar-token')).toBeNull(); expect(getActiveApiConfig().environment).toBe('PRUEBAS');
  });

  it('bloquea el cambio con pendientes sin borrar datos, sesión ni cola', async () => {
    sessionStorage.setItem('ar-token', 'secret');
    const resetDatabase = vi.fn(); const reload = vi.fn();
    await expect(changeApiServer({ active: 'PRODUCCION' }, PRODUCTION_API_URL, { countPending: async () => 3, resetDatabase, reload })).rejects.toEqual(expect.objectContaining<Partial<PendingOperationsError>>({ count: 3 }));
    expect(resetDatabase).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled(); expect(sessionStorage.getItem('ar-token')).toBe('secret'); expect(localStorage.getItem(API_RUNTIME_STORAGE_KEY)).toBeNull();
  });

  it('health fallido presenta el error público sin filtrar detalles', async () => {
    const request = vi.fn().mockRejectedValue(new Error('ECONNREFUSED internal host'));
    await expect(testApiConnection('https://tests.example/api/v1', request)).rejects.toThrow('No se pudo verificar esta API desde este origen.');
  });
});
