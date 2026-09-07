import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { ClientSearchSelect } from '../components/ClientSearchSelect';
import { ProductSearchSelect } from '../components/ProductSearchSelect';
import { api, formatMoney } from '../lib/api';
import { cacheList, getCachedList, queueMutation } from '../lib/offline-db';
import type { ProductRow } from '../lib/product-catalog';
import { duplicateProductId, exceedsKnownBalance, productsFundOf, type PurchaseLine } from '../lib/purchase-form';
import { saleLineEstimate, saleTotals, validateSaleLines } from '../lib/sale-form';

type Row = Record<string, unknown>;
type Line = PurchaseLine;
const today = () => new Date().toISOString().slice(0, 10);

async function load(path: string, store?: Parameters<typeof getCachedList>[0]) {
  try {
    const rows = (await api<{ data: Row[] }>(path)).data;
    if (store) await cacheList(store, rows);
    return rows;
  } catch {
    return store ? getCachedList(store) : [];
  }
}

export function TransactionPage({ kind }: { kind: 'compra' | 'venta' }) {
  const sale = kind === 'venta';
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [partners, setPartners] = useState<Row[]>([]);
  const [contacts, setContacts] = useState<Row[]>([]);
  const [date, setDate] = useState(today());
  const [partnerId, setPartnerId] = useState('');
  const [contactId, setContactId] = useState('');
  const [lines, setLines] = useState<Line[]>([{ productoId: '', cantidad: 1, valor: 0 }]);
  const [observations, setObservations] = useState('');
  const [message, setMessage] = useState('');
  const [processing, setProcessing] = useState(false);
  const requestInFlight = useRef(false);

  useEffect(() => {
    void Promise.all([
      load('/catalogo/productos', 'productos'),
      load('/catalogo/socios', 'custodias'),
      load(sale ? '/catalogo/clientes' : '/catalogo/proveedores', sale ? 'clientes' : undefined)
    ]).then(([loadedProducts, loadedPartners, loadedContacts]) => {
      setProducts(loadedProducts as unknown as ProductRow[]);
      setPartners(loadedPartners);
      setContacts(loadedContacts);
    });
  }, [sale]);

  const activeProducts = products.filter((product) => product.activo);
  const selectedPartner = partners.find((partner) => partner.id === partnerId);
  const productsFund = productsFundOf(selectedPartner);
  const custodyId = productsFund?.id;
  const availableFor = (productId: string) => Number(products.find((product) => product.id === productId)?.cantidad_disponible ?? 0);
  const total = useMemo(() => lines.reduce((sum, line) => sum + line.cantidad * line.valor, 0), [lines]);
  const saleSummary = useMemo(() => saleTotals(lines, products), [lines, products]);
  const saleIssue = sale ? validateSaleLines(lines, products) : null;
  const insufficientFunds = !sale && exceedsKnownBalance(productsFund?.balance ?? null, total);
  const missingProductsFund = Boolean(partnerId) && !productsFund;
  const remainingBalance = productsFund ? productsFund.balance - total : null;
  const saleFundBalance = productsFund ? productsFund.balance + saleSummary.subtotal : null;
  const change = (index: number, update: Partial<Line>) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...update } : line));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (requestInFlight.current) return;
    setMessage('');

    if (!partnerId || !custodyId || lines.some((line) => !line.productoId || line.cantidad < 1 || line.valor <= 0)) {
      setMessage('Completa socio, productos, cantidad y monto.');
      return;
    }
    if (lines.some((line) => !Number.isInteger(line.cantidad))) {
      setMessage('La cantidad de cada producto debe ser un número entero mayor que cero.');
      return;
    }
    if (!sale && duplicateProductId(lines)) {
      setMessage('Cada producto puede aparecer una sola vez dentro de la compra.');
      return;
    }
    if (sale && saleIssue) {
      setMessage(saleIssue.message);
      return;
    }
    if (insufficientFunds) {
      setMessage('El total de la compra supera el saldo disponible del fondo PRODUCTOS.');
      return;
    }

    const payload = sale
      ? { clienteId: contactId || undefined, fecha: `${date}T12:00:00.000Z`, observaciones: observations.trim() || undefined, items: lines.map(({ productoId, cantidad, valor }) => ({ productoId, socioId: partnerId, custodiaId: custodyId, cantidad, precioUnitario: valor })) }
      : { proveedorId: contactId || undefined, socioId: partnerId, custodiaId: custodyId, fecha: date, observaciones: observations.trim() || undefined, items: lines.map(({ productoId, cantidad, valor }) => ({ productoId, cantidad, costoUnitario: valor })) };

    requestInFlight.current = true;
    setProcessing(true);
    try {
      if (!navigator.onLine) {
        const id = crypto.randomUUID();
        await queueMutation(sale ? 'ventas' : 'compras', sale ? 'venta' : 'compra', id, 'CREATE', payload);
        setMessage(`${sale ? 'Venta' : 'Compra'} guardada localmente; se sincronizará al recuperar conexión.`);
        if (sale) { setLines([{ productoId: '', cantidad: 1, valor: 0 }]); setContactId(''); setObservations(''); }
      } else {
        await api(`/${sale ? 'ventas' : 'compras'}`, { method: 'POST', body: JSON.stringify(payload) });
        setMessage(`${sale ? 'Venta' : 'Compra'} confirmada correctamente.`);
        setLines([{ productoId: '', cantidad: 1, valor: 0 }]);
        if (sale) {
          setContactId('');
          setObservations('');
          const [updatedProducts, updatedPartners] = await Promise.all([load('/catalogo/productos', 'productos'), load('/catalogo/socios', 'custodias')]);
          setProducts(updatedProducts as unknown as ProductRow[]);
          setPartners(updatedPartners);
        } else {
          setObservations('');
          setPartners(await load('/catalogo/socios', 'custodias'));
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la operación.');
    } finally {
      requestInFlight.current = false;
      setProcessing(false);
    }
  }

  return <>
    <section className="page-title"><div><p className="eyebrow">{sale ? 'VENTA DE CONTADO' : 'ENTRADA DE INVENTARIO'}</p><h2>{sale ? 'Registrar venta' : 'Registrar compra'}</h2><p>{sale ? 'El ingreso va al fondo PRODUCTOS seleccionado; el stock siempre es general del negocio.' : 'El socio financia desde su fondo PRODUCTOS; las unidades entran al inventario general.'}</p></div></section>
    <form className="transaction-form" onSubmit={submit}>
      <section className="panel">
        <div className="form-grid">
          <label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
          {sale ? <div className="client-picker-field"><span>Cliente</span><ClientSearchSelect clients={contacts} selectedId={contactId} onChange={setContactId} /></div> : <label>Proveedor<select value={contactId} onChange={(event) => setContactId(event.target.value)}><option value="">Sin especificar</option>{contacts.map((contact) => <option key={String(contact.id)} value={String(contact.id)}>{String(contact.nombre)}</option>)}</select></label>}
          <label>{sale ? 'Socio responsable del fondo receptor' : 'Socio responsable del fondo'}<select value={partnerId} onChange={(event) => setPartnerId(event.target.value)} required><option value="">Seleccionar socio</option>{partners.map((partner) => <option key={String(partner.id)} value={String(partner.id)}>{String(partner.nombre)}</option>)}</select></label>
        </div>
        {partnerId && <div className={`purchase-fund-summary ${sale ? 'sale-fund-summary' : ''} ${insufficientFunds || missingProductsFund ? 'insufficient' : ''}`}>
          {productsFund ? sale ? <><div><span>Saldo actual · fondo PRODUCTOS</span><strong>{formatMoney(productsFund.balance)}</strong></div><div><span>Ingreso de la venta</span><strong>{formatMoney(saleSummary.subtotal)}</strong></div><div><span>Saldo estimado después de confirmar</span><strong>{formatMoney(saleFundBalance ?? 0)}</strong></div></> : <><div><span>Saldo disponible · fondo PRODUCTOS</span><strong>{formatMoney(productsFund.balance)}</strong></div><div><span>Saldo después de la compra</span><strong>{formatMoney(remainingBalance ?? 0)}</strong></div></> : <p>El socio seleccionado no tiene un fondo PRODUCTOS disponible.</p>}
        </div>}
      </section>
      <section className="panel">
        <div className="panel-head"><div><h3>Productos</h3><p>Todos los productos pertenecen al inventario general de AR Inversiones.</p></div><button type="button" className="secondary" onClick={() => setLines((current) => [...current, { productoId: '', cantidad: 1, valor: 0 }])}><Plus size={16} /> Agregar línea</button></div>
        {lines.map((line, index) => {
          const selectedInOtherLines = lines.filter((_, otherIndex) => otherIndex !== index).map((otherLine) => otherLine.productoId).filter(Boolean);
          const product = products.find((candidate) => candidate.id === line.productoId);
          const estimate = saleLineEstimate(line, product);
          return <div className={`transaction-line-group ${sale && estimate.profit < 0 ? 'line-loss' : ''}`} key={index}><div className="line-item">
            <div className="product-picker-field"><span>Producto</span><ProductSearchSelect products={activeProducts} selectedId={line.productoId} excludedIds={selectedInOtherLines} showStock={sale} onChange={(productoId) => { const selectedProduct = products.find((candidate) => candidate.id === productoId); change(index, { productoId, ...(sale ? { valor: Number(selectedProduct?.precio_venta ?? 0) } : {}) }); }} /></div>
            <label>Cantidad<input type="number" min="1" step="1" max={sale && line.productoId ? availableFor(line.productoId) : undefined} value={line.cantidad} onChange={(event) => change(index, { cantidad: Number(event.target.value) })} /></label>
            <label>{sale ? 'Precio unitario' : 'Costo final por unidad'}<input type="number" min="0.01" step="0.01" value={line.valor || ''} onChange={(event) => change(index, { valor: Number(event.target.value) })} /></label>
            <strong>{formatMoney(line.cantidad * line.valor)}</strong>
            {lines.length > 1 && <button className="icon-button" type="button" aria-label="Quitar línea" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Minus size={16} /></button>}
          </div>{sale && product && <div className="sale-line-info"><span>Existencia actual<strong>{product.cantidad_disponible}</strong></span><span>Existencia posterior<strong>{Number(product.cantidad_disponible) - line.cantidad}</strong></span><span>Costo promedio<strong>{formatMoney(product.costo_promedio)}</strong></span><span>Precio configurado<strong>{formatMoney(product.precio_venta)}</strong></span><span>Ganancia estimada<strong>{formatMoney(estimate.profit)}</strong></span></div>}</div>;
        })}
      </section>
      <section className="panel purchase-observations"><label>Observaciones <span>(opcional)</span><textarea maxLength={2000} rows={4} value={observations} onChange={(event) => setObservations(event.target.value)} placeholder={`Detalles adicionales de la ${sale ? 'venta' : 'compra'}…`} /></label><small>{observations.length}/2,000 caracteres</small></section>
      <section className={`transaction-total ${sale ? 'sale-transaction-total' : ''}`}><div className="transaction-main-total"><span>Total {sale ? 'de la venta' : ''}</span><strong>{formatMoney(sale ? saleSummary.subtotal : total)}</strong></div>{sale && <><div><span>Costo del inventario</span><strong>{formatMoney(saleSummary.cost)}</strong></div><div><span>Ganancia estimada</span><strong>{formatMoney(saleSummary.profit)}</strong></div></>}<button className="primary" type="submit" disabled={processing || missingProductsFund || (!sale && insufficientFunds) || (sale && Boolean(saleIssue))}>{processing ? `Registrando ${sale ? 'venta' : 'compra'}...` : navigator.onLine ? `Confirmar ${sale ? 'venta' : 'compra'}` : 'Guardar sin conexión'}</button></section>
      {!sale && insufficientFunds && <p className="purchase-warning">El total de la compra supera el saldo disponible del fondo PRODUCTOS.</p>}
      {sale && saleIssue && <p className="purchase-warning">{saleIssue.message}</p>}
      {message && <p className="form-message">{message}</p>}
    </form>
  </>;
}
