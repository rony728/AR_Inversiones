import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, Boxes, ChartNoAxesCombined, ClipboardCheck, CreditCard, LayoutDashboard, Menu, PackagePlus, RefreshCw, Settings, ShoppingCart, Users, Wallet } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { isProductionApiUrl } from '../lib/api';
import { formatLastSync, useOperationalStatus } from '../lib/operational-status';

const nav = [
  ['/', 'Dashboard', LayoutDashboard], ['/productos', 'Productos', Boxes], ['/compras', 'Compras', PackagePlus], ['/ventas', 'Ventas', ShoppingCart], ['/clientes', 'Clientes', Users], ['/prestamos', 'Préstamos', CreditCard], ['/custodias', 'Fondos', Wallet], ['/finanzas', 'Finanzas', ChartNoAxesCombined], ['/auditoria', 'Auditoría', ClipboardCheck], ['/configuracion', 'Configuración', Settings]
] as const;

export function Shell({ children, userName, onLogout }: { children: ReactNode; userName: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const presenceRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const status = useOperationalStatus();
  const statusLabel = status.mode === 'online' ? 'En línea' : status.mode === 'syncing' ? 'Sincronizando' : 'Local';
  useEffect(() => { setPresenceOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!presenceOpen) return;
    const closeOutside = (event: MouseEvent) => { if (!presenceRef.current?.contains(event.target as Node)) setPresenceOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPresenceOpen(false); };
    document.addEventListener('mousedown', closeOutside); document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, [presenceOpen]);
  return <div className="app-shell">
    <aside className={open ? 'sidebar open' : 'sidebar'}>
      <div className="brand">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="AR Inversiones Logo" className="brand-logo-img" />
        <span>AR <b>Inversiones</b></span>
      </div>
      <nav>{nav.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-foot"><span className={status.mode === 'local' ? 'offline' : ''}><Activity size={15} /> {statusLabel}{status.pending > 0 ? ` · Pendientes: ${status.pending}` : ''}</span><button className="text-button" onClick={onLogout}>Cerrar sesión</button></div>
    </aside>
    <main><header className="topbar"><button className="menu-button" aria-label="Abrir menú" onClick={() => setOpen(!open)}><Menu /></button><div className="topbar-brand"><small>AR INVERSIONES</small><h1>Control empresarial</h1></div><div className="topbar-operations" aria-live="polite">{!isProductionApiUrl() && <span className="environment-badge">PRUEBAS</span>}<span className={`connection-state ${status.mode}`}><Activity size={14} /> {statusLabel}</span>{status.pending > 0 && <span className="pending-state">Pendientes: {status.pending}</span>}{status.lastSyncedAt && <span className="last-sync">{formatLastSync(status.lastSyncedAt, status.now)}</span>}{status.mode !== 'local' && status.users.length > 0 && <div className="presence" ref={presenceRef}><button type="button" className="presence-trigger" aria-label={`${status.users.length} ${status.users.length === 1 ? 'usuario activo' : 'usuarios activos'}`} aria-haspopup="true" aria-expanded={presenceOpen} onClick={() => setPresenceOpen((visible) => !visible)}><Users size={15} /><span>{status.users.length} {status.users.length === 1 ? 'usuario activo' : 'usuarios activos'}</span></button>{presenceOpen && <div className="presence-popover" role="dialog" aria-label="Usuarios activos"><strong>Usuarios activos</strong>{status.users.map((user) => <span key={user.id}>{user.nombre}</span>)}</div>}</div>}{status.mode === 'syncing' && <RefreshCw className="sync-spinner" size={15} aria-hidden="true" />}</div><div className="user-pill"><span>{userName.trim().slice(0, 2).toUpperCase()}</span><div><b>{userName}</b><small>Acceso operativo</small></div></div></header><div className="page-content">{children}</div></main>
  </div>;
}
