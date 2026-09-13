// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalStatus } from '../lib/operational-status';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ production: false, status: {} as OperationalStatus }));
vi.mock('../lib/api', () => ({ isProductionApiUrl: () => mocks.production }));
vi.mock('../lib/operational-status', () => ({ useOperationalStatus: () => mocks.status, formatLastSync: () => 'Sincronizado hace 20 s' }));
import { Shell } from './Shell';

const baseStatus: OperationalStatus = { mode: 'online', pending: 0, lastSyncedAt: '2026-09-12T12:00:00.000Z', users: [{ id: '1', nombre: 'Rony' }, { id: '2', nombre: 'Brian' }], now: Date.now() };

describe('cabecera operativa', () => {
  let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
  async function render(status: OperationalStatus = baseStatus) { mocks.status = status; await act(async () => root.render(<MemoryRouter><Shell userName="Rony Turcios" onLogout={vi.fn()}><p>Contenido</p></Shell></MemoryRouter>)); }
  beforeEach(() => { mocks.production = false; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('muestra En línea, PRUEBAS y omite pendientes cuando son cero', async () => {
    await render(); const topbar = container.querySelector('.topbar')!;
    expect(topbar.textContent).toContain('En línea'); expect(topbar.textContent).toContain('PRUEBAS'); expect(topbar.textContent).toContain('Sincronizado hace 20 s'); expect(topbar.textContent).not.toContain('Pendientes:');
  });

  it('muestra Local o Sincronizando y pendientes únicamente cuando existen', async () => {
    await render({ ...baseStatus, mode: 'local', pending: 3, users: [] }); expect(container.querySelector('.topbar')!.textContent).toContain('Local'); expect(container.querySelector('.topbar')!.textContent).toContain('Pendientes: 3'); expect(container.querySelector('.presence-trigger')).toBeNull();
    await render({ ...baseStatus, mode: 'syncing', pending: 2 }); expect(container.querySelector('.topbar')!.textContent).toContain('Sincronizando'); expect(container.querySelector('.topbar')!.textContent).toContain('Pendientes: 2');
  });

  it('no muestra PRUEBAS cuando utiliza la API productiva', async () => {
    mocks.production = true; await render(); expect(container.querySelector('.topbar')!.textContent).not.toContain('PRUEBAS');
  });

  it('abre el popover con nombres y cierra con Escape, clic fuera o navegación', async () => {
    await render(); const trigger = container.querySelector('.presence-trigger') as HTMLButtonElement;
    await act(async () => trigger.click()); expect(document.querySelector('[aria-label="Usuarios activos"]')?.textContent).toContain('Brian');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(document.querySelector('[aria-label="Usuarios activos"]')).toBeNull();
    await act(async () => trigger.click()); await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); expect(document.querySelector('[aria-label="Usuarios activos"]')).toBeNull();
    await act(async () => trigger.click()); const productsLink = [...container.querySelectorAll('a')].find((link) => link.textContent?.includes('Productos')) as HTMLAnchorElement; await act(async () => productsLink.click()); expect(document.querySelector('[aria-label="Usuarios activos"]')).toBeNull();
  });
});
