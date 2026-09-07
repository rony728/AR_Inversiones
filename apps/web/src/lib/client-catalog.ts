export type ClientStatusFilter = 'todos' | 'activos' | 'inactivos';

export type ClientRow = {
  id: string;
  nombre: string;
  identificacion: string | null;
  telefono: string | null;
  direccion: string | null;
  notas: string | null;
  activo: boolean;
  created_at?: string;
  updated_at?: string;
  prestamos_activos?: number | string;
  prestamos_vencidos?: number | string;
  prestamos_activos_vencidos?: number | string;
  capital_pendiente_total?: number | string;
};

export type ClientForm = {
  nombre: string;
  identificacion: string;
  telefono: string;
  direccion: string;
  notas: string;
  activo: boolean;
};

const searchable = (value: string | null | undefined) => (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-HN').replace(/\s+/g, ' ').trim();

export function filterClients(clients: ClientRow[], search: string, status: ClientStatusFilter) {
  const term = searchable(search);
  return clients.filter((client) => {
    const matchesStatus = status === 'todos' || (status === 'activos' ? client.activo : !client.activo);
    const matchesSearch = !term || [client.nombre, client.identificacion, client.telefono].some((value) => searchable(value).includes(term));
    return matchesStatus && matchesSearch;
  }).sort((left, right) => left.nombre.localeCompare(right.nombre, 'es-HN', { sensitivity: 'base' }) || left.id.localeCompare(right.id));
}

const optional = (value: string) => value.trim() || null;

export function clientPayload(form: ClientForm) {
  return {
    nombre: form.nombre.trim(),
    identificacion: optional(form.identificacion),
    telefono: optional(form.telefono),
    direccion: optional(form.direccion),
    notas: optional(form.notas),
    activo: form.activo
  };
}

export function clientFormFromRow(client: ClientRow): ClientForm {
  return {
    nombre: client.nombre,
    identificacion: client.identificacion ?? '',
    telefono: client.telefono ?? '',
    direccion: client.direccion ?? '',
    notas: client.notas ?? '',
    activo: client.activo
  };
}

export function clientFormsEqual(left: ClientForm, right: ClientForm) {
  return JSON.stringify(clientPayload(left)) === JSON.stringify(clientPayload(right));
}
