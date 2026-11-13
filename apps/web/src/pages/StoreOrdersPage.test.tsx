// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreOrdersPage } from './StoreOrdersPage';
import { api } from '../lib/api';

vi.mock('../lib/api',()=>({
  api:vi.fn(),
  formatMoney:(value:unknown)=>'L '+Number(value).toFixed(2),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
const apiMock=vi.mocked(api);

describe('panel protegido de pedidos web',()=>{
  let container:HTMLDivElement;
  let root:ReturnType<typeof createRoot>;
  beforeEach(()=>{
    apiMock.mockReset();
    container=document.createElement('div');
    document.body.appendChild(container);
    root=createRoot(container);
  });
  afterEach(async()=>{
    await act(async()=>root.unmount());
    container.remove();
  });
  it('presenta listado vacío sin crear pedidos ni solicitar información pública',async()=>{
    apiMock.mockResolvedValue({data:[],pagination:{page:1,limit:20,total:0}});
    await act(async()=>root.render(<MemoryRouter><StoreOrdersPage/></MemoryRouter>));
    expect(container.textContent).toContain('Gestión de pedidos');
    expect(container.textContent).toContain('No hay pedidos');
    expect(container.textContent).toContain('no reserva ni descuenta');
    expect(apiMock).toHaveBeenCalledWith('/pedidos-tienda?page=1&limit=20&estado=PENDIENTE');
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
  it('muestra aviso al fallar la API y evita mutaciones sin un pedido seleccionado',async()=>{
    apiMock.mockRejectedValue(new Error('Sesión no autorizada'));
    await act(async()=>root.render(<MemoryRouter><StoreOrdersPage/></MemoryRouter>));
    expect(container.textContent).toContain('Sesión no autorizada');
    expect(container.querySelector('form')).toBeNull();
  });
});
