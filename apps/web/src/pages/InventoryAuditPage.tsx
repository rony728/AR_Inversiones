import { useEffect, useState } from "react";
import { BadgeDollarSign, CheckCircle2, ClipboardCheck, Minus, Plus, TriangleAlert } from "lucide-react";
import { api, formatMoney } from "../lib/api";
import { formatDateTime } from "../lib/date-format";
import { cacheList, getCachedList, queueMutation } from "../lib/offline-db";

type Row = Record<string, unknown>;
type CountLine = { productoId: string; existenciaFisica: number };
type AuditDetail = Row & { detalles?: Row[] };
type ValuationForm = {
  productoId: string;
  costoUnitario: string;
  fechaReferencia: string;
  motivo: string;
};

const emptyValuation = (): ValuationForm => ({
  productoId: "",
  costoUnitario: "",
  fechaReferencia: new Date().toISOString().slice(0, 10),
  motivo: "",
});

async function loadCached(
  path: string,
  store: Parameters<typeof getCachedList>[0],
) {
  try {
    const rows = (await api<{ data: Row[] }>(path)).data;
    await cacheList(store, rows);
    return rows;
  } catch {
    return getCachedList(store);
  }
}

export function InventoryAuditPage() {
  const [products, setProducts] = useState<Row[]>([]);
  const [inventory, setInventory] = useState<Row[]>([]);
  const [audits, setAudits] = useState<Row[]>([]);
  const [lines, setLines] = useState<CountLine[]>([
    { productoId: "", existenciaFisica: 0 },
  ]);
  const [observations, setObservations] = useState("");
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [message, setMessage] = useState("");
  const [valuation, setValuation] = useState<ValuationForm>(emptyValuation);
  const [valuationMessage, setValuationMessage] = useState("");
  const [valuationSaving, setValuationSaving] = useState(false);

  async function refreshAudits() {
    const rows = await loadCached("/auditorias", "auditorias");
    setAudits(rows);
  }

  useEffect(() => {
    Promise.all([
      loadCached("/catalogo/productos", "productos"),
      loadCached("/inventario", "inventario"),
      loadCached("/auditorias", "auditorias"),
    ]).then(([p, i, a]) => {
      setProducts(p);
      setInventory(i);
      setAudits(a);
    });
  }, []);

  const systemStock = (line: CountLine) =>
    Number(
      inventory.find((item) => item.producto_id === line.productoId)
        ?.existencia ?? 0,
    );
  const productName = (id: unknown) =>
    String(products.find((item) => item.id === id)?.nombre ?? id ?? "—");
  const change = (index: number, values: Partial<CountLine>) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...values } : line)),
    );

  const valuationInventory = inventory.find(
    (item) => item.producto_id === valuation.productoId,
  );
  const valuationStock = Number(valuationInventory?.existencia ?? 0);
  const valuationCurrentCost = Number(
    valuationInventory?.costo_promedio_unitario ?? 0,
  );

  async function valueInventory(event: React.FormEvent) {
    event.preventDefault();
    setValuationMessage("");
    const newCost = Number(valuation.costoUnitario);
    if (!navigator.onLine) {
      setValuationMessage(
        "Conéctate para valorizar: el servidor debe verificar la existencia actual.",
      );
      return;
    }
    if (!valuation.productoId || valuationStock <= 0) {
      setValuationMessage("Selecciona un producto con existencia disponible.");
      return;
    }
    if (valuationCurrentCost !== 0) {
      setValuationMessage(
        "Este producto ya tiene costo. La valorización histórica solo aplica a inventario sin valorizar.",
      );
      return;
    }
    if (!Number.isFinite(newCost) || newCost <= 0) {
      setValuationMessage("El costo histórico debe ser mayor que cero.");
      return;
    }
    if (valuation.motivo.trim().length < 3) {
      setValuationMessage("Describe el motivo de la valorización histórica.");
      return;
    }

    setValuationSaving(true);
    try {
      await api("/inventario/valorizacion-historica", {
        method: "POST",
        body: JSON.stringify({
          productoId: valuation.productoId,
          existenciaEsperada: valuationStock,
          costoUnitario: newCost,
          fechaReferencia: valuation.fechaReferencia,
          motivo: valuation.motivo.trim(),
        }),
      });
      const [updatedProducts, updatedInventory] = await Promise.all([
        loadCached("/catalogo/productos", "productos"),
        loadCached("/inventario", "inventario"),
      ]);
      setProducts(updatedProducts);
      setInventory(updatedInventory);
      setValuation({
        ...emptyValuation(),
        productoId: valuation.productoId,
        fechaReferencia: valuation.fechaReferencia,
      });
      setValuationMessage(
        "Inventario histórico valorizado. La existencia física no fue modificada.",
      );
    } catch (error) {
      setValuationMessage(
        error instanceof Error
          ? error.message
          : "No se pudo valorizar el inventario histórico.",
      );
    } finally {
      setValuationSaving(false);
    }
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (
      lines.some(
        (line) =>
          !line.productoId ||
          !Number.isInteger(line.existenciaFisica) ||
          line.existenciaFisica < 0,
      )
    ) {
      setMessage(
        "Completa cada producto y existencia física con unidades enteras.",
      );
      return;
    }
    const keys = lines.map((line) => line.productoId);
    if (new Set(keys).size !== keys.length) {
      setMessage("El mismo producto aparece más de una vez.");
      return;
    }
    const id = crypto.randomUUID();
    const payload = {
      id,
      observaciones: observations || undefined,
      items: lines,
      fecha_inicio: new Date().toISOString(),
      estado: "PENDIENTE",
      productos_contados: lines.length,
      diferencias_encontradas: lines.filter(
        (line) => systemStock(line) !== line.existenciaFisica,
      ).length,
    };
    try {
      if (navigator.onLine) {
        await api("/auditorias", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setMessage(
          "Conteo guardado. Revisa las diferencias antes de aprobar los ajustes.",
        );
        await refreshAudits();
      } else {
        await queueMutation(
          "auditorias",
          "auditoria_inventario",
          id,
          "CREATE",
          payload,
        );
        setAudits((current) => [payload, ...current]);
        setMessage(
          "Conteo guardado en este dispositivo; se enviará al recuperar conexión.",
        );
      }
      setLines([{ productoId: "", existenciaFisica: 0 }]);
      setObservations("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo iniciar la auditoría.",
      );
    }
  }

  async function view(auditId: string) {
    try {
      setDetail(
        (await api<{ data: AuditDetail }>(`/auditorias/${auditId}`)).data,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo consultar el detalle.",
      );
    }
  }

  async function approve(auditId: string) {
    if (!navigator.onLine) {
      setMessage(
        "Conéctate para aprobar: el servidor debe comprobar que el inventario no cambió desde el conteo.",
      );
      return;
    }
    try {
      await api(`/auditorias/${auditId}/aprobar`, { method: "POST" });
      setMessage("Ajustes aprobados y movimientos de inventario registrados.");
      setDetail(null);
      await refreshAudits();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo aprobar la auditoría.",
      );
    }
  }

  return (
    <>
      <section className="page-title">
        <div>
          <p className="eyebrow">CONTROL FÍSICO</p>
          <h2>Auditoría de inventario</h2>
          <p>Compara el conteo físico con el sistema y registra cada ajuste.</p>
        </div>
      </section>
      <form className="panel historical-valuation-form" onSubmit={valueInventory}>
        <div className="panel-head">
          <div>
            <h3>
              <BadgeDollarSign size={17} /> Valorizar inventario histórico
            </h3>
            <p>Asigna costo únicamente a existencias heredadas que todavía tienen costo cero.</p>
          </div>
        </div>
        <div className="historical-valuation-warning" role="note">
          <TriangleAlert size={18} />
          <span>
            Esta operación no modifica la cantidad de inventario ni genera una compra. Únicamente establece el costo histórico de las unidades existentes.
          </span>
        </div>
        <div className="historical-valuation-grid">
          <label>
            Producto
            <select
              required
              value={valuation.productoId}
              onChange={(event) => {
                setValuation((current) => ({ ...current, productoId: event.target.value }));
                setValuationMessage("");
              }}
            >
              <option value="">Seleccionar</option>
              {products
                .filter((product) => product.activo !== false)
                .map((product) => (
                  <option key={String(product.id)} value={String(product.id)}>
                    {String(product.codigo)} · {String(product.nombre)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Existencia actual
            <input readOnly value={valuation.productoId ? String(valuationStock) : "—"} />
          </label>
          <label>
            Costo promedio actual
            <input readOnly value={valuation.productoId ? formatMoney(valuationCurrentCost) : "—"} />
          </label>
          <label>
            Nuevo costo unitario
            <input
              required
              type="number"
              min="0.0001"
              step="0.0001"
              value={valuation.costoUnitario}
              onChange={(event) => setValuation((current) => ({ ...current, costoUnitario: event.target.value }))}
            />
          </label>
          <label>
            Fecha de referencia
            <input
              required
              type="date"
              value={valuation.fechaReferencia}
              onChange={(event) => setValuation((current) => ({ ...current, fechaReferencia: event.target.value }))}
            />
          </label>
          <label className="historical-valuation-reason">
            Motivo
            <textarea
              required
              minLength={3}
              maxLength={2000}
              rows={3}
              value={valuation.motivo}
              onChange={(event) => setValuation((current) => ({ ...current, motivo: event.target.value }))}
            />
          </label>
        </div>
        <button
          className="primary historical-valuation-submit"
          type="submit"
          disabled={valuationSaving}
        >
          {valuationSaving ? "Valorizando…" : "Confirmar valorización histórica"}
        </button>
        {valuationMessage && <p className="form-message">{valuationMessage}</p>}
      </form>
      <form className="panel audit-form" onSubmit={start}>
        <div className="panel-head">
          <div>
            <h3>
              <ClipboardCheck size={17} /> Nuevo conteo
            </h3>
            <p>Cuenta cada producto del inventario general una sola vez.</p>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setLines((current) => [
                ...current,
                { productoId: "", existenciaFisica: 0 },
              ])
            }
          >
            <Plus size={16} /> Agregar producto
          </button>
        </div>
        {lines.map((line, index) => {
          const current = systemStock(line);
          const difference = line.existenciaFisica - current;
          return (
            <div className="audit-line" key={index}>
              <label>
                Producto
                <select
                  value={line.productoId}
                  onChange={(e) =>
                    change(index, { productoId: e.target.value })
                  }
                >
                  <option value="">Seleccionar</option>
                  {products
                    .filter((p) => p.activo !== false)
                    .map((p) => (
                      <option key={String(p.id)} value={String(p.id)}>
                        {String(p.nombre)}
                      </option>
                    ))}
                </select>
              </label>
              <div className="audit-value">
                <span>Sistema</span>
                <strong>{current}</strong>
              </div>
              <label>
                Existencia física
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={line.existenciaFisica}
                  onChange={(e) =>
                    change(index, { existenciaFisica: Number(e.target.value) })
                  }
                />
              </label>
              <div
                className={`audit-value ${difference ? "has-difference" : ""}`}
              >
                <span>Diferencia</span>
                <strong>
                  {difference > 0 ? `+${difference}` : difference}
                </strong>
              </div>
              {lines.length > 1 && (
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Quitar producto"
                  onClick={() =>
                    setLines((currentLines) =>
                      currentLines.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Minus size={16} />
                </button>
              )}
            </div>
          );
        })}
        <label className="audit-observations">
          Observaciones
          <textarea
            rows={3}
            maxLength={2000}
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
          />
        </label>
        <button className="primary audit-submit" type="submit">
          Guardar conteo
        </button>
      </form>
      {message && <p className="form-message audit-message">{message}</p>}
      {detail && (
        <section className="panel audit-detail">
          <div className="panel-head">
            <div>
              <h3>Diferencias del conteo</h3>
              <p>Existencia capturada al iniciar la auditoría.</p>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => setDetail(null)}
            >
              Cerrar
            </button>
          </div>
          <div className="table-wrap desktop-record-table">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Sistema</th>
                  <th>Físico</th>
                  <th>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {(detail.detalles ?? []).map((row) => (
                  <tr key={String(row.id)}>
                    <td>{String(row.producto)}</td>
                    <td>{String(row.existencia_sistema)}</td>
                    <td>{String(row.existencia_fisica)}</td>
                    <td>
                      <strong>
                        {Number(row.diferencia) > 0 ? "+" : ""}
                        {String(row.diferencia)}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-record-list compact audit-detail-cards">
            {(detail.detalles ?? []).map((row) => (
              <article className="mobile-record-card" key={String(row.id)}>
                <div className="mobile-record-header">
                  <h4>{String(row.producto)}</h4>
                  <strong
                    className={Number(row.diferencia) ? "audit-difference" : ""}
                  >
                    {Number(row.diferencia) > 0 ? "+" : ""}
                    {String(row.diferencia)}
                  </strong>
                </div>
                <div className="mobile-record-grid">
                  <span>
                    Sistema<strong>{String(row.existencia_sistema)}</strong>
                  </span>
                  <span>
                    Físico<strong>{String(row.existencia_fisica)}</strong>
                  </span>
                </div>
              </article>
            ))}
          </div>
          {detail.estado === "ABIERTA" && (
            <button
              className="primary approve-audit"
              onClick={() => approve(String(detail.id))}
            >
              <CheckCircle2 size={17} /> Aprobar ajustes
            </button>
          )}
        </section>
      )}
      <section className="panel list-panel">
        <div className="panel-head audit-history-head">
          <div>
            <h3>Historial de auditorías</h3>
            <p>Los conteos y ajustes aprobados permanecen registrados.</p>
          </div>
        </div>
        <div className="table-wrap desktop-record-table">
          <table>
            <thead>
              <tr>
                <th>Inicio</th>
                <th>Estado</th>
                <th>Productos</th>
                <th>Diferencias</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {audits.length ? (
                audits.map((row) => (
                  <tr key={String(row.id)}>
                    <td>
                      {formatDateTime(row.fecha_inicio)}
                    </td>
                    <td>
                      <span className="status">
                        {String(row.estado ?? "PENDIENTE")}
                      </span>
                    </td>
                    <td>{String(row.productos_contados ?? 0)}</td>
                    <td>{String(row.diferencias_encontradas ?? 0)}</td>
                    <td>
                      {row.estado !== "PENDIENTE" && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => view(String(row.id))}
                        >
                          Ver detalle
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    No hay auditorías registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div
          className="mobile-record-list"
          aria-label="Auditorías en formato móvil"
        >
          {audits.length ? (
            audits.map((row) => (
              <article className="mobile-record-card" key={String(row.id)}>
                <div className="mobile-record-header">
                  <div>
                    <span className="mobile-record-kicker">Inventario</span>
                    <h4>
                      {formatDateTime(row.fecha_inicio, "Sin fecha")}
                    </h4>
                  </div>
                  <span className="status">
                    {String(row.estado ?? "PENDIENTE")}
                  </span>
                </div>
                <div className="mobile-record-grid">
                  <span>
                    Acción<strong>Conteo de inventario</strong>
                  </span>
                  <span>
                    Usuario
                    <strong>
                      {String(row.usuario_nombre ?? "Usuario registrado")}
                    </strong>
                  </span>
                  <span>
                    Productos contados
                    <strong>{String(row.productos_contados ?? 0)}</strong>
                  </span>
                  <span>
                    Diferencias
                    <strong>{String(row.diferencias_encontradas ?? 0)}</strong>
                  </span>
                </div>
                {Boolean(row.observaciones) && (
                  <details className="mobile-record-detail">
                    <summary>Observaciones</summary>
                    <p>{String(row.observaciones)}</p>
                  </details>
                )}
                {row.estado !== "PENDIENTE" && (
                  <div className="mobile-record-actions">
                    <button
                      type="button"
                      className="edit-button"
                      onClick={() => view(String(row.id))}
                    >
                      Ver detalle
                    </button>
                  </div>
                )}
              </article>
            ))
          ) : (
            <p className="mobile-record-empty">
              No hay auditorías registradas.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
