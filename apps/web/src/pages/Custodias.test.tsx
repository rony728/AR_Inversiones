// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { apiMock, queueMock } = vi.hoisted(() => ({ apiMock: vi.fn(), queueMock: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMock, formatMoney: (value: unknown) => `L ${Number(value ?? 0).toFixed(2)}` }));
vi.mock('../lib/offline-db', () => ({ queueMutation: queueMock }));
import { Custodias } from './Custodias';

const alex = '11111111-1111-4111-8111-111111111111'; const brian = '22222222-2222-4222-8222-222222222222'; const rony = '33333333-3333-4333-8333-333333333333';
let balances: Record<string, number>;
const rows = () => [
  { id: alex, nombre: 'Alex', custodias: [{ id: 'alex-products', actividad: 'PRODUCTOS', saldo_actual: balances['alex-products'], socio_id: alex }, { id: 'alex-loans', actividad: 'PRESTAMOS', saldo_actual: balances['alex-loans'], socio_id: alex }] },
  { id: brian, nombre: 'Brian', custodias: [{ id: 'brian-products', actividad: 'PRODUCTOS', saldo_actual: balances['brian-products'], socio_id: brian }, { id: 'brian-loans', actividad: 'PRESTAMOS', saldo_actual: balances['brian-loans'], socio_id: brian }] },
  { id: rony, nombre: 'Rony', custodias: [{ id: 'rony-products', actividad: 'PRODUCTOS', saldo_actual: balances['rony-products'], socio_id: rony }, { id: 'rony-loans', actividad: 'PRESTAMOS', saldo_actual: balances['rony-loans'], socio_id: rony }] }
];
function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) { const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }

describe('administración de fondos', () => {
  let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
  beforeEach(async () => {
    balances = { 'alex-products': 1000, 'alex-loans': 2000, 'brian-products': 3000, 'brian-loans': 4000, 'rony-products': 5000, 'rony-loans': 6000 };
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/catalogo/socios') return { data: rows() };
      if (path === '/transferencias-custodia' && options?.method === 'POST') { const input = JSON.parse(String(options.body)); balances[input.custodiaOrigenId] -= input.monto; balances[input.custodiaDestinoId] += input.monto; return { data: {} }; }
      if (path === '/ajustes-fondo' && options?.method === 'POST') { const input = JSON.parse(String(options.body)); balances[input.custodiaId] = input.nuevoSaldo; return { data: {} }; }
      throw new Error(`Ruta inesperada: ${path}`);
    });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); await act(async () => root.render(<Custodias />)); await flush();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); apiMock.mockReset(); queueMock.mockReset(); vi.restoreAllMocks(); document.body.style.overflow = ''; });

  it('muestra los dos fondos de los tres socios en tarjetas responsive', () => {
    expect(container.querySelectorAll('.custody-card')).toHaveLength(3); expect(container.textContent).toContain('Alex'); expect(container.textContent).toContain('Brian'); expect(container.textContent).toContain('Rony'); expect(container.querySelector('.custody-grid')).toBeTruthy(); expect(container.querySelectorAll('button')).toHaveLength(7);
  });

  it('transfiere entre socios y actividades, conserva el total y recarga el catálogo', async () => {
    const before = Object.values(balances).reduce((sum, value) => sum + value, 0); const transferButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Transferir')!; await act(async () => (transferButton as HTMLButtonElement).click());
    const dialog = document.body.querySelector('[role="dialog"]')!; const selects = dialog.querySelectorAll('select'); await act(async () => { setValue(selects[2], brian); setValue(selects[3], 'PRESTAMOS'); setValue(dialog.querySelector('input')!, '250'); setValue(dialog.querySelector('textarea')!, 'Redistribución entre socios'); });
    await act(async () => (dialog.querySelector('form') as HTMLFormElement).requestSubmit()); await flush();
    const request = apiMock.mock.calls.find(([path]) => path === '/transferencias-custodia'); expect(request).toBeTruthy(); const payload = JSON.parse(request![1].body); expect(payload).toMatchObject({ socioOrigenId: alex, custodiaOrigenId: 'alex-products', socioDestinoId: brian, custodiaDestinoId: 'brian-loans', monto: 250 }); expect(balances['alex-products']).toBe(750); expect(balances['brian-loans']).toBe(4250); expect(Object.values(balances).reduce((sum, value) => sum + value, 0)).toBe(before); expect(apiMock.mock.calls.filter(([path]) => path === '/catalogo/socios').length).toBeGreaterThanOrEqual(2);
  });

  it('ajusta un saldo con motivo, muestra la diferencia y recarga la fuente de verdad', async () => {
    const adjustButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Ajustar saldo'))!; await act(async () => (adjustButton as HTMLButtonElement).click()); const dialog = document.body.querySelector('[role="dialog"]')!; const input = dialog.querySelector('input')!; const textarea = dialog.querySelector('textarea')!;
    await act(async () => { setValue(input, '1250'); setValue(textarea, 'Diferencia encontrada en efectivo'); }); expect(dialog.textContent).toContain('Aumenta L 250.00'); await act(async () => (dialog.querySelector('form') as HTMLFormElement).requestSubmit()); await flush();
    const request = apiMock.mock.calls.find(([path]) => path === '/ajustes-fondo'); expect(request).toBeTruthy(); expect(JSON.parse(request![1].body)).toMatchObject({ socioId: alex, custodiaId: 'alex-products', nuevoSaldo: 1250, motivo: 'Diferencia encontrada en efectivo' }); expect(container.textContent).toContain('L 1250.00'); expect(apiMock.mock.calls.filter(([path]) => path === '/catalogo/socios').length).toBeGreaterThanOrEqual(2);
  });
});
