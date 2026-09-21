// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ change: vi.fn(), pending: vi.fn(), test: vi.fn(), current: { environment: 'PRODUCCION', baseUrl: 'https://api-ar-inversiones.rtdev.uk/api/v1', overridden: false }, stored: null as null | Record<string, unknown> }));
vi.mock('../lib/api-switch', () => ({
  PendingOperationsError: class extends Error { constructor(public count: number) { super(`Hay ${count} operaciones pendientes de sincronizar. Sincronízalas antes de cambiar de servidor.`); } },
  changeApiServer: mocks.change,
}));
vi.mock('../lib/offline-db', () => ({ pendingCount: mocks.pending }));
vi.mock('../lib/api-runtime', () => ({
  PRODUCTION_API_URL: 'https://api-ar-inversiones.rtdev.uk/api/v1',
  getActiveApiConfig: () => mocks.current,
  readApiRuntimeSettings: () => mocks.stored,
  normalizeApiBaseUrl: (value: string) => { if (!value.startsWith('http')) throw new Error('Ingresa una URL válida.'); return value.replace(/\/+$/, ''); },
  testApiConnection: mocks.test,
}));

import { Settings } from './Settings';

describe('Configuración', () => {
  let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
  beforeEach(async () => {
    mocks.change.mockReset().mockResolvedValue(undefined); mocks.pending.mockReset().mockResolvedValue(0); mocks.test.mockReset().mockResolvedValue('ok'); mocks.current = { environment: 'PRODUCCION', baseUrl: 'https://api-ar-inversiones.rtdev.uk/api/v1', overridden: false }; mocks.stored = null; vi.stubGlobal('confirm', vi.fn(() => true));
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); await act(async () => root.render(<MemoryRouter><Settings /></MemoryRouter>));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it('abre vistas administrativas propias y conserva Categorías', () => {
    const links = Object.fromEntries([...container.querySelectorAll('a')].map((link) => [link.querySelector('h3')?.textContent, link.getAttribute('href')]));
    expect(links.Usuarios).toBe('/configuracion/usuarios'); expect(links.Socios).toBe('/configuracion/socios'); expect(links.Categorías).toBe('/configuracion/categorias'); expect(links.Proveedores).toBe('/configuracion/proveedores');
  });

  it('muestra entorno, servidor y estado de conexión actuales', async () => {
    expect(container.textContent).toContain('Conexión API'); expect(container.textContent).toContain('Producción'); expect(container.textContent).toContain('https://api-ar-inversiones.rtdev.uk/api/v1');
    await vi.waitFor(() => expect(container.textContent).toContain('Conectado'));
  });

  it('Probar conexión no cambia el servidor y Guardar sí confirma el cambio', async () => {
    const testing = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Pruebas') as HTMLButtonElement;
    await act(async () => testing.click());
    const input = container.querySelector('input[type="url"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'https://tests.example/api/v1/'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    const testButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Probar conexión') as HTMLButtonElement;
    await act(async () => testButton.click()); await vi.waitFor(() => expect(container.textContent).toContain('Conexión correcta.'));
    expect(mocks.change).not.toHaveBeenCalled();
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Guardar') as HTMLButtonElement;
    await act(async () => save.click());
    await vi.waitFor(() => expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ active: 'PRUEBAS', testingUrl: 'https://tests.example/api/v1' }), 'https://tests.example/api/v1'));
    expect(window.confirm).toHaveBeenCalled();
  });

  it('bloquea Guardar con pendientes sin confirmar ni cambiar servidor', async () => {
    mocks.pending.mockResolvedValue(3);
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Guardar') as HTMLButtonElement;
    await act(async () => save.click());
    await vi.waitFor(() => expect(container.textContent).toContain('Hay 3 operaciones pendientes'));
    expect(window.confirm).not.toHaveBeenCalled(); expect(mocks.change).not.toHaveBeenCalled();
  });

  it('Restaurar producción usa la URL oficial y las mismas protecciones', async () => {
    const restore = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Restaurar producción') as HTMLButtonElement;
    await act(async () => restore.click());
    await vi.waitFor(() => expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ active: 'PRODUCCION' }), 'https://api-ar-inversiones.rtdev.uk/api/v1'));
  });

  it('explica que un fallo de fetch puede deberse al origen CORS sin cambiar el servidor', async () => {
    mocks.test.mockRejectedValue(new Error('No se pudo verificar esta API desde este origen. El servidor puede estar disponible, pero este navegador podría no tener permiso CORS.'));
    const testButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Probar conexión') as HTMLButtonElement;
    await act(async () => testButton.click());
    await vi.waitFor(() => expect(container.textContent).toContain('podría no tener permiso CORS'));
    expect(mocks.change).not.toHaveBeenCalled();
  });
});
