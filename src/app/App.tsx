import { useCallback, useEffect, useState } from 'preact/hooks';
import { vistaPermitida, type OpcionCrear } from '../shared/navegacion';
import { cerrarSesion, ErrorApi, fijarVerComo, pedir, type Persona } from './api';
import { BarraInferior, BarraSuperior, MenuLateral, Pestanas } from './componentes/Estructura';
import { Campana, MenuCrear, MenuCuenta, type Alerta, type PersonaVisible } from './componentes/Menus';
import { detenerEnVivo, iniciarEnVivo, useLatido } from './vivo';
import { logoColor } from './marca';
import { alHacerClicEnEnlace, ir, useUbicacion } from './rutas';
import { EntrarComo } from './vistas/EntrarComo';
import { MesaAlAire } from './vistas/Aire';
import { Calendarios } from './vistas/Calendarios';
import { Equipo } from './vistas/Equipo';
import { Estrategia } from './vistas/Estrategia';
import { MiMesa } from './vistas/MiMesa';
import { Gantt, MesaDeTrabajo, Resumen } from './vistas/Panorama';
import { CentroPlanificacion } from './vistas/Planificacion';
import { Marcas, Mesas } from './vistas/Organizacion';
import { Tareas } from './vistas/Tareas';
import { Perfil } from './vistas/Perfil';
import { Bases, Entregables, Proyectos } from './vistas/Proyectos';
import { Registro } from './vistas/Registro';
import { Sprints } from './vistas/Sprints';
import { EnConstruccion, Inicio, Mas } from './vistas/Vistas';

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'elegir' }
  | { tipo: 'registro' }
  | { tipo: 'sin_acceso'; mensaje: string }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; persona: Persona; actor: Persona };

const DESTINO_CREAR: Record<OpcionCrear['id'], { vista: Parameters<typeof ir>[0]; aviso: string }> = {
  tarea: { vista: 'tasks', aviso: 'El formulario de tarea por pasos llega en la Fase 3.' },
  aire: { vista: 'aire', aviso: '' },
  catalogo: { vista: 'campaigns', aviso: 'Campañas 360, webinars y catálogo llegan en la Fase 3.' },
  compromiso: { vista: 'muro', aviso: 'Los compromisos del día llegan en la Fase 7.' },
};

const Mensaje = ({ titulo, texto, salir }: { titulo: string; texto: string; salir?: boolean }) => (
  <main class="entrar">
    <div class="tarjeta" role="alert">
      <img src={logoColor} alt="mesawow" width={150} height={40} />
      <h1 style={{ marginTop: '16px', fontSize: '22px' }}>{titulo}</h1>
      <p style={{ marginTop: '8px' }}>{texto}</p>
      {salir && <div class="acciones"><button type="button" onClick={cerrarSesion}>Salir</button></div>}
    </div>
  </main>
);

