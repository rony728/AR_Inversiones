// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api', () => ({
  api: apiMock,
  formatMoney: (value: unknown) => `L ${Number(value ?? 0).toFixed(2)}`,
}));

import { Dashboard } from './Dashboard';

const dashboardData = {
  periodo: { desde: '2026-09-01', hasta: '2026-09-30' },
  indicadores: {
    ventas: 100,
    gananciaProductos: 25,
    gananciaPrestamos: 0,
    gastosProductos: 0,
    gastosPrestamos: 0,
    intereses: 0,
    capitalPrestadoActual: 0,
    prestamosVencidos: 0,
    fondosTotales: 100,
    valorInventario: 50,
  },
  resultado: {
    PRODUCTOS: { ingresos: 100, gastos: 0, gananciaOperativa: 25 },
    PRESTAMOS: { ingresos: 0, gastos: 0, gananciaOperativa: 0, perdidas: 0 },
  },
  actividad: [{
    id: 'sale-1',
    tipo: 'VENTA',
    fecha: '2026-09-22',
    monto: '100',
    descripcion: 'Venta confirmada',
    socio: 'Brian',
    productos: 'Samsung A15, Cargador',
  }],
};

describe('actividad reciente del Dashboard', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    apiMock.mockResolvedValue({ data: dashboardData });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    apiMock.mockReset();
  });

  it('muestra los productos reales y el socio de una venta', async () => {
    await act(async () => root.render(<MemoryRouter><Dashboard /></MemoryRouter>));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    const activity = container.querySelector('.recent-activity')?.textContent;
    expect(activity).toContain('Venta · Samsung A15, Cargador');
    expect(activity).toContain('Venta confirmada · Socio: Brian');
  });
});
