import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Boxes, Camera, Eye, FolderTree, ImagePlus, Pencil, Plus, Search, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, formatMoney } from '../lib/api';
import { cacheList, getCachedList } from '../lib/offline-db';
import { clearProductImageCache, loadProductImage, optimizeProductImage } from '../lib/product-images';
import { emptyProductFilters, filterProducts, productProfit, sortProducts, uniqueNumericValues, type ProductFilters, type ProductRow, type ProductSort, type SortDirection } from '../lib/product-catalog';

type Category = { id: string; nombre: string; activo: boolean };
type ProductForm = { codigo: string; nombre: string; descripcion: string; categoriaId: string; precioVenta: string; activo: boolean };
const emptyForm: ProductForm = { codigo: '', nombre: '', descripcion: '', categoriaId: '', precioVenta: '0', activo: true };

function ProductImage({ product, large = false, previewUrl }: { product?: ProductRow; large?: boolean; previewUrl?: string | null }) {
  const [source, setSource] = useState<string | null>(previewUrl ?? null);
  useEffect(() => {
    let active = true;
    if (previewUrl) { setSource(previewUrl); return () => { active = false; }; }
    if (!product?.tiene_imagen) { setSource(null); return () => { active = false; }; }
    void loadProductImage(product.id, product.imagen_actualizada_at).then((url) => { if (active) setSource(url); }).catch(() => { if (active) setSource(null); });
    return () => { active = false; };
  }, [previewUrl, product?.id, product?.tiene_imagen, product?.imagen_actualizada_at]);
  return source
    ? <img className={`product-image ${large ? 'product-image-large' : 'product-image-thumb'}`} src={source} alt={product ? `Imagen de ${product.nombre}` : 'Vista previa del producto'} />
    : <div className={`product-image-placeholder ${large ? 'product-image-large' : 'product-image-thumb'}`} aria-label="Producto sin imagen"><ImagePlus aria-hidden="true" /></div>;
}

function ProductModal({ children, label }: { children: ReactNode; label: string }) {
  return createPortal(<div className="product-modal-overlay"><div className="product-modal" role="dialog" aria-modal="true" aria-label={label}>{children}</div></div>, document.body);
}