export const App = () => {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [abierto, setAbierto] = useState<'crear' | 'cuenta' | 'campana' | null>(null);
  const [personas, setPersonas] = useState<PersonaVisible[]>([]);
  const [viendoComo, setViendoComo] = useState('');
  const [aviso, setAviso] = useState('');
  const [crearTarea, setCrearTarea] = useState(false);
  const [planificar, setPlanificar] = useState(false);
  const [alertas, setAlertas] = useState<{ alertas: Alerta[]; sinLeer: number }>({ alertas: [], sinLeer: 0 });
  const latido = useLatido();
  const { vista, desde } = useUbicacion();

  const cargar = useCallback((silencioso = false) => {
    if (!silencioso) setEstado({ tipo: 'cargando' });
    pedir<{ persona: Persona; actor?: Persona }>('/me')
      .then(({ persona, actor }) => setEstado({ tipo: 'listo', persona, actor: actor ?? persona }))
      .catch((e: Error) => {
        const code = e instanceof ErrorApi ? e.code : '';
        if (code === 'sin_sesion' && e instanceof ErrorApi && e.message.startsWith('Elige')) setEstado({ tipo: 'elegir' });
        else if (code === 'invitacion_pendiente') setEstado({ tipo: 'registro' });
        else if (code === 'sin_acceso' || code === 'sin_sesion' || code === 'sesion_invalida') setEstado({ tipo: 'sin_acceso', mensaje: e.message });
        else setEstado({ tipo: 'error', mensaje: e.message });
      });
  }, []);

  useEffect(() => cargar(), [cargar]);
  useEffect(() => {
    addEventListener('click', alHacerClicEnEnlace);
    return () => removeEventListener('click', alHacerClicEnEnlace);
  }, []);
  const esAdminReal = estado.tipo === 'listo' && estado.actor.permisos.esAdmin;
  useEffect(() => {
    if (esAdminReal) pedir<{ personas: PersonaVisible[] }>('/personas').then((r) => setPersonas(r.personas)).catch(() => setPersonas([]));
  }, [esAdminReal]);
  // En vivo y campana: se conectan al entrar y la campana se actualiza con cada señal.
  const listo = estado.tipo === 'listo';
  useEffect(() => { if (listo) iniciarEnVivo(); }, [listo]);
  const cargarAlertas = () => pedir<{ alertas: Alerta[]; sinLeer: number }>('/alertas').then(setAlertas).catch(() => undefined);
  useEffect(() => { if (listo) cargarAlertas(); }, [listo, latido, viendoComo]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 4500);
    return () => clearTimeout(t);
  }, [aviso]);

  if (estado.tipo === 'cargando') return <main class="entrar"><p>Cargando mesawow…</p></main>;
  if (estado.tipo === 'elegir') return <EntrarComo alEntrar={() => cargar()} />;
  if (estado.tipo === 'registro') return <Registro alEntrar={() => cargar()} />;
  if (estado.tipo === 'sin_acceso') return <Mensaje titulo="Aún no tienes acceso a mesawow" texto={estado.mensaje} salir />;
  if (estado.tipo === 'error') return <Mensaje titulo="No pudimos abrir mesawow" texto={estado.mensaje} />;

  const { persona, actor } = estado;
  const { permisos } = persona;
  const viendoOtra = actor.id !== persona.id;
  // Roles externos no usan el Inicio del equipo (prototipo: van a Mi mesa). Ver §14-P2.
  const vistaFinal = !permisos.esEquipo && vista === 'muro' ? 'agenda' : vista;
  const permitida = vistaPermitida(vistaFinal, permisos);
  const idPerfil = new URLSearchParams(location.search).get('id') ?? persona.id;

  const verComo = (id: string) => {
    setViendoComo(id);
    fijarVerComo(id);
    setAbierto(null);
    cargar(true);
    ir(id ? 'tasks' : 'muro');
  };

  const contenido = () => {
    if (!permitida) return <div class="pronto" role="alert"><strong>No tienes acceso a esta sección.</strong><p>Si crees que deberías verla, pídelo a coordinación.</p></div>;
    switch (vistaFinal) {
      case 'muro': return <Inicio persona={persona} />;
      case 'more': return <Mas persona={persona} alAbrirCuenta={() => setAbierto('cuenta')} />;
      case 'team': return <Equipo actorId={actor.id} aviso={setAviso} />;
      case 'tasks': return <Tareas persona={persona} aviso={setAviso} crear={crearTarea && !viendoOtra} alCrear={setCrearTarea} />;
      case 'mesas': return <Mesas persona={persona} aviso={setAviso} />;
      case 'agenda': return <MiMesa persona={persona} aviso={setAviso} />;
      case 'scrum': return <Sprints persona={persona} aviso={setAviso} />;
      case 'campaigns': return <Proyectos persona={persona} aviso={setAviso} />;
      case 'library': return <Entregables aviso={setAviso} />;
      case 'bases': return <Bases persona={persona} aviso={setAviso} />;
      case 'home': return <Resumen persona={persona} />;
      case 'gantt': return <Gantt />;
      case 'metro': return <MesaDeTrabajo />;
      case 'strategy': return <Estrategia persona={persona} aviso={setAviso} />;
      case 'aire': return <MesaAlAire persona={persona} aviso={setAviso} />;
      case 'calendario': return <Calendarios persona={persona} />;
      case 'brands': return <Marcas persona={persona} aviso={setAviso} />;
      case 'profile': return <Perfil personaId={idPerfil} soloLectura={viendoOtra || actor.permisos.soloLectura && idPerfil !== actor.id} aviso={setAviso} />;
      default: return <EnConstruccion vista={vistaFinal} />;
    }
  };

  return (
    <div class="app">
      <a class="saltar" href="#contenido">Saltar al contenido</a>
      <MenuLateral vista={vistaFinal} desde={desde} permisos={permisos} />
      <div class="columna">
        <BarraSuperior nombre={actor.name} alertas={alertas.sinLeer}
          alAbrirCampana={() => setAbierto('campana')} alAbrirCuenta={() => setAbierto('cuenta')} />
        {viendoOtra && (
          <div class="viendo-como" role="status">
            <span>Estás viendo el espacio de {persona.name} (solo lectura).</span>
            <button type="button" onClick={() => verComo('')}>Volver a coordinación</button>
          </div>
        )}
        <Pestanas vista={vistaFinal} desde={desde} permisos={permisos} />
        <main id="contenido" class="contenido" tabIndex={-1}>{contenido()}</main>
      </div>
      <BarraInferior vista={vistaFinal} desde={desde} permisos={permisos} alCrear={() => setAbierto('crear')} />

      <MenuCrear abierto={abierto === 'crear'} alCerrar={() => setAbierto(null)} persona={persona}
        alElegir={(id) => {
          setAbierto(null);
          ir(DESTINO_CREAR[id].vista);
          if (id === 'tarea') setCrearTarea(true);
          else if (id === 'catalogo') setPlanificar(true);
          else if (id === 'aire') {
            // Abre la Mesa al aire con el selector "Programar una salida".
            history.replaceState(null, '', '/al-aire?programar=1');
            dispatchEvent(new PopStateEvent('popstate'));
          }
          else setAviso(DESTINO_CREAR[id].aviso);
        }} />
      <MenuCuenta abierto={abierto === 'cuenta'} alCerrar={() => setAbierto(null)} persona={actor}
        personas={personas} viendoComo={viendoComo} alVerComo={verComo} alSalir={() => { detenerEnVivo(); cerrarSesion(); }} />
      <Campana abierto={abierto === 'campana'} alCerrar={() => setAbierto(null)} alertas={alertas.alertas}
        alLeer={(claves) => pedir('/alertas/leer', { method: 'POST', json: { claves } }).then(cargarAlertas)} />
      {planificar && <CentroPlanificacion alCerrar={() => setPlanificar(false)} aviso={setAviso} />}

      <div class="aviso-flotante" role="status" aria-live="polite">{aviso}</div>
    </div>
  );
};
