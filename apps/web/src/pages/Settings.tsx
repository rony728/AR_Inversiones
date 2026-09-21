import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe2, ShieldCheck, Tags, Truck, UserRound, UsersRound } from 'lucide-react';
import { changeApiServer, PendingOperationsError } from '../lib/api-switch';
import { getActiveApiConfig, normalizeApiBaseUrl, PRODUCTION_API_URL, readApiRuntimeSettings, testApiConnection, type ApiEnvironment, type ApiRuntimeSettings } from '../lib/api-runtime';
import { pendingCount } from '../lib/offline-db';
const items = [[UserRound, 'Usuarios', 'Acceso de los operadores', '/configuracion/usuarios'], [UsersRound, 'Socios', 'Rony, Alex y Brian con dos fondos', '/configuracion/socios'], [Tags, 'Categorías', 'Organización del catálogo', '/configuracion/categorias'], [Truck, 'Proveedores', 'Datos de compras', '/configuracion/proveedores']] as const;
const environmentNames: Record<ApiEnvironment, string> = { PRODUCCION: 'Producción', PRUEBAS: 'Pruebas', PERSONALIZADA: 'Personalizada' };

export function Settings() {
  const current = useMemo(() => getActiveApiConfig(), []);
  const stored = useMemo(() => readApiRuntimeSettings(), []);
  const [environment, setEnvironment] = useState<ApiEnvironment>(current.environment);
  const [testingUrl, setTestingUrl] = useState(stored?.testingUrl ?? (current.environment === 'PRUEBAS' ? current.baseUrl : ''));
  const [customUrl, setCustomUrl] = useState(stored?.customUrl ?? (current.environment === 'PERSONALIZADA' ? current.baseUrl : ''));
  const [status, setStatus] = useState<'checking' | 'connected' | 'unreachable'>('checking');
  const [feedback, setFeedback] = useState('');
  const [working, setWorking] = useState(false);
  const candidate = environment === 'PRODUCCION' ? PRODUCTION_API_URL : environment === 'PRUEBAS' ? testingUrl : customUrl;

  useEffect(() => {
    let active = true;
    void testApiConnection(current.baseUrl).then(() => { if (active) setStatus('connected'); }).catch(() => { if (active) setStatus('unreachable'); });
    return () => { active = false; };
  }, [current.baseUrl]);

  function nextSettings(targetEnvironment: ApiEnvironment, url: string): ApiRuntimeSettings {
    return {
      active: targetEnvironment,
      testingUrl: targetEnvironment === 'PRUEBAS' ? url : testingUrl || stored?.testingUrl,
      customUrl: targetEnvironment === 'PERSONALIZADA' ? url : customUrl || stored?.customUrl,
    };
  }

  async function apply(targetEnvironment: ApiEnvironment, rawUrl: string) {
    setFeedback('');
    let normalized: string;
    try { normalized = normalizeApiBaseUrl(rawUrl); } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'Ingresa una URL válida.'); return; }
    setWorking(true);
    try {
      const pending = await pendingCount();
      if (pending > 0) throw new PendingOperationsError(pending);
      const confirmed = window.confirm(`Vas a cambiar de ${environmentNames[current.environment]} a ${environmentNames[targetEnvironment]}.\n\nSe cerrará tu sesión y se limpiarán los datos locales sincronizados del servidor actual.\n\nLos datos almacenados en los servidores no serán modificados.`);
      if (!confirmed) return;
      await changeApiServer(nextSettings(targetEnvironment, normalized), normalized);
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'No se pudo cambiar el servidor.'); }
    finally { setWorking(false); }
  }

  async function testCandidate() {
    setWorking(true); setFeedback('');
    try { await testApiConnection(candidate); setFeedback('Conexión correcta.'); }
    catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'No se pudo verificar esta API desde este origen.'); }
    finally { setWorking(false); }
  }

  return <>
    <section className="page-title"><div><p className="eyebrow">ADMINISTRACIÓN</p><h2>Configuración</h2><p>Catálogos y parámetros necesarios para la operación.</p></div></section>
    <section className="settings-list">{items.map(([Icon, title, text, path]) => <Link key={title} to={path}><span><Icon size={21} /></span><div><h3>{title}</h3><p>{text}</p></div><ShieldCheck size={18} /></Link>)}</section>
    <section className="panel api-connection" aria-labelledby="api-connection-title">
      <div className="panel-head"><div><p className="eyebrow">CONEXIÓN</p><h3 id="api-connection-title"><Globe2 size={20} /> Conexión API</h3><p>Selecciona el servidor de datos utilizado únicamente por este dispositivo.</p></div></div>
      <div className="api-current"><span>Entorno actual <strong>{environmentNames[current.environment]}</strong></span><span>Servidor actual <strong>{current.baseUrl}</strong></span><span>Estado <strong className={status === 'connected' ? 'connection-ok' : status === 'unreachable' ? 'connection-error' : ''}>{status === 'checking' ? 'Comprobando…' : status === 'connected' ? 'Conectado' : 'No accesible'}</strong></span></div>
      <div className="api-environment-options" role="group" aria-label="Entorno de API">
        {(['PRODUCCION', 'PRUEBAS', 'PERSONALIZADA'] as const).map((item) => <button key={item} type="button" className={environment === item ? 'secondary active' : 'secondary'} onClick={() => { setEnvironment(item); setFeedback(''); }}>{environmentNames[item]}</button>)}
      </div>
      {environment !== 'PRODUCCION' && <label>URL de {environmentNames[environment].toLowerCase()}<input type="url" value={environment === 'PRUEBAS' ? testingUrl : customUrl} placeholder="https://servidor.example.com/api/v1" onChange={(event) => environment === 'PRUEBAS' ? setTestingUrl(event.target.value) : setCustomUrl(event.target.value)} /></label>}
      {environment === 'PRODUCCION' && <div className="api-production-url">{PRODUCTION_API_URL}</div>}
      {feedback && <p className={feedback === 'Conexión correcta.' ? 'form-message' : 'purchase-warning'} role="status">{feedback}</p>}
      <div className="api-actions"><button type="button" className="secondary" disabled={working || !candidate} onClick={() => void testCandidate()}>Probar conexión</button><button type="button" className="primary" disabled={working || !candidate} onClick={() => void apply(environment, candidate)}>Guardar</button><button type="button" className="text-button" disabled={working} onClick={() => void apply('PRODUCCION', PRODUCTION_API_URL)}>Restaurar producción</button></div>
      <small>Al cambiar de servidor se cerrará la sesión y se limpiarán los datos locales sincronizados. Las operaciones pendientes nunca se eliminan.</small>
    </section>
  </>;
}
