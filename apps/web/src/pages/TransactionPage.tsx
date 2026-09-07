import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { ProductSearchSelect } from '../components/ProductSearchSelect';
import { api, formatMoney } from '../lib/api';
import { cacheList, getCachedList, queueMutation } from '../lib/offline-db';
import type { ProductRow } from '../lib/product-catalog';
import { duplicateProductId, exceedsKnownBalance, productsFundOf, type PurchaseLine } from '../lib/purchase-form';

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
  const [purchaseProcessing, setPurchaseProcessing] = useState(false);
  const purchaseRequestInFlight = useRef(false);

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
  const insufficientFunds = !sale && exceedsKnownBalance(productsFund?.balance ?? null, total);
  const missingProductsFund = !sale && Boolean(partnerId) && !productsFund;
  const remainingBalance = productsFund ? productsFund.balance - total : null;
  const change = (index: number, update: Partial<Line>) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...update } : line));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!sale && purchaseRequestInFlight.current) return;
    setMessage('');

    if (!partnerId || !custodyId || lines.some((line) => !line.productoId || line.cantidad < 1 || line.valor <= 0)) {
      setMessage('Completa socio, productos, cantidad y monto.');
      return;
    }
    if (!sale && lines.some((line) => !Number.isInteger(line.cantidad))) {
      setMessage('La cantidad de cada producto debe ser un número entero mayor que cero.');
      return;
    }
    if (!sale && duplicateProductId(lines)) {
      setMessage('Cada producto puede aparecer una sola vez dentro de la compra.');
      return;
    }
    if (sale && lines.some((line) => line.cantidad > availableFor(line.productoId))) {
      setMessage('La cantidad solicitada supera el inventario disponible.');
      return;
    }
    if (insufficientFunds) {
      setMessage('El total de la compra supera el saldo disponible del fondo PRODUCTOS.');
      return;
    }

    const payload = sale
      ? { clienteId: contactId || undefined, fecha: `${date}T12:00:00.000Z`, items: lines.map(({ productoId, cantidad, valor }) => ({ productoId, socioId: partnerId, custodiaId: custodyId, cantidad, precioUnitario: valor })) }
      : { proveedorId: contactId || undefined, socioId: partnerId, custodiaId: custodyId, fecha: date, observaciones: observations.trim() || undefined, items: lines.map(({ productoId, cantidad, valor }) => ({ productoId, cantidad, costoUnitario: valor })) };

    if (!sale) { purchaseRequestInFlight.current = true; setPurchaseProcessing(true); }
    try {
      if (!navigator.onLine) {
        const id = crypto.randomUUID();
        await queueMutation(sale ? 'ventas' : 'compras', sale ? 'venta' : 'compra', id, 'CREATE', payload);
        setMessage(`${sale ? 'Venta' : 'Compra'} guardada localmente; se sincronizará al recuperar conexión.`);
      } else {
        await api(`/${sale ? 'ventas' : 'compras'}`, { method: 'POST', body: JSON.stringify(payload) });
        setMessage(`${sale ? 'Venta' : 'Compra'} confirmada correctamente.`);
        setLines([{ productoId: '', cantidad: 1, valor: 0 }]);
        if (!sale) {
          setObservations('');
          setPartners(await load('/catalogo/socios', 'custodias'));
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la operación.');
    } finally {
      if (!sale) { purchaseRequestInFlight.current = false; setPurchaseProcessing(false); }
    }
  }

  return <>
    <section className="page-title"><div><p className="eyebrow">{sale ? 'VENTA DE CONTADO' : 'ENTRADA DE INVENTARIO'}</p><h2>{sale ? 'Registrar venta' : 'Registrar compra'}</h2><p>{sale ? 'El ingreso va al fondo PRODUCTOS seleccionado; el stock siempre es general del negocio.' : 'El socio financia desde su fondo PRODUCTOS; las unidades entran al inventario general.'}</p></div></section>
    <form className="transaction-form" onSubmit={submit}>
      <section className="panel">
        <div className="form-grid">
          <label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
          <label>{sale ? 'Cliente' : 'Proveedor'}<select value={contactId} onChange={(event) => setContactId(event.target.value)}><option value="">Sin especificar</option>{contacts.map((contact) => <option key={String(contact.id)} value={String(contact.id)}>{String(contact.nombre)}</option>)}</select></label>
          <label>{sale ? 'Socio responsable del fondo receptor' : 'Socio responsable del fondo'}<select value={partnerId} onChange={(event) => setPartnerId(event.target.value)} required><option value="">Seleccionar socio</option>{partners.map((partner) => <option key={String(partner.id)} value={String(partner.id)}>{String(partner.nombre)}</option>)}</select></label>
        </div>
        {!sale && partnerId && <div className={`purchase-fund-summary ${insufficientFunds || missingProductsFund ? 'insufficient' : ''}`}>
          {productsFund ? <><div><span>Saldo disponible · fondo PRODUCTOS</span><strong>{formatMoney(productsFund.balance)}</strong></div><div><span>Saldo después de la compra</span><strong>{formatMoney(remainingBalance ?? 0)}</strong></div></> : <p>El socio seleccionado no tiene un fondo PRODUCTOS disponible.</p>}
        </div>}
      </section>
      <section className="panel">
        <div className="panel-head"><div><h3>Productos</h3><p>Todos los productos pertenecen al inventario general de AR Inversiones.</p></div><button type="button" className="secondary" onClick={() => setLines((current) => [...current, { productoId: '', cantidad: 1, valor: 0 }])}><Plus size={16} /> Agregar línea</button></div>
        {lines.map((line, index) => {
          const selectedInOtherLines = lines.filter((_, otherIndex) => otherIndex !== index).map((otherLine) => otherLine.productoId).filter(Boolean);
          return <div className="line-item" key={index}>
            {sale ? <label>Producto<select value={line.productoId} onChange={(event) => { const product = products.find((item) => item.id === event.target.value); change(index, { productoId: event.target.value, valor: Number(product?.precio_venta ?? 0) }); }}><option value="">Seleccionar</option>{activeProducts.map((product) => <option key={product.id} value={product.id}>{product.nombre} · {product.cantidad_disponible} disponibles</option>)}</select></label> : <div className="product-picker-field"><span>Producto</span><ProductSearchSelect products={activeProducts} selectedId={line.productoId} excludedIds={selectedInOtherLines} onChange={(productoId) => change(index, { productoId })} /></div>}
            <label>Cantidad<input type="number" min="1" step="1" max={sale && line.productoId ? availableFor(line.productoId) : undefined} value={line.cantidad} onChange={(event) => change(index, { cantidad: Number(event.target.value) })} /></label>
            <label>{sale ? 'Precio unitario' : 'Costo final por unidad'}<input type="number" min="0.01" step="0.01" value={line.valor || ''} onChange={(event) => change(index, { valor: Number(event.target.value) })} /></label>
            <strong>{formatMoney(line.cantidad * line.valor)}</strong>
            {lines.length > 1 && <button className="icon-button" type="button" aria-label="Quitar línea" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Minus size={16} /></button>}
          </div>;
        })}
      </section>
      {!sale && <section className="panel purchase-observations"><label>Observaciones <span>(opcional)</span><textarea maxLength={2000} rows={4} value={observations} onChange={(event) => setObservations(event.target.value)} placeholder="Detalles adicionales de la compra…" /></label><small>{observations.length}/2,000 caracteres</small></section>}
      <section className="transaction-total"><div><span>Total</span><strong>{formatMoney(total)}</strong></div><button className="primary" type="submit" disabled={!sale && (purchaseProcessing || insufficientFunds || missingProductsFund)}>{!sale && purchaseProcessing ? 'Registrando compra...' : navigator.onLine ? `Confirmar ${sale ? 'venta' : 'compra'}` : 'Guardar sin conexión'}</button></section>
      {!sale && insufficientFunds && <p className="purchase-warning">El total de la compra supera el saldo disponible del fondo PRODUCTOS.</p>}
      {message && <p className="form-message">{message}</p>}
    </form>
  </>;
}
