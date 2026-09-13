import { describe, expect, it } from 'vitest';
import { isProductionApiUrl, PRODUCTION_API_URL } from './api';
import { formatLastSync, PRESENCE_REFRESH_MS } from './operational-status';

describe('estado operativo', () => {
  it('formatea la última sincronización sin actualizar cada segundo', () => {
    const now = new Date('2026-09-12T12:00:20.000Z').getTime();
    expect(formatLastSync('2026-09-12T12:00:00.000Z', now)).toBe('Sincronizado hace 20 s');
    expect(formatLastSync('2026-09-12T11:58:00.000Z', now)).toBe('Sincronizado hace 2 min');
    expect(PRESENCE_REFRESH_MS).toBe(45_000);
  });

  it('detecta PRUEBAS para cualquier API distinta de producción', () => {
    expect(isProductionApiUrl(PRODUCTION_API_URL)).toBe(true);
    expect(isProductionApiUrl(`${PRODUCTION_API_URL}/`)).toBe(true);
    expect(isProductionApiUrl('http://192.168.3.113:3004/api/v1')).toBe(false);
    expect(isProductionApiUrl('http://localhost:3004/api/v1')).toBe(false);
  });
});
