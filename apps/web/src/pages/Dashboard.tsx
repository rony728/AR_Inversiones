import { useEffect, useState } from 'react';
import { Banknote, Boxes, CircleDollarSign, CreditCard, HandCoins, Landmark, PackagePlus, ReceiptText, ShoppingCart, TriangleAlert, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, formatMoney } from '../lib/api';
import { MetricCard } from '../components/MetricCard';

type Preset = 'current' | 'previous' | 'custom';
type DashboardData = {
  periodo: { desde: string; hasta: string };
  indicadores: { ventas: number; gananciaNeta: number; gastos: number; intereses: number; capitalPrestadoActual: number; prestamosVencidos: number; fondosTotales: number; valorInventario: number };
  resultado: { ventas: number; gananciaVentas: number; intereses: number; otrosIngresos: number; gastos: number; perdidasPrestamo: number; gananciaNeta: number };
  actividad: Array<{ id: string; tipo: string; fecha: string; monto: string; descripcion: string }>;
};
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const monthRange = (offset: number) => { const now = new Date(); return { desde: iso(new Date(now.getFullYear(), now.getMonth() + offset, 1)), hasta: iso(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)) }; };
const empty: DashboardData = { periodo: monthRange(0), indicadores: { ventas: 0, gananciaNeta: 0, gastos: 0, intereses: 0, capitalPrestadoActual: 0, prestamosVencidos: 0, fondosTotales: 0, valorInventario: 0 }, resultado: { ventas: 0, gananciaVentas: 0, intereses: 0, otrosIngresos: 0, gastos: 0, perdidasPrestamo: 0, gananciaNeta: 0 }, actividad: [] };
const activityLabel: Record<string, string> = { VENTA: 'Venta', COMPRA: 'Compra', PRESTAMO: 'Préstamo', PAGO_PRESTAMO: 'Pago de préstamo', GASTO: 'Gasto', TRANSFERENCIA_FONDOS: 'Transferencia entre fondos', DISTRIBUCION_UTILIDAD: 'Distribución de utilidad' };

export function Dashboard() {
  const initial = monthRange(0);
  const [preset, setPreset] = useState<Preset>('current');
  const [desde, setDesde] = useState(initial.desde);
  const [hasta, setHasta] = useState(initial.hasta);
  const [data, setData] = useState<DashboardData>(empty);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!desde || !hasta || desde > hasta) return;
    setLoading(true);
    setUnavailable(false);
    api<{ data: DashboardData }>(`/dashboard?desde=${desde}&hasta=${hasta}`)
      .then((result) => setData(result.data))
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  }, [desde, hasta]);

  function choose(value: Preset) {
    setPreset(value);
    if (value !== 'custom') {
      const range = monthRange(value === 'current' ? 0 : -1);
      setDesde(range.desde);
      setHasta(range.hasta);
    }
  }

  return (
    <>
      <section className="page-title dashboard-title">
        <div>
          <p className="eyebrow">OPERACIÓN DEL PERÍODO</p>
          <h2>Resumen del negocio</h2>
          <p>Datos operativos de la nueva PWA, sin mezclar ventas históricas migradas.</p>
        </div>
        <div className="quick-actions">
          <Link className="primary" to="/ventas"><ShoppingCart size={16} /> Nueva venta</Link>
          <Link className="secondary" to="/compras"><PackagePlus size={16} /> Nueva compra</Link>
          <Link className="secondary" to="/prestamos"><CreditCard size={16} /> Nuevo préstamo</Link>
          <Link className="secondary" to="/finanzas"><Landmark size={16} /> Registrar gasto</Link>
        </div>
      </section>

      <section className="period-filter">
        <label>
          Período
          <select value={preset} onChange={(event) => choose(event.target.value as Preset)}>
            <option value="current">Mes actual</option>
            <option value="previous">Mes anterior</option>
            <option value="custom">Rango personalizado</option>
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label>Desde <input type="date" value={desde} max={hasta} onChange={(event) => setDesde(event.target.value)} /></label>
            <label>Hasta <input type="date" value={hasta} min={desde} onChange={(event) => setHasta(event.target.value)} /></label>
          </>
        )}
        <span>{desde} — {hasta}</span>
      </section>

      {unavailable && <div className="notice">No se pudo consultar el Dashboard. Verifica la conexión con la API y PostgreSQL.</div>}
      {loading && <div className="dashboard-loading">Actualizando indicadores…</div>}

      <section className="metrics dashboard-metrics">
        <MetricCard label="Ventas del período" value={data.indicadores.ventas} icon={<ReceiptText />} accent="green" />
        <MetricCard label="Ganancia del período" value={data.indicadores.gananciaNeta} icon={<CircleDollarSign />} accent="green" />
        <MetricCard label="Gastos del período" value={data.indicadores.gastos} icon={<Landmark />} accent="orange" />
        <MetricCard label="Intereses cobrados" value={data.indicadores.intereses} icon={<HandCoins />} accent="purple" />
        <MetricCard label="Capital prestado actualmente" value={data.indicadores.capitalPrestadoActual} icon={<CreditCard />} accent="purple" />
        <MetricCard label="Préstamos vencidos" value={data.indicadores.prestamosVencidos} icon={<TriangleAlert />} accent="orange" format="number" />
        <MetricCard label="Dinero total en fondos" value={data.indicadores.fondosTotales} icon={<Wallet />} />
        <MetricCard label="Valor actual del inventario" value={data.indicadores.valorInventario} icon={<Boxes />} />
      </section>

      <section className="dashboard-grid">
        <article className="panel recent-activity">
          <div className="panel-head">
            <div>
              <h3>Actividad reciente</h3>
              <p>Solo operaciones de la nueva PWA dentro del período seleccionado</p>
            </div>
          </div>
          {data.actividad.length ? (
            <div className="activity-list">
              {data.actividad.map((item) => (
                <div className="activity-item" key={`${item.tipo}-${item.id}`}>
                  <span><Banknote size={16} /></span>
                  <div>
                    <b>{activityLabel[item.tipo] ?? item.tipo}</b>
                    <small>{item.descripcion}</small>
                  </div>
                  <time>{String(item.fecha).slice(0, 10)}</time>
                  <strong>{formatMoney(item.monto)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span><Boxes /></span>
              <b>Aún no hay operaciones en este período</b>
              <p>Las compras, ventas, préstamos y demás operaciones aparecerán aquí.</p>
            </div>
          )}
        </article>

        <article className="panel performance">
          <div className="panel-head">
            <div>
              <h3>Resultado del período</h3>
              <p>Utilidad operativa, intereses y gastos</p>
            </div>
          </div>
          <div className="result-breakdown">
            <div><span>Ventas</span><strong>{formatMoney(data.resultado.ventas)}</strong></div>
            <div><span>Ganancia de ventas</span><strong>{formatMoney(data.resultado.gananciaVentas)}</strong></div>
            <div><span>Intereses cobrados</span><strong>{formatMoney(data.resultado.intereses)}</strong></div>
            <div><span>Otros ingresos válidos</span><strong>{formatMoney(data.resultado.otrosIngresos)}</strong></div>
            <div className="negative"><span>Gastos</span><strong>− {formatMoney(data.resultado.gastos)}</strong></div>
            <div className="negative"><span>Pérdidas por préstamos</span><strong>− {formatMoney(data.resultado.perdidasPrestamo)}</strong></div>
            <div className="net-result"><span>Ganancia neta</span><strong>{formatMoney(data.resultado.gananciaNeta)}</strong></div>
          </div>
        </article>
      </section>
    </>
  );
}
