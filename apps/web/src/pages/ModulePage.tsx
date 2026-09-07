import { Plus, Search } from 'lucide-react';
import { formatMoney } from '../lib/api';
import { useOfflineList } from '../lib/offline-query';

type Config = { title: string; subtitle: string; resource: string; action: string; columns: Array<[string, string]>; stage?: string };
const configs: Record<string, Config> = {
  productos: { title: 'Productos', subtitle: 'Catálogo, categorías, stock y costo promedio.', resource: '/catalogo/productos', action: 'Nuevo producto', columns: [['codigo', 'Código'], ['nombre', 'Producto'], ['categoria_id', 'Categoría'], ['activo', 'Estado']] },
  clientes: { title: 'Clientes', subtitle: 'Información, historial y préstamos asociados.', resource: '/catalogo/clientes', action: 'Nuevo cliente', columns: [['nombre', 'Cliente'], ['identificacion', 'Identificación'], ['telefono', 'Teléfono'], ['activo', 'Estado']] },
  compras: { title: 'Compras', subtitle: 'Registra el inventario adquirido y su costo final.', resource: '/compras', action: 'Registrar compra', columns: [['fecha', 'Fecha'], ['total', 'Total'], ['estado', 'Estado']], stage: 'La confirmación de compras y el movimiento de custodias se habilitarán en la etapa 6.' },
  ventas: { title: 'Ventas', subtitle: 'Ventas de contado, costo promedio y ganancia.', resource: '/ventas', action: 'Registrar venta', columns: [['fecha', 'Fecha'], ['total', 'Total'], ['ganancia_total', 'Ganancia'], ['estado', 'Estado']], stage: 'La confirmación de ventas y reducción de stock se habilitarán en la etapa 6.' },
  prestamos: { title: 'Préstamos', subtitle: 'Capital, interés mensual, vencimientos y pagos.', resource: '/prestamos', action: 'Nuevo préstamo', columns: [['fecha_desembolso', 'Desembolso'], ['capital_pendiente', 'Capital pendiente'], ['tasa_mensual', 'Tasa'], ['estado', 'Estado']], stage: 'La creación de préstamos y aplicación de pagos se habilitarán en la etapa 7.' },
  auditoria: { title: 'Auditoría de inventario', subtitle: 'Compara existencia del sistema contra la física.', resource: '/auditorias', action: 'Iniciar auditoría', columns: [['fecha_inicio', 'Inicio'], ['estado', 'Estado'], ['fecha_aprobacion', 'Aprobación']], stage: 'Los ajustes de inventario se habilitarán en la etapa 10.' }
};

function value(row: Record<string, unknown>, key: string) { const raw = row[key]; if (key.includes('total') || key.includes('capital') || key === 'monto') return formatMoney(raw as number); if (key === 'activo') return raw ? 'Activo' : 'Inactivo'; return raw ? String(raw).slice(0, 24) : '—'; }
export function ModulePage({ name }: { name: keyof typeof configs }) {
  const config = configs[name]; const store = ({ productos: 'productos', clientes: 'clientes', compras: 'compras', ventas: 'ventas', prestamos: 'prestamos', auditoria: 'configuracion' } as const)[name] ?? 'configuracion'; const { rows, offline } = useOfflineList(store, config.resource);
  return <><section className="page-title"><div><p className="eyebrow">OPERACIÓN</p><h2>{config.title}</h2><p>{config.subtitle}</p></div><button className="primary"><Plus size={18} /> {config.action}</button></section>{config.stage && <div className="notice">{config.stage}</div>}
    <section className="panel list-panel">{offline && <div className="offline-banner">Mostrando la última copia disponible en este dispositivo.</div>}<div className="table-tools"><div className="search"><Search size={17} /><input placeholder="Buscar…" /></div><span>{rows.length} registros</span></div><div className="table-wrap"><table><thead><tr>{config.columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={String(row.id ?? index)}>{config.columns.map(([key]) => <td key={key}><span className={key === 'estado' || key === 'activo' ? 'status' : ''}>{value(row, key)}</span></td>)}</tr>) : <tr><td className="empty-cell" colSpan={config.columns.length}>No hay registros locales todavía.</td></tr>}</tbody></table></div></section></>;
}
