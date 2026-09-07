export type ProductRow = {
  id: string;
  codigo: string;
  nombre: string;
  categoria_id: string | null;
  categoria: string | null;
  cantidad_disponible: number | string;
  costo_promedio: number | string;
  precio_venta: number | string;
  existencia_minima: number | string;
  activo: boolean;
};

export type ProductSort = 'producto' | 'cantidad' | 'costo' | 'precio';
export type SortDirection = 'asc' | 'desc';

export const normalizeSearch = (value: unknown) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-HN');

export function filterProducts(rows: ProductRow[], search: string) {
  const term = normalizeSearch(search.trim());
  if (!term) return rows;
  return rows.filter((row) => [row.codigo, row.nombre, row.categoria].some((value) => normalizeSearch(value).includes(term)));
}

export function sortProducts(rows: ProductRow[], sort: ProductSort, direction: SortDirection) {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort === 'producto') return left.nombre.localeCompare(right.nombre, 'es', { sensitivity: 'base' }) * factor;
    const field = sort === 'cantidad' ? 'cantidad_disponible' : sort === 'costo' ? 'costo_promedio' : 'precio_venta';
    return (Number(left[field]) - Number(right[field])) * factor;
  });
}
