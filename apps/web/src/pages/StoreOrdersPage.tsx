import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ClipboardList, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, formatMoney } from '../lib/api';

type Status = 'PENDIENTE' | 'CONFIRMADO' | 'COMPLETADO' | 'CANCELADO';
type Order = {
  id: string; numero: string; estado: Status; cliente_nombre: string; cliente_telefono?: string;
  cliente_email?: string | null; direccion_entrega?: string | null; instrucciones_entrega?: string | null;
  modalidad_entrega: string; metodo_pago: string; subtotal: string; costo_envio: string;
  total: string; version: number; creado_at: string; actualizado_at: string;
  notas_cliente?: string | null; notas_internas?: string | null;
};
type Detail = Order & {
  detalles: Array<{id:string;producto_nombre:string;producto_codigo:string|null;cantidad:number;precio_unitario:string;subtotal:string}>;
  eventos: Array<{id:string;accion:string;estado_anterior:Status|null;estado_nuevo:Status;observacion:string|null;creado_at:string;actor_usuario:string|null}>;
};
type OrderList = { data: Order[]; pagination: {page:number;limit:number;total:number} };
const statuses: Status[] = ['PENDIENTE','CONFIRMADO','COMPLETADO','CANCELADO'];
const transitions: Record<Status, Status[]> = {
  PENDIENTE:['CONFIRMADO','CANCELADO'], CONFIRMADO:['COMPLETADO','CANCELADO'],
  COMPLETADO:[], CANCELADO:[],
};
const date = (value:string) => new Date(value).toLocaleString('es-HN',{dateStyle:'medium',timeStyle:'short'});
const label = (value:string) => value.charAt(0)+value.slice(1).toLocaleLowerCase('es');

