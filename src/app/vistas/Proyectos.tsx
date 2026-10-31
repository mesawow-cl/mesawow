// Proyectos y campañas (§4.14), Entregables (§4.15) y Bases y segmentos (§4.20).
import { useEffect, useState } from 'preact/hooks';
import { hoySantiago } from '../../shared/fechas';
import { abrirArchivo, pedir, type Persona } from '../api';
import { Dialogo } from '../componentes/Dialogo';
import { fechaCorta, marcas as cargarMarcas, TONO_ESTADO, type Marca } from '../datos';

type Fila = Record<string, any>;
const valor = (e: Event) => (e.target as HTMLInputElement).value;
const PESTANAS = [['brief', 'Brief y objetivos'], ['audiencia', 'Base y segmentos'], ['contenido', 'Contenidos y HTML'], ['config', 'Configuración'],
  ['revision', 'Revisión'], ['programacion', 'Programación'], ['protocolo', 'Protocolo y tareas']] as const;

const Estado = ({ e }: { e: string }) => <span class={`insignia ${TONO_ESTADO[e] ?? (e === 'Calendarizada' || e === 'Programada en el canal' ? 'verde' : e === 'Borrador' ? 'gris' : '')}`}>{e}</span>;

const VistaPrevia = ({ html }: { html: string }) => {
  const [movil, setMovil] = useState(false);
  return (
    <div>
      <div class="segmentado" role="group" aria-label="Vista previa">
        <button type="button" aria-pressed={!movil} onClick={() => setMovil(false)}>Escritorio</button>
        <button type="button" aria-pressed={movil} onClick={() => setMovil(true)}>Teléfono</button>
      </div>
      {/* sandbox vacío: el HTML del correo no ejecuta código ni accede a la app. */}
      <iframe class={`vista-correo${movil ? ' movil' : ''}`} title="Vista previa del correo" sandbox="" srcdoc={html || '<p style="font-family:sans-serif;color:#777">Sin contenido todavía.</p>'} />
    </div>
  );
};

