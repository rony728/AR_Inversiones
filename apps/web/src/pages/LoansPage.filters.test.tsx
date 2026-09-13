// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMock, formatMoney: (value: unknown) => `L ${Number(value ?? 0).toFixed(2)}` }));
vi.mock('../lib/offline-db', () => ({ cacheList: vi.fn().mockResolvedValue(undefined), getCachedList: vi.fn().mockResolvedValue([]), queueMutation: vi.fn() }));

import { LoansPage } from './LoansPage';

const loan = (id: string, cliente: string, socio: string, estado: 'ACTIVO' | 'VENCIDO') => ({ id, cliente, cliente_id: `client-${id}`, socio, socio_id: `partner-${socio}`, custodia_id: `fund-${socio}`, fondo_saldo: 5000, cliente_activo: true, capital_original: 1000, capital_pendiente: 800, intereses_pendientes: 120, periodos_pendientes: 1, total_adeudado: 920, tasa_mensual: 15, fecha_desembolso: '2026-08-01', fecha_proximo_pago: '2026-12-01', estado, es_heredado: false, observaciones: null });
const loans = [
  loan('1', 'Alicia', 'Alex', 'VENCIDO'),
  loan('2', 'Alice', 'Alex', 'ACTIVO'),
  loan('3', 'Bruno Alex', 'Alex', 'ACTIVO'),
  loan('4', 'Bruno Brian', 'Brian', 'ACTIVO'),
  loan('5', 'Rosa', 'Rony', 'ACTIVO')
];

async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
function setSelect(select: HTMLSelectElement, value: string) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); }
function setSearch(input: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }

describe('filtro por socio en Préstamos', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/prestamos') return { data: loans };
      if (path === '/catalogo/clientes') return { data: loans.map((item) => ({ id: item.cliente_id, nombre: item.cliente, activo: true })) };
      if (path === '/catalogo/socios') return { data: ['Alex', 'Brian', 'Rony'].map((nombre) => ({ id: `partner-${nombre}`, nombre, activo: true, custodias: [{ id: `fund-${nombre}`, actividad: 'PRESTAMOS', saldo_actual: 5000 }] })) };
      throw new Error(`Ruta inesperada: ${path}`);
    });
    vi.stubGlobal('scrollTo', vi.fn());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<LoansPage />));
    await flush();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    apiMock.mockReset();
    vi.unstubAllGlobals();
  });

  const tableText = () => container.querySelector('.loans-table tbody')?.textContent ?? '';
  const countText = () => container.querySelector('.loan-tools > strong')?.textContent ?? '';
  const partnerSelect = () => container.querySelector('select[aria-label="Socio"]') as HTMLSelectElement;
  const stateSelect = () => container.querySelector('select[aria-label="Estado"]') as HTMLSelectElement;

  it('genera socios únicos y filtra por uno de ellos', async () => {
    expect([...partnerSelect().options].map((option) => option.text)).toEqual(['TODOS', 'Alex', 'Brian', 'Rony']);
    await act(async () => setSelect(partnerSelect(), 'Brian'));
    expect(tableText()).toContain('Bruno Brian');
    expect(tableText()).not.toContain('Alice');
    expect(tableText()).not.toContain('Rosa');
  });

  it('TODOS restaura los préstamos de todos los socios', async () => {
    await act(async () => setSelect(partnerSelect(), 'Alex'));
    await act(async () => setSelect(partnerSelect(), 'TODOS'));
    expect(tableText()).toContain('Alice');
    expect(tableText()).toContain('Bruno Brian');
    expect(tableText()).toContain('Rosa');
  });

  it('combina Socio y Estado', async () => {
    await act(async () => { setSelect(partnerSelect(), 'Alex'); setSelect(stateSelect(), 'VENCIDO'); });
    expect(tableText()).toContain('Alicia');
    expect(tableText()).not.toContain('Alice');
    expect(countText()).toBe('1 de 5 préstamos');
  });

  it('combina Socio y búsqueda por cliente', async () => {
    await act(async () => { setSelect(partnerSelect(), 'Brian'); setSearch(container.querySelector('.loan-tools .search input') as HTMLInputElement, 'Bruno'); });
    expect(tableText()).toContain('Bruno Brian');
    expect(tableText()).not.toContain('Bruno Alex');
    expect(countText()).toBe('1 de 5 préstamos');
  });

  it('actualiza el contador con todos los filtros combinados', async () => {
    await act(async () => { setSelect(partnerSelect(), 'Alex'); setSelect(stateSelect(), 'ACTIVO'); });
    expect(countText()).toBe('2 de 5 préstamos');
  });
});
