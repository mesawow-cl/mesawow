import { useCallback, useEffect, useState } from 'preact/hooks';
import { vistaPermitida, type OpcionCrear } from '../shared/navegacion';
import { entrarComo, ErrorApi, pedir, type Persona } from './api';
import { BarraInferior, BarraSuperior, MenuLateral, Pestanas } from './componentes/Estructura';
import { Campana, MenuCrear, MenuCuenta, type PersonaVisible } from './componentes/Menus';
import { alHacerClicEnEnlace, ir, useUbicacion } from './rutas';
import { EntrarComo } from './vistas/EntrarComo';
import { EnConstruccion, Inicio, Mas } from './vistas/Vistas';

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'elegir' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; persona: Persona };

const DESTINO_CREAR: Record<OpcionCrear['id'], { vista: Parameters<typeof ir>[0]; aviso: string }> = {
  tarea: { vista: 'tasks', aviso: 'El formulario de tarea por pasos llega en la Fase 3.' },
  aire: { vista: 'aire', aviso: 'Programar salidas al aire llega en la Fase 4.' },
  catalogo: { vista: 'campaigns', aviso: 'Campañas 360, webinars y catálogo llegan en la Fase 3.' },
  compromiso: { vista: 'muro', aviso: 'Los compromisos del día llegan en la Fase 7.' },
};

export const App = () => {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [abierto, setAbierto] = useState<'crear' | 'cuenta' | 'campana' | null>(null);
  const [personas, setPersonas] = useState<PersonaVisible[]>([]);
  const [viendoComo, setViendoComo] = useState('');
  const [aviso, setAviso] = useState('');
  const { vista, desde } = useUbicacion();

  const cargar = useCallback(() => {
    setEstado({ tipo: 'cargando' });
    pedir<{ persona: Persona }>('/me')
      .then(({ persona }) => setEstado({ tipo: 'listo', persona }))
      .catch((e: Error) => {
        if (e instanceof ErrorApi && e.code === 'sin_sesion') setEstado({ tipo: 'elegir' });
        else setEstado({ tipo: 'error', mensaje: e.message });
      });
  }, []);

  useEffect(cargar, [cargar]);
  useEffect(() => {
    addEventListener('click', alHacerClicEnEnlace);
    return () => removeEventListener('click', alHacerClicEnEnlace);
  }, []);
  useEffect(() => {
    if (estado.tipo === 'listo' && estado.persona.permisos.esAdmin) {
      pedir<{ personas: PersonaVisible[] }>('/personas').then((r) => setPersonas(r.personas)).catch(() => setPersonas([]));
    }
  }, [estado]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 4500);
    return () => clearTimeout(t);
  }, [aviso]);

  if (estado.tipo === 'cargando') return <main class="entrar"><p>Cargando mesawow…</p></main>;
  if (estado.tipo === 'elegir') return <EntrarComo alEntrar={cargar} />;
  if (estado.tipo === 'error') {
    return (
      <main class="entrar">
        <div class="tarjeta" role="alert"><h1 style={{ fontSize: '22px' }}>No pudimos abrir mesawow</h1><p style={{ marginTop: '8px' }}>{estado.mensaje}</p></div>
      </main>
    );
  }

  const { persona } = estado;
  const { permisos } = persona;
  // Roles externos no usan el Inicio del equipo (prototipo: van a Mi mesa). Ver §14-P2.
  const vistaFinal = !permisos.esEquipo && vista === 'muro' ? 'agenda' : vista;
  const permitida = vistaPermitida(vistaFinal, permisos);
  const persVista = personas.find((p) => p.id === viendoComo);

  const salir = () => { entrarComo(null); setAbierto(null); setViendoComo(''); history.replaceState(null, '', '/'); cargar(); };

  return (
    <div class="app">
      <a class="saltar" href="#contenido">Saltar al contenido</a>
      <MenuLateral vista={vistaFinal} desde={desde} permisos={permisos} />
      <div class="columna">
        <BarraSuperior nombre={persona.name} alertas={0}
          alAbrirCampana={() => setAbierto('campana')} alAbrirCuenta={() => setAbierto('cuenta')} />
        {persVista && (
          <div class="viendo-como" role="status">
            <span>Estás viendo el espacio de {persVista.name} (solo lectura).</span>
            <button type="button" onClick={() => setViendoComo('')}>Volver a coordinación</button>
          </div>
        )}
        <Pestanas vista={vistaFinal} desde={desde} permisos={permisos} />
        <main id="contenido" class="contenido" tabIndex={-1}>
          {!permitida ? (
            <div class="pronto" role="alert"><strong>No tienes acceso a esta sección.</strong><p>Si crees que deberías verla, pídelo a coordinación.</p></div>
          ) : vistaFinal === 'muro' ? (
            <Inicio persona={persona} />
          ) : vistaFinal === 'more' ? (
            <Mas persona={persona} alAbrirCuenta={() => setAbierto('cuenta')} />
          ) : (
            <EnConstruccion vista={vistaFinal} />
          )}
        </main>
      </div>
      <BarraInferior vista={vistaFinal} desde={desde} permisos={permisos} alCrear={() => setAbierto('crear')} />

      <MenuCrear abierto={abierto === 'crear'} alCerrar={() => setAbierto(null)} persona={persona}
        alElegir={(id) => { setAbierto(null); ir(DESTINO_CREAR[id].vista); setAviso(DESTINO_CREAR[id].aviso); }} />
      <MenuCuenta abierto={abierto === 'cuenta'} alCerrar={() => setAbierto(null)} persona={persona}
        personas={personas} viendoComo={viendoComo}
        alVerComo={(id) => { setViendoComo(id); setAbierto(null); if (id) ir('tasks'); }} alSalir={salir} />
      <Campana abierto={abierto === 'campana'} alCerrar={() => setAbierto(null)} />

      <div class="aviso-flotante" role="status" aria-live="polite">{aviso}</div>
    </div>
  );
};
