import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

type Category = { id: string; nombre: string; activo: boolean };

export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() { const result = await api<{ data: Category[] }>('/catalogo/categorias'); setCategories(result.data); }
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : 'No se pudieron cargar las categorías.')); }, []);
  function startNew() { setEditing(null); setName(''); setActive(true); setMessage(''); }
  function startEdit(category: Category) { setEditing(category); setName(category.nombre); setActive(category.activo); setMessage(''); }
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      await api(`/catalogo/categorias${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(editing ? { nombre: name, activo: active } : { nombre: name }) });
      startNew(); await load(); setMessage('Categoría guardada correctamente.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar la categoría.'); }
    finally { setSaving(false); }
  }

  return <><section className="page-title"><div><p className="eyebrow">CONFIGURACIÓN</p><h2>Categorías</h2><p>Organiza el catálogo sin afectar el historial de los productos.</p></div><Link className="secondary" to="/configuracion"><ArrowLeft size={17} /> Volver</Link></section>
    <div className="category-layout"><section className="panel"><div className="panel-head"><div><h3>{editing ? 'Editar categoría' : 'Nueva categoría'}</h3><p>Los productos también pueden mantenerse sin categoría.</p></div>{editing && <button className="secondary" onClick={startNew}><Plus size={15} /> Nueva</button>}</div>
      <form className="compact-form category-form" onSubmit={save}><label>Nombre<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>{editing && <label className="checkbox-field"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Categoría activa</label>}<button className="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar categoría'}</button>{message && <p className="form-message">{message}</p>}</form>
    </section><section className="panel list-panel"><div className="table-tools"><strong>Categorías existentes</strong><span>{categories.length} registros</span></div><div className="table-wrap"><table><thead><tr><th>Nombre</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{categories.length ? categories.map((category) => <tr key={category.id}><td>{category.nombre}</td><td><span className={`status ${category.activo ? '' : 'status-inactive'}`}>{category.activo ? 'Activa' : 'Inactiva'}</span></td><td><button className="edit-button" onClick={() => startEdit(category)}><Pencil size={14} /> Editar</button></td></tr>) : <tr><td colSpan={3} className="empty-cell">No hay categorías registradas.</td></tr>}</tbody></table></div></section></div>
  </>;
}
