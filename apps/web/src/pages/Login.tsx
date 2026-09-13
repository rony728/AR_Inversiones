import { useState } from 'react';
import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { api } from '../lib/api';

type AuthUser = { id: string; usuario: string; nombre: string };
export function Login({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [usuario, setUsuario] = useState(''); const [password, setPassword] = useState(''); const [showPassword, setShowPassword] = useState(false); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setLoading(true); setError(''); try { const result = await api<{ token: string; user: AuthUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ usuario, password }) }); sessionStorage.setItem('ar-token', result.token); sessionStorage.setItem('ar-user', JSON.stringify(result.user)); onLogin(result.user); } catch (err) { setError(err instanceof Error ? err.message : 'No fue posible iniciar sesión.'); } finally { setLoading(false); } }
  return (
    <div className="login">
      <section>
        <div className="login-brand">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="AR Inversiones Logo" className="login-logo-img" />
          <span>AR <b>Inversiones</b></span>
        </div>
        <h1>Controla tu operación con claridad.</h1>
        <p>Inventario, préstamos y fondos en un solo lugar.</p>
        <div className="login-note"><LockKeyhole size={18} /> Acceso protegido para el equipo de AR Inversiones.</div>
      </section>
      <div className="login-form-side"><form onSubmit={submit}>
          <p className="eyebrow">INICIAR SESIÓN</p>
          <h2>Bienvenido</h2>
          <label>Usuario<input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" required /></label>
          <label>Contraseña<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /><button type="button" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary wide" disabled={loading}>{loading ? 'Ingresando…' : 'Ingresar'}</button>
        </form></div>
    </div>
  );

}
