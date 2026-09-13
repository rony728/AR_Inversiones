// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMock, formatMoney: (value: unknown) => `L ${Number(value ?? 0).toFixed(2)}` }));
vi.mock('../lib/offline-db', () => ({ cacheList: vi.fn().mockResolvedValue(undefined), getCachedList: vi.fn().mockResolvedValue([]), queueMutation: vi.fn() }));

import { ClientsPage } from './ClientsPage';
import { InventoryAuditPage } from './InventoryAuditPage';
import { LoansPage } from './LoansPage';
import { TransactionPage } from './TransactionPage';

async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }

describe('presentación responsive de módulos operativos', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    vi.stubGlobal('scrollTo', vi.fn());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    apiMock.mockReset();
    vi.unstubAllGlobals();
    document.body.style.overflow = '';
  });

  it.each([
    ['compra' as const, '/compras', 'Proveedor móvil', 'Compras en formato móvil'],
    ['venta' as const, '/ventas', 'Cliente móvil', 'Ventas en formato móvil']
  ])('mantiene tabla y tarjetas accesibles en %s', async (kind, historyPath, contactName, mobileLabel) => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/catalogo/productos') return { data: [] };
      if (path === '/catalogo/socios') return { data: [{ id: 'partner-1', nombre: 'Rony', custodias: [] }] };
      if (path === (kind === 'venta' ? '/catalogo/clientes' : '/catalogo/proveedores')) return { data: [{ id: 'contact-1', nombre: contactName }] };
      if (path === historyPath) return { data: [{ id: 'record-123456', cliente_id: 'contact-1', proveedor_id: 'contact-1', socio_id: 'partner-1', fecha: '2026-09-13', total: 1250, ganancia_total: 250, estado: 'CONFIRMADA', observaciones: 'Entrega coordinada' }] };
      throw new Error(`Ruta inesperada: ${path}`);
    });
    await act(async () => root.render(<TransactionPage kind={kind} />));
    await flush();

    expect(container.querySelector('.transaction-history .desktop-record-table')).toBeTruthy();
    const mobile = container.querySelector(`[aria-label="${mobileLabel}"]`)!;
    expect(mobile).toBeTruthy();
    expect(mobile.textContent).toContain(contactName);
    expect(mobile.textContent).toContain('L 1250.00');
    expect(container.querySelector('.transaction-history-tools input')).toBeTruthy();
  });

  it('presenta clientes como tarjetas sin perder filtros ni acciones', async () => {
    apiMock.mockResolvedValue({ data: [{ id: 'client-1', nombre: 'Cliente móvil', identificacion: '0801', telefono: '9999-0000', activo: true, prestamos_activos: 1, prestamos_vencidos: 0, capital_pendiente_total: 800 }] });
    await act(async () => root.render(<ClientsPage />));
    await flush();

    expect(container.querySelector('.clients-panel .desktop-record-table')).toBeTruthy();
    const mobile = container.querySelector('[aria-label="Clientes en formato móvil"]')!;
    expect(mobile.textContent).toContain('Cliente móvil');
    expect(mobile.textContent).toContain('9999-0000');
    expect([...mobile.querySelectorAll('button')].map((button) => button.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Ver'), expect.stringContaining('Editar')]));
    expect(container.querySelector('.client-search')).toBeTruthy();
    expect(container.querySelector('.client-filters')).toBeTruthy();
  });

  it('presenta préstamos como tarjetas y conserva Ver, Editar y Pago', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/prestamos') return { data: [{ id: 'loan-1', cliente: 'Cliente crédito', cliente_id: 'client-1', cliente_activo: true, socio: 'Rony', socio_id: 'partner-1', custodia_id: 'fund-1', fondo_saldo: 3000, capital_original: 1000, capital_pendiente: 800, intereses_pendientes: 120, periodos_pendientes: 1, total_adeudado: 920, tasa_mensual: 15, fecha_desembolso: '2026-08-13', fecha_proximo_pago: '2026-10-13', estado: 'ACTIVO', es_heredado: false, edicion_habilitada: true, observaciones: null }] };
      if (path === '/catalogo/clientes') return { data: [{ id: 'client-1', nombre: 'Cliente crédito', activo: true }] };
      if (path === '/catalogo/socios') return { data: [{ id: 'partner-1', nombre: 'Rony', activo: true, custodias: [{ id: 'fund-1', actividad: 'PRESTAMOS', saldo_actual: 3000 }] }] };
      throw new Error(`Ruta inesperada: ${path}`);
    });
    await act(async () => root.render(<LoansPage />));
    await flush();

    expect(container.querySelector('.loans-table .desktop-record-table')).toBeTruthy();
    const mobile = container.querySelector('[aria-label="Préstamos en formato móvil"]')!;
    expect(mobile.textContent).toContain('Cliente crédito');
    expect(mobile.textContent).toContain('Capital pendiente');
    expect(mobile.textContent).toContain('Próximo pago');
    expect([...mobile.querySelectorAll('button')].map((button) => button.textContent?.trim())).toEqual(expect.arrayContaining(['Pago', 'Editar', 'Ver']));
    expect(container.querySelector('.loan-tools input')).toBeTruthy();
    expect(container.querySelector('.loan-tools select')).toBeTruthy();
  });

  it('presenta auditorías y sus diferencias en tarjetas móviles', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/catalogo/productos') return { data: [{ id: 'product-1', nombre: 'Café', activo: true }] };
      if (path === '/inventario') return { data: [{ producto_id: 'product-1', existencia: 5 }] };
      if (path === '/auditorias') return { data: [{ id: 'audit-1', fecha_inicio: '2026-09-13T10:30:00', estado: 'APROBADA', productos_contados: 1, diferencias_encontradas: 1, observaciones: 'Conteo de cierre' }] };
      if (path === '/auditorias/audit-1') return { data: { id: 'audit-1', estado: 'APROBADA', detalles: [{ id: 'detail-1', producto: 'Café', existencia_sistema: 5, existencia_fisica: 4, diferencia: -1 }] } };
      throw new Error(`Ruta inesperada: ${path}`);
    });
    await act(async () => root.render(<InventoryAuditPage />));
    await flush();

    const history = container.querySelector('[aria-label="Auditorías en formato móvil"]')!;
    expect(history.textContent).toContain('Inventario');
    expect(history.textContent).toContain('Conteo de cierre');
    expect(container.querySelector('.list-panel .desktop-record-table')).toBeTruthy();
    await act(async () => (history.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(container.querySelector('.audit-detail-cards')?.textContent).toContain('Café');
    expect(container.querySelector('.audit-detail .desktop-record-table')).toBeTruthy();
  });
});
