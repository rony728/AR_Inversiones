import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Minus, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { cacheList, getCachedList, queueMutation } from '../lib/offline-db';

type Row = Record<string, unknown>;
type CountLine = { productoId: string; socioId: string; existenciaFisica: number };
type AuditDetail = Row & { detalles?: Row[] };

async function loadCached(path: string, store: Parameters<typeof getCachedList>[0]) {
  try {
    const rows = (await api<{ data: Row[] }>(path)).data;
    await cacheList(store, rows);
    return rows;
  } catch { return getCachedList(store); }
}

export function InventoryAuditPage() {
  const [products, setProducts] = useState<Row[]>([]);
  const [partners, setPartners] = useState<Row[]>([]);
  const [inventory, setInventory] = useState<Row[]>([]);
  const [audits, setAudits] = useState<Row[]>([]);
  const [lines, setLines] = useState<CountLine[]>([{ productoId: '', socioId: '', existenciaFisica: 0 }]);
  const [observations, setObservations] = useState('');
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [message, setMessage] = useState('');

  async function refreshAudits() {
    const rows = await loadCached('/auditorias', 'auditorias');
    setAudits(rows);
  }

  useEffect(() => {
    Promise.all([
      loadCached('/catalogo/productos', 'productos'),
      loadCached('/catalogo/socios', 'custodias'),
      loadCached('/inventario', 'inventario'),
      loadCached('/auditorias', 'auditorias')
    ]).then(([p, s, i, a]) => { setProducts(p); setPartners(s); setInventory(i); setAudits(a); });
  }, []);

  const systemStock = (line: CountLine) => Number(inventory.find((item) => item.producto_id === line.productoId && item.socio_id === line.socioId)?.existencia ?? 0);
  const productName = (id: unknown) => String(products.find((item) => item.id === id)?.nombre ?? id ?? '—');
  const partnerName = (id: unknown) => String(partners.find((item) => item.id === id)?.nombre ?? id ?? '—');
  const change = (index: number, values: Partial<CountLine>) => setLines((current) => current.map((line, i) => i === index ? { ...line, ...values } : line));

  async function start(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    if (lines.some((line) => !line.productoId || !line.socioId || !Number.isInteger(line.existenciaFisica) || line.existenciaFisica < 0)) { setMessage('Completa cada producto, socio y existencia física con unidades enteras.'); return; }
    const keys = lines.map((line) => `${line.productoId}:${line.socioId}`);
    if (new Set(keys).size !== keys.length) { setMessage('El mismo producto y socio aparece más de una vez.'); return; }
    const id = crypto.randomUUID();
    const payload = { id, observaciones: observations || undefined, items: lines, fecha_inicio: new Date().toISOString(), estado: 'PENDIENTE', productos_contados: lines.length, diferencias_encontradas: lines.filter((line) => systemStock(line) !== line.existenciaFisica).length };
    try {
      if (navigator.onLine) {
        await api('/auditorias', { method: 'POST', body: JSON.stringify(payload) });
        setMessage('Conteo guardado. Revisa las diferencias antes de aprobar los ajustes.');
        await refreshAudits();
      } else {
        await queueMutation('auditorias', 'auditoria_inventario', id, 'CREATE', payload);
        setAudits((current) => [payload, ...current]);
        setMessage('Conteo guardado en este dispositivo; se enviará al recuperar conexión.');
      }
      setLines([{ productoId: '', socioId: '', existenciaFisica: 0 }]); setObservations('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo iniciar la auditoría.'); }
  }

  async function view(auditId: string) {
    try { setDetail((await api<{ data: AuditDetail }>(`/auditorias/${auditId}`)).data); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo consultar el detalle.'); }
  }

  async function approve(auditId: string) {
    if (!navigator.onLine) { setMessage('Conéctate para aprobar: el servidor debe comprobar que el inventario no cambió desde el conteo.'); return; }
    try {
      await api(`/auditorias/${auditId}/aprobar`, { method: 'POST' });
      setMessage('Ajustes aprobados y movimientos de inventario registrados.'); setDetail(null); await refreshAudits();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo aprobar la auditoría.'); }
  }

  return <><section className="page-title"><div><p className="eyebrow">CONTROL FÍSICO</p><h2>Auditoría de inventario</h2><p>Compara el conteo físico con el sistema y registra cada ajuste.</p></div></section>
    <form className="panel audit-form" onSubmit={start}><div className="panel-head"><div><h3><ClipboardCheck size={17} /> Nuevo conteo</h3><p>Selecciona las combinaciones de producto y socio que fueron contadas.</p></div><button type="button" className="secondary" onClick={() => setLines((current) => [...current, { productoId: '', socioId: '', existenciaFisica: 0 }])}><Plus size={16} /> Agregar producto</button></div>
      {lines.map((line, index) => { const current = systemStock(line); const difference = line.existenciaFisica - current; return <div className="audit-line" key={index}><label>Producto<select value={line.productoId} onChange={(e) => change(index, { productoId: e.target.value })}><option value="">Seleccionar</option>{products.filter((p) => p.activo !== false).map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.nombre)}</option>)}</select></label><label>Socio propietario<select value={line.socioId} onChange={(e) => change(index, { socioId: e.target.value })}><option value="">Seleccionar</option>{partners.filter((p) => p.activo !== false).map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.nombre)}</option>)}</select></label><div className="audit-value"><span>Sistema</span><strong>{current}</strong></div><label>Existencia física<input type="number" min="0" step="1" value={line.existenciaFisica} onChange={(e) => change(index, { existenciaFisica: Number(e.target.value) })} /></label><div className={`audit-value ${difference ? 'has-difference' : ''}`}><span>Diferencia</span><strong>{difference > 0 ? `+${difference}` : difference}</strong></div>{lines.length > 1 && <button className="icon-button" type="button" aria-label="Quitar producto" onClick={() => setLines((currentLines) => currentLines.filter((_, i) => i !== index))}><Minus size={16} /></button>}</div>; })}
      <label className="audit-observations">Observaciones<textarea rows={3} maxLength={2000} value={observations} onChange={(e) => setObservations(e.target.value)} /></label><button className="primary audit-submit" type="submit">Guardar conteo</button></form>
    {message && <p className="form-message audit-message">{message}</p>}
    {detail && <section className="panel audit-detail"><div className="panel-head"><div><h3>Diferencias del conteo</h3><p>Existencia capturada al iniciar la auditoría.</p></div><button className="text-button" onClick={() => setDetail(null)}>Cerrar</button></div><div className="table-wrap"><table><thead><tr><th>Producto</th><th>Socio</th><th>Sistema</th><th>Físico</th><th>Diferencia</th></tr></thead><tbody>{(detail.detalles ?? []).map((row) => <tr key={String(row.id)}><td>{String(row.producto)}</td><td>{String(row.socio)}</td><td>{String(row.existencia_sistema)}</td><td>{String(row.existencia_fisica)}</td><td><strong>{Number(row.diferencia) > 0 ? '+' : ''}{String(row.diferencia)}</strong></td></tr>)}</tbody></table></div>{detail.estado === 'ABIERTA' && <button className="primary approve-audit" onClick={() => approve(String(detail.id))}><CheckCircle2 size={17} /> Aprobar ajustes</button>}</section>}
    <section className="panel list-panel"><div className="panel-head audit-history-head"><div><h3>Historial de auditorías</h3><p>Los conteos y ajustes aprobados permanecen registrados.</p></div></div><div className="table-wrap"><table><thead><tr><th>Inicio</th><th>Estado</th><th>Productos</th><th>Diferencias</th><th></th></tr></thead><tbody>{audits.length ? audits.map((row) => <tr key={String(row.id)}><td>{String(row.fecha_inicio ?? '').slice(0, 19).replace('T', ' ')}</td><td><span className="status">{String(row.estado ?? 'PENDIENTE')}</span></td><td>{String(row.productos_contados ?? 0)}</td><td>{String(row.diferencias_encontradas ?? 0)}</td><td>{row.estado !== 'PENDIENTE' && <button className="text-button" onClick={() => view(String(row.id))}>Ver detalle</button>}</td></tr>) : <tr><td colSpan={5} className="empty-cell">No hay auditorías registradas.</td></tr>}</tbody></table></div></section>
  </>;
}
