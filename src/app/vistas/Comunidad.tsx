// Comunidad (§4.2): logros automáticos, felicitar, comentar, reportar; compromisos del día (§4.4);
// Logros del equipo (coordinaODirige) y Moderación (esAdmin).
import { useEffect, useState } from 'preact/hooks';
import { pedir, type Persona } from '../api';
import { Avatar } from '../componentes/Avatar';
import { Dialogo } from '../componentes/Dialogo';
import { marcas as cargarMarcas, mesas as cargarMesas, personas as cargarPersonas, type Marca, type Mesa, type PersonaDirectorio } from '../datos';
import { hrefDe } from '../rutas';
import { useLatido } from '../vivo';

export interface Logro {
  id: string; tipo: string; valido: boolean; creado: string; detalle: boolean; titulo: string; mesa: string | null; marca: string | null; grupo: string;
  personas: { id: string; name: string; foto: string | null }[]; felicitaciones: number; felicitaste: boolean; comentarios: number; tareaId: string | null;
}

export const TIPOS_LOGRO = ['Tarea aceptada', 'Día cumplido', 'Sprint completo', 'Objetivo del sprint alcanzado', 'Lanzamiento verificado', 'Entrega entre áreas'];

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const perfilDe = (id: string) => `${hrefDe('profile')}?id=${id}`;

/** Felicitar con la sonrisa; el toast con rayos aparece al reconocer (nivel 2 de celebración). */
export const felicitar = async (l: Logro, aviso: (m: string) => void) => {
  const r = await pedir<{ felicitaste: boolean; felicitaciones: number }>(`/logros/${l.id}/felicitar`, { method: 'POST', json: {} });
  if (r.felicitaste) aviso(`⚡ Reconociste a ${l.personas.map((p) => p.name.split(' ')[0]).join(', ') || 'el equipo'} · La persona verá tu sonrisa en su logro`);
  return r;
};

export const BotonFelicitar = ({ logro, aviso, alCambiar }: { logro: Logro; aviso: (m: string) => void; alCambiar: (l: Logro) => void }) => {
  const [animar, setAnimar] = useState(false);
  return (
    <button type="button" class={`felicitar${logro.felicitaste ? ' activo' : ''}${animar ? ' animar' : ''}`} aria-pressed={logro.felicitaste}
      onClick={async () => {
        try {
          const r = await felicitar(logro, aviso);
          setAnimar(r.felicitaste);
          alCambiar({ ...logro, ...r });
        } catch (e) { aviso((e as Error).message); }
      }}>
      <span aria-hidden="true">😊</span> {logro.felicitaste ? 'Felicitaste' : 'Felicitar'} <b>{logro.felicitaciones}</b>
    </button>
  );
};