export function StoreOrdersPage() {
  const [filter,setFilter]=useState<Status | ''>('PENDIENTE');
  const [page,setPage]=useState(1);
  const [list,setList]=useState<Order[]>([]);
  const [total,setTotal]=useState(0);
  const [selectedId,setSelectedId]=useState<string | null>(null);
  const [detail,setDetail]=useState<Detail | null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [next,setNext]=useState<Status | ''>('');
  const [note,setNote]=useState('');
  const [internalNote,setInternalNote]=useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params=new URLSearchParams({page:String(page),limit:'20'});
      if (filter) params.set('estado',filter);
      const result=await api<OrderList>(`/pedidos-tienda?${params}`);
      setList(result.data);setTotal(result.pagination.total);setError('');
    } catch (e) {
      setError(e instanceof Error?e.message:'No se pudieron consultar los pedidos.');
      setList([]);
    } finally {setLoading(false);}
  },[filter,page]);

  useEffect(()=>{void load();},[load]);

  async function open(id:string) {
    setSelectedId(id); setDetail(null); setError('');setNotice('');
    try {
      const response=await api<{data:Detail}>(`/pedidos-tienda/${id}`);
      setDetail(response.data);setNext('');setNote('');
      setInternalNote(response.data.notas_internas || '');
    } catch(e) {
      setError(e instanceof Error?e.message:'No se pudo consultar el detalle.');
    }
  }

  async function changeStatus(event:FormEvent) {
    event.preventDefault();
    if (!detail || !next || busy || !transitions[detail.estado].includes(next)) return;
    if (!window.confirm(`¿Cambiar el pedido #${detail.numero} de ${detail.estado} a ${next}? Esto NO registra una venta ni descuenta inventario.`)) return;
    setBusy(true);setError('');setNotice('');
    try {
      await api(`/pedidos-tienda/${detail.id}/estado`,{
        method:'POST',body:JSON.stringify({estado:next,observacion:note.trim(),version:detail.version})
      });
      await Promise.all([load(),open(detail.id)]);
      setNotice('Estado actualizado y registrado en la bitácora. No se modificaron existencias ni ventas.');
    } catch(e) {
      await open(detail.id).catch(()=>undefined);
      setError(e instanceof Error?e.message:'No se pudo actualizar el estado.');
    } finally {setBusy(false);}
  }

  async function saveNote(event:FormEvent) {
    event.preventDefault();
    if (!detail || busy || internalNote.trim().length<3) return;
    setBusy(true);setError('');setNotice('');
    try {
      await api(`/pedidos-tienda/${detail.id}/notas`,{
        method:'POST',body:JSON.stringify({observacion:internalNote.trim(),version:detail.version})
      });
      await open(detail.id);
      setNotice('Nota interna guardada en la bitácora.');
    } catch(e) {
      await open(detail.id).catch(()=>undefined);
      setError(e instanceof Error?e.message:'No se pudo guardar la nota.');
    } finally {setBusy(false);}
  }

  return <>
    <section className="page-title">
      <div><p className="eyebrow">AR ACCESORIOS · PEDIDOS WEB</p><h2>Gestión de pedidos</h2>
        <p>Pedidos separados de ventas e inventario. Confirmación y registro de ventas siempre manuales.</p></div>
      <button type="button" className="secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/> Actualizar</button>
    </section>
    <div className="notice"><ShieldCheck size={17}/> El checkout público permanece deshabilitado. Cambiar un estado no crea una venta, no cobra y no reserva ni descuenta existencias.</div>
    {error && <div className="notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    <section className="panel">
      <div className="table-tools">
        <strong>Pedidos registrados ({total})</strong>
        <label>Estado <select value={filter} onChange={(e)=>{setFilter(e.target.value as Status | '');setPage(1);}}>
          <option value="">Todos</option>{statuses.map((status)=><option key={status} value={status}>{label(status)}</option>)}
        </select></label>
      </div>
      <div className="table-wrap">
        <table><thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Entrega</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>{loading?<tr><td colSpan={7}>Consultando pedidos...</td></tr>:
            list.length===0?<tr><td colSpan={7} className="empty-cell">No hay pedidos para el filtro seleccionado.</td></tr>:
              list.map((item)=><tr key={item.id}>
                <td>#{item.numero}</td><td>{date(item.creado_at)}</td><td>{item.cliente_nombre}</td>
                <td>{item.modalidad_entrega==='RETIRO'?'Retiro':'Envío'}</td><td>{formatMoney(item.total)}</td>
                <td><span className="status">{label(item.estado)}</span></td>
                <td><button type="button" className="edit-button" onClick={()=>void open(item.id)}>Ver detalle</button></td>
              </tr>)}
          </tbody></table>
      </div>
      {total>20 && <div className="store-orders-pagination">
        <button type="button" className="secondary" disabled={page===1} onClick={()=>setPage((p)=>p-1)}>Anterior</button>
        <span>Página {page} de {Math.ceil(total/20)}</span>
        <button type="button" className="secondary" disabled={page>=Math.ceil(total/20)} onClick={()=>setPage((p)=>p+1)}>Siguiente</button>
      </div>}
    </section>
    {selectedId && <section className="panel store-order-detail" aria-label="Detalle del pedido">
      <div className="panel-head"><h3>{detail?`Pedido #${detail.numero}`:'Cargando detalle...'}</h3>
        <button type="button" className="secondary" onClick={()=>{setSelectedId(null);setDetail(null);}}>Cerrar detalle</button>
      </div>
      {detail && <>
        <div className="store-order-grid">
          <div><strong>Comprador</strong><p>{detail.cliente_nombre}</p><p>{detail.cliente_telefono}</p><p>{detail.cliente_email || 'Sin correo'}</p></div>
          <div><strong>Entrega y pago</strong><p>{detail.modalidad_entrega}</p><p>{detail.direccion_entrega || 'Retiro coordinado'}</p><p>{detail.instrucciones_entrega || ''}</p><p>Método: {detail.metodo_pago}</p></div>
          <div><strong>Resumen</strong><p>Subtotal: {formatMoney(detail.subtotal)}</p><p>Envío: {formatMoney(detail.costo_envio)}</p><p><b>Total: {formatMoney(detail.total)}</b></p><p>Estado: {label(detail.estado)}</p></div>
        </div>
        {detail.notas_cliente && <p><strong>Observaciones del cliente:</strong> {detail.notas_cliente}</p>}
        <div className="table-wrap"><table><thead><tr><th>Producto</th><th>Código</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead>
          <tbody>{detail.detalles.map((item)=><tr key={item.id}><td>{item.producto_nombre}</td><td>{item.producto_codigo || '—'}</td><td>{item.cantidad}</td><td>{formatMoney(item.precio_unitario)}</td><td>{formatMoney(item.subtotal)}</td></tr>)}</tbody></table></div>
        <div className="store-order-grid store-order-actions">
          <form onSubmit={(event)=>void changeStatus(event)}>
            <h4>Cambiar estado</h4>
            <label>Nuevo estado<select value={next} onChange={(e)=>setNext(e.target.value as Status | '')} disabled={busy || transitions[detail.estado].length===0}>
              <option value="">Selecciona estado</option>
              {transitions[detail.estado].map((status)=><option key={status} value={status}>{label(status)}</option>)}
            </select></label>
            <label>Motivo o comprobación realizada<textarea required minLength={3} maxLength={2000} value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Justificación para la bitácora" /></label>
            <button className="primary" disabled={busy || !next || note.trim().length<3}>Confirmar cambio</button>
            <p>Importante: al completar, registra la venta manualmente desde el módulo Ventas.</p>
          </form>
          <form onSubmit={(event)=>void saveNote(event)}>
            <h4>Nota interna</h4>
            <label>Observaciones del equipo<textarea required minLength={3} maxLength={2000} value={internalNote} onChange={(e)=>setInternalNote(e.target.value)} /></label>
            <button className="secondary" disabled={busy || internalNote.trim().length<3}>Guardar nota</button>
          </form>
        </div>
        <h4>Historial del pedido</h4>
        <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Acción</th><th>Estado</th><th>Usuario</th><th>Observación</th></tr></thead>
          <tbody>{detail.eventos.map((entry)=><tr key={entry.id}><td>{date(entry.creado_at)}</td><td>{entry.accion}</td><td>{entry.estado_anterior || '—'} → {entry.estado_nuevo}</td><td>{entry.actor_usuario || 'Sistema'}</td><td>{entry.observacion || '—'}</td></tr>)}</tbody></table></div>
      </>}
    </section>}
  </>;
}
