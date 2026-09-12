// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMock, formatMoney: (value: unknown) => `L ${Number(value ?? 0).toFixed(2)}` }));
vi.mock('../lib/offline-db', () => ({ cacheList: vi.fn().mockResolvedValue(undefined), getCachedList: vi.fn().mockResolvedValue([]), queueMutation: vi.fn() }));

import { LoansPage } from './LoansPage';

const partnerId = '11111111-1111-4111-8111-111111111111';
const fundId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const loans = ['Primero', 'Intermedio', 'Último'].map((cliente, index) => ({ id: `loan-${index + 1}`, cliente, cliente_id: clientId, socio: 'Rony', socio_id: partnerId, custodia_id: fundId, fondo_saldo: 5000, cliente_activo: true, capital_original: 1000, capital_pendiente: 800, intereses_pendientes: 120, periodos_pendientes: 1, total_adeudado: 920, tasa_mensual: 15, fecha_desembolso: null, fecha_proximo_pago: '2026-10-11', estado: 'ACTIVO', es_heredado: index !== 1, edicion_habilitada: true, observaciones: null }));
const detail = (index: number) => ({ prestamo: loans[index], intereses: [], pagos: [], reprogramaciones: [], recuperaciones: [], anulacion: null, auditoria: [] });

async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
function setText(element: HTMLTextAreaElement, value: string) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }

