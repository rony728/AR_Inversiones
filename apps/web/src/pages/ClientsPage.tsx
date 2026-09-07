import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Eye, Pencil, Plus, RefreshCw, Search, UserRound, X } from 'lucide-react';
import { api, formatMoney } from '../lib/api';
import { cacheList, getCachedList } from '../lib/offline-db';
import { clientFormFromRow, clientFormsEqual, clientPayload, filterClients, type ClientForm, type ClientRow, type ClientStatusFilter } from '../lib/client-catalog';

type Loan = { id: string; fecha_desembolso: string; capital_original: string; capital_pendiente: string; tasa_mensual: string; fecha_proximo_pago: string; estado: string };
type Sale = { id: string; fecha: string; total: string; ganancia_total: string; estado: string };
type ClientDetail = {
  cliente: ClientRow;
  resumen: { prestamosActivos: number; prestamosVencidos: number; capitalPendienteTotal: number; prestamosPagados: number; cantidadVentas: number; totalVendido: number };
  prestamos: Loan[] | null;
  ventas: Sale[] | null;
};
type DataSource = 'loading' | 'server' | 'cache' | 'error';

const emptyForm: ClientForm = { nombre: '', identificacion: '', telefono: '', direccion: '', notas: '', activo: true };
const date = (value?: string) => {
  if (!value) return '—';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) && value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat('es-HN', { dateStyle: 'medium' }).format(parsed);
};

function cachedDetail(client: ClientRow): ClientDetail {
  return {
    cliente: client,
    resumen: {
      prestamosActivos: Number(client.prestamos_activos ?? 0),
      prestamosVencidos: Number(client.prestamos_vencidos ?? 0),
      capitalPendienteTotal: Number(client.capital_pendiente_total ?? 0),
      prestamosPagados: 0,
      cantidadVentas: 0,
      totalVendido: 0
    },
    prestamos: null,
    ventas: null
  };
}

