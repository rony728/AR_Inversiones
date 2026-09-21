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
const partnerRows = (balances: Record<string, number>) => [
  { id: '44444444-4444-4444-8444-444444444444', nombre: 'Alex', activo: true, custodias: [{ id: 'product-alex', actividad: 'PRODUCTOS', saldo_actual: 91001 }, { id: 'loan-alex', actividad: 'PRESTAMOS', saldo_actual: balances.Alex }] },
  { id: '55555555-5555-4555-8555-555555555555', nombre: 'Brian', activo: true, custodias: [{ id: 'product-brian', actividad: 'PRODUCTOS', saldo_actual: 92002 }, { id: 'loan-brian', actividad: 'PRESTAMOS', saldo_actual: balances.Brian }] },
  { id: partnerId, nombre: 'Rony', activo: true, custodias: [{ id: 'product-rony', actividad: 'PRODUCTOS', saldo_actual: 93003 }, { id: fundId, actividad: 'PRESTAMOS', saldo_actual: balances.Rony }] }
];

async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
function setText(element: HTMLTextAreaElement, value: string) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }
function setInput(element: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }

describe('modales de préstamos', () => {
  let container: HTMLDivElement; let root: ReturnType<typeof createRoot>; let deletedIds: Set<string>; let loanBalances: Record<string, number>; let failPayment: boolean; let failPaymentRefresh: boolean; let paymentPosts: number;
  beforeEach(async () => {
    deletedIds = new Set();
    failPayment = false;
    failPaymentRefresh = false;
    paymentPosts = 0;
    loanBalances = { Alex: 1005, Brian: 5911, Rony: 3000 };
    apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/prestamos') { if (failPaymentRefresh && paymentPosts > 0) throw new Error('No se pudo refrescar la cartera.'); return { data: loans.map((loan) => deletedIds.has(loan.id) ? { ...loan, eliminado_at: '2026-09-11T12:00:00Z', estado_antes_eliminacion: loan.estado, motivo_eliminacion: 'Duplicado de migración' } : loan) }; }
      if (path === '/catalogo/clientes') return { data: [{ id: clientId, nombre: 'Cliente', activo: true }] };
      if (path === '/catalogo/socios') return { data: partnerRows(loanBalances) };
      if (/^\/prestamos\/loan-\d\/liquidacion\?/.test(path)) return { data: { capitalPendiente: 800, interesesPendientes: 120, periodosPendientes: 1, pagoMinimo: 120, totalMaximo: 920, proximaFecha: '2026-10-11', estadoActual: 'ACTIVO' } };
      if (/^\/prestamos\/loan-\d\/pagos$/.test(path) && options?.method === 'POST') { paymentPosts += 1; if (failPayment) throw new Error('No se pudo aplicar el pago.'); return { data: { interes: '120.00', capital: '0.00', montoExtra: '25.00', totalRecibido: '145.00', capitalRestante: '800.00', estado: 'ACTIVO' } }; }
      if (/^\/prestamos\/loan-\d$/.test(path) && options?.method === 'PATCH') { loanBalances.Rony = 2800; return { data: loans[Number(path.at(-1)) - 1] }; }
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

  it('muestra solo el fondo PRESTAMOS de los tres socios desde el catálogo de fondos', () => {
    const funds = container.querySelector('.loan-funds')!;
    expect(funds.querySelectorAll('.loan-fund-card')).toHaveLength(3);
    expect(funds.textContent).toContain('Alex'); expect(funds.textContent).toContain('L 1005.00');
    expect(funds.textContent).toContain('Brian'); expect(funds.textContent).toContain('L 5911.00');
    expect(funds.textContent).toContain('Rony'); expect(funds.textContent).toContain('L 3000.00');
    expect(funds.textContent).not.toContain('L 91001.00'); expect(funds.textContent).not.toContain('L 92002.00'); expect(funds.textContent).not.toContain('L 93003.00');
    expect(apiMock.mock.calls.some(([path]) => path === '/catalogo/socios')).toBe(true);
    expect(funds.querySelector('.loan-funds-grid')).toBeTruthy();
    expect([...funds.querySelectorAll('.loan-fund-card')].every((card) => card.parentElement?.classList.contains('loan-funds-grid'))).toBe(true);
  });

  it('vuelve a consultar los fondos y actualiza las tarjetas después de editar', async () => {
    const middleRow = [...container.querySelectorAll('tbody tr')].find((row) => row.textContent?.includes('Intermedio'))!;
    await act(async () => { (middleRow.querySelector('button') as HTMLButtonElement).click(); });
    const dialog = document.body.querySelector('[role="dialog"]')!;
    await act(async () => setText(dialog.querySelector('textarea[required]')!, 'Capital actualizado'));
    const save = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Guardar edición')) as HTMLButtonElement;
    await act(async () => save.click()); await flush();
    await vi.waitFor(() => expect(container.querySelector('.loan-funds')?.textContent).toContain('L 2800.00'));
    expect(apiMock.mock.calls.filter(([path]) => path === '/catalogo/socios').length).toBeGreaterThanOrEqual(2);
  });

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

  it('abre Registrar pago limpio y cierra por X, Escape y overlay restaurando el scroll', async () => {
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Registrar pago')) as HTMLButtonElement;
    await act(async () => open.click());
    let dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Registrar pago'); expect(document.body.style.overflow).toBe('hidden');
    const amounts = dialog.querySelectorAll('input[type="number"]'); expect((amounts[0] as HTMLInputElement).value).toBe(''); expect((amounts[1] as HTMLInputElement).value).toBe('');
    await act(async () => (dialog.querySelector('.close-button') as HTMLButtonElement).click()); expect(document.body.querySelector('[role="dialog"]')).toBeNull(); expect(document.body.style.overflow).toBe('');
    await act(async () => open.click()); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => open.click()); const overlay = document.body.querySelector('.loan-modal-overlay') as HTMLDivElement; await act(async () => overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); expect(document.body.querySelector('[role="dialog"]')).toBeNull(); expect(window.scrollTo).toHaveBeenCalled();
  });

  it('conserva el submit y el monto extra dentro del modal contextual', async () => {
    const payButton = [...container.querySelectorAll('.mobile-record-actions button')].find((button) => button.textContent?.includes('Pago')) as HTMLButtonElement;
    await act(async () => payButton.click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Total recibido'));
    const dialog = document.body.querySelector('[role="dialog"]')!; const amounts = dialog.querySelectorAll('input[type="number"]');
    await act(async () => setInput(amounts[0] as HTMLInputElement, '120'));
    await act(async () => setInput(amounts[1] as HTMLInputElement, '25'));
    await vi.waitFor(() => expect(dialog.textContent).toContain('L 145.00'));
    const submit = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Aplicar pago')) as HTMLButtonElement;
    expect(submit.type).toBe('submit'); await vi.waitFor(() => expect(submit.disabled).toBe(false)); await act(async () => (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(apiMock.mock.calls.some(([path, options]) => /^\/prestamos\/loan-\d\/pagos$/.test(path) && options?.method === 'POST')).toBe(true));
    const call = apiMock.mock.calls.find(([path, options]) => /^\/prestamos\/loan-\d\/pagos$/.test(path) && options?.method === 'POST');
    expect(JSON.parse(call![1].body)).toMatchObject({ monto: 120, montoExtra: 25 });
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    expect(container.textContent).toContain('Total recibido: L 145.00');
  });

  it('cierra con éxito aunque falle el refresh posterior y no repite el pago', async () => {
    const payButton = [...container.querySelectorAll('.mobile-record-actions button')].find((button) => button.textContent?.includes('Pago')) as HTMLButtonElement;
    await act(async () => payButton.click()); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    const dialog = document.body.querySelector('[role="dialog"]')!; const amount = dialog.querySelector('input[type="number"]') as HTMLInputElement;
    await act(async () => setInput(amount, '120')); failPaymentRefresh = true;
    const form = dialog.querySelector('form') as HTMLFormElement;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(container.textContent).toContain('Pago aplicado:'));
    await vi.waitFor(() => expect(container.textContent).toContain('No se pudo actualizar el listado'));
    expect(paymentPosts).toBe(1); expect(document.body.style.overflow).toBe('');
  });

  it('ignora un segundo submit mientras el POST continúa pendiente', async () => {
    const payButton = [...container.querySelectorAll('.mobile-record-actions button')].find((button) => button.textContent?.includes('Pago')) as HTMLButtonElement;
    await act(async () => payButton.click()); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    const dialog = document.body.querySelector('[role="dialog"]')!; await act(async () => setInput(dialog.querySelector('input[type="number"]') as HTMLInputElement, '120'));
    const form = dialog.querySelector('form') as HTMLFormElement;
    let resolvePost: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { resolvePost = resolve; });
    apiMock.mockImplementationOnce(async () => { paymentPosts += 1; await pending; return { data: { interes: '120.00', capital: '0.00', montoExtra: '0.00', totalRecibido: '120.00', capitalRestante: '800.00', estado: 'ACTIVO' } }; });
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(paymentPosts).toBe(1); expect(dialog.textContent).toContain('Aplicando pago...');
    await act(async () => { resolvePost?.(); await pending; });
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    expect(paymentPosts).toBe(1);
  });

  it('muestra el error del pago dentro del modal y limpia datos al reabrir', async () => {
    const payButton = [...container.querySelectorAll('.mobile-record-actions button')].find((button) => button.textContent?.includes('Pago')) as HTMLButtonElement;
    await act(async () => payButton.click()); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); }); await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeTruthy());
    let dialog = document.body.querySelector('[role="dialog"]')!; const amounts = dialog.querySelectorAll('input[type="number"]');
    await act(async () => setInput(amounts[0] as HTMLInputElement, '120')); failPayment = true;
    const submit = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Aplicar pago')) as HTMLButtonElement;
    await vi.waitFor(() => expect(submit.disabled).toBe(false)); await act(async () => submit.click()); await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('No se pudo aplicar el pago.'));
    await act(async () => (document.body.querySelector('.close-button') as HTMLButtonElement).click());
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Registrar pago')) as HTMLButtonElement; await act(async () => open.click());
    dialog = document.body.querySelector('[role="dialog"]')!; expect((dialog.querySelector('input[type="number"]') as HTMLInputElement).value).toBe(''); expect(dialog.textContent).not.toContain('No se pudo aplicar el pago.');
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
