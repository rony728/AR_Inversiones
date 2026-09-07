import { useState } from 'react';
import { BadgeDollarSign, LockKeyhole } from 'lucide-react';
import { api } from '../lib/api';

type AuthUser = { id: string; usuario: string; nombre: string };
export function Login({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [usuario, setUsuario] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setLoading(true); setError(''); try { const result = await api<{ token: string; user: AuthUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ usuario, password }) }); sessionStorage.setItem('ar-token', result.token); sessionStorage.setItem('ar-user', JSON.stringify(result.user)); onLogin(result.user); } catch (err) { setError(err instanceof Error ? err.message : 'No fue posible iniciar sesión.'); } finally { setLoading(false); } }
  return <div className="login"><section><div className="login-brand"><BadgeDollarSign /> AR <b>Inversiones</b></div><h1>Controla tu operación con claridad.</h1><p>Inventario, préstamos y fondos en un solo lugar.</p><div className="login-note"><LockKeyhole size={18} /> Acceso protegido para el equipo de AR Inversiones.</div></section><form onSubmit={submit}><p className="eyebrow">INICIAR SESIÓN</p><h2>Bienvenido</h2><label>Usuario<input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" required /></label><label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>{error && <p className="form-error">{error}</p>}<button className="primary wide" disabled={loading}>{loading ? 'Ingresando…' : 'Ingresar'}</button><small>La primera cuenta se configura desde la API mediante el proceso de inicialización.</small></form></div>;
}
