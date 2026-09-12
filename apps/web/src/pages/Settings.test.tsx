// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Settings } from './Settings';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('navegación de Configuración', () => {
  let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
  beforeEach(async () => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); await act(async () => root.render(<MemoryRouter><Settings /></MemoryRouter>)); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('abre vistas administrativas propias y conserva Categorías', () => {
    const links = Object.fromEntries([...container.querySelectorAll('a')].map((link) => [link.querySelector('h3')?.textContent, link.getAttribute('href')]));
    expect(links.Usuarios).toBe('/configuracion/usuarios');
    expect(links.Socios).toBe('/configuracion/socios');
    expect(links.Categorías).toBe('/configuracion/categorias');
    expect(links.Proveedores).toBe('/configuracion/proveedores');
    expect(Object.values(links)).not.toContain('/custodias');
    expect(Object.values(links)).not.toContain('/compras');
    expect(container.textContent).not.toContain('Sincronización');
  });
});
