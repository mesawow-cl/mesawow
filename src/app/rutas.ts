// Rutas de la app (app.mesawow.cl). Cada vista tiene una dirección en español.
import { useEffect, useState } from 'preact/hooks';
import type { EspacioId, Vista } from '../shared/navegacion';

export const RUTAS: Record<Vista, string> = {
  muro: '/',
  plaza: '/comunidad',
  recognition: '/logros',
  agenda: '/mi-mesa',
  calendario: '/calendarios',
  tasks: '/encargos',
  gantt: '/tiempo-de-trabajo',
  home: '/resumen',
  notifications: '/avisos',
  preferences: '/mis-avisos',
  mesas: '/mesas',
  metro: '/mesa-de-trabajo',
  scrum: '/sprints',
  campaigns: '/proyectos',
  library: '/entregables',
  brands: '/marcas',
  strategy: '/mesa-estrategica',
  aire: '/al-aire',
  bases: '/bases',
  connections: '/correo-y-whatsapp',
  settings: '/plataformas',
  team: '/equipo',
  profile: '/perfil',
  reports: '/informes',
  coverage: '/alcance',
  moderation: '/moderacion',
  more: '/mas',
};

const VISTA_POR_RUTA = new Map(Object.entries(RUTAS).map(([v, r]) => [r, v as Vista]));

export interface Ubicacion { vista: Vista; desde?: EspacioId }

export const leerUbicacion = (): Ubicacion => {
  const ruta = location.pathname.replace(/\/+$/, '') || '/';
  const desde = new URLSearchParams(location.search).get('desde') as EspacioId | null;
  return { vista: VISTA_POR_RUTA.get(ruta) ?? 'muro', desde: desde ?? undefined };
};

export const hrefDe = (vista: Vista, desde?: EspacioId) => RUTAS[vista] + (desde ? `?desde=${desde}` : '');

export const ir = (vista: Vista, desde?: EspacioId) => {
  const destino = hrefDe(vista, desde);
  if (destino !== location.pathname + location.search) history.pushState(null, '', destino);
  dispatchEvent(new PopStateEvent('popstate'));
  scrollTo({ top: 0 });
};

/** Intercepta clics en enlaces internos para navegar sin recargar. */
export const alHacerClicEnEnlace = (e: MouseEvent) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest('a');
  if (!a || a.target || a.origin !== location.origin || a.hasAttribute('download')) return;
  e.preventDefault();
  history.pushState(null, '', a.pathname + a.search);
  dispatchEvent(new PopStateEvent('popstate'));
  scrollTo({ top: 0 });
};

export const useUbicacion = () => {
  const [u, setU] = useState(leerUbicacion);
  useEffect(() => {
    const alCambiar = () => setU(leerUbicacion());
    addEventListener('popstate', alCambiar);
    return () => removeEventListener('popstate', alCambiar);
  }, []);
  return u;
};
