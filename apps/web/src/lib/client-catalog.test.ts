import { describe, expect, it } from 'vitest';
import { clientFormsEqual, clientPayload, filterClients, type ClientForm, type ClientRow } from './client-catalog';

const rows: ClientRow[] = [
  { id: '2', nombre: 'Zoé López', identificacion: '0801-20', telefono: '9999 0000', direccion: null, notas: null, activo: false },
  { id: '1', nombre: 'Ana Pérez', identificacion: 'RTN-123', telefono: '2222-1111', direccion: null, notas: null, activo: true },
  { id: '3', nombre: 'Carlos Díaz', identificacion: null, telefono: null, direccion: null, notas: null, activo: true }
];

describe('catálogo de clientes', () => {
  it('busca sin distinguir mayúsculas, acentos ni espacios y ordena alfabéticamente', () => {
    expect(filterClients(rows, '  ANA   PEREZ ', 'todos').map((row) => row.id)).toEqual(['1']);
    expect(filterClients(rows, 'rtn-123', 'todos').map((row) => row.id)).toEqual(['1']);
    expect(filterClients(rows, '9999', 'todos').map((row) => row.id)).toEqual(['2']);
    expect(filterClients(rows, '', 'todos').map((row) => row.id)).toEqual(['1', '3', '2']);
  });

  it('filtra clientes activos e inactivos', () => {
    expect(filterClients(rows, '', 'activos').map((row) => row.id)).toEqual(['1', '3']);
    expect(filterClients(rows, '', 'inactivos').map((row) => row.id)).toEqual(['2']);
  });

  it('normaliza campos opcionales vacíos como null y detecta formularios sin cambios', () => {
    const form: ClientForm = { nombre: ' Ana ', identificacion: ' ', telefono: '', direccion: ' Tegucigalpa ', notas: '', activo: true };
    expect(clientPayload(form)).toEqual({ nombre: 'Ana', identificacion: null, telefono: null, direccion: 'Tegucigalpa', notas: null, activo: true });
    expect(clientFormsEqual(form, { ...form, nombre: 'Ana', direccion: 'Tegucigalpa' })).toBe(true);
    expect(clientFormsEqual(form, { ...form, activo: false })).toBe(false);
  });
});
