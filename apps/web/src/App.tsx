import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Custodias } from './pages/Custodias';
import { Dashboard } from './pages/Dashboard';
import { Finanzas } from './pages/Finanzas';
import { Login } from './pages/Login';
import { ModulePage } from './pages/ModulePage';
import { Settings } from './pages/Settings';
import { TransactionPage } from './pages/TransactionPage';
import { LoansPage } from './pages/LoansPage';
import { InventoryAuditPage } from './pages/InventoryAuditPage';
import { beginSyncListener } from './lib/sync';
import { api } from './lib/api';

export function App() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem('ar-token')));
  const [userName, setUserName] = useState(() => { try { return JSON.parse(sessionStorage.getItem('ar-user') ?? '{}').nombre ?? ''; } catch { return ''; } });
  useEffect(() => beginSyncListener(), []);
  useEffect(() => { if (authenticated && !userName) void api<{ user: { nombre: string } }>('/auth/me').then((result) => { setUserName(result.user.nombre); sessionStorage.setItem('ar-user', JSON.stringify(result.user)); }).catch(() => undefined); }, [authenticated, userName]);
  if (!authenticated) return <Login onLogin={(user) => { setUserName(user.nombre); setAuthenticated(true); }} />;
  return <Shell userName={userName || 'Equipo AR'} onLogout={() => { sessionStorage.removeItem('ar-token'); sessionStorage.removeItem('ar-user'); setUserName(''); setAuthenticated(false); }}><Routes>
    <Route path="/" element={<Dashboard />} /><Route path="/productos" element={<ModulePage name="productos" />} /><Route path="/compras" element={<TransactionPage kind="compra" />} /><Route path="/ventas" element={<TransactionPage kind="venta" />} /><Route path="/clientes" element={<ModulePage name="clientes" />} /><Route path="/prestamos" element={<LoansPage />} /><Route path="/custodias" element={<Custodias />} /><Route path="/finanzas" element={<Finanzas />} /><Route path="/auditoria" element={<InventoryAuditPage />} /><Route path="/configuracion" element={<Settings />} /><Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Shell>;
}
