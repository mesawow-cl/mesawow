import { useInstalar } from '../pwa';
import { BotonInstalar } from './Avisos';
import { useEffect, useState } from 'preact/hooks';
import { useEstadoEnVivo, useLatido } from '../vivo';
import { ESPACIOS, pestanasVisibles, type Vista } from '../../shared/navegacion';
import { hoySantiago } from '../../shared/fechas';
import { ZONA_HORARIA } from '../../shared/constantes';
import { pedir, type Persona } from '../api';
import { fechaCorta } from '../datos';
import { Icono, type NombreIcono } from '../componentes/Icono';
import { sonrisa } from '../marca';
import { hrefDe } from '../rutas';
import { FASE_DE } from './fases';
import { BotonFelicitar, Compromisos, ListaLogros, type Logro } from './Comunidad';

const ETIQUETA: Partial<Record<Vista, string>> = Object.fromEntries(
  ESPACIOS.flatMap((e) => e.pestanas.map((t) => [t.vista, t.etiqueta])),
);

export const EnConstruccion = ({ vista }: { vista: keyof typeof FASE_DE }) => {
  const { fase, detalle } = FASE_DE[vista];
  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado"><div><p class="ceja">mesawow</p><h1 id="titulo-vista">{ETIQUETA[vista]}</h1></div></div>
      <div class="pronto">
        <img src={sonrisa} alt="" width={72} height={50} />
        <strong>Se construye en la Fase {fase}.</strong>
        <p>{detalle}</p>
      </div>
    </section>
  );
};