export const Proyectos = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const [lista, setLista] = useState<Fila[] | null>(null);
  const [elegida, setElegida] = useState('');
  const [det, setDet] = useState<Fila | null>(null);
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number][0]>('brief');
  const [nueva, setNueva] = useState(false);
  const coordina = persona.permisos.coordina && !persona.permisos.soloLectura;

  const cargarLista = () => pedir<{ campanas: Fila[] }>('/campanas').then((r) => { setLista(r.campanas); setElegida((e) => e || r.campanas[0]?.id || ''); });
  const cargar = () => elegida ? pedir<Fila>(`/campanas/${elegida}`).then(setDet).catch((e: Error) => aviso(e.message)) : setDet(null);
  useEffect(() => { cargarLista(); }, []);
  useEffect(() => { cargar(); }, [elegida]);

  const guardar = async (ruta: string, metodo: string, json: unknown, mensaje: string) => {
    try { await pedir(`/campanas/${elegida}${ruta}`, { method: metodo, json }); aviso(mensaje); cargar(); cargarLista(); }
    catch (e) { aviso((e as Error).message); }
  };

  const c = det?.campana;
  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div><p class="ceja">Mesas</p><h1 id="titulo-vista">Construye tu campaña</h1>
          <p>Brief, audiencia, contenido, revisión y programación. Cada cambio crea una versión nueva que vuelve a revisión.</p></div>
        {coordina && <button type="button" class="primario" onClick={() => setNueva(true)}>＋ Nueva campaña</button>}
      </div>
      {!lista ? <p>Cargando…</p> : !lista.length ? <div class="pronto"><strong>Aún no hay campañas.</strong><p>Crea la primera con ＋ Nueva campaña.</p></div> : (
        <>
          <label class="visualmente-oculto" for="campana-sel">Campaña</label>
          <select id="campana-sel" class="buscador" style={{ width: 'min(640px, 100%)' }} value={elegida} onChange={(e) => setElegida(valor(e))}>
            {lista.map((x) => <option key={x.id} value={x.id}>{x.marca} · {x.name}</option>)}
          </select>
          {c && (
            <>
              <div class="chips" style={{ marginTop: '12px' }}>
                <Estado e={c.status} /><span class="insignia gris">Versión {c.version}</span>
                {c.approved_version && <span class="insignia verde">Aprobada la versión {c.approved_version}</span>}
                {c.launched_at && <span class="insignia verde">Lanzada el {fechaCorta(c.launched_at)}</span>}
              </div>
              <nav class="pestanas-vista" aria-label="Secciones de la campaña">
                {PESTANAS.map(([k, t]) => <button type="button" key={k} aria-pressed={pestana === k} onClick={() => setPestana(k)}>{t}</button>)}
              </nav>
              <div class="tarjeta">
                {pestana === 'brief' && <Brief c={c} editable={coordina} guardar={(j) => guardar('/brief', 'PATCH', j, 'Brief guardado. Nueva versión en borrador.')} />}
                {pestana === 'audiencia' && <Audiencia c={c} editable={coordina} guardar={(id) => guardar('/segmento', 'PATCH', { segmentoId: id }, 'Segmento guardado.')} />}
                {pestana === 'contenido' && <Contenido c={c} editable={coordina} guardar={(j) => guardar('/contenido', 'PATCH', j, 'Versión de contenido guardada.')} />}
                {pestana === 'config' && <Configuracion c={c} editable={coordina} guardar={(j) => guardar('/configuracion', 'PATCH', j, 'Configuración guardada.')} />}
                {pestana === 'revision' && (
                  <div class="formulario">
                    <ul class="lista-simple">
                      {det!.revision.map((r: Fila) => <li key={r.item}><span class={`insignia ${r.ok ? 'verde' : 'roja'}`}>{r.ok ? '✓' : 'Falta'}</span> {r.item}</li>)}
                    </ul>
                    {c.review_comment && <p><strong>Observación:</strong> {c.review_comment}</p>}
                    <VistaPrevia html={c.html} />
                    {coordina && (
                      <div class="acciones">
                        {c.status === 'Borrador' || c.status === 'Ajustes solicitados'
                          ? <button type="button" onClick={() => guardar('/enviar-revision', 'POST', {}, 'Enviada a revisión.')}>Enviar a revisión</button> : null}
                        {c.status === 'En revisión' && <button type="button" onClick={() => { const m = prompt('¿Qué ajustes se necesitan?'); if (m?.trim()) guardar('/pedir-ajustes', 'POST', { comentario: m }, 'Ajustes solicitados.'); }}>Solicitar ajustes</button>}
                        {c.approved_version !== c.version && <button type="button" class="primario" onClick={() => guardar('/aprobar', 'POST', {}, `Versión ${c.version} aprobada.`)}>Aprobar versión</button>}
                      </div>
                    )}
                  </div>
                )}
                {pestana === 'programacion' && <Programacion c={c} editable={coordina} guardar={guardar} />}
                {pestana === 'protocolo' && (
                  !det!.tareas.length ? <p class="apagado">Esta campaña no tiene tareas. Créalas desde Mis encargos eligiendo la campaña, o con el protocolo 360 o webinar.</p> : (
                    <>
                      <p class="apagado">{det!.tareas.filter((t: Fila) => ['Aprobada', 'Completada'].includes(t.status)).length} de {det!.tareas.length} terminadas</p>
                      <ul class="lista-invitaciones" style={{ marginTop: '10px' }}>
                        {det!.tareas.map((t: Fila) => (
                          <li key={t.id}><span><a href={`/encargos?tarea=${t.id}`}>{t.title}</a><br /><span class="apagado">{t.responsable ?? 'Sin responsable'} · vence {fechaCorta(t.due)}</span></span><Estado e={t.status} /></li>
                        ))}
                      </ul>
                    </>
                  )
                )}
              </div>
            </>
          )}
        </>
      )}
      {nueva && <NuevaCampana alCerrar={() => setNueva(false)} alCrear={(id) => { setNueva(false); aviso('Campaña creada en borrador.'); setElegida(id); cargarLista(); }} />}
    </section>
  );
};