describe('modales de préstamos', () => {
  let container: HTMLDivElement; let root: ReturnType<typeof createRoot>; let deletedIds: Set<string>;
  beforeEach(async () => {
    deletedIds = new Set();
    apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/prestamos') return { data: loans.map((loan) => deletedIds.has(loan.id) ? { ...loan, eliminado_at: '2026-09-11T12:00:00Z', estado_antes_eliminacion: loan.estado, motivo_eliminacion: 'Duplicado de migración' } : loan) };
      if (path === '/catalogo/clientes') return { data: [{ id: clientId, nombre: 'Cliente', activo: true }] };
      if (path === '/catalogo/socios') return { data: [{ id: partnerId, nombre: 'Rony', activo: true, custodias: [{ id: fundId, actividad: 'PRESTAMOS', saldo_actual: 5000 }] }] };
      if (/^\/prestamos\/loan-\d$/.test(path) && options?.method === 'PATCH') return { data: loans[Number(path.at(-1)) - 1] };
      if (/^\/prestamos\/loan-\d\/eliminar$/.test(path) && options?.method === 'POST') { deletedIds.add(path.split('/')[2]); return { data: { id: path.split('/')[2] } }; }
      if (/^\/prestamos\/loan-\d$/.test(path)) { const value = detail(Number(path.at(-1)) - 1); return { data: deletedIds.has(value.prestamo.id) ? { ...value, prestamo: { ...value.prestamo, eliminado_at: '2026-09-11T12:00:00Z', estado_antes_eliminacion: value.prestamo.estado, motivo_eliminacion: 'Duplicado de migración' } } : value }; }
      throw new Error(`Ruta inesperada: ${path}`);
    });
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('scrollTo', vi.fn());
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<LoansPage />); }); await flush();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); apiMock.mockReset(); document.body.style.overflow = ''; });

  it('envía desde el modal intermedio el mismo PATCH y muestra la confirmación', async () => {
    const middleRow = [...container.querySelectorAll('tbody tr')].find((row) => row.textContent?.includes('Intermedio'))!;
    await act(async () => { (middleRow.querySelector('button') as HTMLButtonElement).click(); });
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog).toBeTruthy(); expect(document.body.style.overflow).toBe('hidden');
    let save = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Guardar edición')) as HTMLButtonElement;
    expect(dialog.textContent).toContain('Debes indicar un motivo de al menos 3 caracteres para habilitar el guardado.');
    expect(save.disabled).toBe(true);
    await act(async () => setText(dialog.querySelector('textarea[required]')!, 'No'));
    expect(save.disabled).toBe(true);
    await act(async () => setText(dialog.querySelector('textarea[required]')!, 'Corrección verificada'));
    save = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Guardar edición')) as HTMLButtonElement;
    expect(dialog.textContent).not.toContain('Debes indicar un motivo de al menos 3 caracteres para habilitar el guardado.');
    expect(save.type).toBe('submit'); expect(save.disabled).toBe(false);
    expect((dialog.querySelector('form') as HTMLFormElement).checkValidity()).toBe(true);
    await act(async () => save.click()); await flush();
    expect(window.confirm).toHaveBeenCalled();
    await vi.waitFor(() => expect(apiMock.mock.calls.some(([path, options]) => path === '/prestamos/loan-2' && options?.method === 'PATCH')).toBe(true));
    const patch = apiMock.mock.calls.find(([path, options]) => path === '/prestamos/loan-2' && options?.method === 'PATCH');
    expect(patch).toBeTruthy(); expect(JSON.parse(patch![1].body).motivo).toBe('Corrección verificada');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('Préstamo editado y registrado en auditoría.');
  });

  it('muestra dentro del modal el error del guardado y permite corregirlo', async () => {
    const middleRow = [...container.querySelectorAll('tbody tr')].find((row) => row.textContent?.includes('Intermedio'))!;
    await act(async () => { (middleRow.querySelector('button') as HTMLButtonElement).click(); });
    const dialog = document.body.querySelector('[role="dialog"]')!;
    await act(async () => setText(dialog.querySelector('textarea[required]')!, 'Corrección verificada'));
    apiMock.mockImplementationOnce(async () => { throw new Error('No se pudo guardar la corrección.'); });
    const save = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Guardar edición')) as HTMLButtonElement;
    await act(async () => save.click());
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('No se pudo guardar la corrección.'));
  });

  it('permite cerrar sin guardar y mantiene operativo el detalle', async () => {
    const editButtons = [...container.querySelectorAll('button')].filter((button) => button.textContent?.includes('Editar'));
    await act(async () => { (editButtons[2] as HTMLButtonElement).click(); });
    const correctionDialog = document.body.querySelector('[role="dialog"]')!;
    await act(async () => (correctionDialog.querySelector('.close-button') as HTMLButtonElement).click());
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
    const viewButtons = [...container.querySelectorAll('button')].filter((button) => button.textContent?.includes('Ver'));
    await act(async () => { (viewButtons[0] as HTMLButtonElement).click(); }); await flush();
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Intereses por período');
  });

  it('retira un préstamo nuevo y lo conserva consultable sin acciones operativas', async () => {
    const row = [...container.querySelectorAll('tbody tr')].find((item) => item.textContent?.includes('Intermedio'))!;
    const view = [...row.querySelectorAll('button')].find((button) => button.textContent?.includes('Ver')) as HTMLButtonElement;
    await act(async () => view.click()); await flush();
    let dialog = document.body.querySelector('[role="dialog"]')!;
    const remove = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Eliminar') as HTMLButtonElement;
    await act(async () => remove.click());
    dialog = document.body.querySelector('[role="dialog"]')!;
    await act(async () => setText(dialog.querySelector('.loan-action-form textarea')!, 'Duplicado de migración'));
    const confirm = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Confirmar acción')) as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(window.confirm).toHaveBeenCalledWith('¿Confirmas que deseas retirar este préstamo de la cartera? El registro se conservará en Eliminados para auditoría.');
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('ELIMINADO'));
    expect(apiMock.mock.calls.some(([path, options]) => path === '/prestamos/loan-2/eliminar' && options?.method === 'POST')).toBe(true);
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Duplicado de migración');
    expect([...document.body.querySelectorAll('[role="dialog"] button')].some((button) => ['Editar datos', 'Reprogramar', 'Eliminar'].includes(button.textContent ?? ''))).toBe(false);
    await act(async () => (document.body.querySelector('[role="dialog"] .close-button') as HTMLButtonElement).click());
    const filter = container.querySelector('.loan-tools select') as HTMLSelectElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(filter, 'ELIMINADO'); filter.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelector('tbody')?.textContent).toContain('Intermedio');
    expect(container.querySelector('tbody')?.textContent).toContain('ELIMINADO');
  });
});
