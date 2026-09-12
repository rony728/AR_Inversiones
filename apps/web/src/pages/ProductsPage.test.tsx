// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductRow } from '../lib/product-catalog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { apiMock, loadImageMock, optimizeMock, clearImageMock } = vi.hoisted(() => ({ apiMock: vi.fn(), loadImageMock: vi.fn(), optimizeMock: vi.fn(), clearImageMock: vi.fn() }));
vi.mock('../lib/api', () => ({ api: apiMock, formatMoney: (value: unknown) => `L ${Number(value ?? 0).toFixed(2)}` }));
vi.mock('../lib/offline-db', () => ({ cacheList: vi.fn().mockResolvedValue(undefined), getCachedList: vi.fn().mockResolvedValue([]) }));
vi.mock('../lib/product-images', () => ({ loadProductImage: loadImageMock, optimizeProductImage: optimizeMock, clearProductImageCache: clearImageMock }));
import { ProductsPage } from './ProductsPage';

const categories = [{ id: 'cat-a', nombre: 'Alimentos', activo: true }, { id: 'cat-b', nombre: 'Hogar', activo: true }];
const initialProducts: ProductRow[] = [
  { id: 'prod-1', codigo: 'CAF-01', nombre: 'Café', descripcion: 'Café molido', categoria_id: 'cat-a', categoria: 'Alimentos', cantidad_disponible: 0, costo_promedio: 55, precio_venta: 95, existencia_minima: 2, activo: true, tiene_imagen: false, updated_at: '2026-09-12T10:00:00Z' },
  { id: 'prod-2', codigo: 'VAS-02', nombre: 'Vaso', descripcion: null, categoria_id: 'cat-b', categoria: 'Hogar', cantidad_disponible: 8, costo_promedio: 20, precio_venta: 35, existencia_minima: 1, activo: false, tiene_imagen: true, imagen_actualizada_at: '2026-09-12T11:00:00Z' }
];

async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
function clickByText(scope: ParentNode, text: string) { const button = [...scope.querySelectorAll('button')].find((item) => item.textContent?.includes(text)) as HTMLButtonElement; expect(button).toBeTruthy(); button.click(); return button; }
function setInput(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) { const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }

