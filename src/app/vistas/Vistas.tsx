import { ESPACIOS, pestanasVisibles, type Vista } from '../../shared/navegacion';
import { ZONA_HORARIA } from '../../shared/constantes';
import type { Persona } from '../api';
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

export const Inicio = ({ persona }: { persona: Persona }) => {
  const nombre = persona.name.split(' ')[0];
  return (
    <section aria-labelledby="titulo-vista">
      <div class="hero">
        <div class="hero-arriba">
          <span>{fechaDeHoy()}</span>
          <span class="en-vivo"><i aria-hidden="true" />En vivo</span>
        </div>
        <h1 id="titulo-vista">¡Hola, <span>{nombre}</span>! 👋</h1>
        <p>Hoy hacemos que las cosas pasen. Aquí verás tu trabajo, el del equipo y lo que celebramos.</p>
      </div>
      <div class="metricas" role="list" aria-label="Tus números">
        <div role="listitem"><Metrica icono="check" color="#9B5CFF" fondo="#F1EAFF" valor="—" etiqueta="Mis tareas" /></div>
        <div role="listitem"><Metrica icono="sparkle" color="#F22E62" fondo="#FFEAF0" valor="—" etiqueta="En progreso" /></div>
        <div role="listitem"><Metrica icono="trophy" color="#00808A" fondo="#E3F6F7" valor="—" etiqueta="Completadas" /></div>
        <div role="listitem"><Metrica icono="smile" color="#C25A00" fondo="#FFF3E6" valor="—" etiqueta="Logros hoy" /></div>
      </div>
      <div class="inicio-grilla">
        <div>
          <section class="tarjeta" aria-labelledby="t-wow">
            <div class="seccion-cabeza"><h2 id="t-wow">Momento WOW</h2></div>
            <Pronto texto="Los hitos del equipo (sprint completo, lanzamiento verificado) llegan en la Fase 7." />
          </section>
          <section class="tarjeta" aria-labelledby="t-logros">
            <div class="seccion-cabeza"><h2 id="t-logros">Logros del día</h2><a href={hrefDe('plaza')}>Ver todos →</a></div>
            <Pronto texto="Los logros automáticos aparecen aquí desde la Fase 7." />
          </section>
          <section class="tarjeta" aria-labelledby="t-actividad">
            <div class="seccion-cabeza"><h2 id="t-actividad">Actividad del equipo</h2><span class="insignia">En vivo · Fase 5</span></div>
            <Pronto texto="Entregas, revisiones, sprints y reconocimientos, en vivo." />
          </section>
        </div>
        <div>
          <section class="tarjeta" aria-labelledby="t-dia">
            <div class="seccion-cabeza"><h2 id="t-dia">Tu día</h2></div>
            <Pronto texto="Tus encargos de hoy y tu compromiso del día llegan en la Fase 3." />
          </section>
          <section class="tarjeta" aria-labelledby="t-paneles">
            <div class="seccion-cabeza"><h2 id="t-paneles">Tus paneles</h2><a href={hrefDe('more')}>Todos →</a></div>
            <div class="mas-grilla" style={{ gridTemplateColumns: '1fr' }}>
              <ul>
                <li><a href={hrefDe('tasks')}>Mis encargos</a></li>
                <li><a href={hrefDe('agenda')}>Mi mesa</a></li>
                <li><a href={hrefDe('mesas')}>Mesas</a></li>
                <li><a href={hrefDe('scrum')}>Sprints</a></li>
                <li><a href={hrefDe('campaigns')}>Proyectos</a></li>
                <li><a href={hrefDe('plaza')}>Comunidad</a></li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
};

export const Mas = ({ persona, alAbrirCuenta }: { persona: Persona; alAbrirCuenta: () => void }) => (
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
  </section>
);