export const TarjetaLogro = ({ logro, aviso, alAbrir, alReportar, alCambiar }: {
  logro: Logro; aviso: (m: string) => void; alAbrir: (id: string) => void; alReportar?: (id: string) => void; alCambiar: (l: Logro) => void;
}) => (
  <article class={`tarjeta logro${logro.valido ? '' : ' en-actualizacion'}`}>
    <div class="logro-cabeza">
      <div class="pila-avatares">{logro.personas.slice(0, 3).map((p) => <Avatar key={p.id} nombre={p.name} foto={p.foto} />)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div class="logro-personas">{logro.personas.map((p, i) => <>{i > 0 && ' · '}<a href={perfilDe(p.id)}>{p.name}</a></>)}{!logro.personas.length && 'Equipo'}</div>
        <p class="ayuda">{fechaHora(logro.creado)} · Automático</p>
      </div>
      <span class="chispa" aria-hidden="true">✦</span>
    </div>
    <span class={`insignia ${logro.valido ? 'verde' : 'ambar'}`}>{logro.valido ? logro.tipo : 'Reconocimiento en actualización'}</span>
    <h3>{logro.titulo}</h3>
    <p class="ayuda">{logro.detalle ? [logro.mesa ?? 'Trabajo compartido', logro.marca].filter(Boolean).join(' · ') : 'Reconocimiento interno. El detalle conserva sus permisos.'}</p>
    <p>{logro.valido ? 'Gracias por hacer avanzar el trabajo y conectar al equipo.' : 'La entrega se está revisando. Su historial se conserva.'}</p>
    <div class="logro-acciones">
      <BotonFelicitar logro={logro} aviso={aviso} alCambiar={alCambiar} />
      <button type="button" onClick={() => alAbrir(logro.id)}>{logro.comentarios ? `Comentarios (${logro.comentarios})` : 'Comentar'}</button>
      {logro.tareaId && <a class="boton" href={`/encargos?tarea=${logro.tareaId}`}>Ver resultado</a>}
      {alReportar && <button type="button" class="enlace" onClick={() => alReportar(logro.id)}>Reportar</button>}
    </div>
  </article>
);

interface Detalle {
  logro: Logro & { actualizado: string }; tareas: { id: string; title: string }[];
  comentarios: { id: string; texto: string; creado: string; persona: string; mencion: string | null; propio: boolean }[];
}

/** Detalle de logro: personas, estado, tareas, comentarios con mención opcional. */
export const DetalleLogro = ({ id, alCerrar, aviso }: { id: string | null; alCerrar: () => void; aviso: (m: string) => void }) => {
  const [d, setD] = useState<Detalle | null>(null);
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [texto, setTexto] = useState('');
  const [mencion, setMencion] = useState('');
  const cargar = () => id && pedir<Detalle>(`/logros/${id}`).then(setD).catch((e: Error) => { aviso(e.message); alCerrar(); });
  useEffect(() => { setD(null); setTexto(''); setMencion(''); cargar(); }, [id]);
  useEffect(() => { cargarPersonas().then(setGente); }, []);
  const comentar = async (e: Event) => {
    e.preventDefault();
    try { await pedir(`/logros/${id}/comentarios`, { method: 'POST', json: { texto, mencionId: mencion || null } }); setTexto(''); setMencion(''); cargar(); }
    catch (err) { aviso((err as Error).message); }
  };
  const retirar = async (cid: string) => {
    try { await pedir(`/comentarios/${cid}`, { method: 'DELETE' }); cargar(); } catch (err) { aviso((err as Error).message); }
  };
  return (
    <Dialogo titulo="Un logro que nos conecta" abierto={!!id} alCerrar={alCerrar}>
      {!d ? <p>Cargando…</p> : (
        <div class="formulario">
          <span class="insignia verde" style={{ justifySelf: 'start' }}>{d.logro.tipo}</span>
          <h3 style={{ margin: 0 }}>{d.logro.titulo}</h3>
          <p>{d.logro.personas.map((p) => p.name).join(' · ') || 'Equipo'}</p>
          <p class="ayuda">{d.logro.valido ? 'Validado' : 'En actualización'} · {fechaHora(d.logro.creado)}</p>
          {d.tareas.length > 0 && <div class="acciones" style={{ justifyContent: 'flex-start' }}>{d.tareas.map((t) => <a key={t.id} class="boton" href={`/encargos?tarea=${t.id}`} onClick={alCerrar}>{t.title}</a>)}</div>}
          <h3 style={{ marginBottom: 0 }}>Felicitaciones del equipo</h3>
          {!d.comentarios.length ? <p class="ayuda">Sé la primera persona en felicitar.</p> : (
            <ul class="lista-limpia">
              {d.comentarios.map((k) => (
                <li key={k.id} class="comentario">
                  <strong>{k.persona}</strong>{k.mencion && <span class="ayuda"> · mencionó a {k.mencion}</span>}
                  <p style={{ margin: '4px 0' }}>{k.texto}</p>
                  {k.propio && <button type="button" class="enlace" onClick={() => retirar(k.id)}>Retirar mi comentario</button>}
                </li>
              ))}
            </ul>
          )}
          <form class="formulario" onSubmit={comentar}>
            <label>Tu felicitación
              <textarea rows={3} maxLength={1000} required value={texto} placeholder="Gracias por tu aporte…" onInput={(e) => setTexto((e.target as HTMLTextAreaElement).value)} />
            </label>
            <label>Mencionar a alguien del equipo
              <select value={mencion} onChange={(e) => setMencion((e.target as HTMLSelectElement).value)}>
                <option value="">Sin mención</option>
                {gente.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <div class="acciones"><button class="primario">Publicar comentario</button></div>
          </form>
        </div>
      )}
    </Dialogo>
  );
};

const Reportar = ({ id, alCerrar, aviso }: { id: string | null; alCerrar: () => void; aviso: (m: string) => void }) => {
  const [motivo, setMotivo] = useState('');
  const enviar = async (e: Event) => {
    e.preventDefault();
    try { await pedir(`/logros/${id}/reportar`, { method: 'POST', json: { motivo } }); setMotivo(''); alCerrar(); aviso('Reporte interno registrado.'); }
    catch (err) { aviso((err as Error).message); }
  };
  return (
    <Dialogo titulo="Reportar contenido" abierto={!!id} alCerrar={alCerrar}>
      <form class="formulario" onSubmit={enviar}>
        <label>Qué debemos revisar<textarea rows={4} required maxLength={1000} value={motivo} onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} /></label>
        <p class="ayuda">La administración revisará el reporte. Un logro válido conserva una ficha mínima segura.</p>
        <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button class="primario">Enviar reporte interno</button></div>
      </form>
    </Dialogo>
  );
};

// ─────────────────────────────── Compromisos del día

interface DatosCompromiso { dia: string; fin: string; existe: boolean; seleccion: string[]; opciones: { id: string; title: string; status: string; due: string }[] }

export const Compromisos = ({ abierto, alCerrar, aviso }: { abierto: boolean; alCerrar: () => void; aviso: (m: string) => void }) => {
  const [d, setD] = useState<DatosCompromiso | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [fin, setFin] = useState('18:00');
  const [motivo, setMotivo] = useState('');
  useEffect(() => {
    if (!abierto) return;
    setMotivo('');
    pedir<DatosCompromiso>('/compromisos/hoy').then((x) => { setD(x); setSel(x.seleccion); setFin(x.fin); }).catch((e: Error) => { aviso(e.message); alCerrar(); });
  }, [abierto]);
  const guardar = async (e: Event) => {
    e.preventDefault();
    if (!sel.length) { aviso('Selecciona al menos una entrega.'); return; }
    try {
      await pedir('/compromisos/hoy', { method: 'PUT', json: { fin, tareas: sel, ...(d?.existe ? { motivo } : {}) } });
      alCerrar(); aviso('Compromisos guardados. El reconocimiento se evaluará al cierre.');
    } catch (err) { aviso((err as Error).message); }
  };
  return (
    <Dialogo titulo="Mis compromisos del día" abierto={abierto} alCerrar={alCerrar}>
      {!d ? <p>Cargando…</p> : (
        <form class="formulario" onSubmit={guardar}>
          <p>{d.dia} · America/Santiago</p>
          <p class="nota">El sistema evalúa el cierre después de tu jornada. Solo reconoce el día cumplido si todas las entregas seleccionadas satisfacen sus criterios. No se celebra por reservar horas.</p>
          <label>Fin de jornada<input type="time" required value={fin} onInput={(e) => setFin((e.target as HTMLInputElement).value)} /></label>
          {!d.opciones.length ? <p>Primero necesitas una tarea asignada.</p> : (
            <div class="lista-elegible" role="group" aria-label="Tus entregas">
              {d.opciones.map((t) => (
                <label key={t.id}>
                  <input type="checkbox" checked={sel.includes(t.id)} onChange={(e) => setSel((e.target as HTMLInputElement).checked ? [...sel, t.id] : sel.filter((x) => x !== t.id))} />
                  {t.title} · <span class="ayuda">{t.status}</span>
                </label>
              ))}
            </div>
          )}
          {d.existe && <label>Motivo del cambio de compromisos<textarea rows={2} required maxLength={500} value={motivo} onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} /></label>}
          <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button class="primario" disabled={!d.opciones.length}>Guardar compromisos</button></div>
        </form>
      )}
    </Dialogo>
  );
};

