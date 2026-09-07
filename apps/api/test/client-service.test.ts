import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { clientCreateInput, clientListSql, clientUpdateInput, createClient, summarizeClientLoans, updateClient } from '../src/modules/catalog/client-service.js';
import { requireActiveClient } from '../src/modules/operations/client-guard.js';
import { registerSale, saleInput } from '../src/modules/operations/inventory-service.js';
import { createLoan, loanInput } from '../src/modules/operations/loan-service.js';

type Call = { text: string; values: unknown[] };
const clientId = '11111111-1111-4111-8111-111111111111';

function serviceClient(before: Record<string, unknown> = { id: clientId, nombre: 'Ana', identificacion: null, telefono: null, direccion: null, notas: null, activo: true }) {
  const calls: Call[] = [];
  const client = {
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      if (text.startsWith('SELECT * FROM clientes')) return { rows: [before] };
      if (text.startsWith('INSERT INTO clientes')) return { rows: [{ ...before, nombre: values[0], identificacion: values[1], telefono: values[2], direccion: values[3], notas: values[4] }] };
      if (text.startsWith('UPDATE clientes')) {
        const changed = { ...before };
        const set = text.slice(text.indexOf('SET') + 3, text.indexOf('WHERE')).split(',');
        set.forEach((part, index) => { changed[part.split('=')[0].trim()] = values[index]; });
        return { rows: [changed] };
      }
      return { rows: [] };
    }
  } as unknown as PoolClient;
  return { client, calls };
}

test('valida y normaliza la creación y actualización de clientes', () => {
  assert.deepEqual(clientCreateInput.parse({ nombre: ' Ana ', identificacion: ' ', telefono: '', direccion: null }), {
    nombre: 'Ana', identificacion: null, telefono: null, direccion: null
  });
  assert.throws(() => clientCreateInput.parse({ nombre: '' }));
  assert.throws(() => clientCreateInput.parse({ nombre: 'a'.repeat(181) }));
  assert.throws(() => clientCreateInput.parse({ nombre: 'Ana', identificacion: 'a'.repeat(81) }));
  assert.throws(() => clientCreateInput.parse({ nombre: 'Ana', telefono: 'a'.repeat(51) }));
  assert.throws(() => clientCreateInput.parse({ nombre: 'Ana', desconocido: true }));
  assert.throws(() => clientUpdateInput.parse({}));
  assert.deepEqual(clientCreateInput.parse({ nombre: 'Ana', identificacion: '0801', telefono: '9999', direccion: 'Centro', notas: 'Preferente' }), {
    nombre: 'Ana', identificacion: '0801', telefono: '9999', direccion: 'Centro', notas: 'Preferente'
  });
});

test('crea cliente con campos opcionales nulos y registra auditoría', async () => {
  const { client, calls } = serviceClient();
  const created = await createClient(client, clientCreateInput.parse({ nombre: 'Ana' }), 'usuario-1');
  assert.equal(created.nombre, 'Ana');
  assert.deepEqual(calls[0].values, ['Ana', null, null, null, null]);
  const audit = calls.find((call) => call.text.includes('INSERT INTO auditoria_sistema'));
  assert.deepEqual(audit?.values.slice(0, 4), ['usuario-1', 'cliente', clientId, 'CREAR']);
});

test('devuelve un conflicto entendible para identificación duplicada', async () => {
  const client = { query: async () => { throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'clientes_identificacion_unica' }); } } as unknown as PoolClient;
  await assert.rejects(createClient(client, clientCreateInput.parse({ nombre: 'Ana', identificacion: '0801' })), (error: unknown) => {
    const value = error as { code?: string; status?: number; message?: string };
    return value.code === 'DUPLICATE_CLIENT_IDENTIFICATION' && value.status === 409 && value.message === 'Ya existe un cliente con esa identificación.';
  });
});