const Brief = ({ c, editable, guardar }: { c: Fila; editable: boolean; guardar: (j: unknown) => void }) => {
  const [d, setD] = useState({ nombre: c.name, objetivo: c.objective, indicador: c.metric, meta: c.target, presupuesto: c.budget ?? '', plataforma: c.platform, inicio: c.start_date ?? hoySantiago(), fin: c.end_date ?? hoySantiago(), publico: c.audience, notas: c.notes });
  const k = (x: keyof typeof d) => (e: Event) => setD({ ...d, [x]: valor(e) });
  return (
    <form class="formulario" onSubmit={(e) => { e.preventDefault(); guardar({ ...d, presupuesto: d.presupuesto === '' ? null : Number(d.presupuesto) }); }}>
      <fieldset disabled={!editable} class="formulario" style={{ border: 0, padding: 0 }}>
        <label>Nombre<input required minLength={3} value={d.nombre} onInput={k('nombre')} /></label>
        <label>Objetivo<input required value={d.objetivo} onInput={k('objetivo')} /></label>
        <div class="dos"><label>Indicador<input value={d.indicador} onInput={k('indicador')} /></label><label>Meta<input value={d.meta} placeholder="Ej.: 40 reuniones" onInput={k('meta')} /></label></div>
        <div class="dos"><label>Presupuesto<input type="number" min={0} step={0.01} value={d.presupuesto} onInput={k('presupuesto')} /></label><label>Plataforma<input value={d.plataforma} onInput={k('plataforma')} /></label></div>
        <div class="dos"><label>Inicio<input type="date" required value={d.inicio} onInput={k('inicio')} /></label><label>Fin<input type="date" required min={d.inicio} value={d.fin} onInput={k('fin')} /></label></div>
        <label>Público<textarea rows={2} value={d.publico} onInput={k('publico')} /></label>
        <label>Notas<textarea rows={2} value={d.notas} onInput={k('notas')} /></label>
      </fieldset>
      {editable && <div class="acciones"><button type="submit" class="primario">Guardar brief</button></div>}
    </form>
  );
};

const Audiencia = ({ c, editable, guardar }: { c: Fila; editable: boolean; guardar: (id: string | null) => void }) => {
  const [segs, setSegs] = useState<Fila[] | null>(null);
  const [id, setId] = useState(c.segment_id ?? '');
  useEffect(() => { pedir<{ segmentos: Fila[] }>('/bases').then((r) => setSegs(r.segmentos.filter((s) => s.brand_id === c.brand_id))).catch(() => setSegs([])); }, [c.id]);
  return (
    <div class="formulario">
      <p>Elige un segmento validado de la misma marca. Los segmentos se arman en <a href="/bases?desde=aire">Bases y segmentos</a>.</p>
      {!segs ? <p>Cargando…</p> : !segs.length ? <p class="apagado">No hay segmentos de esta marca todavía.</p> : (
        <label>Segmento
          <select disabled={!editable} value={id} onChange={(e) => setId(valor(e))}>
            <option value="">Sin segmento</option>
            {segs.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.contactos} contactos</option>)}
          </select>
        </label>
      )}
      {editable && <div class="acciones"><button type="button" class="primario" onClick={() => guardar(id || null)}>Guardar selección</button></div>}
    </div>
  );
};

const Contenido = ({ c, editable, guardar }: { c: Fila; editable: boolean; guardar: (j: unknown) => void }) => {
  const [d, setD] = useState({ asunto: c.subject, preheader: c.preheader, cta: c.cta, url: c.url, html: c.html });
  const k = (x: keyof typeof d) => (e: Event) => setD({ ...d, [x]: valor(e) });
  return (
    <form class="formulario" onSubmit={(e) => { e.preventDefault(); guardar(d); }}>
      <fieldset disabled={!editable} class="formulario" style={{ border: 0, padding: 0 }}>
        <div class="dos"><label>Asunto<input value={d.asunto} onInput={k('asunto')} /></label><label>Preheader<input value={d.preheader} onInput={k('preheader')} /></label></div>
        <div class="dos"><label>Texto del botón (CTA)<input value={d.cta} onInput={k('cta')} /></label><label>URL del botón<input type="url" value={d.url} placeholder="https://" onInput={k('url')} /></label></div>
        <label>HTML del correo<textarea class="codigo" rows={10} value={d.html} onInput={k('html')} /></label>
      </fieldset>
      <VistaPrevia html={d.html} />
      <div class="acciones">
        <button type="button" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([d.html], { type: 'text/html' })); a.download = 'correo_campana.html'; a.click(); }}>Descargar HTML</button>
        {editable && <button type="submit" class="primario">Guardar versión</button>}
      </div>
    </form>
  );
};