export function ProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState<ProductFilters>(emptyProductFilters);
  const [sort, setSort] = useState<ProductSort>('producto');
  const [direction, setDirection] = useState<SortDirection>('asc');
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<ProductRow | null>(null);
  const [pendingImage, setPendingImage] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState('');
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [productResult, categoryResult] = await Promise.all([
        api<{ data: ProductRow[] }>('/catalogo/productos'),
        api<{ data: Category[] }>('/catalogo/categorias')
      ]);
      setProducts(productResult.data); setCategories(categoryResult.data); setOffline(false);
      await cacheList('productos', productResult.data as unknown as Record<string, unknown>[]);
    } catch {
      setProducts(await getCachedList('productos') as unknown as ProductRow[]); setOffline(true);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  const modalOpen = formOpen || Boolean(viewing);
  useEffect(() => {
    if (!modalOpen) return;
    const scrollX = window.scrollX; const scrollY = window.scrollY;
    const overflow = document.body.style.overflow; const paddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden'; if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => { document.body.style.overflow = overflow; document.body.style.paddingRight = paddingRight; window.scrollTo(scrollX, scrollY); };
  }, [modalOpen]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const rows = useMemo(() => sortProducts(filterProducts(products, filters), sort, direction), [products, filters, sort, direction]);
  const stockOptions = useMemo(() => uniqueNumericValues(products, 'cantidad_disponible'), [products]);
  const costOptions = useMemo(() => uniqueNumericValues(products, 'costo_promedio'), [products]);
  const priceOptions = useMemo(() => uniqueNumericValues(products, 'precio_venta'), [products]);
  const editingProduct = useMemo(() => products.find((product) => product.id === editingId), [products, editingId]);
  function resetPendingImage() { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); setPendingImage(null); }
  function closeForm() { resetPendingImage(); setFormOpen(false); setEditingId(null); setMessage(''); }
  function openNew() { resetPendingImage(); setEditingId(null); setForm(emptyForm); setMessage(''); setFormOpen(true); }
  function openEdit(product: ProductRow) {
    resetPendingImage(); setEditingId(product.id);
    setForm({ codigo: product.codigo, nombre: product.nombre, descripcion: product.descripcion ?? '', categoriaId: product.categoria_id ?? '', precioVenta: String(product.precio_venta ?? 0), activo: product.activo });
    setMessage(''); setViewing(null); setFormOpen(true);
  }

  async function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setImageProcessing(true); setMessage('');
    try { const optimized = await optimizeProductImage(file); resetPendingImage(); setPendingImage(optimized); setPreviewUrl(URL.createObjectURL(optimized)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo preparar la imagen.'); }
    finally { setImageProcessing(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage(''); let targetId = editingId;
    try {
      const payload = { codigo: form.codigo, nombre: form.nombre, descripcion: form.descripcion.trim() || null, categoriaId: form.categoriaId || null, precioVenta: Number(form.precioVenta), activo: form.activo };
      const result = await api<{ data: { id: string } }>(`/catalogo/productos${targetId ? `/${targetId}` : ''}`, { method: targetId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      targetId = result.data.id; if (!editingId) setEditingId(targetId);
      if (pendingImage) { await api(`/catalogo/productos/${targetId}/imagen`, { method: 'PATCH', headers: { 'Content-Type': pendingImage.type }, body: pendingImage }); clearProductImageCache(targetId); }
      resetPendingImage(); setFormOpen(false); setEditingId(null); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar el producto.'); }
    finally { setSaving(false); }
  }

  function changeSort(next: ProductSort) { if (next === sort) setDirection((current) => current === 'asc' ? 'desc' : 'asc'); else { setSort(next); setDirection('asc'); } }
  function clearFilters() { setFilters(emptyProductFilters); setSort('producto'); setDirection('asc'); }
  const sortableHeading = (field: ProductSort, label: string) => {
    const indicator = sort === field ? (direction === 'asc' ? '↑' : '↓') : '↕';
    const state = sort === field ? (direction === 'asc' ? 'ascendente' : 'descendente') : 'sin ordenar';
    return <button type="button" className={`sort-button ${sort === field ? 'active' : ''}`} aria-label={`${label}: ${state}`} onClick={() => changeSort(field)}>{label}<span className="sort-indicator" aria-hidden="true">{indicator}</span></button>;
  };
  const setFilter = <K extends keyof ProductFilters>(key: K, value: ProductFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));

  return <>
    <section className="page-title products-title"><div><p className="eyebrow">OPERACIÓN</p><h2>Productos</h2><p>Inventario y catálogo de productos.</p></div><div className="products-title-actions"><Link className="secondary" to="/configuracion/categorias"><FolderTree size={16} /> Categorías</Link><button className="primary" onClick={openNew}><Plus size={18} /> Nuevo producto</button></div></section>

    {viewing && <ProductModal label={`Ver producto ${viewing.nombre}`}><section className="panel product-detail-panel"><div className="panel-head"><div><h3>{viewing.nombre}</h3><p>{viewing.codigo} · {viewing.categoria ?? 'Sin categoría'}</p></div><button type="button" className="close-button" aria-label="Cerrar detalle" onClick={() => setViewing(null)}><X size={18} /></button></div><div className="product-detail-layout"><ProductImage product={viewing} large /><div className="product-detail-grid"><Detail label="Código / SKU" value={viewing.codigo} /><Detail label="Categoría" value={viewing.categoria ?? 'Sin categoría'} /><Detail label="Estado" value={viewing.activo ? 'Activo' : 'Inactivo'} /><Detail label="Cantidad disponible" value={`${Number(viewing.cantidad_disponible)} unidades`} /><Detail label="Costo promedio" value={formatMoney(viewing.costo_promedio)} /><Detail label="Precio de venta" value={formatMoney(viewing.precio_venta)} /><Detail label="Ganancia estimada por unidad" value={formatMoney(productProfit(viewing).profit)} /><Detail label="Margen sobre precio" value={`${productProfit(viewing).margin.toFixed(2)} %`} /><Detail label="Existencia mínima" value={String(Number(viewing.existencia_minima))} /><Detail label="Precio mínimo histórico" value={viewing.precio_minimo == null ? 'No configurado' : formatMoney(viewing.precio_minimo)} /><Detail label="Marca / modelo" value={[viewing.marca, viewing.modelo].filter(Boolean).join(' · ') || 'No registrado'} /><Detail label="Código de barras" value={viewing.codigo_barras ?? 'No registrado'} /><Detail label="Control de serie" value={viewing.control_serie ? 'Sí' : 'No'} /><Detail label="Garantía" value={`${Number(viewing.garantia_dias ?? 0)} días`} /><Detail label="Última actualización" value={viewing.updated_at ? new Date(viewing.updated_at).toLocaleString('es-HN') : 'No disponible'} /><div className="product-description"><span>Descripción</span><strong>{viewing.descripcion || 'Sin descripción'}</strong></div></div></div><div className="product-modal-actions"><button type="button" className="secondary" onClick={() => setViewing(null)}>Cerrar</button><button type="button" className="primary" onClick={() => openEdit(viewing)}><Pencil size={15} /> Editar producto</button></div></section></ProductModal>}

    {formOpen && <ProductModal label={editingId ? 'Editar producto' : 'Nuevo producto'}><section className="panel product-form-panel"><div className="panel-head"><div><h3>{editingId ? 'Editar producto' : 'Nuevo producto'}</h3><p>Stock y costo promedio se actualizan únicamente mediante operaciones de inventario.</p></div><button type="button" className="close-button" aria-label="Cerrar formulario" onClick={closeForm}><X size={18} /></button></div><form className="product-form" onSubmit={save}><div className="product-image-editor"><ProductImage product={editingProduct} large previewUrl={previewUrl} /><p>{imageProcessing ? 'Optimizando imagen…' : pendingImage ? 'Vista previa optimizada' : editingProduct?.tiene_imagen ? 'Imagen actual' : 'Sin imagen'}</p><div className="product-image-mobile-actions"><button type="button" className="secondary" onClick={() => cameraInput.current?.click()}><Camera size={15} /> Cámara</button><button type="button" className="secondary" onClick={() => galleryInput.current?.click()}><Upload size={15} /> Galería</button></div><button type="button" className="secondary product-image-desktop-action" onClick={() => fileInput.current?.click()}><Upload size={15} /> Seleccionar imagen</button><input ref={cameraInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={selectImage} /><input ref={galleryInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} /><input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} /></div><div className="product-edit-fields"><label>Código / SKU<input required maxLength={80} value={form.codigo} onChange={(event) => setForm({ ...form, codigo: event.target.value })} /></label><label>Nombre<input required minLength={2} maxLength={180} value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} /></label><label className="product-description-field">Descripción<textarea maxLength={2000} rows={4} value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} /></label><label>Categoría<select value={form.categoriaId} onChange={(event) => setForm({ ...form, categoriaId: event.target.value })}><option value="">Sin categoría</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.nombre}{category.activo ? '' : ' (inactiva)'}</option>)}</select></label><label>Precio de venta<input required type="number" min="0" step="0.01" value={form.precioVenta} onChange={(event) => setForm({ ...form, precioVenta: event.target.value })} /></label><label className="checkbox-field"><input type="checkbox" checked={form.activo} onChange={(event) => setForm({ ...form, activo: event.target.checked })} />Producto activo</label>{editingProduct && <div className="product-protected-values"><span>Existencia: <strong>{Number(editingProduct.cantidad_disponible)}</strong></span><span>Costo promedio: <strong>{formatMoney(editingProduct.costo_promedio)}</strong></span><small>Valores informativos protegidos por el historial de inventario.</small></div>}</div>{message && <p className="form-error product-form-message">{message}</p>}<div className="product-modal-actions"><button type="button" className="secondary" onClick={closeForm}>Cancelar</button><button type="submit" className="primary" disabled={saving || offline || imageProcessing}>{saving ? 'Guardando…' : 'Guardar producto'}</button></div></form></section></ProductModal>}

    <section className="panel product-filter-panel"><div className="product-filter-top"><div className="search product-search"><Search size={17} /><input value={filters.search} onChange={(event) => setFilter('search', event.target.value)} placeholder="Buscar por código, producto o categoría…" /></div><div className="product-stock-quick"><button type="button" className={filters.stock === 'with' ? 'active' : ''} onClick={() => setFilter('stock', filters.stock === 'with' ? 'all' : 'with')}>Con existencia</button><button type="button" className={filters.stock === 'without' ? 'active' : ''} onClick={() => setFilter('stock', filters.stock === 'without' ? 'all' : 'without')}>Agotados</button></div><button type="button" className="secondary compact" onClick={clearFilters}>Limpiar filtros</button></div><div className="product-filter-grid"><label>Categoría<select value={filters.categoryId} onChange={(event) => setFilter('categoryId', event.target.value)}><option value="">Todas</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.nombre}</option>)}</select></label><label>Estado<select value={filters.status} onChange={(event) => setFilter('status', event.target.value as ProductFilters['status'])}><option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label><ExactValueFilter label="Cantidad disponible" value={filters.stockValue} options={stockOptions} onChange={(value) => setFilter('stockValue', value)} /><ExactValueFilter label="Costo promedio" value={filters.costValue} options={costOptions} formatOption={formatMoney} onChange={(value) => setFilter('costValue', value)} /><ExactValueFilter label="Precio de venta" value={filters.priceValue} options={priceOptions} formatOption={formatMoney} onChange={(value) => setFilter('priceValue', value)} /></div></section>

    <section className="panel list-panel products-panel">{offline && <div className="offline-banner">Mostrando la última copia disponible. Las imágenes no disponibles usarán el placeholder y la edición requiere conexión.</div>}<div className="table-tools"><strong>{rows.length} de {products.length} productos</strong></div><div className="table-wrap desktop-only"><table className="products-table"><thead><tr><th>Imagen</th><th>{sortableHeading('codigo', 'Código')}</th><th>{sortableHeading('producto', 'Producto')}</th><th>{sortableHeading('categoria', 'Categoría')}</th><th className="number-cell">{sortableHeading('cantidad', 'Cantidad')}</th><th className="number-cell">{sortableHeading('costo', 'Costo promedio')}</th><th className="number-cell">{sortableHeading('precio', 'Precio')}</th><th>{sortableHeading('estado', 'Estado')}</th><th>Acciones</th></tr></thead><tbody>{rows.length ? rows.map((product) => <ProductTableRow key={product.id} product={product} onView={() => setViewing(product)} onEdit={() => openEdit(product)} />) : <tr><td className="empty-cell" colSpan={9}>{loading ? 'Cargando productos…' : 'No hay productos que coincidan con los filtros.'}</td></tr>}</tbody></table></div><div className="product-mobile-cards">{rows.length ? rows.map((product) => <ProductMobileCard key={product.id} product={product} onView={() => setViewing(product)} onEdit={() => openEdit(product)} />) : <div className="empty-state"><span><Boxes /></span><b>{loading ? 'Cargando productos…' : 'No hay productos que coincidan con los filtros.'}</b></div>}</div></section>
  </>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function ExactValueFilter({ label, value, options, onChange, formatOption = String }: { label: string; value: string; options: number[]; onChange: (value: string) => void; formatOption?: (value: number) => string }) { return <label>{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Todos</option>{options.map((option) => <option key={option} value={String(option)}>{formatOption(option)}</option>)}</select></label>; }
function stockClass(product: ProductRow) { const quantity = Number(product.cantidad_disponible); const minimum = Number(product.existencia_minima); return quantity === 0 ? 'stock-zero' : minimum > 0 && quantity <= minimum ? 'stock-low' : 'stock-normal'; }
function ProductActions({ onView, onEdit, mobile = false }: { onView: () => void; onEdit: () => void; mobile?: boolean }) { return <div className={`product-actions ${mobile ? 'product-actions-mobile' : ''}`}><button type="button" className="view-button" onClick={onView}><Eye size={14} /> Ver</button><button type="button" className="edit-button" onClick={onEdit}><Pencil size={14} /> Editar</button></div>; }
function ProductTableRow({ product, onView, onEdit }: { product: ProductRow; onView: () => void; onEdit: () => void }) { return <tr className={!product.activo ? 'inactive-row' : ''}><td><ProductImage product={product} /></td><td><strong>{product.codigo}</strong></td><td>{product.nombre}</td><td>{product.categoria ?? 'Sin categoría'}</td><td className={`number-cell ${stockClass(product)}`}><span className="stock-badge">{Number(product.cantidad_disponible)}</span></td><td className="number-cell">{formatMoney(product.costo_promedio)}</td><td className="number-cell">{formatMoney(product.precio_venta)}</td><td><span className={`status ${product.activo ? '' : 'status-inactive'}`}>{product.activo ? 'Activo' : 'Inactivo'}</span></td><td><ProductActions onView={onView} onEdit={onEdit} /></td></tr>; }
function ProductMobileCard({ product, onView, onEdit }: { product: ProductRow; onView: () => void; onEdit: () => void }) { return <article className={`product-card-mobile ${!product.activo ? 'inactive' : ''}`}><div className="product-card-header"><ProductImage product={product} /><div className="product-card-identity"><strong>{product.nombre}</strong><small>SKU: {product.codigo}</small></div><span className={`status ${product.activo ? '' : 'status-inactive'}`}>{product.activo ? 'Activo' : 'Inactivo'}</span></div><div className="product-card-body"><div><span>Categoría</span><b>{product.categoria ?? 'Sin categoría'}</b></div><div><span>Precio venta</span><b>{formatMoney(product.precio_venta)}</b></div><div><span>Costo prom.</span><b>{formatMoney(product.costo_promedio)}</b></div><div className={stockClass(product)}><span>Stock dispon.</span><div><span className="stock-badge">{Number(product.cantidad_disponible)} unid.</span></div></div></div><div className="product-card-footer"><ProductActions onView={onView} onEdit={onEdit} mobile /></div></article>; }
