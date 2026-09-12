import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { changeUserPassword, createUser, passwordChangeInput, updateUser, userCreateInput, userUpdateInput } from '../src/modules/catalog/user-service.js';

const userId = '11111111-1111-4111-8111-111111111111';
type Call = { sql: string; values: unknown[] };
function mockClient() {
  const safeUser = { id: userId, nombre: 'Rony', usuario: 'rony', activo: true, created_at: '2026-09-12', updated_at: '2026-09-12' };
  const calls: Call[] = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT')) return { rows: [safeUser] };
    if (sql.startsWith('INSERT INTO usuarios')) return { rows: [{ ...safeUser, nombre: values[0], usuario: values[1] }] };
    if (sql.startsWith('UPDATE usuarios SET password_hash')) return { rows: [] };
    if (sql.startsWith('UPDATE usuarios SET')) return { rows: [{ ...safeUser, ...Object.fromEntries(sql.match(/SET (.+) WHERE/)![1].split(',').map((entry, index) => [entry.split('=')[0], values[index]])) }] };
    return { rows: [] };
  } };
  return { client, calls };
}

test('valida creación, edición y cambio de contraseña por separado', () => {
  assert.equal(userCreateInput.safeParse({ nombre: 'Rony', usuario: 'rony', password: 'clave-segura' }).success, true);
  assert.equal(userCreateInput.safeParse({ nombre: 'Rony', usuario: 'rony', password: 'corta' }).success, false);
  assert.equal(userUpdateInput.safeParse({ password: 'no-permitida' }).success, false);
  assert.equal(userUpdateInput.safeParse({}).success, false);
  assert.equal(passwordChangeInput.safeParse({ password: 'clave-nueva' }).success, true);
});

test('crea usuarios con hash y nunca lo devuelve ni lo audita', async () => {
  const db = mockClient(); const rawPassword = 'clave-segura';
  const result = await createUser(db.client as never, userCreateInput.parse({ nombre: 'Alex', usuario: 'alex', password: rawPassword }), 'actor-1');
  const insert = db.calls.find((call) => call.sql.startsWith('INSERT INTO usuarios'))!;
  assert.equal(await bcrypt.compare(rawPassword, String(insert.values[2])), true);
  assert.equal('password_hash' in result, false);
  const audit = db.calls.find((call) => call.sql.includes('INSERT INTO auditoria_sistema'))!;
  assert.equal(JSON.stringify(audit.values).includes(rawPassword), false); assert.equal(JSON.stringify(audit.values).includes(String(insert.values[2])), false);
});

test('edita y activa o desactiva usando solo columnas seguras en auditoría', async () => {
  const db = mockClient(); await updateUser(db.client as never, userId, userUpdateInput.parse({ nombre: 'Rony A.', activo: false }), 'actor-1');
  const select = db.calls.find((call) => call.sql.startsWith('SELECT'))!; assert.equal(select.sql.includes('*'), false); assert.equal(select.sql.includes('password_hash'), false);
  const audit = db.calls.find((call) => call.sql.includes('INSERT INTO auditoria_sistema'))!; assert.equal(audit.values[3], 'DESACTIVAR'); assert.equal(JSON.stringify(audit.values).includes('password_hash'), false);
});

test('cambia la contraseña sin registrar contraseña ni hash en auditoría', async () => {
  const db = mockClient(); const rawPassword = 'clave-totalmente-nueva';
  await changeUserPassword(db.client as never, userId, passwordChangeInput.parse({ password: rawPassword }), 'actor-1');
  const update = db.calls.find((call) => call.sql.startsWith('UPDATE usuarios SET password_hash'))!; assert.equal(await bcrypt.compare(rawPassword, String(update.values[0])), true);
  const audit = db.calls.find((call) => call.sql.includes('INSERT INTO auditoria_sistema'))!; assert.equal(audit.values[3], 'CAMBIAR_PASSWORD'); assert.equal(JSON.stringify(audit.values).includes(rawPassword), false); assert.equal(JSON.stringify(audit.values).includes(String(update.values[0])), false);
});