const fechaDeHoy = () => {
  const f = new Intl.DateTimeFormat('es-CL', { timeZone: ZONA_HORARIA, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return f.charAt(0).toUpperCase() + f.slice(1);
};

const Metrica = ({ icono, color, fondo, valor, etiqueta }: { icono: NombreIcono; color: string; fondo: string; valor: string; etiqueta: string }) => (
  <div class="tarjeta metrica">
    <span class="ic" style={{ color, background: fondo }}><Icono nombre={icono} /></span>
    <div><strong>{valor}</strong><span>{etiqueta}</span></div>
  </div>
);

const Pronto = ({ texto }: { texto: string }) => (
  <div class="pronto"><img src={sonrisa} alt="" width={72} height={50} /><p>{texto}</p></div>
);

const hace = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
};

interface DatosInicio {
  stats: { misTareas: number; enProgreso: number; completadas: number; logrosHoy: number };
  tuDia: { tareas: { id: string; title: string; status: string }[]; hechas: number; pendientes: { id: string; title: string; due: string; status: string }[] };
  paneles: { encargos: number; hoyRestantes: number; mesas: number; sprint: string | null; campanas: number; menciones: number };
  actividad: { at: string; persona: string; verbo: string; objeto: string; tipo: string; tareaId: string | null }[];
}

interface DatosComunidad {
  logrosHoy: number; wow: (Logro & { visto: boolean }) | null; delDia: Logro[]; recientes: Logro[]; menciones: number;
  actividad: { at: string; persona: string; verbo: string; objeto: string; tipo: string; logroId: string }[];
}

const reducirMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Momento WOW: solo hitos, confeti una vez por persona y hito (nivel 3 de celebración). */
const MomentoWow = ({ wow, aviso, alCambiar }: { wow: Logro & { visto: boolean }; aviso: (m: string) => void; alCambiar: (l: Logro) => void }) => {
  const [confeti, setConfeti] = useState(false);
  useEffect(() => {
    if (wow.visto) return;
    pedir(`/logros/${wow.id}/visto`, { method: 'POST', json: {} }).catch(() => undefined);
    if (reducirMovimiento()) return;
    setConfeti(true);
    const t = setTimeout(() => setConfeti(false), 3500);
    return () => clearTimeout(t);
  }, [wow.id]);
  const sprint = /Sprint|Objetivo/.test(wow.tipo);
  return (
    <article class="tarjeta wow" aria-label="Momento WOW">
      <span class="wow-pestana">✦ Momento WOW</span>
      <p class="ceja">{wow.tipo}</p>
      <h2>{sprint ? '¡Sprint completado!' : '¡Lanzamiento verificado!'}</h2>
      <p>{wow.titulo}</p>
      <p class="ayuda">{[wow.mesa, wow.marca].filter(Boolean).join(' · ')}{wow.mesa || wow.marca ? ' · ' : ''}{hace(wow.creado)}</p>
      <div class="wow-pie">
        <span class="pila-avatares" aria-label={wow.personas.map((p) => p.name).join(', ')}>{wow.personas.slice(0, 5).map((p) => <span key={p.id} class="avatar" aria-hidden="true">{p.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>)}</span>
        <BotonFelicitar logro={wow} aviso={aviso} alCambiar={alCambiar} />
      </div>
      {confeti && <div class="confeti" aria-hidden="true">{Array.from({ length: 36 }, (_, i) => <i key={i} style={{ '--i': i } as never} />)}</div>}
    </article>
  );
};

export const Inicio = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const nombre = persona.name.split(' ')[0];
  const [d, setD] = useState<DatosInicio | null>(null);
  const [filtro, setFiltro] = useState('todo');
  const latido = useLatido();
  const enVivo = useEstadoEnVivo();
  const [vistos, setVistos] = useState<Set<string> | null>(null);
  const [social, setSocial] = useState<DatosComunidad | null>(null);
  const [mostrar, setMostrar] = useState(8);
  const [compromisos, setCompromisos] = useState(false);
  useEffect(() => {
    Promise.all([pedir<DatosInicio>('/inicio'), pedir<DatosComunidad>('/comunidad/inicio').catch(() => null)]).then(([x, c]) => {
      const todas = [...x.actividad, ...(c?.actividad ?? [])];
      // Lo que llega después de la primera carga se resalta como nuevo.
      setVistos((v) => v ?? new Set(todas.map((e) => `${e.at}|${e.persona}|${e.objeto}`)));
      setD(x);
      setSocial(c);
    }).catch(() => setD(null));
  }, [persona.id, latido]);
  const cambiarLogro = (l: Logro) => social && setSocial({
    ...social, wow: social.wow?.id === l.id ? { ...social.wow, ...l } : social.wow,
    delDia: social.delDia.map((x) => x.id === l.id ? l : x), recientes: social.recientes.map((x) => x.id === l.id ? l : x),
  });
  const hoy = hoySantiago();
  const total = d?.tuDia.tareas.length ?? 0;
  const pct = total ? Math.round(((d?.tuDia.hechas ?? 0) / total) * 100) : 0;
  const actividad = [...(d?.actividad ?? []).map((e) => ({ ...e, logroId: null as string | null })), ...(social?.actividad ?? []).map((e) => ({ ...e, tareaId: null as string | null }))]
    .sort((a, b) => b.at.localeCompare(a.at)).filter((e) => filtro === 'todo' || e.tipo === filtro);
  return (
    <section aria-labelledby="titulo-vista">
      <div class="hero">
        <div class="hero-arriba">
          <span>{fechaDeHoy()}</span>
          <span class={`en-vivo${enVivo === 'conectado' ? '' : ' desconectado'}`}><i aria-hidden="true" />{enVivo === 'conectado' ? 'En vivo' : 'Reconectando…'}</span>
        </div>
        <h1 id="titulo-vista">¡Hola, <span>{nombre}</span>! 👋</h1>
        <p>Hoy hacemos que las cosas pasen. {social?.logrosHoy ? `Hoy el equipo suma ${social.logrosHoy} logro(s). ` : ''}{d?.tuDia.tareas.length ? `Tienes ${d.tuDia.tareas.length} encargo(s) que vencen hoy.` : 'Aquí verás tu trabajo, el del equipo y lo que celebramos.'}</p>
      </div>
      <div class="metricas" role="list" aria-label="Tus números">
        <a role="listitem" href={hrefDe('tasks')} class="sin-subrayado"><Metrica icono="check" color="#9B5CFF" fondo="#F1EAFF" valor={d ? String(d.stats.misTareas) : '—'} etiqueta="Mis tareas" /></a>
        <a role="listitem" href={hrefDe('tasks')} class="sin-subrayado"><Metrica icono="sparkle" color="#F22E62" fondo="#FFEAF0" valor={d ? String(d.stats.enProgreso) : '—'} etiqueta="En progreso" /></a>
        <a role="listitem" href={hrefDe('tasks')} class="sin-subrayado"><Metrica icono="trophy" color="#00808A" fondo="#E3F6F7" valor={d ? String(d.stats.completadas) : '—'} etiqueta="Completadas" /></a>
        <a role="listitem" href={hrefDe('plaza')} class="sin-subrayado"><Metrica icono="smile" color="#C25A00" fondo="#FFF3E6" valor={social ? String(social.logrosHoy) : '—'} etiqueta="Logros hoy" /></a>
      </div>
      <div class="inicio-grilla">
        <div>
          {social?.wow && <MomentoWow wow={social.wow} aviso={aviso} alCambiar={cambiarLogro} />}
          <section class="tarjeta" aria-labelledby="t-logros">
            <div class="seccion-cabeza"><h2 id="t-logros">Logros del día</h2><a href={hrefDe('plaza')}>Comunidad →</a></div>
            {social?.delDia.length ? <ListaLogros logros={social.delDia} aviso={aviso} alCambiar={cambiarLogro} /> : (
              <>
                <Pronto texto="Hoy todavía no hay logros publicados. Se publican solos al aprobar trabajo con evidencia." />
                {!!social?.recientes.length && <><h3>Últimos logros</h3><ListaLogros logros={social.recientes} aviso={aviso} alCambiar={cambiarLogro} /></>}
                <div class="acciones" style={{ justifyContent: 'flex-start' }}><a class="casilla" href={hrefDe('tasks')}>Ver mis encargos</a></div>
              </>
            )}
          </section>
          <section class="tarjeta" aria-labelledby="t-actividad">
            <div class="seccion-cabeza"><h2 id="t-actividad">Actividad del equipo</h2><span class="insignia">{enVivo === 'conectado' ? 'En vivo' : 'Reconectando…'}</span></div>
            <div class="chips" role="group" aria-label="Filtrar actividad" style={{ marginBottom: '10px' }}>
              {[['todo', 'Todo'], ['logro', 'Logros'], ['entrega', 'Entregas'], ['revision', 'Revisiones'], ['sprint', 'Sprints'], ['reconocimiento', 'Reconocimientos']].map(([k, t]) => (
                <button type="button" key={k} class="chip-filtro" aria-pressed={filtro === k} onClick={() => setFiltro(k!)}>{t}</button>
              ))}
            </div>
            {!actividad.length ? <p class="apagado">Todavía no hay actividad para mostrar.</p> : (
              <ul class="lista-simple actividad" aria-live="polite">
                {actividad.slice(0, mostrar).map((e, i) => (
                  <li key={i} class={vistos && !vistos.has(`${e.at}|${e.persona}|${e.objeto}`) ? 'nuevo' : ''}><strong>{e.persona}</strong> {e.verbo} {e.tareaId ? <a href={`/encargos?tarea=${e.tareaId}`}>{e.objeto}</a> : e.objeto}
                    <span class="apagado"> · {hace(e.at)}</span></li>
                ))}
              </ul>
            )}
            {actividad.length > mostrar && <div class="acciones" style={{ justifyContent: 'flex-start' }}><button type="button" onClick={() => setMostrar(mostrar + 10)}>Ver más actividad</button></div>}
          </section>
        </div>
        <div>
          <section class="tarjeta" aria-labelledby="t-dia">
            <div class="seccion-cabeza"><h2 id="t-dia">Tu día</h2></div>
            <div class="tu-dia">
              <div class="anillo" style={{ '--p': pct } as never} role="img" aria-label={`${d?.tuDia.hechas ?? 0} de ${total} encargos de hoy listos`}><span>{d?.tuDia.hechas ?? 0}/{total}</span></div>
              <p>{!d ? 'Cargando…' : total && d.tuDia.hechas === total ? '¡Todo listo por hoy! 🎉' : total ? `Te quedan ${total - d.tuDia.hechas} encargo(s) para hoy.` : d.tuDia.pendientes.length ? 'Nada vence hoy. Buen momento para adelantar.' : 'Sin encargos pendientes.'}</p>
            </div>
            <ul class="lista-simple" style={{ marginTop: '10px' }}>
              {d?.tuDia.pendientes.map((t) => (
                <li key={t.id}><a href={`/encargos?tarea=${t.id}`}>{t.title}</a> <span class={`insignia ${t.due < hoy ? 'roja' : t.due === hoy ? 'ambar' : 'gris'}`}>{t.due < hoy ? 'Atrasada' : t.due === hoy ? 'Hoy' : fechaCorta(t.due)}</span></li>
              ))}
            </ul>
            <div class="acciones" style={{ justifyContent: 'flex-start' }}>
              <a class="casilla" href={hrefDe('agenda')}>Ir a Mi mesa</a>
              {persona.permisos.esEquipo && !persona.permisos.soloLectura && <button type="button" onClick={() => setCompromisos(true)}>Mis compromisos</button>}
            </div>
          </section>
          <section class="tarjeta" aria-labelledby="t-paneles">
            <div class="seccion-cabeza"><h2 id="t-paneles">Tus paneles</h2><a href={hrefDe('more')}>Todos →</a></div>
            <ul class="paneles">
              <li><a href={hrefDe('tasks')}>Mis encargos <span class="insignia">{d?.paneles.encargos ?? '—'}</span></a></li>
              <li><a href={hrefDe('agenda')}>Mi mesa <span class="insignia">{d?.paneles.hoyRestantes ?? '—'}</span></a></li>
              <li><a href={hrefDe('mesas')}>Mesas <span class="insignia">{d?.paneles.mesas ?? '—'}</span></a></li>
              <li><a href={hrefDe('scrum')}>Sprints <span class="insignia">{d?.paneles.sprint ?? 'Planificar el próximo'}</span></a></li>
              <li><a href={hrefDe('campaigns')}>Proyectos <span class="insignia">{d?.paneles.campanas ?? '—'}</span></a></li>
              <li><a href={hrefDe('plaza')}>Comunidad <span class="insignia">{social?.menciones ? `${social.menciones} menciones` : '—'}</span></a></li>
            </ul>
          </section>
        </div>
      </div>
      <Compromisos abierto={compromisos} alCerrar={() => setCompromisos(false)} aviso={aviso} />
    </section>
  );
};

export const Mas = ({ persona, alAbrirCuenta }: { persona: Persona; alAbrirCuenta: () => void }) => {
  const { estado, pedirInstalar } = useInstalar();
  return (
  <section aria-labelledby="titulo-vista">
    <div class="encabezado">
      <div><p class="ceja">mesawow</p><h1 id="titulo-vista">Todo mesawow</h1></div>
      <button type="button" onClick={alAbrirCuenta}>Tu cuenta y cerrar sesión</button>
    </div>
    <div class="mas-grilla">
      {ESPACIOS.map((e) => (
        <section class="tarjeta" key={e.id} aria-labelledby={`mas-${e.id}`}>
          <h2 id={`mas-${e.id}`} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}><Icono nombre={e.icono} />{e.etiqueta}</h2>
          <ul>
            {pestanasVisibles(e, persona.permisos).map((t) => (
              <li key={t.vista}><a href={hrefDe(t.vista, e.id)}>{t.etiqueta}</a></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
    {estado && estado !== 'instalada' && <div style={{ marginTop: '16px' }}><BotonInstalar estado={estado} alInstalar={pedirInstalar} /></div>}
  </section>
  );
};
