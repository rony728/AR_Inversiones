// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMock }));
import { Login } from './Login';

function setInput(input: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }

describe('Login', () => {
  let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
  beforeEach(async () => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); await act(async () => root.render(<Login onLogin={vi.fn()} />)); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); apiMock.mockReset(); sessionStorage.clear(); });

  it('mantiene usuario y contraseña sin mostrar el texto técnico de inicialización', () => {
    expect(container.querySelector('input[autocomplete="username"]')).toBeTruthy();
    expect(container.querySelector('input[autocomplete="current-password"]')).toBeTruthy();
    expect(container.textContent).not.toContain('La primera cuenta se configura desde la API');
  });

  it('muestra y oculta la contraseña sin alterar su valor', async () => {
    const password = container.querySelector('input[autocomplete="current-password"]') as HTMLInputElement;
    await act(async () => setInput(password, 'clave-segura'));
    expect(password.type).toBe('password');
    const show = container.querySelector('[aria-label="Mostrar contraseña"]') as HTMLButtonElement;
    await act(async () => show.click()); expect(password.type).toBe('text'); expect(password.value).toBe('clave-segura');
    const hide = container.querySelector('[aria-label="Ocultar contraseña"]') as HTMLButtonElement;
    await act(async () => hide.click()); expect(password.type).toBe('password'); expect(password.value).toBe('clave-segura');
  });

  it('muestra el mensaje del backend dentro del formulario', async () => {
    apiMock.mockRejectedValueOnce(new Error('Credenciales inválidas.'));
    const [user, password] = [...container.querySelectorAll('input')] as HTMLInputElement[];
    await act(async () => { setInput(user, 'rony'); setInput(password, 'incorrecta'); });
    await act(async () => { (container.querySelector('form') as HTMLFormElement).requestSubmit(); });
    await vi.waitFor(() => expect(container.querySelector('form [role="alert"]')?.textContent).toBe('Credenciales inválidas.'));
  });
});