const Configuracion = ({ c, editable, guardar }: { c: Fila; editable: boolean; guardar: (j: unknown) => void }) => {
  const [d, setD] = useState({ remitente: c.sender, respuesta: c.reply_to, cuenta: c.account, utmSource: c.utm_source, utmCampaign: c.utm_campaign });
  const k = (x: keyof typeof d) => (e: Event) => setD({ ...d, [x]: valor(e) });
  return (
    <form class="formulario" onSubmit={(e) => { e.preventDefault(); guardar(d); }}>
      <fieldset disabled={!editable} class="formulario" style={{ border: 0, padding: 0 }}>
        <div class="dos"><label>Remitente<input value={d.remitente} onInput={k('remitente')} /></label><label>Responder a<input value={d.respuesta} onInput={k('respuesta')} /></label></div>
        <label>Cuenta de envío<input value={d.cuenta} placeholder="Cuenta de Brevo de la marca" onInput={k('cuenta')} /></label>
        <div class="dos"><label>UTM source<input value={d.utmSource} onInput={k('utmSource')} /></label><label>UTM campaign<input value={d.utmCampaign} onInput={k('utmCampaign')} /></label></div>
      </fieldset>
      <p class="ayuda">El envío real con Brevo se conecta en la Fase 6. Nunca se escriben claves aquí.</p>
      {editable && <div class="acciones"><button type="submit" class="primario">Guardar configuración</button></div>}
    </form>
  );
};

const Programacion = ({ c, editable, guardar }: { c: Fila; editable: boolean; guardar: (r: string, m: string, j: unknown, msg: string) => void }) => {
  const [d, setD] = useState({ fecha: c.sched_date ?? hoySantiago(), hora: c.sched_time ?? '10:00', idExterno: c.external_id ?? '', evidencia: c.evidence ?? '' });
  const [lanz, setLanz] = useState({ fecha: hoySantiago(), evidencia: '' });
  const aprobada = c.approved_version === c.version;
  const k = (x: keyof typeof d) => (e: Event) => setD({ ...d, [x]: valor(e) });
  return (
    <div class="formulario">
      {!aprobada && <p class="aviso-bloqueo">Solo se programa la versión aprobada. Ve a Revisión.</p>}
      <fieldset disabled={!editable || !aprobada} class="formulario">
        <legend>Programación (hora de Chile)</legend>
        <div class="dos"><label>Fecha<input type="date" value={d.fecha} onInput={k('fecha')} /></label><label>Hora<input type="time" value={d.hora} onInput={k('hora')} /></label></div>
        <div class="dos"><label>ID externo<input value={d.idExterno} onInput={k('idExterno')} /></label><label>Evidencia (enlace)<input type="url" value={d.evidencia} onInput={k('evidencia')} /></label></div>
        <div class="acciones">
          <button type="button" onClick={() => guardar('/programar', 'POST', { ...d, externa: false }, 'Campaña calendarizada.')}>Calendarizar</button>
          <button type="button" class="primario" onClick={() => guardar('/programar', 'POST', { ...d, externa: true }, 'Programación externa registrada.')}>Registrar programación externa</button>
        </div>
      </fieldset>
      {editable && (
        <fieldset class="formulario">
          <legend>Registrar lanzamiento real</legend>
          <div class="dos"><label>Fecha<input type="date" max={hoySantiago()} value={lanz.fecha} onInput={(e) => setLanz({ ...lanz, fecha: valor(e) })} /></label>
            <label>Enlace de evidencia<input type="url" required value={lanz.evidencia} placeholder="https://" onInput={(e) => setLanz({ ...lanz, evidencia: valor(e) })} /></label></div>
          <div class="acciones"><button type="button" onClick={() => guardar('/lanzamiento', 'POST', lanz, '¡Lanzamiento verificado!')}>Registrar lanzamiento</button></div>
        </fieldset>
      )}
    </div>
  );
};