export function ClientsPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [source, setSource] = useState<DataSource>('loading');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClientStatusFilter>('todos');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [form, setForm] = useState<ClientForm>(emptyForm);
  const [baseline, setBaseline] = useState<ClientForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailClientId, setDetailClientId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  async function load() {
    setSource('loading');
    try {
      const result = await api<{ data: ClientRow[] }>('/catalogo/clientes');
      setClients(result.data);
      setSource('server');
      await cacheList('clientes', result.data as unknown as Record<string, unknown>[]);
    } catch {
      try {
        const cached = await getCachedList('clientes') as unknown as ClientRow[];
        setClients(cached);
        setSource(cached.length ? 'cache' : 'error');
      } catch { setClients([]); setSource('error'); }
    }
  }

  useEffect(() => { void load(); }, []);
  const rows = useMemo(() => filterClients(clients, search, status), [clients, search, status]);
  const canWrite = source === 'server';
  const unchanged = Boolean(editing && clientFormsEqual(form, baseline));

  function openNew() {
    setEditing(null); setForm(emptyForm); setBaseline(emptyForm); setFormError(''); setFormOpen(true);
  }

  function openEdit(client: ClientRow) {
    const values = clientFormFromRow(client);
    setEditing(client); setForm(values); setBaseline(values); setFormError(''); setFormOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current || !canWrite) return;
    if (editing && unchanged) { setFormError('No hay cambios para guardar.'); return; }
    if (editing && form.activo !== editing.activo) {
      const message = form.activo
        ? '¿Deseas reactivar este cliente? Volverá a estar disponible para nuevas ventas y préstamos.'
        : '¿Deseas desactivar este cliente? No podrá usarse en nuevas ventas o préstamos. Su historial y préstamos actuales no cambiarán.';
      if (!window.confirm(message)) return;
    }
    savingRef.current = true; setSaving(true); setFormError('');
    try {
      const payload = clientPayload(form);
      if (editing) await api(`/catalogo/clientes/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else {
        const { activo: _activo, ...createPayload } = payload;
        await api('/catalogo/clientes', { method: 'POST', body: JSON.stringify(createPayload) });
      }
      setNotice(editing ? 'Cliente actualizado correctamente.' : 'Cliente creado correctamente.');
      setFormOpen(false); setDetail(null); setDetailError('');
      await load();
    } catch (error) { setFormError(error instanceof Error ? error.message : 'No se pudo guardar el cliente.'); }
    finally { savingRef.current = false; setSaving(false); }
  }

  async function showDetail(client: ClientRow) {
    setDetailClientId(client.id); setDetailError(''); setDetailLoading(true); setDetail(null);
    if (source !== 'server') {
      setDetail(cachedDetail(client)); setDetailLoading(false); return;
    }
    try {
      const result = await api<{ data: ClientDetail }>(`/catalogo/clientes/${client.id}`);
      setDetail(result.data);
    } catch (error) { setDetailError(error instanceof Error ? error.message : 'No se pudo cargar el detalle.'); }
    finally { setDetailLoading(false); }
  }

  return <>
    <section className="page-title clients-title"><div><p className="eyebrow">RELACIONES</p><h2>Clientes</h2><p>Directorio e historial comercial de clientes.</p></div><button className="primary" onClick={openNew} disabled={!canWrite}><Plus size={18} /> Nuevo cliente</button></section>
    {source === 'cache' && <div className="offline-banner">Mostrando la última copia disponible. La consulta individual y los cambios requieren conexión con la API. <button type="button" className="text-button" onClick={() => void load()}>Reintentar</button></div>}
    {source === 'error' && <div className="client-load-error"><strong>No fue posible cargar los clientes y no hay una copia local disponible.</strong><button className="secondary" type="button" onClick={() => void load()}><RefreshCw size={15} /> Reintentar</button></div>}
    {notice && <div className="form-message client-notice">{notice}<button aria-label="Cerrar mensaje" onClick={() => setNotice('')}><X size={15} /></button></div>}

    {formOpen && <section className="panel client-form-panel">
      <div className="panel-head"><div><h3>{editing ? 'Editar cliente' : 'Nuevo cliente'}</h3><p>Los campos de identificación, teléfono, dirección y notas son opcionales.</p></div><button type="button" className="close-button" aria-label="Cerrar" onClick={() => setFormOpen(false)}><X size={18} /></button></div>
      <form className="client-form" onSubmit={save}>
        <label>Nombre<input required maxLength={180} autoFocus value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} /></label>
        <label>Identificación<input maxLength={80} value={form.identificacion} onChange={(event) => setForm({ ...form, identificacion: event.target.value })} /></label>
        <label>Teléfono<input maxLength={50} value={form.telefono} onChange={(event) => setForm({ ...form, telefono: event.target.value })} /></label>
        <label className="client-address">Dirección<textarea rows={2} value={form.direccion} onChange={(event) => setForm({ ...form, direccion: event.target.value })} /></label>
        <label className="client-notes">Notas<textarea rows={3} value={form.notas} onChange={(event) => setForm({ ...form, notas: event.target.value })} /></label>
        {editing && <label className="checkbox-field"><input type="checkbox" checked={form.activo} onChange={(event) => setForm({ ...form, activo: event.target.checked })} /> Cliente activo</label>}
        <div className="client-form-actions"><button className="primary" disabled={saving || !canWrite || unchanged}>{saving ? 'Guardando cliente…' : 'Guardar cliente'}</button><button type="button" className="secondary" onClick={() => setFormOpen(false)}>Cancelar</button></div>
        {formError && <p className="form-error client-form-message">{formError}</p>}
      </form>
    </section>}

    <section className="panel list-panel clients-panel">
      <div className="table-tools client-tools"><div className="search client-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, identificación o teléfono…" />{search && <button type="button" aria-label="Limpiar búsqueda" onClick={() => setSearch('')}><X size={15} /></button>}</div><div className="client-filters" role="group" aria-label="Filtrar por estado">{(['todos', 'activos', 'inactivos'] as const).map((filter) => <button type="button" key={filter} className={status === filter ? 'active' : ''} onClick={() => setStatus(filter)}>{filter[0].toUpperCase() + filter.slice(1)}</button>)}</div><span className={`data-freshness ${source}`}>{source === 'server' ? 'Datos actuales' : source === 'cache' ? 'Copia del dispositivo' : source === 'loading' ? 'Consultando…' : 'Sin datos'}</span><strong>{rows.length} de {clients.length} clientes</strong></div>
      <div className="table-wrap"><table className="clients-table"><thead><tr><th>Cliente</th><th>Identificación</th><th>Teléfono</th><th>Estado</th><th className="number-cell">Préstamos activos / vencidos</th><th className="number-cell">Capital pendiente</th><th>Acciones</th></tr></thead><tbody>
        {rows.length ? rows.map((client) => <tr key={client.id} className={!client.activo ? 'inactive-row' : ''}><td><strong>{client.nombre}</strong></td><td>{client.identificacion || '—'}</td><td>{client.telefono || '—'}</td><td><span className={`status ${client.activo ? '' : 'status-inactive'}`}>{client.activo ? 'Activo' : 'Inactivo'}</span></td><td className="number-cell"><span className="loan-count">{Number(client.prestamos_activos ?? 0)} / {Number(client.prestamos_vencidos ?? 0)}</span></td><td className="number-cell">{formatMoney(client.capital_pendiente_total)}</td><td><div className="client-actions"><button className="edit-button" type="button" onClick={() => void showDetail(client)}><Eye size={14} /> Ver</button><button className="edit-button" type="button" disabled={!canWrite} onClick={() => openEdit(client)}><Pencil size={14} /> Editar</button></div></td></tr>) : <tr><td className="empty-cell" colSpan={7}>{source === 'loading' ? 'Cargando clientes…' : 'No hay clientes que coincidan con los filtros.'}</td></tr>}
      </tbody></table></div>
    </section>

    {(detailLoading || detailError || detail) && <section className="panel client-detail">
      <div className="panel-head"><div><h3><UserRound size={17} /> Detalle del cliente</h3><p>Información personal y relación histórica con el negocio.</p></div><button className="close-button" type="button" aria-label="Cerrar detalle" onClick={() => { setDetail(null); setDetailError(''); }}><X size={18} /></button></div>
      {detailLoading && <div className="empty-state">Cargando detalle…</div>}
      {detailError && <div className="client-detail-error"><p>{detailError}</p><button className="secondary" onClick={() => { const selected = clients.find((client) => client.id === detailClientId); if (selected) void showDetail(selected); }}>Reintentar</button></div>}
      {detail && <>
        {detail.prestamos === null && <div className="offline-banner">La copia local incluye el resumen, pero el historial completo requiere conexión con la API.</div>}
        <div className="client-profile"><div><span>Nombre</span><strong>{detail.cliente.nombre}</strong></div><div><span>Identificación</span><strong>{detail.cliente.identificacion || '—'}</strong></div><div><span>Teléfono</span><strong>{detail.cliente.telefono || '—'}</strong></div><div><span>Estado</span><strong>{detail.cliente.activo ? 'Activo' : 'Inactivo'}</strong></div><div className="wide-detail"><span>Dirección</span><strong>{detail.cliente.direccion || '—'}</strong></div><div className="wide-detail"><span>Notas</span><strong>{detail.cliente.notas || '—'}</strong></div><div><span>Creado</span><strong>{date(detail.cliente.created_at)}</strong></div><div><span>Actualizado</span><strong>{date(detail.cliente.updated_at)}</strong></div></div>
        <div className="client-summary"><article><span>Préstamos activos</span><strong>{detail.resumen.prestamosActivos}</strong></article><article><span>Préstamos vencidos</span><strong>{detail.resumen.prestamosVencidos}</strong></article><article><span>Préstamos pagados</span><strong>{detail.resumen.prestamosPagados}</strong></article><article><span>Capital pendiente</span><strong>{formatMoney(detail.resumen.capitalPendienteTotal)}</strong></article><article><span>Ventas</span><strong>{detail.resumen.cantidadVentas}</strong></article><article><span>Total vendido</span><strong>{formatMoney(detail.resumen.totalVendido)}</strong></article></div>
        {detail.prestamos && <div className="client-history"><h4>Préstamos</h4><div className="table-wrap"><table><thead><tr><th>Desembolso</th><th>Capital original</th><th>Capital pendiente</th><th>Tasa mensual</th><th>Próximo pago</th><th>Estado</th></tr></thead><tbody>{detail.prestamos.length ? detail.prestamos.map((loan) => <tr key={loan.id}><td>{date(loan.fecha_desembolso)}</td><td>{formatMoney(loan.capital_original)}</td><td>{formatMoney(loan.capital_pendiente)}</td><td>{Number(loan.tasa_mensual)}%</td><td>{date(loan.fecha_proximo_pago)}</td><td>{loan.estado}</td></tr>) : <tr><td colSpan={6} className="empty-cell">Este cliente no tiene préstamos.</td></tr>}</tbody></table></div></div>}
        {detail.ventas && <div className="client-history"><h4>Ventas</h4><div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Total</th><th>Ganancia</th><th>Estado</th></tr></thead><tbody>{detail.ventas.length ? detail.ventas.map((sale) => <tr key={sale.id}><td>{date(sale.fecha)}</td><td>{formatMoney(sale.total)}</td><td>{formatMoney(sale.ganancia_total)}</td><td>{sale.estado}</td></tr>) : <tr><td colSpan={4} className="empty-cell">Este cliente no tiene ventas asociadas.</td></tr>}</tbody></table></div></div>}
      </>}
    </section>}
  </>;
}