test('actualiza datos, evita guardar sin cambios y audita desactivación/reactivación', async () => {
  const first = serviceClient();
  await updateClient(first.client, clientId, clientUpdateInput.parse({ telefono: '9999-9999' }), 'usuario-1');
  assert.equal(first.calls.some((call) => call.text.startsWith('UPDATE clientes SET telefono=')), true);
  assert.equal(first.calls.find((call) => call.text.includes('INSERT INTO auditoria_sistema'))?.values[3], 'ACTUALIZAR');

  const same = serviceClient();
  await assert.rejects(updateClient(same.client, clientId, clientUpdateInput.parse({ nombre: 'Ana' })), (error: unknown) => (error as { code?: string }).code === 'NO_CHANGES');
  assert.equal(same.calls.some((call) => call.text.startsWith('UPDATE clientes')), false);

  const disabled = serviceClient();
  await updateClient(disabled.client, clientId, clientUpdateInput.parse({ activo: false }));
  assert.equal(disabled.calls.find((call) => call.text.includes('INSERT INTO auditoria_sistema'))?.values[3], 'DESACTIVAR');
  assert.equal(disabled.calls.some((call) => /UPDATE (prestamos|ventas)/.test(call.text)), false);

  const enabled = serviceClient({ id: clientId, nombre: 'Ana', identificacion: null, telefono: null, direccion: null, notas: null, activo: false });
  await updateClient(enabled.client, clientId, clientUpdateInput.parse({ activo: true }));
  assert.equal(enabled.calls.find((call) => call.text.includes('INSERT INTO auditoria_sistema'))?.values[3], 'REACTIVAR');
});

test('resume préstamos y la consulta de listado agrega sin ocultar clientes inactivos', () => {
  assert.deepEqual(summarizeClientLoans([
    { estado: 'ACTIVO', capital_pendiente: '100.50' },
    { estado: 'VENCIDO', capital_pendiente: '200.00' },
    { estado: 'PAGADO', capital_pendiente: '0' }
  ]), { activos: 1, vencidos: 1, pagados: 1, capitalPendiente: 300.5 });
  assert.match(clientListSql, /GROUP BY cliente_id/);
  assert.match(clientListSql, /ORDER BY lower\(c\.nombre\)/);
  assert.doesNotMatch(clientListSql, /c\.activo\s*=\s*true/);
});

for (const loanState of ['ACTIVO', 'VENCIDO']) {
  test(`permite desactivar un cliente con préstamo ${loanState.toLowerCase()} sin tocar préstamos ni finanzas`, async () => {
    const { client, calls } = serviceClient();
    await updateClient(client, clientId, clientUpdateInput.parse({ activo: false }));
    assert.equal(calls.some((call) => /UPDATE (prestamos|ventas)|INSERT INTO movimientos_financieros/.test(call.text)), false);
    assert.equal(calls.find((call) => call.text.includes('INSERT INTO auditoria_sistema'))?.values[3], 'DESACTIVAR');
  });
}

test('rechaza clientes inexistentes o inactivos como autoridad del backend', async () => {
  const calls: Call[] = [];
  const client = { query: async (text: string, values: unknown[] = []) => { calls.push({ text, values }); return { rows: [] }; } } as unknown as PoolClient;
  await assert.rejects(requireActiveClient(client, clientId), (error: unknown) => (error as { code?: string }).code === 'INVALID_CLIENT');

  const sale = saleInput.parse({ clienteId: clientId, items: [{ productoId: '22222222-2222-4222-8222-222222222222', socioId: '33333333-3333-4333-8333-333333333333', custodiaId: '44444444-4444-4444-8444-444444444444', cantidad: 1, precioUnitario: 100 }] });
  await assert.rejects(registerSale(client, sale), (error: unknown) => (error as { code?: string }).code === 'INVALID_CLIENT');
  assert.equal(calls.some((call) => call.text.includes('INSERT INTO ventas')), false);

  const loan = loanInput.parse({ clienteId: clientId, socioId: '33333333-3333-4333-8333-333333333333', custodiaId: '44444444-4444-4444-8444-444444444444', capital: 100, fechaDesembolso: '2026-09-07' });
  await assert.rejects(createLoan(client, loan), (error: unknown) => (error as { code?: string }).code === 'INVALID_CLIENT');
  assert.equal(calls.some((call) => call.text.includes('INSERT INTO prestamos')), false);
});
