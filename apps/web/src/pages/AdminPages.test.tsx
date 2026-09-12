// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMock, formatMoney: (value: unknown) => `L ${Number(value).toFixed(2)}` }));
import { PartnersPage } from './PartnersPage';
import { ProvidersPage } from './ProvidersPage';
import { UsersPage } from './UsersPage';

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }
function button(container: HTMLElement, text: string) { return [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text)) as HTMLButtonElement; }
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }

describe('vistas administrativas', () => {
  let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); apiMock.mockReset(); });

  it('administra usuarios sin exponer credenciales', async () => {
    let users = [{ id: 'user-1', nombre: 'Rony', usuario: 'rony', activo: true }];
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/catalogo/usuarios' && !options) return { data: users };
      if (path === '/catalogo/usuarios' && options?.method === 'POST') return { data: { id: 'user-2' } };
      if (path === '/catalogo/usuarios/user-1' && options?.method === 'PATCH') { const body = JSON.parse(String(options.body)); users = [{ ...users[0], ...body }]; return { data: users[0] }; }
      if (path === '/catalogo/usuarios/user-1/password') return { data: { id: 'user-1', passwordChanged: true } };
      throw new Error(`Ruta inesperada: ${path}`);
    });
    await act(async () => root.render(<MemoryRouter><UsersPage /></MemoryRouter>)); await flush();
    expect(container.textContent).toContain('Rony'); expect(container.innerHTML).not.toContain('password_hash');

    const createInputs = container.querySelectorAll('form.admin-form input');
    await act(async () => { setInput(createInputs[0] as HTMLInputElement, 'Alex'); setInput(createInputs[1] as HTMLInputElement, 'alex'); setInput(createInputs[2] as HTMLInputElement, 'secreto-seguro'); });
    await act(async () => (container.querySelector('form.admin-form') as HTMLFormElement).requestSubmit()); await flush();
    expect(apiMock.mock.calls.some(([path, options]) => path === '/catalogo/usuarios' && options?.method === 'POST' && JSON.parse(options.body).password === 'secreto-seguro')).toBe(true);

    await act(async () => button(container, 'Editar').click());
    const editName = container.querySelector('form.admin-form input') as HTMLInputElement; await act(async () => setInput(editName, 'Rony Actualizado'));
    await act(async () => (container.querySelector('form.admin-form') as HTMLFormElement).requestSubmit()); await flush();
    expect(apiMock.mock.calls.some(([path, options]) => path === '/catalogo/usuarios/user-1' && JSON.parse(options.body).nombre === 'Rony Actualizado')).toBe(true);

    await act(async () => button(container, 'Desactivar').click()); await flush();
    expect(apiMock.mock.calls.some(([path, options]) => path === '/catalogo/usuarios/user-1' && JSON.parse(options.body).activo === false)).toBe(true);
    await act(async () => button(container, 'Contraseña').click());
    const password = container.querySelector('.password-form input') as HTMLInputElement; await act(async () => setInput(password, 'otra-clave-segura'));
    await act(async () => (container.querySelector('.password-form') as HTMLFormElement).requestSubmit()); await flush();
    expect(apiMock.mock.calls.some(([path, options]) => path === '/catalogo/usuarios/user-1/password' && JSON.parse(options.body).password === 'otra-clave-segura')).toBe(true);
  });

  it('edita solo el nombre del socio y mantiene sus fondos asociados', async () => {
    let partners = [{ id: 'partner-1', nombre: 'Alex', activo: true, custodias: [{ id: 'products-1', actividad: 'PRODUCTOS', saldo_actual: '100' }, { id: 'loans-1', actividad: 'PRESTAMOS', saldo_actual: '200' }] }];
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/catalogo/socios' && !options) return { data: partners };
      if (path === '/catalogo/socios/partner-1') { const body = JSON.parse(String(options?.body)); partners = [{ ...partners[0], nombre: body.nombre }]; return { data: partners[0] }; }
      throw new Error(`Ruta inesperada: ${path}`);
    });
    await act(async () => root.render(<MemoryRouter><PartnersPage /></MemoryRouter>)); await flush();
    expect(container.textContent).toContain('PRODUCTOS'); expect(container.textContent).toContain('PRESTAMOS');
    await act(async () => button(container, 'Editar').click()); const input = container.querySelector('.admin-form input') as HTMLInputElement;
    await act(async () => setInput(input, 'Alejandro')); await act(async () => (container.querySelector('.admin-form') as HTMLFormElement).requestSubmit()); await flush();
    const request = apiMock.mock.calls.find(([path, options]) => path === '/catalogo/socios/partner-1' && options?.method === 'PATCH');
    expect(JSON.parse(request![1].body)).toEqual({ nombre: 'Alejandro' }); expect(container.textContent).toContain('PRODUCTOS'); expect(container.textContent).toContain('PRESTAMOS');
  });

  it('crea, edita y desactiva proveedores sin ofrecer eliminación', async () => {
    let providers = [{ id: 'provider-1', nombre: 'Proveedor Uno', identificacion: null, telefono: null, direccion: null, activo: true }];
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/catalogo/proveedores' && !options) return { data: providers };
      if (path === '/catalogo/proveedores' && options?.method === 'POST') return { data: { id: 'provider-2' } };
      if (path === '/catalogo/proveedores/provider-1') { const body = JSON.parse(String(options?.body)); providers = [{ ...providers[0], ...body }]; return { data: providers[0] }; }
      throw new Error(`Ruta inesperada: ${path}`);
    });
    await act(async () => root.render(<MemoryRouter><ProvidersPage /></MemoryRouter>)); await flush();
    expect(container.textContent).not.toContain('Eliminar'); const inputs = container.querySelectorAll('.admin-form input');
    await act(async () => setInput(inputs[0] as HTMLInputElement, 'Proveedor Dos')); await act(async () => (container.querySelector('.admin-form') as HTMLFormElement).requestSubmit()); await flush();
    expect(apiMock.mock.calls.some(([path, options]) => path === '/catalogo/proveedores' && options?.method === 'POST')).toBe(true);
    await act(async () => button(container, 'Editar').click()); const editName = container.querySelector('.admin-form input') as HTMLInputElement; await act(async () => setInput(editName, 'Proveedor Editado'));
    await act(async () => (container.querySelector('.admin-form') as HTMLFormElement).requestSubmit()); await flush();
    expect(apiMock.mock.calls.some(([path, options]) => path === '/catalogo/proveedores/provider-1' && JSON.parse(options.body).nombre === 'Proveedor Editado')).toBe(true);
    await act(async () => button(container, 'Desactivar').click()); await flush();
    expect(apiMock.mock.calls.some(([path, options]) => path === '/catalogo/proveedores/provider-1' && JSON.parse(options.body).activo === false)).toBe(true);
  });
});
