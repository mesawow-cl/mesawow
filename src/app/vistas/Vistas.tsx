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

export const Inicio = ({ persona }: { persona: Persona }) => {
  const nombre = persona.name.split(' ')[0];
  const [d, setD] = useState<DatosInicio | null>(null);
  const [filtro, setFiltro] = useState('todo');
  const latido = useLatido();
  const enVivo = useEstadoEnVivo();
  const [vistos, setVistos] = useState<Set<string> | null>(null);
  useEffect(() => {
    pedir<DatosInicio>('/inicio').then((x) => {
      // Lo que llega después de la primera carga se resalta como nuevo.
      setVistos((v) => v ?? new Set(x.actividad.map((e) => `${e.at}|${e.persona}|${e.objeto}`)));
      setD(x);
    }).catch(() => setD(null));
  }, [persona.id, latido]);
  const hoy = hoySantiago();
  const total = d?.tuDia.tareas.length ?? 0;
  const pct = total ? Math.round(((d?.tuDia.hechas ?? 0) / total) * 100) : 0;
  const actividad = (d?.actividad ?? []).filter((e) => filtro === 'todo' || e.tipo === filtro);
  return (
    <section aria-labelledby="titulo-vista">
      <div class="hero">
        <div class="hero-arriba">
          <span>{fechaDeHoy()}</span>
          <span class={`en-vivo${enVivo === 'conectado' ? '' : ' desconectado'}`}><i aria-hidden="true" />{enVivo === 'conectado' ? 'En vivo' : 'Reconectando…'}</span>
        </div>
        <h1 id="titulo-vista">¡Hola, <span>{nombre}</span>! 👋</h1>
        <p>Hoy hacemos que las cosas pasen. {d?.tuDia.tareas.length ? `Tienes ${d.tuDia.tareas.length} encargo(s) que vencen hoy.` : 'Aquí verás tu trabajo, el del equipo y lo que celebramos.'}</p>
      </div>
      <div class="metricas" role="list" aria-label="Tus números">
        <a role="listitem" href={hrefDe('tasks')} class="sin-subrayado"><Metrica icono="check" color="#9B5CFF" fondo="#F1EAFF" valor={d ? String(d.stats.misTareas) : '—'} etiqueta="Mis tareas" /></a>
        <a role="listitem" href={hrefDe('tasks')} class="sin-subrayado"><Metrica icono="sparkle" color="#F22E62" fondo="#FFEAF0" valor={d ? String(d.stats.enProgreso) : '—'} etiqueta="En progreso" /></a>
        <a role="listitem" href={hrefDe('tasks')} class="sin-subrayado"><Metrica icono="trophy" color="#00808A" fondo="#E3F6F7" valor={d ? String(d.stats.completadas) : '—'} etiqueta="Completadas" /></a>
        <a role="listitem" href={hrefDe('plaza')} class="sin-subrayado"><Metrica icono="smile" color="#C25A00" fondo="#FFF3E6" valor="—" etiqueta="Logros hoy" /></a>
      </div>
      <div class="inicio-grilla">
        <div>
          <section class="tarjeta" aria-labelledby="t-wow">
            <div class="seccion-cabeza"><h2 id="t-wow">Momento WOW</h2></div>
            <Pronto texto="Los hitos del equipo (sprint completo, lanzamiento verificado) se celebran aquí desde la Fase 7." />
          </section>
          <section class="tarjeta" aria-labelledby="t-actividad">
            <div class="seccion-cabeza"><h2 id="t-actividad">Actividad del equipo</h2><span class="insignia">{enVivo === 'conectado' ? 'En vivo' : 'Reconectando…'}</span></div>
            <div class="chips" role="group" aria-label="Filtrar actividad" style={{ marginBottom: '10px' }}>
              {[['todo', 'Todo'], ['entrega', 'Entregas'], ['revision', 'Revisiones'], ['logro', 'Aprobaciones'], ['sprint', 'Sprints']].map(([k, t]) => (
                <button type="button" key={k} class="chip-filtro" aria-pressed={filtro === k} onClick={() => setFiltro(k!)}>{t}</button>
              ))}
            </div>
            {!actividad.length ? <p class="apagado">Todavía no hay actividad para mostrar.</p> : (
              <ul class="lista-simple actividad" aria-live="polite">
                {actividad.slice(0, 12).map((e, i) => (
                  <li key={i} class={vistos && !vistos.has(`${e.at}|${e.persona}|${e.objeto}`) ? 'nuevo' : ''}><strong>{e.persona}</strong> {e.verbo} {e.tareaId ? <a href={`/encargos?tarea=${e.tareaId}`}>{e.objeto}</a> : e.objeto}
                    <span class="apagado"> · {hace(e.at)}</span></li>
                ))}
              </ul>
            )}
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
            <div class="acciones" style={{ justifyContent: 'flex-start' }}><a class="casilla" href={hrefDe('agenda')}>Ir a Mi mesa</a></div>
          </section>
          <section class="tarjeta" aria-labelledby="t-paneles">
            <div class="seccion-cabeza"><h2 id="t-paneles">Tus paneles</h2><a href={hrefDe('more')}>Todos →</a></div>
            <ul class="paneles">
              <li><a href={hrefDe('tasks')}>Mis encargos <span class="insignia">{d?.paneles.encargos ?? '—'}</span></a></li>
              <li><a href={hrefDe('agenda')}>Mi mesa <span class="insignia">{d?.paneles.hoyRestantes ?? '—'}</span></a></li>
              <li><a href={hrefDe('mesas')}>Mesas <span class="insignia">{d?.paneles.mesas ?? '—'}</span></a></li>
              <li><a href={hrefDe('scrum')}>Sprints <span class="insignia">{d?.paneles.sprint ?? 'Planificar el próximo'}</span></a></li>
              <li><a href={hrefDe('campaigns')}>Proyectos <span class="insignia">{d?.paneles.campanas ?? '—'}</span></a></li>
              <li><a href={hrefDe('plaza')}>Comunidad</a></li>
            </ul>
          </section>
        </div>
      </div>
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
