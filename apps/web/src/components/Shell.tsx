import { useEffect, useState, type ReactNode } from 'react';
import { Activity, BadgeDollarSign, Boxes, ChartNoAxesCombined, ClipboardCheck, CreditCard, LayoutDashboard, Menu, PackagePlus, Settings, ShoppingCart, Users, Wallet } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { pendingCount } from '../lib/offline-db';

const nav = [
  ['/', 'Dashboard', LayoutDashboard], ['/productos', 'Productos', Boxes], ['/compras', 'Compras', PackagePlus], ['/ventas', 'Ventas', ShoppingCart], ['/clientes', 'Clientes', Users], ['/prestamos', 'Préstamos', CreditCard], ['/custodias', 'Custodias', Wallet], ['/finanzas', 'Finanzas', ChartNoAxesCombined], ['/auditoria', 'Auditoría', ClipboardCheck], ['/configuracion', 'Configuración', Settings]
] as const;

export function Shell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine); const [pending, setPending] = useState(0);
  useEffect(() => { const refresh = () => { setOnline(navigator.onLine); void pendingCount().then(setPending); }; refresh(); window.addEventListener('online', refresh); window.addEventListener('offline', refresh); const timer = window.setInterval(refresh, 4000); return () => { window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh); window.clearInterval(timer); }; }, []);
  return <div className="app-shell">
    <aside className={open ? 'sidebar open' : 'sidebar'}>
      <div className="brand"><span className="brand-mark"><BadgeDollarSign size={22} /></span><span>AR <b>Inversiones</b></span></div>
      <nav>{nav.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-foot"><span className={online ? '' : 'offline'}><Activity size={15} /> {online ? 'En línea' : 'Sin conexión'}{pending ? ` · ${pending} pendientes` : ''}</span><button className="text-button" onClick={onLogout}>Cerrar sesión</button></div>
    </aside>
    <main><header className="topbar"><button className="menu-button" aria-label="Abrir menú" onClick={() => setOpen(!open)}><Menu /></button><div><small>AR INVERSIONES</small><h1>Control empresarial</h1></div><div className="user-pill"><span>AR</span><div><b>Usuario</b><small>Acceso operativo</small></div></div></header><div className="page-content">{children}</div></main>
  </div>;
}
