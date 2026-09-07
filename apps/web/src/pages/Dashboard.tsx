import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Boxes, CreditCard, Landmark, ReceiptText, Wallet } from 'lucide-react';
import { api, formatMoney } from '../lib/api';
import { MetricCard } from '../components/MetricCard';

type Row = Record<string, string | number>;
const getRows = async (path: string) => (await api<{ data: Row[] }>(path)).data;
export function Dashboard() {
  const [stats, setStats] = useState({ custodias: 0, ventas: 0, prestamos: 0, gastos: 0 });
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { Promise.all([getRows('/custodias'), getRows('/ventas'), getRows('/prestamos'), getRows('/gastos')]).then(([custodias, ventas, prestamos, gastos]) => setStats({ custodias: custodias.reduce((total, row) => total + Number(row.saldo_actual ?? 0), 0), ventas: ventas.reduce((total, row) => total + Number(row.total ?? 0), 0), prestamos: prestamos.reduce((total, row) => total + Number(row.capital_pendiente ?? 0), 0), gastos: gastos.reduce((total, row) => total + Number(row.monto ?? 0), 0) })).catch(() => setUnavailable(true)); }, []);
  return <><section className="page-title"><div><p className="eyebrow">RESUMEN GENERAL</p><h2>Buenos días</h2><p>Una vista clara de la operación de AR Inversiones.</p></div><button className="primary">Registrar movimiento</button></section>
    {unavailable && <div className="notice">No se pudo consultar la API. Los indicadores se mostrarán al conectarla a PostgreSQL.</div>}
    <section className="metrics"><MetricCard label="Dinero en custodias" value={stats.custodias} icon={<Wallet />} /><MetricCard label="Ventas registradas" value={stats.ventas} icon={<ReceiptText />} accent="green" /><MetricCard label="Capital prestado" value={stats.prestamos} icon={<CreditCard />} accent="purple" /><MetricCard label="Gastos" value={stats.gastos} icon={<Landmark />} accent="orange" /></section>
    <section className="dashboard-grid"><article className="panel"><div className="panel-head"><div><h3>Actividad reciente</h3><p>Operaciones confirmadas recientemente</p></div><button className="text-button">Ver movimientos</button></div><div className="empty-state"><span><Boxes /></span><b>Aún no hay movimientos</b><p>Las compras, ventas y préstamos aparecerán aquí.</p></div></article>
    <article className="panel performance"><div className="panel-head"><div><h3>Resultado del período</h3><p>Ingresos y egresos acumulados</p></div></div><div className="result"><div><small>Ingresos</small><strong>{formatMoney(stats.ventas)}</strong><em><ArrowUpRight size={15} /> Ventas e intereses</em></div><div><small>Gastos</small><strong>{formatMoney(stats.gastos)}</strong><em className="negative"><ArrowDownRight size={15} /> Operativos</em></div></div></article></section>
  </>;
}
