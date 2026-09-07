import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { filterProducts, type ProductRow } from '../lib/product-catalog';
import { selectablePurchaseProducts } from '../lib/purchase-form';

type Props = {
  products: ProductRow[];
  selectedId: string;
  excludedIds: string[];
  onChange: (productId: string) => void;
};

export function ProductSearchSelect({ products, selectedId, excludedIds, onChange }: Props) {
  const optionsId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = products.find((product) => product.id === selectedId);
  const options = useMemo(() => filterProducts(selectablePurchaseProducts(products, excludedIds, selectedId), query), [excludedIds, products, query, selectedId]);

  function choose(productId: string) {
    onChange(productId);
    setOpen(false);
    setQuery('');
  }

  return <div className="product-combobox">
    <Search size={16} />
    <input
      aria-label="Buscar producto por nombre o código"
      aria-expanded={open}
      aria-controls={optionsId}
      role="combobox"
      autoComplete="off"
      placeholder="Buscar por nombre o código…"
      value={open ? query : selected ? `${selected.nombre} · ${selected.codigo}` : ''}
      onFocus={() => { setOpen(true); setQuery(''); }}
      onBlur={() => window.setTimeout(() => { setOpen(false); setQuery(''); }, 120)}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
    />
    {open && <div className="product-options" id={optionsId} role="listbox">
      {options.length ? options.slice(0, 50).map((product) => <button key={product.id} type="button" role="option" aria-selected={product.id === selectedId} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(product.id)}>
        <strong>{product.nombre}</strong><small>{product.codigo}</small>
      </button>) : <span>No hay productos disponibles que coincidan.</span>}
    </div>}
  </div>;
}
