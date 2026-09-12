import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDownAZ, ArrowUpAZ, Boxes, FolderTree, Pencil, Plus, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, formatMoney } from '../lib/api';
import { cacheList, getCachedList } from '../lib/offline-db';
import { filterProducts, sortProducts, type ProductRow, type ProductSort, type SortDirection } from '../lib/product-catalog';

type Category = { id: string; nombre: string; activo: boolean };
type ProductForm = { codigo: string; nombre: string; categoriaId: string; precioVenta: string; activo: boolean };
const emptyForm: ProductForm = { codigo: '', nombre: '', categoriaId: '', precioVenta: '0', activo: true };

export function ProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProductSort>('producto');
  const [direction, setDirection] = useState<SortDirection>('asc');
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [productResult, categoryResult] = await Promise.all([
        api<{ data: ProductRow[] }>('/catalogo/productos'),
        api<{ data: Category[] }>('/catalogo/categorias')
      ]);
      setProducts(productResult.data);
      setCategories(categoryResult.data);
      setOffline(false);
      await cacheList('productos', productResult.data as unknown as Record<string, unknown>[]);
    } catch {
      setProducts(await getCachedList('productos') as unknown as ProductRow[]);
      setOffline(true);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  const rows = useMemo(() => sortProducts(filterProducts(products, search), sort, direction), [products, search, sort, direction]);

  function openNew() { setEditingId(null); setForm(emptyForm); setMessage(''); setFormOpen(true); }
  function openEdit(product: ProductRow) {
    setEditingId(product.id);
    setForm({ codigo: product.codigo, nombre: product.nombre, categoriaId: product.categoria_id ?? '', precioVenta: String(product.precio_venta ?? 0), activo: product.activo });
    setMessage(''); setFormOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      const payload = { codigo: form.codigo, nombre: form.nombre, categoriaId: form.categoriaId || null, precioVenta: Number(form.precioVenta), activo: form.activo };
      await api(`/catalogo/productos${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setFormOpen(false); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar el producto.'); }
    finally { setSaving(false); }
  }

  function changeSort(next: ProductSort) {
    if (next === sort) setDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSort(next); setDirection('asc'); }
  }

  const sortIcon = direction === 'asc' ? <ArrowDownAZ size={15} /> : <ArrowUpAZ size={15} />;
  const sortableHeading = (field: ProductSort, label: string) => (
    <button className="sort-button" onClick={() => changeSort(field)}>
      {label}{sort === field && sortIcon}
    </button>
  );

  return (
    <>
      <section className="page-title products-title">
        <div>
          <p className="eyebrow">OPERACIÓN</p>
          <h2>Productos</h2>
          <p>Inventario y catálogo de productos.</p>
        </div>
        <div className="products-title-actions">
          <Link className="secondary" to="/configuracion/categorias"><FolderTree size={16} /> Categorías</Link>
          <button className="primary" onClick={openNew}><Plus size={18} /> Nuevo producto</button>
        </div>
      </section>

      {formOpen && (
        <section className="panel product-form-panel">
          <div className="panel-head">
            <div>
              <h3>{editingId ? 'Editar producto' : 'Nuevo producto'}</h3>
              <p>Stock y costo promedio se actualizan únicamente mediante operaciones de inventario.</p>
            </div>
            <button className="close-button" aria-label="Cerrar" onClick={() => setFormOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <form className="product-form" onSubmit={save}>
            <label>
              Código / SKU
              <input required maxLength={80} value={form.codigo} onChange={(event) => setForm({ ...form, codigo: event.target.value })} />
            </label>
            <label>
              Nombre
              <input required minLength={2} maxLength={180} value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} />
            </label>
            <label>
              Categoría
              <select value={form.categoriaId} onChange={(event) => setForm({ ...form, categoriaId: event.target.value })}>
                <option value="">Sin categoría</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.nombre}{category.activo ? '' : ' (inactiva)'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Precio de venta
              <input required type="number" min="0" step="0.01" value={form.precioVenta} onChange={(event) => setForm({ ...form, precioVenta: event.target.value })} />
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={form.activo} onChange={(event) => setForm({ ...form, activo: event.target.checked })} />
              Producto activo
            </label>
            <button className="primary" disabled={saving || offline}>
              {saving ? 'Guardando…' : 'Guardar producto'}
            </button>
            {message && <p className="form-error product-form-message">{message}</p>}
          </form>
        </section>
      )}

      <section className="panel list-panel products-panel">
        {offline && <div className="offline-banner">Mostrando la última copia disponible. La edición requiere conexión.</div>}
        <div className="table-tools">
          <div className="search product-search">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por código, producto o categoría…" />
          </div>
          <span>{rows.length} de {products.length} productos</span>
        </div>

        {/* Tabla para vista Escritorio */}
        <div className="table-wrap desktop-only">
          <table className="products-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>{sortableHeading('producto', 'Producto')}</th>
                <th>Categoría</th>
                <th className="number-cell">{sortableHeading('cantidad', 'Cantidad disponible')}</th>
                <th className="number-cell">{sortableHeading('costo', 'Costo promedio')}</th>
                <th className="number-cell">{sortableHeading('precio', 'Precio de venta')}</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((product) => {
                  const quantity = Number(product.cantidad_disponible);
                  const minimum = Number(product.existencia_minima);
                  const stockClass = quantity === 0 ? 'stock-zero' : minimum > 0 && quantity <= minimum ? 'stock-low' : 'stock-normal';
                  return (
                    <tr key={product.id} className={!product.activo ? 'inactive-row' : ''}>
                      <td><strong>{product.codigo}</strong></td>
                      <td>{product.nombre}</td>
                      <td>{product.categoria ?? 'Sin categoría'}</td>
                      <td className={`number-cell ${stockClass}`}>
                        <span className="stock-badge">{quantity}</span>
                      </td>
                      <td className="number-cell">{formatMoney(product.costo_promedio)}</td>
                      <td className="number-cell">{formatMoney(product.precio_venta)}</td>
                      <td>
                        <span className={`status ${product.activo ? '' : 'status-inactive'}`}>
                          {product.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td>
                        <button className="edit-button" onClick={() => openEdit(product)}>
                          <Pencil size={14} /> Editar
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="empty-cell" colSpan={8}>
                    {loading ? 'Cargando productos…' : 'No hay productos que coincidan con la búsqueda.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Tarjetas táctiles para vista Móvil */}
        <div className="product-mobile-cards">
          {rows.length ? (
            rows.map((product) => {
              const quantity = Number(product.cantidad_disponible);
              const minimum = Number(product.existencia_minima);
              const stockClass = quantity === 0 ? 'stock-zero' : minimum > 0 && quantity <= minimum ? 'stock-low' : 'stock-normal';
              return (
                <div key={product.id} className={`product-card-mobile ${!product.activo ? 'inactive' : ''}`}>
                  <div className="product-card-header">
                    <div>
                      <strong>{product.nombre}</strong>
                      <small>SKU: {product.codigo}</small>
                    </div>
                    <span className={`status ${product.activo ? '' : 'status-inactive'}`}>
                      {product.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <div className="product-card-body">
                    <div>
                      <span>Categoría</span>
                      <b>{product.categoria ?? 'Sin categoría'}</b>
                    </div>
                    <div>
                      <span>Precio venta</span>
                      <b>{formatMoney(product.precio_venta)}</b>
                    </div>
                    <div>
                      <span>Costo prom.</span>
                      <b>{formatMoney(product.costo_promedio)}</b>
                    </div>
                    <div className={stockClass}>
                      <span>Stock dispon.</span>
                      <div><span className="stock-badge">{quantity} unid.</span></div>
                    </div>
                  </div>
                  <div className="product-card-footer">
                    <button className="edit-button" onClick={() => openEdit(product)}>
                      <Pencil size={14} /> Editar producto
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="empty-state">
              <span><Boxes /></span>
              <b>{loading ? 'Cargando productos…' : 'No hay productos que coincidan con la búsqueda.'}</b>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