/** Lista de logros con agrupación "N aportes al mismo encargo" y diálogos de detalle y reporte. */
export const ListaLogros = ({ logros, aviso, alCambiar, agrupar = false }: { logros: Logro[]; aviso: (m: string) => void; alCambiar: (l: Logro) => void; agrupar?: boolean }) => {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [reporte, setReporte] = useState<string | null>(null);
  const grupos: Logro[][] = [];
  for (const l of logros) {
    const g = agrupar ? grupos.find((x) => x[0]!.grupo === l.grupo) : undefined;
    if (g) g.push(l); else grupos.push([l]);
  }
  const tarjeta = (l: Logro) => <TarjetaLogro key={l.id} logro={l} aviso={aviso} alAbrir={setAbierto} alReportar={setReporte} alCambiar={alCambiar} />;
  return (
    <>
      {!logros.length ? (
        <div class="pronto"><strong>Los próximos logros aparecerán aquí.</strong><p>Completa una tarea con evidencia y criterios de aceptación. Si requiere revisión, se publicará al aprobarse.</p></div>
      ) : (
        <div class="lista-logros">
          {grupos.map((g) => g.length === 1 ? tarjeta(g[0]!) : (
            <details class="grupo-logros" open key={g[0]!.grupo}>
              <summary>{g.length} aportes al mismo encargo · {g[0]!.creado.slice(0, 10)}</summary>
              {g.map(tarjeta)}
            </details>
          ))}
        </div>
      )}
      <DetalleLogro id={abierto} alCerrar={() => setAbierto(null)} aviso={aviso} />
      <Reportar id={reporte} alCerrar={() => setReporte(null)} aviso={aviso} />
    </>
  );
};

