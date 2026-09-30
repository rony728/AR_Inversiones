// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMock, formatMoney: (value: unknown) => `L ${Number(value ?? 0).toFixed(2)}` }));
vi.mock('../lib/offline-db', () => ({ cacheList: vi.fn().mockResolvedValue(undefined), getCachedList: vi.fn().mockResolvedValue([]), queueMutation: vi.fn() }));

import { InventoryAuditPage } from './InventoryAuditPage';

async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

describe('valorización histórica de inventario', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let cost: number;

  beforeEach(async () => {
    cost = 0;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/catalogo/productos') return { data: [{ id: 'product-1', codigo: 'HIS-1', nombre: 'Producto heredado', activo: true, costo_promedio: cost }] };
      if (path === '/inventario') return { data: [{ producto_id: 'product-1', existencia: 4, costo_promedio_unitario: cost }] };
      if (path === '/auditorias') return { data: [] };
      if (path === '/inventario/valorizacion-historica' && options?.method === 'POST') {
        cost = 125.25;
        return { data: { id: 'valuation-1' } };
      }
      throw new Error(`Ruta inesperada: ${path}`);
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<InventoryAuditPage />));
    await flush();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    apiMock.mockReset();
  });

  it('muestra advertencia, datos actuales y registra costo sin enviar una cantidad nueva', async () => {
    const form = container.querySelector('.historical-valuation-form') as HTMLFormElement;
    expect(form.textContent).toContain('no modifica la cantidad de inventario ni genera una compra');
    const select = form.querySelector('select')!;
    await act(async () => setValue(select, 'product-1'));
    expect([...form.querySelectorAll<HTMLInputElement>('input[readonly]')].map((item) => item.value)).toEqual(['4', 'L 0.00']);
    await act(async () => {
      setValue(form.querySelector('input[type="number"]')!, '125.25');
      setValue(form.querySelector('textarea')!, 'Inventario anterior a producción');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    const request = apiMock.mock.calls.find(([path, options]) => path === '/inventario/valorizacion-historica' && options?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      productoId: 'product-1',
      existenciaEsperada: 4,
      costoUnitario: 125.25,
      motivo: 'Inventario anterior a producción',
    });
    expect(JSON.parse(String(request?.[1]?.body))).not.toHaveProperty('existenciaNueva');
    expect(form.textContent).toContain('La existencia física no fue modificada');
    expect(apiMock.mock.calls.filter(([path]) => path === '/inventario').length).toBe(2);
    expect([...form.querySelectorAll<HTMLInputElement>('input[readonly]')].map((item) => item.value)).toEqual(['4', 'L 125.25']);
  });

  it('muestra el rechazo de inventario desactualizado y conserva los datos para corregir', async () => {
    const form = container.querySelector('.historical-valuation-form') as HTMLFormElement;
    await act(async () => {
      setValue(form.querySelector('select')!, 'product-1');
      setValue(form.querySelector('input[type="number"]')!, '80');
      setValue(form.querySelector('textarea')!, 'Costo histórico comprobado');
    });
    apiMock.mockRejectedValueOnce(new Error('La existencia cambió. Actualiza la información antes de valorizar.'));
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(form.textContent).toContain('La existencia cambió');
    expect((form.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('80');
  });
});
