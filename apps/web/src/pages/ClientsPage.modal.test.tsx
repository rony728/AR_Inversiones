// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMock, formatMoney: (value: unknown) => `L ${Number(value ?? 0).toFixed(2)}` }));
vi.mock('../lib/offline-db', () => ({ cacheList: vi.fn().mockResolvedValue(undefined), getCachedList: vi.fn().mockResolvedValue([]) }));

import { ClientsPage } from './ClientsPage';

const client = { id: 'client-1', nombre: 'Cliente modal', identificacion: '0801-2000', telefono: '9999-0000', direccion: 'Dirección de prueba', notas: 'Cliente frecuente', activo: true, prestamos_activos: 1, prestamos_vencidos: 0, capital_pendiente_total: 800, created_at: '2026-01-10T12:00:00Z', updated_at: '2026-09-10T12:00:00Z' };
const detail = {
  cliente: client,
  resumen: { prestamosActivos: 1, prestamosVencidos: 0, capitalPendienteTotal: 800, prestamosPagados: 2, cantidadVentas: 3, totalVendido: 2500 },
  prestamos: [{ id: 'loan-1', fecha_desembolso: '2026-08-01', capital_original: '1000', capital_pendiente: '800', tasa_mensual: '15', fecha_proximo_pago: '2026-10-01', estado: 'ACTIVO' }],
  ventas: [{ id: 'sale-1', fecha: '2026-09-01', total: '500', ganancia_total: '100', estado: 'CONFIRMADA' }]
};

async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
function rowButton(container: ParentNode, text: string) { return [...container.querySelectorAll('.clients-table tbody button')].find((button) => button.textContent?.includes(text)) as HTMLButtonElement; }
function setInput(input: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }

describe('modales de Clientes', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/catalogo/clientes/client-1' && options?.method === 'PATCH') return { data: { id: client.id } };
      if (path === '/catalogo/clientes/client-1') return { data: detail };
      if (path === '/catalogo/clientes') return { data: [client] };
      throw new Error(`Ruta inesperada: ${path}`);
    });
    vi.stubGlobal('scrollTo', vi.fn());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<ClientsPage />));
    await flush();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    apiMock.mockReset();
    vi.unstubAllGlobals();
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  });

  it('abre Ver en modal con perfil, resumen e historiales y cierra con X', async () => {
    await act(async () => rowButton(container, 'Ver').click());
    await flush();

    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Cliente modal');
    expect(dialog.textContent).toContain('Dirección de prueba');
    expect(dialog.textContent).toContain('Préstamos activos');
    expect(dialog.textContent).toContain('Préstamos');
    expect(dialog.textContent).toContain('Ventas');
    expect(document.body.style.overflow).toBe('hidden');

    await act(async () => (dialog.querySelector('[aria-label="Cerrar detalle"]') as HTMLButtonElement).click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('abre Editar en modal y conserva el mismo endpoint y formulario de guardado', async () => {
    await act(async () => rowButton(container, 'Editar').click());
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toContain('Editar cliente');
    expect(document.body.style.overflow).toBe('hidden');

    const name = dialog.querySelector('input[required]') as HTMLInputElement;
    await act(async () => setInput(name, 'Cliente actualizado'));
    const save = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Guardar cliente')) as HTMLButtonElement;
    expect(save.type).toBe('submit');
    await act(async () => save.click());
    await flush();

    const update = apiMock.mock.calls.find(([path, options]) => path === '/catalogo/clientes/client-1' && options?.method === 'PATCH');
    expect(update).toBeTruthy();
    expect(JSON.parse(String(update![1].body)).nombre).toBe('Cliente actualizado');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('Cliente actualizado correctamente.');
  });

  it('permite cerrar sin guardar mediante Escape y clic en el overlay', async () => {
    await act(async () => rowButton(container, 'Editar').click());
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);

    await act(async () => rowButton(container, 'Ver').click());
    await flush();
    const overlay = document.body.querySelector('.client-modal-overlay') as HTMLDivElement;
    await act(async () => overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('.mobile-record-list')).toBeTruthy();
  });
});