const NuevaCampana = ({ alCerrar, alCrear }: { alCerrar: () => void; alCrear: (id: string) => void }) => {
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [d, setD] = useState({ nombre: '', marcaId: '' });
  const [error, setError] = useState('');
  useEffect(() => { cargarMarcas().then(setMarcas); }, []);
  return (
    <Dialogo titulo="Nueva campaña" abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={async (e) => { e.preventDefault(); try { alCrear((await pedir<{ id: string }>('/campanas', { method: 'POST', json: d })).id); } catch (err) { setError((err as Error).message); } }}>
        <label>Nombre<input required minLength={3} value={d.nombre} onInput={(e) => setD({ ...d, nombre: valor(e) })} /></label>
        <label>Marca<select required value={d.marcaId} onChange={(e) => setD({ ...d, marcaId: valor(e) })}><option value="">Elige</option>{marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <p class="ayuda">Las campañas 360 de tres meses y los webinars, con su protocolo de tareas, llegan en el siguiente bloque de esta fase.</p>
        {error && <p class="error-form" role="alert">{error}</p>}
        <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" class="primario">Crear borrador</button></div>
      </form>
    </Dialogo>
  );
};

export const Entregables = ({ aviso }: { aviso: (m: string) => void }) => {
  const [lista, setLista] = useState<Fila[] | null>(null);
  const [ver, setVer] = useState<{ nombre: string; html: string } | null>(null);
  useEffect(() => { pedir<{ entregables: Fila[] }>('/entregables').then((r) => setLista(r.entregables)).catch((e: Error) => aviso(e.message)); }, []);
  const abrir = async (x: Fila) => { const r = await pedir<{ campana: Fila }>(`/campanas/${x.id}`); setVer({ nombre: x.name, html: r.campana.html }); };
  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado"><div><p class="ceja">Mesas</p><h1 id="titulo-vista">Entregables y versiones</h1><p>Los correos HTML de cada campaña, con su versión y aprobación.</p></div></div>
      {!lista ? <p>Cargando…</p> : !lista.length ? <p class="apagado">Aún no hay entregables HTML.</p> : (
        <ul class="lista-invitaciones">
          {lista.map((x) => (
            <li key={x.id}><span><strong>{x.name}</strong><br /><span class="apagado">{x.marca} · versión {x.version}{x.approved_version === x.version ? ' · aprobada' : ''}</span></span>
              <button type="button" onClick={() => abrir(x)}>Ver correo</button></li>
          ))}
        </ul>
      )}
      {ver && <Dialogo titulo={ver.nombre} abierto alCerrar={() => setVer(null)}><VistaPrevia html={ver.html} /></Dialogo>}
    </section>
  );
};

