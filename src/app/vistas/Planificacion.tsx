// Centro de planificación (§4.14): campaña 360, webinar, trabajos del catálogo, plantillas y propuesta semanal.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { hoySantiago } from '../../shared/fechas';
import { pedir } from '../api';
import { Asistente } from '../componentes/Asistente';
import { Dialogo } from '../componentes/Dialogo';
import { fechaCorta, marcas as cargarMarcas, personas as cargarPersonas, type Marca, type PersonaDirectorio } from '../datos';

type Fila = Record<string, any>;
const valor = (e: Event) => (e.target as HTMLInputElement).value;
const CANALES_360 = ['Meta Ads', 'Google Ads', 'Brevo · mailing y newsletter', 'Instagram / Facebook', 'YouTube', 'LinkedIn', 'TikTok'];

const useBase = () => {
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  useEffect(() => { cargarMarcas().then(setMarcas); cargarPersonas().then(setGente); }, []);
  return { marcas, gente };
};
const conMarca = (gente: PersonaDirectorio[], marcaId: string) => gente.filter((g) => g.role === 'Administrador general' || g.marcas.includes(marcaId));
const ElegirPersona = ({ etiqueta, valor: v, alCambiar, gente, requerido = true }: { etiqueta: string; valor: string; alCambiar: (v: string) => void; gente: PersonaDirectorio[]; requerido?: boolean }) => (
  <label>{etiqueta}
    <select required={requerido} value={v} onChange={(e) => alCambiar(valor(e))}>
      <option value="">{requerido ? 'Elige' : 'Sin asignar'}</option>{gente.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>
  </label>
);

type Opcion = 'menu' | '360' | 'webinar' | 'catalogo' | 'plantilla';

/** Diálogo principal: se abre desde ＋ "Una campaña o trabajo del catálogo" y desde Proyectos. */
export const CentroPlanificacion = ({ alCerrar, aviso, alCrear }: { alCerrar: () => void; aviso: (m: string) => void; alCrear?: (campanaId?: string) => void }) => {
  const [opcion, setOpcion] = useState<Opcion>('menu');
  const [propuesta, setPropuesta] = useState<{ tareas: string[]; desde: string } | null>(null);
  const terminar = (mensaje: string, tareas: string[] | null, desde: string, campanaId?: string) => {
    aviso(mensaje);
    alCrear?.(campanaId);
    if (tareas?.length) setPropuesta({ tareas, desde }); else alCerrar();
  };
  if (propuesta) return <PropuestaSemanal tareas={propuesta.tareas} desde={propuesta.desde} alCerrar={alCerrar} aviso={aviso} />;
  const titulos: Record<Opcion, string> = { menu: 'Campaña 360, webinar y trabajos estándar', '360': 'Campaña de tres meses', webinar: 'Nuevo webinar', catalogo: 'Trabajo del catálogo', plantilla: 'Encargo personalizado' };
  return (
    <Dialogo titulo={titulos[opcion]} abierto alCerrar={alCerrar}>
      {opcion === 'menu' && (
        <ul class="crear-lista">
          {([['360', 'Campaña 360 de tres meses', 'Protocolo completo: preparación, piezas mensuales, pauta e informes (437 tareas con el alcance por defecto).'],
            ['webinar', 'Webinar', '31 tareas desde 20 días hábiles antes hasta 5 después del evento.'],
            ['catalogo', 'Trabajo del catálogo', 'Presentaciones, contenidos, mailings, landings, sitios y más, con sus pasos y horas.'],
            ['plantilla', 'Encargo personalizado o plantilla', 'Arma tus propios pasos y guárdalos como plantilla.']] as const).map(([k, t, d]) => (
            <li key={k}><button type="button" onClick={() => setOpcion(k)}><span class="ic">＋</span><span>{t}<small>{d}</small></span></button></li>
          ))}
        </ul>
      )}
      {opcion === '360' && <Form360 alListo={(r, desde) => terminar(`Campaña creada con ${r.tareas} tareas. Revisa la propuesta de sprints.`, null, desde, r.id)} />}
      {opcion === 'webinar' && <FormWebinar alListo={(r) => terminar(`Webinar creado con ${r.tareas} tareas (${r.horas} h). Valida los inputs antes de proponer sprints.`, null, '', r.id)} />}
      {opcion === 'catalogo' && <FormCatalogo alListo={(r, desde) => terminar(`Trabajo creado con ${r.tareas.length} tareas.`, r.tareas, desde)} />}
      {opcion === 'plantilla' && <FormPlantilla alListo={(m) => { aviso(m); setOpcion('catalogo'); }} />}
    </Dialogo>
  );
};

const Form360 = ({ alListo }: { alListo: (r: Fila, desde: string) => void }) => {
  const { marcas, gente } = useBase();
  const hoy = hoySantiago();
  const [d, setD] = useState({ nombre: '', marcaId: '', inicio: hoy, objetivo: '', indicador: '', presupuesto: '', organic: 12, video: 4, email: 4, ads: 4,
    inputsListos: false, canales: [] as string[], alAireDesde: hoy, alAireHasta: '', mkt: '', com: '', rev: '' });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const k = (x: keyof typeof d) => (e: Event) => setD({ ...d, [x]: valor(e) });
  const total = 8 + 5 + 6 + 3 * (d.organic * 6 + d.video * 5 + d.email * 7 + d.ads * 4 + 3) + 1;
  const elegibles = conMarca(gente, d.marcaId);
  const enviar = async () => {
    setEnviando(true); setError('');
    try {
      const r = await pedir<Fila>('/campanas/360', { method: 'POST', json: {
        nombre: d.nombre, marcaId: d.marcaId, inicio: d.inicio, objetivo: d.objetivo, indicador: d.indicador, presupuesto: d.presupuesto ? Number(d.presupuesto) : null,
        alcance: { organic: +d.organic, video: +d.video, email: +d.email, ads: +d.ads }, inputsListos: d.inputsListos, canales: d.canales,
        alAireDesde: d.alAireDesde, alAireHasta: d.alAireHasta, responsableMarketingId: d.mkt, responsableComercialId: d.com, revisorId: d.rev,
      } });
      alListo(r, d.inicio);
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  };
  return (
    <Asistente error={error} enviando={enviando} textoEnviar="Crear campaña y protocolo" alEnviar={enviar} pasos={[
      { titulo: 'Campaña', contenido: (<>
        <label>Nombre<input required minLength={3} value={d.nombre} onInput={k('nombre')} /></label>
        <div class="dos"><label>Marca<select required value={d.marcaId} onChange={k('marcaId')}><option value="">Elige</option>{marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label>Inicio de la preparación<input type="date" required value={d.inicio} onInput={k('inicio')} /></label></div>
        <label>Objetivo<input required value={d.objetivo} onInput={k('objetivo')} /></label>
        <div class="dos"><label>Indicador y meta<input value={d.indicador} onInput={k('indicador')} /></label><label>Presupuesto<input type="number" min={0} value={d.presupuesto} onInput={k('presupuesto')} /></label></div>
      </>) },
      { titulo: 'Alcance y canales', contenido: (<>
        <div class="dos">
          <label>Publicaciones orgánicas por mes<input type="number" min={0} max={60} required value={d.organic} onInput={k('organic')} /></label>
          <label>Reels por mes<input type="number" min={0} max={30} required value={d.video} onInput={k('video')} /></label>
          <label>Mailings o newsletters por mes<input type="number" min={0} max={30} required value={d.email} onInput={k('email')} /></label>
          <label>Piezas de campaña por mes<input type="number" min={0} max={30} required value={d.ads} onInput={k('ads')} /></label>
        </div>
        <fieldset><legend>Canales</legend><div class="casillas">
          {CANALES_360.map((c) => <label class="casilla" key={c}><input type="checkbox" checked={d.canales.includes(c)} onChange={(e) => setD({ ...d, canales: (e.target as HTMLInputElement).checked ? [...d.canales, c] : d.canales.filter((x) => x !== c) })} />{c}</label>)}
        </div></fieldset>
        <label class="casilla" style={{ justifySelf: 'start' }}><input type="checkbox" checked={d.inputsListos} onChange={(e) => setD({ ...d, inputsListos: (e.target as HTMLInputElement).checked })} /> Inputs disponibles y validados</label>
        <p class="ayuda">Con este alcance se crearán <strong>{total} tareas</strong>.</p>
      </>) },
      { titulo: 'Fechas y equipo', contenido: (<>
        <div class="dos"><label>Al aire desde<input type="date" required value={d.alAireDesde} onInput={k('alAireDesde')} /></label><label>Al aire hasta<input type="date" required min={d.alAireDesde} value={d.alAireHasta} onInput={k('alAireHasta')} /></label></div>
        {!d.marcaId && <p class="ayuda">Elige la marca en el paso 1 para ver a las personas.</p>}
        <ElegirPersona etiqueta="Responsable de Marketing" valor={d.mkt} alCambiar={(v) => setD({ ...d, mkt: v })} gente={elegibles} />
        <ElegirPersona etiqueta="Responsable de inputs comerciales" valor={d.com} alCambiar={(v) => setD({ ...d, com: v })} gente={elegibles} />
        <ElegirPersona etiqueta="Revisor de entregables" valor={d.rev} alCambiar={(v) => setD({ ...d, rev: v })} gente={elegibles} />
      </>) },
      { titulo: 'Revisar y crear', contenido: (
        <div class="ficha">
          <div><dt>Campaña</dt><dd>{d.nombre || '—'}</dd></div><div><dt>Tareas</dt><dd>{total}</dd></div>
          <div><dt>Preparación desde</dt><dd>{fechaCorta(d.inicio)}</dd></div><div><dt>Al aire</dt><dd>{d.alAireHasta ? `${fechaCorta(d.alAireDesde)} → ${fechaCorta(d.alAireHasta)}` : '—'}</dd></div>
          <div class="ancho"><dt>Canales</dt><dd>{d.canales.join(', ') || '—'}</dd></div>
        </div>
      ) },
    ]} />
  );
};

const FormWebinar = ({ alListo }: { alListo: (r: Fila) => void }) => {
  const { marcas, gente } = useBase();
  const [d, setD] = useState({ nombre: '', marcaId: '', objetivo: '', presupuesto: '', fechaEvento: '', horaEvento: '18:00', minutos: '90', plataforma: 'Google Meet', relatores: '',
    Marketing: '', Comercial: '', 'Coordinación': '', 'Diseño': '', 'Operación': '', rev: '' });
  const [error, setError] = useState('');
  const k = (x: keyof typeof d) => (e: Event) => setD({ ...d, [x]: valor(e) });
  const elegibles = conMarca(gente, d.marcaId);
  const enviar = async () => {
    try {
      alListo(await pedir<Fila>('/campanas/webinar', { method: 'POST', json: {
        nombre: d.nombre, marcaId: d.marcaId, objetivo: d.objetivo, presupuesto: d.presupuesto ? Number(d.presupuesto) : null, fechaEvento: d.fechaEvento,
        horaEvento: d.horaEvento, minutos: Number(d.minutos), plataforma: d.plataforma, relatores: d.relatores, revisorId: d.rev || null,
        responsables: Object.fromEntries((['Marketing', 'Comercial', 'Coordinación', 'Diseño', 'Operación'] as const).map((r) => [r, d[r] || null])),
      } }));
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Asistente error={error} textoEnviar="Crear webinar" alEnviar={enviar} pasos={[
      { titulo: 'Evento', contenido: (<>
        <label>Título<input required minLength={3} value={d.nombre} onInput={k('nombre')} /></label>
        <label>Marca<select required value={d.marcaId} onChange={k('marcaId')}><option value="">Elige</option>{marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <div class="dos"><label>Objetivo<input value={d.objetivo} placeholder="Ej.: 100 inscritos y 40 asistentes" onInput={k('objetivo')} /></label><label>Presupuesto<input type="number" min={0} value={d.presupuesto} onInput={k('presupuesto')} /></label></div>
      </>) },
      { titulo: 'Fecha y formato', contenido: (<>
        <div class="dos"><label>Fecha del evento<input type="date" required min={hoySantiago()} value={d.fechaEvento} onInput={k('fechaEvento')} /></label><label>Hora (Chile)<input type="time" required value={d.horaEvento} onInput={k('horaEvento')} /></label></div>
        <div class="dos"><label>Duración (minutos)<input type="number" min={30} max={480} step={15} required value={d.minutos} onInput={k('minutos')} /></label><label>Plataforma<input required value={d.plataforma} onInput={k('plataforma')} /></label></div>
        <label>Relatores<input value={d.relatores} onInput={k('relatores')} /></label>
        <p class="ayuda">31 tareas, unas 84,5 h: preparación de 20 días hábiles y seguimiento de 5.</p>
      </>) },
      { titulo: 'Equipo y crear', contenido: (<>
        {(['Marketing', 'Comercial', 'Coordinación', 'Diseño', 'Operación'] as const).map((r) => (
          <ElegirPersona key={r} etiqueta={`Responsable de ${r}`} valor={d[r]} alCambiar={(v) => setD({ ...d, [r]: v })} gente={elegibles} requerido={false} />
        ))}
        <ElegirPersona etiqueta="Revisor o aprobador" valor={d.rev} alCambiar={(v) => setD({ ...d, rev: v })} gente={elegibles} requerido={false} />
      </>) },
    ]} />
  );
};

const FormCatalogo = ({ alListo }: { alListo: (r: { tareas: string[] }, desde: string) => void }) => {
  const { marcas, gente } = useBase();
  const [servicios, setServicios] = useState<Fila[]>([]);
  const hoy = hoySantiago();
  const [d, setD] = useState({ plantillaId: '', nombre: '', marcaId: '', inicio: hoy, plazo: hoy, urgencia: 'Media', cantidad: '1', responsableId: '', revisorId: '', inputsListos: false });
  const [error, setError] = useState('');
  useEffect(() => { pedir<{ servicios: Fila[] }>('/catalogo').then((r) => setServicios(r.servicios)); }, []);
  const k = (x: keyof typeof d) => (e: Event) => setD({ ...d, [x]: valor(e) });
  const elegido = useMemo(() => servicios.find((s) => s.id === d.plantillaId), [servicios, d.plantillaId]);
  const elegibles = conMarca(gente, d.marcaId);
  return (
    <form class="formulario" onSubmit={async (e) => {
      e.preventDefault();
      try { alListo(await pedir('/trabajos', { method: 'POST', json: { ...d, cantidad: Number(d.cantidad), revisorId: d.revisorId || null } }), d.inicio); } catch (err) { setError((err as Error).message); }
    }}>
      <label>Servicio<select required value={d.plantillaId} onChange={k('plantillaId')}><option value="">Elige un servicio</option>
        {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.propio ? ' · plantilla propia' : ''} · {s.horas} h</option>)}</select></label>
      <div class="dos"><label>Nombre<input required minLength={3} value={d.nombre} onInput={k('nombre')} /></label>
        <label>Marca<select required value={d.marcaId} onChange={k('marcaId')}><option value="">Elige</option>{marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div>
      <div class="dos"><label>Inicio<input type="date" required value={d.inicio} onInput={k('inicio')} /></label><label>Entrega comprometida<input type="date" required min={d.inicio} value={d.plazo} onInput={k('plazo')} /></label></div>
      <div class="dos"><label>Urgencia<select value={d.urgencia} onChange={k('urgencia')}>{['Urgente', 'Alta', 'Media', 'Baja'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Cantidad<input type="number" min={1} max={30} required value={d.cantidad} onInput={k('cantidad')} /></label></div>
      <div class="dos"><ElegirPersona etiqueta="Responsable principal" valor={d.responsableId} alCambiar={(v) => setD({ ...d, responsableId: v })} gente={elegibles} />
        <ElegirPersona etiqueta="Revisor y aprobador" valor={d.revisorId} alCambiar={(v) => setD({ ...d, revisorId: v })} gente={elegibles} requerido={false} /></div>
      <label class="casilla" style={{ justifySelf: 'start' }}><input type="checkbox" checked={d.inputsListos} onChange={(e) => setD({ ...d, inputsListos: (e.target as HTMLInputElement).checked })} /> Inputs disponibles y validados</label>
      {elegido && (
        <details open><summary>{elegido.pasos.length} pasos · {elegido.horas * Number(d.cantidad || 1)} h en total</summary>
          <ul class="lista-simple">{elegido.pasos.map((p: Fila, i: number) => <li key={i}>{i + 1}. {p.title} · {p.hours} h · {p.tool}</li>)}</ul></details>
      )}
      {error && <p class="error-form" role="alert">{error}</p>}
      <div class="acciones"><button type="submit" class="primario">Crear trabajo y proponer sprints</button></div>
    </form>
  );
};

const pasoVacio = (i: number) => ({ title: '', hours: 1, tool: '', instruction: '', deliverable: '', acceptance: '', dependency: i, role: 'execute' as 'execute' | 'review' });

const FormPlantilla = ({ alListo }: { alListo: (m: string) => void }) => {
  const [nombre, setNombre] = useState('');
  const [pasos, setPasos] = useState([pasoVacio(0)]);
  const [error, setError] = useState('');
  const cambiar = (i: number, c: Partial<ReturnType<typeof pasoVacio>>) => setPasos(pasos.map((p, j) => (j === i ? { ...p, ...c } : p)));
  const quitar = (i: number) => setPasos(pasos.filter((_, j) => j !== i).map((p) => ({ ...p, dependency: p.dependency === i + 1 ? 0 : p.dependency > i + 1 ? p.dependency - 1 : p.dependency })));
  return (
    <form class="formulario" onSubmit={async (e) => {
      e.preventDefault();
      try { await pedir('/plantillas', { method: 'POST', json: { nombre, pasos: pasos.map((p) => ({ ...p, hours: Number(p.hours) })) } }); alListo('Plantilla guardada. Ya aparece en el catálogo.'); }
      catch (err) { setError((err as Error).message); }
    }}>
      <label>Nombre de la plantilla<input required minLength={3} value={nombre} onInput={(e) => setNombre(valor(e))} /></label>
      {pasos.map((p, i) => (
        <fieldset key={i}>
          <legend>Paso {i + 1}</legend>
          <div class="dos"><label>Título<input required value={p.title} onInput={(e) => cambiar(i, { title: valor(e) })} /></label>
            <label>Horas<input type="number" required min={0.5} step={0.5} value={p.hours} onInput={(e) => cambiar(i, { hours: Number(valor(e)) })} /></label></div>
          <div class="dos"><label>Herramienta<input required value={p.tool} onInput={(e) => cambiar(i, { tool: valor(e) })} /></label>
            <label>Lo hace<select value={p.role} onChange={(e) => cambiar(i, { role: valor(e) as 'execute' | 'review' })}><option value="execute">Responsable principal</option><option value="review">Revisor o aprobador</option></select></label></div>
          <label>Instrucción<input required value={p.instruction} onInput={(e) => cambiar(i, { instruction: valor(e) })} /></label>
          <div class="dos"><label>Entregable<input required value={p.deliverable} onInput={(e) => cambiar(i, { deliverable: valor(e) })} /></label>
            <label>Criterio de aceptación<input required value={p.acceptance} onInput={(e) => cambiar(i, { acceptance: valor(e) })} /></label></div>
          <div class="dos"><label>Depende de<select value={p.dependency} onChange={(e) => cambiar(i, { dependency: Number(valor(e)) })}><option value={0}>Ninguno</option>{pasos.slice(0, i).map((_, j) => <option key={j} value={j + 1}>Paso {j + 1}</option>)}</select></label>
            {pasos.length > 1 && <button type="button" style={{ alignSelf: 'end' }} onClick={() => quitar(i)}>Quitar paso</button>}</div>
        </fieldset>
      ))}
      <button type="button" class="mas-opciones" onClick={() => setPasos([...pasos, pasoVacio(pasos.length)])}>＋ Agregar paso</button>
      <p class="ayuda">Total: {pasos.reduce((n, p) => n + Number(p.hours || 0), 0)} h. Editar una plantilla crea una versión nueva sin cambiar trabajos ya creados.</p>
      {error && <p class="error-form" role="alert">{error}</p>}
      <div class="acciones"><button type="submit" class="primario">Guardar plantilla</button></div>
    </form>
  );
};

/** Propuesta de sprints semanales: cada tarea cabe entera en una semana sin pasar el 80 %. */
export const PropuestaSemanal = ({ tareas, desde, alCerrar, aviso }: { tareas: string[]; desde: string; alCerrar: () => void; aviso: (m: string) => void }) => {
  const [r, setR] = useState<{ propuestas: Fila[]; problemas: Fila[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { pedir<typeof r>('/planificacion/propuesta', { method: 'POST', json: { tareaIds: tareas, desde } }).then(setR).catch((e: Error) => setError(e.message)); }, []);
  const aplicar = async () => {
    try {
      const x = await pedir<Fila>('/planificacion/aplicar', { method: 'POST', json: { tareaIds: tareas, desde } });
      aviso(`Propuesta aplicada: ${x.aplicadas} tarea(s) en ${x.sprints} sprint(s) semanal(es). La agenda quedó reservada.`);
      alCerrar();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Dialogo titulo="Propuesta de sprints semanales" abierto alCerrar={alCerrar}>
      {error ? <p class="error-form" role="alert">{error}</p> : !r ? <p>Calculando…</p> : (
        <div class="formulario">
          <p class="ayuda">Cada tarea debe caber entera en una semana, sin pasar el 80 % de la capacidad neta (lunes a viernes, 09–14 y 15–18, sin reuniones ni feriados).</p>
          {r.propuestas.length > 0 && (
            <ul class="lista-invitaciones">
              {r.propuestas.map((p) => (
                <li key={p.id}><span><strong>{p.titulo}</strong><br /><span class="apagado">{p.horas} h · semana del {fechaCorta(p.semana)} · termina {fechaCorta(p.fin.slice(0, 10))} {p.fin.slice(11)}</span></span>
                  {p.tarde ? <span class="insignia roja">Fuera de plazo</span> : <span class="insignia verde">A tiempo</span>}</li>
              ))}
            </ul>
          )}
          {r.problemas.length > 0 && (
            <details open={!r.propuestas.length}><summary>{r.problemas.length} tarea(s) sin comprometer</summary>
              <ul class="lista-simple">{r.problemas.slice(0, 50).map((p) => <li key={p.id}><strong>{p.titulo}</strong>: {p.motivo}</li>)}</ul></details>
          )}
          <div class="acciones">
            <button type="button" onClick={alCerrar}>Ahora no</button>
            {r.propuestas.length > 0 && <button type="button" class="primario" onClick={aplicar}>Aplicar propuesta y reservar agenda</button>}
          </div>
        </div>
      )}
    </Dialogo>
  );
};
