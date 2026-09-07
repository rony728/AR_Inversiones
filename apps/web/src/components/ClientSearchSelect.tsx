import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { filterActiveClients } from '../lib/sale-form';

type Props = {
  clients: Array<Record<string, unknown>>;
  selectedId: string;
  onChange: (clientId: string) => void;
};

export function ClientSearchSelect({ clients, selectedId, onChange }: Props) {
  const optionsId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = clients.find((client) => client.id === selectedId);
  const options = useMemo(() => filterActiveClients(clients, query), [clients, query]);

  function choose(clientId: string) {
    onChange(clientId);
    setOpen(false);
    setQuery('');
  }

  return <div className="product-combobox client-combobox">
    <Search size={16} />
    <input
      aria-label="Buscar cliente por nombre"
      aria-expanded={open}
      aria-controls={optionsId}
      role="combobox"
      autoComplete="off"
      placeholder="Sin especificar · buscar cliente…"
      value={open ? query : selected ? String(selected.nombre) : ''}
      onFocus={() => { setOpen(true); setQuery(''); }}
      onBlur={() => window.setTimeout(() => { setOpen(false); setQuery(''); }, 120)}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
    />
    {open && <div className="product-options" id={optionsId} role="listbox">
      <button type="button" role="option" aria-selected={!selectedId} onMouseDown={(event) => event.preventDefault()} onClick={() => choose('')}><strong>Sin especificar</strong></button>
      {options.length ? options.slice(0, 50).map((client) => <button key={String(client.id)} type="button" role="option" aria-selected={client.id === selectedId} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(String(client.id))}><strong>{String(client.nombre)}</strong></button>) : query && <span>No hay clientes activos que coincidan.</span>}
    </div>}
  </div>;
}