export const Bases = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const [datos, setDatos] = useState<{ bases: Fila[]; segmentos: Fila[] } | null>(null);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [marcaId, setMarcaId] = useState('');
  const [baseId, setBaseId] = useState('');
  const [muestra, setMuestra] = useState<Fila[]>([]);
  const [seg, setSeg] = useState({ nombre: '', ubicacion: '', interes: '' });
  const cargar = () => pedir<typeof datos>('/bases').then((r) => { setDatos(r); setBaseId((b) => b || r!.bases[0]?.id || ''); }).catch((e: Error) => aviso(e.message));
  useEffect(() => { cargar(); cargarMarcas().then((m) => { setMarcas(m); setMarcaId(m[0]?.id ?? ''); }); }, []);
  useEffect(() => { if (baseId) pedir<{ muestra: Fila[] }>(`/bases/${baseId}`).then((r) => setMuestra(r.muestra)); }, [baseId]);

  const subir = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { aviso('El archivo puede pesar hasta 2 MB.'); return; }
    try {
      const r = await pedir<{ id: string; stats: Fila }>(`/bases?marca=${marcaId}&nombre=${encodeURIComponent(f.name)}`, { method: 'POST', body: await f.text(), headers: { 'content-type': 'text/csv' } });
      aviso(`Base cargada: ${r.stats.eligible} de ${r.stats.total} contactos habilitados.`);
      setBaseId(r.id);
      cargar();
    } catch (e) { aviso((e as Error).message); }
  };
  const ejemplo = () => {
    const csv = 'email;nombre;comuna;interes;autorizado;baja\nana@example.test;Ana;Providencia;Inversión;si;\nbeto@example.test;Beto;Ñuñoa;Propiedades;si;\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'ejemplo_base.csv'; a.click();
  };
  const base = datos?.bases.find((b) => b.id === baseId);
  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div><p class="ceja">Al aire</p><h1 id="titulo-vista">Bases y segmentos</h1>
          <p>Carga contactos en CSV: mesawow separa inválidos, duplicados, bajas y contactos sin respaldo de consentimiento.</p></div>
        {!persona.permisos.soloLectura && (
          <div class="persona-acciones">
            <button type="button" onClick={ejemplo}>CSV de ejemplo</button>
            <select aria-label="Marca de la base" value={marcaId} onChange={(e) => setMarcaId(valor(e))}>{marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            <label class="casilla primario">＋ Cargar CSV<input class="visualmente-oculto" type="file" accept=".csv,text/csv" onChange={(e) => subir((e.target as HTMLInputElement).files?.[0])} /></label>
          </div>
        )}
      </div>
      {!datos ? <p>Cargando…</p> : !datos.bases.length ? <div class="pronto"><strong>Aún no hay bases.</strong><p>Descarga el CSV de ejemplo para ver el formato.</p></div> : (
        <>
          <select class="buscador" aria-label="Base" value={baseId} onChange={(e) => setBaseId(valor(e))}>{datos.bases.map((b) => <option key={b.id} value={b.id}>{b.marca} · {b.filename}</option>)}</select>
          {base && (
            <div class="metricas">
              {[['Registros', base.stats.total], ['Habilitados', base.stats.eligible], ['Inválidos o duplicados', base.stats.invalid + base.stats.duplicates], ['Bajas o sin respaldo', base.stats.excluded + base.stats.pending]]
                .map(([k, v]) => <div class="tarjeta metrica" key={k}><div><strong>{v}</strong><span>{k}</span></div></div>)}
            </div>
          )}
          <div class="inicio-grilla">
            <section class="tarjeta">
              <h2 style={{ marginBottom: '10px' }}>Primeros contactos</h2>
              <ul class="lista-simple">{muestra.map((m, i) => <li key={i}>{m.name || '—'} · {m.email} <span class={`insignia ${m.status === 'Habilitado' ? 'verde' : 'gris'}`}>{m.status}</span></li>)}</ul>
            </section>
            <section class="tarjeta">
              <h2 style={{ marginBottom: '10px' }}>Crear segmento</h2>
              <form class="formulario" onSubmit={async (e) => {
                e.preventDefault();
                try { const r = await pedir<{ contactos: number }>('/segmentos', { method: 'POST', json: { baseId, ...seg } }); aviso(`Segmento creado con ${r.contactos} contactos.`); setSeg({ nombre: '', ubicacion: '', interes: '' }); cargar(); }
                catch (err) { aviso((err as Error).message); }
              }}>
                <label>Nombre<input required minLength={2} value={seg.nombre} onInput={(e) => setSeg({ ...seg, nombre: valor(e) })} /></label>
                <div class="dos"><label>Ubicación contiene<input value={seg.ubicacion} onInput={(e) => setSeg({ ...seg, ubicacion: valor(e) })} /></label>
                  <label>Interés contiene<input value={seg.interes} onInput={(e) => setSeg({ ...seg, interes: valor(e) })} /></label></div>
                <div class="acciones"><button type="submit" class="primario">Crear segmento</button></div>
              </form>
              <h3 style={{ margin: '16px 0 8px' }}>Segmentos guardados</h3>
              <ul class="lista-invitaciones">
                {datos.segmentos.map((s) => (
                  <li key={s.id}><span><strong>{s.name}</strong><br /><span class="apagado">{s.marca} · {s.contactos} contactos</span></span>
                    <button type="button" onClick={() => abrirArchivo(`/api/v1/segmentos/${s.id}/exportar`, 'segmento.csv')}>Exportar CSV</button></li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </section>
  );
};
