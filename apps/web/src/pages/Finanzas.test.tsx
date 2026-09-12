// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMock, formatMoney: (value: unknown) => `L ${Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }));
vi.mock('../lib/offline-db', () => ({ cacheList: vi.fn(), getCachedList: vi.fn().mockResolvedValue([]), queueMutation: vi.fn() }));
import { distributionSharePreview, Finanzas } from './Finanzas';

const partners = ['Alex', 'Brian', 'Rony'].map((nombre, index) => ({ id: `partner-${index}`, nombre, custodias: [{ id: `fund-${index}`, actividad: 'PRODUCTOS', saldo_actual: '5000.00' }] }));
function setInput(input: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }

describe('vista previa de distribución de utilidad', () => {
  let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
  beforeEach(async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    apiMock.mockImplementation(async (path: string) => path === '/catalogo/socios' ? { data: partners } : path === '/movimientos-financieros' ? { data: [] } : path === '/distribuciones' ? { data: { id: 'distribution-1' } } : Promise.reject(new Error(`Ruta inesperada: ${path}`)));
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); await act(async () => root.render(<Finanzas />)); await flush();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); apiMock.mockReset(); vi.restoreAllMocks(); });

  it('muestra 3000 como L 1,000.00 y se actualiza inmediatamente', async () => {
    const input = container.querySelector('.distribution-form input[type="number"]') as HTMLInputElement; const output = container.querySelector('.distribution-share output') as HTMLOutputElement;
    expect(output.textContent).toBe('L 0.00'); expect(output instanceof HTMLInputElement).toBe(false);
    await act(async () => setInput(input, '3000')); expect(output.textContent).toBe('L 1,000.00');
    await act(async () => setInput(input, '600')); expect(output.textContent).toBe('L 200.00');
    await act(async () => setInput(input, '')); expect(output.textContent).toBe('L 0.00');
    await act(async () => setInput(input, '0')); expect(output.textContent).toBe('L 0.00');
  });

  it('usa centavos exactos como el backend y avisa si no son divisibles', async () => {
    expect(distributionSharePreview('100.02')).toEqual({ amount: 33.34, divisible: true }); expect(distributionSharePreview('100')).toEqual({ amount: 0, divisible: false });
    const input = container.querySelector('.distribution-form input[type="number"]') as HTMLInputElement; await act(async () => setInput(input, '100.02')); expect(container.querySelector('.distribution-share output')?.textContent).toBe('L 33.34');
    await act(async () => setInput(input, '100')); expect(container.querySelector('.distribution-share output')?.textContent).toBe('No divisible exactamente'); expect(container.querySelector('.distribution-share small')?.textContent).toContain('centavos exactos');
  });

  it('conserva el payload y comportamiento de confirmación existente', async () => {
    const form = container.querySelector('.distribution-form') as HTMLFormElement; const input = form.querySelector('input[type="number"]') as HTMLInputElement; await act(async () => setInput(input, '3000')); await act(async () => form.requestSubmit()); await flush();
    const request = apiMock.mock.calls.find(([path]) => path === '/distribuciones'); expect(request).toBeTruthy(); const payload = JSON.parse(request![1].body); expect(payload.utilidadTotal).toBe(3000); expect(payload.socios).toHaveLength(3); expect(container.textContent).toContain('Distribución registrada con cuotas trazables.'); expect(container.querySelector('.distribution-share output')?.textContent).toBe('L 0.00');
  });
});