const reemplazar = (lista: Logro[], l: Logro) => lista.map((x) => x.id === l.id ? l : x);

// ─────────────────────────────── Comunidad (plaza)

export const Comunidad = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const [filtros, setFiltros] = useState({ tipo: '', persona: '', mesa: '', marca: '' });
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ logros: Logro[]; hayMas: boolean } | null>(null);
  const [error, setError] = useState('');
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [listaMesas, setMesas] = useState<Mesa[]>([]);
  const [listaMarcas, setMarcas] = useState<Marca[]>([]);
  const [compromisos, setCompromisos] = useState(false);
  const latido = useLatido();
  useEffect(() => { cargarPersonas().then(setGente); cargarMesas().then(setMesas); cargarMarcas().then(setMarcas); }, []);
  useEffect(() => {
    const q = new URLSearchParams({ pagina: String(pagina) });
    for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, v);
    pedir<{ logros: Logro[]; hayMas: boolean }>(`/logros?${q}`).then(setDatos).catch((e: Error) => setError(e.message));
  }, [filtros, pagina, latido]);
  const cambiar = (k: keyof typeof filtros, v: string) => { setFiltros({ ...filtros, [k]: v }); setPagina(1); };
  const filtro = (k: keyof typeof filtros, etiqueta: string, todas: string, opciones: { id: string; name: string }[]) => (
    <select aria-label={etiqueta} value={filtros[k]} onChange={(e) => cambiar(k, (e.target as HTMLSelectElement).value)}>
      <option value="">{todas}</option>
      {opciones.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
  if (error) return <div class="pronto" role="alert"><strong>{error}</strong></div>;
  return (
    <section aria-labelledby="titulo-vista">
      <div class="hero hero-comunidad">
        <div>
          <p class="ceja">Cada aporte conecta</p>
          <h1 id="titulo-vista">Un equipo. Muchas mesas. Logros compartidos.</h1>
          <p>Los reconocimientos se publican automáticamente al completar y aceptar el trabajo.</p>
        </div>
        <div class="acciones" style={{ justifyContent: 'flex-start' }}>
          {!persona.permisos.soloLectura && <button type="button" class="primario" onClick={() => setCompromisos(true)}>Mis compromisos del día</button>}
          <a class="boton" href={hrefDe('profile')}>Mi perfil</a>
        </div>
      </div>
      <div class="inicio-grilla">
        <div>
          <div class="filtros-comunidad">
            {filtro('tipo', 'Tipo de logro', 'Todos los logros', TIPOS_LOGRO.map((t) => ({ id: t, name: t })))}
            {filtro('persona', 'Integrante', 'Todo el equipo', gente)}
            {filtro('mesa', 'Mesa', 'Todas las mesas', listaMesas.filter((m) => m.active))}
            {filtro('marca', 'Marca', 'Todas las marcas', listaMarcas)}
          </div>
          {!datos ? <p>Cargando logros…</p> : <ListaLogros logros={datos.logros} aviso={aviso} agrupar alCambiar={(l) => setDatos({ ...datos, logros: reemplazar(datos.logros, l) })} />}
          {datos?.hayMas && <div class="acciones"><button type="button" onClick={() => setPagina(pagina + 1)}>Ver más logros</button></div>}
        </div>
        <aside>
          <section class="tarjeta">
            <h2>Reconocer también conecta</h2>
            <p>Felicita a quienes entregaron, revisaron y colaboraron.</p>
            <p class="ayuda">Sin rankings de personas. Cada trabajo aporta de una manera distinta.</p>
            <a class="boton" href={hrefDe('preferences')}>Mis avisos sociales</a>
          </section>
          <section class="tarjeta">
            <h3>Publicación automática</h3>
            <p class="ayuda">Siempre activa. Las preferencias de avisos no apagan los logros.</p>
            <p class="ayuda">Solo el equipo ve Comunidad. Los mandantes tienen su propia vista de avances aprobados.</p>
          </section>
        </aside>
      </div>
      <Compromisos abierto={compromisos} alCerrar={() => setCompromisos(false)} aviso={aviso} />
    </section>
  );
};

// ─────────────────────────────── Logros del equipo (coordinaODirige)

export const LogrosEquipo = ({ aviso }: { aviso: (m: string) => void }) => {
  const [d, setD] = useState<{ porMesa: { id: string; name: string; n: number }[]; recientes: Logro[] } | null>(null);
  const [error, setError] = useState('');
  const latido = useLatido();
  useEffect(() => { pedir<NonNullable<typeof d>>('/reconocimiento').then(setD).catch((e: Error) => setError(e.message)); }, [latido]);
  if (error) return <div class="pronto" role="alert"><strong>{error}</strong></div>;
  const descargar = () => {
    if (!d) return;
    const texto = ['Logros que conectan las mesas', `Corte: ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })} · America/Santiago`, '',
      ...d.porMesa.map((m) => `${m.name}: ${m.n} reconocimientos`), '', 'Hitos y aportes recientes:',
      ...d.recientes.map((l) => `- ${l.creado.slice(0, 10)} · ${l.tipo} · ${l.titulo} · ${l.personas.map((p) => p.name).join(', ')}`)].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    a.download = `logros-mesawow-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <section aria-labelledby="titulo-vista">
      <div class="hero">
        <div><p class="ceja">Inicio</p><h1 id="titulo-vista">Logros que conectan las mesas</h1><p>Seguimiento operativo de Dirección, separado de resultados comerciales.</p></div>
        <div class="acciones" style={{ justifyContent: 'flex-start' }}><button type="button" disabled={!d} onClick={descargar}>Descargar resumen</button></div>
      </div>
      <p class="nota" style={{ marginTop: '22px' }}>Sin rankings individuales. Los reconocimientos no equivalen a ventas, calidad ni productividad medida.</p>
      {!d ? <p>Cargando…</p> : (
        <>
          <div class="grilla-2 grilla-mesas">
            {d.porMesa.map((m) => (
              <article class="tarjeta" key={m.id}><h2>{m.name}</h2><strong>{m.n} reconocimientos</strong><p class="ayuda">Aportes registrados, sin comparar esfuerzos diferentes.</p></article>
            ))}
          </div>
          <h2 style={{ marginTop: '24px' }}>Hitos y aportes recientes</h2>
          <ListaLogros logros={d.recientes} aviso={aviso} alCambiar={(l) => setD({ ...d, recientes: reemplazar(d.recientes, l) })} />
        </>
      )}
    </section>
  );
};

// ─────────────────────────────── Moderación (esAdmin)

interface Reporte { id: string; reason: string; status: string; resolution: string | null; created_at: string; logro_id: string; title: string; type: string; por: string | null }

export const Moderacion = ({ aviso }: { aviso: (m: string) => void }) => {
  const [lista, setLista] = useState<Reporte[] | null>(null);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState<Reporte | null>(null);
  const [accion, setAccion] = useState('revisado');
  const [motivo, setMotivo] = useState('');
  const cargar = () => pedir<{ reportes: Reporte[] }>('/moderacion').then((r) => setLista(r.reportes)).catch((e: Error) => setError(e.message));
  useEffect(() => { cargar(); }, []);
  if (error) return <div class="pronto" role="alert"><strong>{error}</strong></div>;
  const resolver = async (e: Event) => {
    e.preventDefault();
    try { await pedir(`/moderacion/${abierto!.id}`, { method: 'POST', json: { accion, motivo } }); setAbierto(null); aviso('Resolución registrada.'); cargar(); }
    catch (err) { aviso((err as Error).message); }
  };
  return (
    <section aria-labelledby="titulo-vista">
      <div class="hero"><div><p class="ceja">Equipo</p><h1 id="titulo-vista">Cuidar Comunidad</h1><p>Reportes e historial, con motivo registrado.</p></div></div>
      <section class="tarjeta" style={{ marginTop: '22px' }}>
        {!lista ? <p>Cargando…</p> : !lista.length ? <p>Sin reportes.</p> : (
          <ul class="lista-limpia lista-plataformas">
            {lista.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.reason}</strong>
                  <p class="ayuda">{r.type} · {r.title} · reportó {r.por ?? '—'} · {fechaHora(r.created_at)}</p>
                  {r.resolution && <p class="ayuda">{r.resolution}</p>}
                </div>
                <span class={`insignia ${r.status === 'Resuelto' ? 'verde' : 'ambar'}`}>{r.status}</span>
                {r.status === 'Pendiente' && <button type="button" onClick={() => { setAbierto(r); setAccion('revisado'); setMotivo(''); }}>Revisar</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Dialogo titulo="Resolver reporte" abierto={!!abierto} alCerrar={() => setAbierto(null)}>
        {abierto && (
          <form class="formulario" onSubmit={resolver}>
            <p>{abierto.reason}</p>
            <label>Acción
              <select value={accion} onChange={(e) => setAccion((e.target as HTMLSelectElement).value)}>
                <option value="revisado">Revisado, mantener reconocimiento</option>
                <option value="restringir">Restringir detalle sensible y conservar ficha</option>
                <option value="comentarios">Retirar comentarios reportados (conservar historial)</option>
              </select>
            </label>
            <label>Motivo de resolución<textarea rows={3} required maxLength={1000} value={motivo} onInput={(e) => setMotivo((e.target as HTMLTextAreaElement).value)} /></label>
            <div class="acciones"><button type="button" onClick={() => setAbierto(null)}>Cancelar</button><button class="primario">Registrar resolución</button></div>
          </form>
        )}
      </Dialogo>
    </section>
  );
};