describe('módulo Productos', () => {
  let container: HTMLDivElement; let root: ReturnType<typeof createRoot>; let products: ProductRow[];
  beforeEach(async () => {
    products = structuredClone(initialProducts);
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/catalogo/productos' && !options?.method) return { data: products };
      if (path === '/catalogo/categorias') return { data: categories };
      if (path === '/catalogo/productos/prod-1' && options?.method === 'PATCH') { const body = JSON.parse(String(options.body)); products[0] = { ...products[0], codigo: body.codigo, nombre: body.nombre, descripcion: body.descripcion, categoria_id: body.categoriaId, categoria: categories.find((item) => item.id === body.categoriaId)?.nombre ?? null, precio_venta: body.precioVenta, activo: body.activo }; return { data: { id: 'prod-1' } }; }
      if (path === '/catalogo/productos/prod-2' && options?.method === 'PATCH') return { data: { id: 'prod-2' } };
      if (/\/catalogo\/productos\/prod-[12]\/imagen/.test(path) && options?.method === 'PATCH') return { data: {} };
      throw new Error(`Ruta inesperada: ${path}`);
    });
    loadImageMock.mockResolvedValue('blob:product-image'); optimizeMock.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
    vi.stubGlobal('scrollTo', vi.fn()); vi.stubGlobal('structuredClone', (value: unknown) => JSON.parse(JSON.stringify(value)));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<MemoryRouter><ProductsPage /></MemoryRouter>); }); await flush();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); apiMock.mockReset(); loadImageMock.mockReset(); optimizeMock.mockReset(); clearImageMock.mockReset(); vi.unstubAllGlobals(); document.body.style.overflow = ''; });

  it('muestra placeholder o miniatura y abre/cierra Ver en modal', async () => {
    expect(container.querySelectorAll('[aria-label="Producto sin imagen"]').length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(container.querySelectorAll('img[alt="Imagen de Vaso"]').length).toBeGreaterThan(0));
    await act(async () => { clickByText(container.querySelector('tbody')!, 'Ver'); });
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Ganancia estimada por unidad'); expect(dialog.textContent).toContain('L 40.00'); expect(dialog.textContent).toContain('42.11 %');
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => { (dialog.querySelector('[aria-label="Cerrar detalle"]') as HTMLButtonElement).click(); });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull(); expect(window.scrollTo).toHaveBeenCalled();
  });

  it('abre Editar en modal, conserva UUID e inventario y no permite editarlos', async () => {
    const firstRow = container.querySelector('tbody tr')!;
    await act(async () => { clickByText(firstRow, 'Editar'); });
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Existencia:'); expect(dialog.textContent).toContain('Costo promedio:');
    expect([...dialog.querySelectorAll('input')].some((input) => /existencia|costo/i.test(input.name))).toBe(false);
    await act(async () => { setInput([...dialog.querySelectorAll('input')].find((input) => input.value === 'Café')!, 'Café premium'); setInput(dialog.querySelector('textarea')!, 'Nueva descripción'); setInput(dialog.querySelector('select')!, 'cat-b'); setInput(dialog.querySelector('input[type="number"]')!, '55'); });
    await act(async () => { clickByText(dialog, 'Guardar producto'); }); await flush();
    const patch = apiMock.mock.calls.find(([path, options]) => path === '/catalogo/productos/prod-1' && options?.method === 'PATCH');
    expect(patch).toBeTruthy(); const body = JSON.parse(patch![1].body);
    expect(body).toMatchObject({ nombre: 'Café premium', descripcion: 'Nueva descripción', categoriaId: 'cat-b', precioVenta: 55 });
    expect(body).not.toHaveProperty('id'); expect(body).not.toHaveProperty('existencia'); expect(body).not.toHaveProperty('costoPromedio');
    expect(products[0].id).toBe('prod-1'); expect(products[0].cantidad_disponible).toBe(0); expect(products[0].costo_promedio).toBe(55);
  });

  it('agrega y reemplaza imagen con controles separados de cámara y galería', async () => {
    await act(async () => { clickByText(container, 'Nuevo producto'); });
    let dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('input[capture="environment"]')).toBeTruthy(); expect(dialog.textContent).toContain('Cámara'); expect(dialog.textContent).toContain('Galería');
    await act(async () => { (dialog.querySelector('[aria-label="Cerrar formulario"]') as HTMLButtonElement).click(); });
    for (const [index, productId] of [['0', 'prod-1'], ['1', 'prod-2']] as const) {
      const row = container.querySelectorAll('tbody tr')[Number(index)];
      await act(async () => { clickByText(row, 'Editar'); }); dialog = document.body.querySelector('[role="dialog"]')!;
      const gallery = [...dialog.querySelectorAll('input[type="file"]')].find((input) => !input.hasAttribute('capture')) as HTMLInputElement;
      const file = new File(['source'], `${productId}.png`, { type: 'image/png' }); Object.defineProperty(gallery, 'files', { configurable: true, value: [file] });
      await act(async () => { gallery.dispatchEvent(new Event('change', { bubbles: true })); }); await flush();
      expect(optimizeMock).toHaveBeenCalledWith(file); expect(dialog.textContent).toContain('Vista previa optimizada');
      await act(async () => { clickByText(dialog, 'Guardar producto'); }); await flush();
      expect(apiMock.mock.calls.some(([path, options]) => path === `/catalogo/productos/${productId}/imagen` && options?.method === 'PATCH' && options.body instanceof Blob)).toBe(true);
      expect(clearImageMock).toHaveBeenCalledWith(productId);
    }
  });

  it('filtra categoría, estado, rangos, agotados y limpia filtros', async () => {
    const panel = container.querySelector('.product-filter-panel')!;
    await act(async () => { setInput(panel.querySelector('select')!, 'cat-a'); }); expect(container.querySelector('tbody')!.textContent).toContain('Café'); expect(container.querySelector('tbody')!.textContent).not.toContain('Vaso');
    await act(async () => { clickByText(panel, 'Limpiar filtros'); setInput(panel.querySelectorAll('select')[1], 'inactive'); }); expect(container.querySelector('tbody')!.textContent).toContain('Vaso');
    await act(async () => { clickByText(panel, 'Limpiar filtros'); clickByText(panel, 'Agotados'); }); expect(container.querySelector('tbody')!.textContent).toContain('Café');
    await act(async () => { clickByText(panel, 'Limpiar filtros'); setInput(panel.querySelector('[aria-label="Existencia mínima"]')!, '8'); setInput(panel.querySelector('[aria-label="Costo promedio máxima"]')!, '25'); setInput(panel.querySelector('[aria-label="Precio de venta mínima"]')!, '30'); }); expect(container.querySelector('tbody')!.textContent).toContain('Vaso'); expect(container.querySelector('tbody')!.textContent).not.toContain('Café');
    await act(async () => { clickByText(panel, 'Limpiar filtros'); }); expect(container.querySelectorAll('tbody tr')).toHaveLength(2); expect((panel.querySelector('[aria-label="Existencia mínima"]') as HTMLInputElement).value).toBe('');
  });

  it('ordena columnas ascendente/descendente y mantiene tarjetas responsive', async () => {
    const table = container.querySelector('table')!; const codes = () => [...table.querySelectorAll('tbody tr')].map((row) => row.children[1].textContent);
    await act(async () => { clickByText(table.querySelector('thead')!, 'Código'); }); expect(codes()).toEqual(['CAF-01', 'VAS-02']);
    await act(async () => { clickByText(table.querySelector('thead')!, 'Código'); }); expect(codes()).toEqual(['VAS-02', 'CAF-01']);
    for (const label of ['Producto', 'Categoría', 'Cantidad', 'Costo promedio', 'Precio', 'Estado']) expect([...table.querySelectorAll('th button')].some((button) => button.textContent?.includes(label))).toBe(true);
    expect(container.querySelector('.product-mobile-cards')?.children).toHaveLength(2); expect(container.querySelectorAll('.product-actions-mobile')).toHaveLength(2);
  });
});
