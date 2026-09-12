import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, SlidersHorizontal, WalletCards, X } from 'lucide-react';
import { api, formatMoney } from '../lib/api';
import { queueMutation } from '../lib/offline-db';

type Activity = 'PRODUCTOS' | 'PRESTAMOS';
type Custody = { id: string; actividad: Activity; saldo_actual: string; socio_id: string };
type Partner = { id: string; nombre: string; custodias: Custody[] };

function FundModal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <div className="fund-modal-overlay"><section className="panel fund-modal" role="dialog" aria-modal="true" aria-label={title}><div className="panel-head"><div><h3>{title}</h3></div><button className="close-button" type="button" onClick={close} aria-label="Cerrar"><X size={18} /></button></div>{children}</section></div>;
}

export function Custodias() {
  const [partners, setPartners] = useState<Partner[]>([]); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [processing, setProcessing] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false); const [originPartnerId, setOriginPartnerId] = useState(''); const [originActivity, setOriginActivity] = useState<Activity>('PRODUCTOS'); const [destinationPartnerId, setDestinationPartnerId] = useState(''); const [destinationActivity, setDestinationActivity] = useState<Activity>('PRESTAMOS'); const [amount, setAmount] = useState(''); const [transferReason, setTransferReason] = useState('');
  const [adjusting, setAdjusting] = useState<{ partner: Partner; custody: Custody } | null>(null); const [newBalance, setNewBalance] = useState(''); const [adjustmentReason, setAdjustmentReason] = useState('');

  async function loadPartners() { const response = await api<{ data: Partner[] }>('/catalogo/socios'); setPartners(response.data); setOriginPartnerId((current) => current || response.data[0]?.id || ''); setDestinationPartnerId((current) => current || response.data[0]?.id || ''); }
  useEffect(() => { loadPartners().catch(() => setError('Conecta la API y PostgreSQL para consultar los fondos.')); }, []);
  useEffect(() => { if (!showTransfer && !adjusting) return; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; }; }, [showTransfer, adjusting]);

  const originPartner = partners.find((partner) => partner.id === originPartnerId); const destinationPartner = partners.find((partner) => partner.id === destinationPartnerId);
  const origin = originPartner?.custodias.find((item) => item.actividad === originActivity); const destination = destinationPartner?.custodias.find((item) => item.actividad === destinationActivity);
  const adjustmentDifference = useMemo(() => Number(newBalance || 0) - Number(adjusting?.custody.saldo_actual ?? 0), [newBalance, adjusting]);

  function openAdjustment(partner: Partner, custody: Custody) { setMessage(''); setAdjusting({ partner, custody }); setNewBalance(custody.saldo_actual); setAdjustmentReason(''); }
  function applyOptimisticTransfer(originId: string, destinationId: string, value: number) { setPartners((current) => current.map((partner) => ({ ...partner, custodias: partner.custodias.map((custody) => custody.id === originId ? { ...custody, saldo_actual: String(Number(custody.saldo_actual) - value) } : custody.id === destinationId ? { ...custody, saldo_actual: String(Number(custody.saldo_actual) + value) } : custody) }))); }

  async function transfer(event: React.FormEvent) {
    event.preventDefault(); setMessage(''); const numericAmount = Number(amount);
    if (!originPartner || !destinationPartner || !origin || !destination || numericAmount <= 0) { setMessage('Selecciona fondos válidos y un monto mayor que cero.'); return; }
    if (origin.id === destination.id) { setMessage('Los fondos de origen y destino deben ser distintos.'); return; }
    if (numericAmount > Number(origin.saldo_actual)) { setMessage('El fondo de origen no tiene saldo suficiente.'); return; }
    if (transferReason.trim().length < 3) { setMessage('Indica un motivo de al menos 3 caracteres.'); return; }
    const payload = { socioOrigenId: originPartner.id, custodiaOrigenId: origin.id, socioDestinoId: destinationPartner.id, custodiaDestinoId: destination.id, monto: numericAmount, observaciones: transferReason.trim() };
    setProcessing(true);
    try {
      if (navigator.onLine) { await api('/transferencias-custodia', { method: 'POST', body: JSON.stringify(payload) }); await loadPartners(); }
      else { await queueMutation('custodias', 'transferencia_custodia', crypto.randomUUID(), 'CREATE', payload); applyOptimisticTransfer(origin.id, destination.id, numericAmount); }
      setMessage(navigator.onLine ? 'Transferencia confirmada sin afectar la utilidad.' : 'Transferencia guardada localmente para sincronizar.'); setAmount(''); setTransferReason(''); setShowTransfer(false);
    } catch (err) { setMessage(err instanceof Error ? err.message : 'No se pudo realizar la transferencia.'); } finally { setProcessing(false); }
  }

  async function adjust(event: React.FormEvent) {
    event.preventDefault(); setMessage(''); if (!adjusting) return;
    if (!navigator.onLine) { setMessage('Conéctate para registrar un ajuste manual con el saldo actualizado.'); return; }
    if (Number(newBalance) < 0 || !newBalance) { setMessage('El nuevo saldo debe ser mayor o igual que cero.'); return; }
    if (adjustmentDifference === 0) { setMessage('El nuevo saldo debe ser diferente del saldo actual.'); return; }
    if (adjustmentReason.trim().length < 3) { setMessage('Indica un motivo de al menos 3 caracteres.'); return; }
    setProcessing(true);
    try { await api('/ajustes-fondo', { method: 'POST', body: JSON.stringify({ socioId: adjusting.partner.id, custodiaId: adjusting.custody.id, nuevoSaldo: Number(newBalance), motivo: adjustmentReason.trim() }) }); await loadPartners(); setMessage('Ajuste registrado con trazabilidad en auditoría.'); setAdjusting(null); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'No se pudo registrar el ajuste.'); } finally { setProcessing(false); }
  }

  return <><section className="page-title"><div><p className="eyebrow">DINERO DEL NEGOCIO BAJO RESPONSABILIDAD</p><h2>Fondos</h2><p>Cada socio es responsable de un fondo Productos y un fondo Préstamos del negocio.</p></div><button className="primary" onClick={() => { setMessage(''); setShowTransfer(true); }}><ArrowRightLeft size={18} /> Transferir</button></section><div className="notice">Las transferencias solo mueven saldo entre fondos; no generan ingreso, gasto ni utilidad.</div>{message && <p className="form-message fund-page-message">{message}</p>}
    <section className="custody-grid">{partners.map((partner) => <article className="custody-card" key={partner.id}><div className="custody-name"><span><WalletCards size={19} /></span><div><h3>{partner.nombre}</h3><p>Responsable de fondos</p></div></div>{partner.custodias.map((custody) => <div className="custody-line fund-line" key={custody.id}><div><span>{custody.actividad === 'PRODUCTOS' ? 'Productos' : 'Préstamos'}</span><strong>{formatMoney(custody.saldo_actual)}</strong></div><button type="button" className="secondary compact" onClick={() => openAdjustment(partner, custody)}><SlidersHorizontal size={15} /> Ajustar saldo</button></div>)}</article>)}{!partners.length && <div className="empty-state">{error || 'No hay fondos disponibles.'}</div>}</section>
    {showTransfer && <FundModal title="Transferir entre fondos" close={() => setShowTransfer(false)}><form className="transfer-form fund-operation-form" onSubmit={transfer}><label>Socio origen<select value={originPartnerId} onChange={(event) => setOriginPartnerId(event.target.value)}>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.nombre}</option>)}</select></label><label>Fondo origen<select value={originActivity} onChange={(event) => setOriginActivity(event.target.value as Activity)}><option value="PRODUCTOS">Productos</option><option value="PRESTAMOS">Préstamos</option></select></label><div className="fund-balance-summary"><span>Saldo disponible del origen</span><strong>{formatMoney(origin?.saldo_actual)}</strong></div><label>Socio destino<select value={destinationPartnerId} onChange={(event) => setDestinationPartnerId(event.target.value)}>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.nombre}</option>)}</select></label><label>Fondo destino<select value={destinationActivity} onChange={(event) => setDestinationActivity(event.target.value as Activity)}><option value="PRODUCTOS">Productos</option><option value="PRESTAMOS">Préstamos</option></select></label><label>Monto<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><label className="full-width">Motivo / observación<textarea minLength={3} maxLength={2000} value={transferReason} onChange={(event) => setTransferReason(event.target.value)} required /></label>{message && <p className="form-message full-width">{message}</p>}<div className="form-actions full-width"><button type="button" className="secondary" onClick={() => setShowTransfer(false)}>Cancelar</button><button className="primary" type="submit" disabled={processing}>{processing ? 'Transfiriendo...' : 'Confirmar transferencia'}</button></div></form></FundModal>}
    {adjusting && <FundModal title="Ajustar saldo" close={() => setAdjusting(null)}><form className="fund-operation-form" onSubmit={adjust}><div className="fund-static-field"><span>Socio</span><strong>{adjusting.partner.nombre}</strong></div><div className="fund-static-field"><span>Fondo</span><strong>{adjusting.custody.actividad === 'PRODUCTOS' ? 'Productos' : 'Préstamos'}</strong></div><div className="fund-static-field"><span>Saldo actual</span><strong>{formatMoney(adjusting.custody.saldo_actual)}</strong></div><label>Nuevo saldo<input type="number" min="0" step="0.01" value={newBalance} onChange={(event) => setNewBalance(event.target.value)} required /></label><div className={`fund-adjustment-preview ${adjustmentDifference < 0 ? 'decrease' : adjustmentDifference > 0 ? 'increase' : ''}`}><span>Diferencia</span><strong>{adjustmentDifference > 0 ? `Aumenta ${formatMoney(adjustmentDifference)}` : adjustmentDifference < 0 ? `Disminuye ${formatMoney(Math.abs(adjustmentDifference))}` : formatMoney(0)}</strong></div><label className="full-width">Motivo del ajuste<textarea minLength={3} maxLength={2000} value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} required /></label>{message && <p className="form-message full-width">{message}</p>}<div className="form-actions full-width"><button type="button" className="secondary" onClick={() => setAdjusting(null)}>Cancelar</button><button className="primary" type="submit" disabled={processing}>{processing ? 'Registrando ajuste...' : 'Confirmar ajuste'}</button></div></form></FundModal>}
  </>;
}
