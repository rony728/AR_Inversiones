export type ProductRow = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  categoria_id: string | null;
  categoria: string | null;
  cantidad_disponible: number | string;
  costo_promedio: number | string;
  precio_venta: number | string;
  existencia_minima: number | string;
  activo: boolean;
  marca?: string | null;
  modelo?: string | null;
  codigo_barras?: string | null;
  control_serie?: boolean;
  garantia_dias?: number | string;
  precio_minimo?: number | string | null;
  created_at?: string;
  updated_at?: string;
  tiene_imagen?: boolean;
  imagen_tipo_mime?: string | null;
  imagen_tamano_bytes?: number | null;
  imagen_actualizada_at?: string | null;
};

export type ProductSort = 'codigo' | 'producto' | 'categoria' | 'cantidad' | 'costo' | 'precio' | 'estado';
export type SortDirection = 'asc' | 'desc';
export type ProductFilters = {
  search: string;
  categoryId: string;
  status: 'all' | 'active' | 'inactive';
  stock: 'all' | 'with' | 'without';
  stockValue: string;
  costValue: string;
  priceValue: string;
};

export const emptyProductFilters: ProductFilters = { search: '', categoryId: '', status: 'all', stock: 'all', stockValue: '', costValue: '', priceValue: '' };

export const normalizeSearch = (value: unknown) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-HN');

function matchesExactValue(value: number, selected: string) {
  return selected === '' || value === Number(selected);
}

export function filterProducts(rows: ProductRow[], filters: ProductFilters | string) {
  const resolved = typeof filters === 'string' ? { ...emptyProductFilters, search: filters } : filters;
  const term = normalizeSearch(resolved.search.trim());
  return rows.filter((row) => {
    const quantity = Number(row.cantidad_disponible);
    const matchesSearch = !term || [row.codigo, row.nombre, row.categoria].some((value) => normalizeSearch(value).includes(term));
    const matchesCategory = !resolved.categoryId || row.categoria_id === resolved.categoryId;
    const matchesStatus = resolved.status === 'all' || (resolved.status === 'active' ? row.activo : !row.activo);
    const matchesStock = resolved.stock === 'all' || (resolved.stock === 'with' ? quantity > 0 : quantity === 0);
    return matchesSearch && matchesCategory && matchesStatus && matchesStock
      && matchesExactValue(quantity, resolved.stockValue)
      && matchesExactValue(Number(row.costo_promedio), resolved.costValue)
      && matchesExactValue(Number(row.precio_venta), resolved.priceValue);
  });
}

export function uniqueNumericValues(rows: ProductRow[], field: 'cantidad_disponible' | 'costo_promedio' | 'precio_venta') {
  return [...new Set(rows.map((row) => Number(row[field])).filter(Number.isFinite))].sort((left, right) => left - right);
}

export function sortProducts(rows: ProductRow[], sort: ProductSort, direction: SortDirection) {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort === 'codigo') return left.codigo.localeCompare(right.codigo, 'es', { sensitivity: 'base', numeric: true }) * factor;
    if (sort === 'producto') return left.nombre.localeCompare(right.nombre, 'es', { sensitivity: 'base' }) * factor;
    if (sort === 'categoria') return String(left.categoria ?? '').localeCompare(String(right.categoria ?? ''), 'es', { sensitivity: 'base' }) * factor;
    if (sort === 'estado') return (Number(left.activo) - Number(right.activo)) * factor;
    const field = sort === 'cantidad' ? 'cantidad_disponible' : sort === 'costo' ? 'costo_promedio' : 'precio_venta';
    return (Number(left[field]) - Number(right[field])) * factor;
  });
}

export function productProfit(product: Pick<ProductRow, 'costo_promedio' | 'precio_venta'>) {
  const cost = Number(product.costo_promedio);
  const price = Number(product.precio_venta);
  const profit = price - cost;
  return { profit, margin: price > 0 ? (profit / price) * 100 : 0 };
}
