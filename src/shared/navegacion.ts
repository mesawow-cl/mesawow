// Los 5 espacios y sus pestañas (render final del prototipo, MW_SPACES · línea 1279).
import type { Permisos } from './roles';

export type Vista =
  | 'muro' | 'plaza' | 'recognition'
  | 'agenda' | 'calendario' | 'tasks' | 'gantt' | 'home' | 'notifications' | 'preferences'
  | 'mesas' | 'metro' | 'scrum' | 'campaigns' | 'library' | 'brands' | 'strategy'
  | 'aire' | 'bases' | 'connections' | 'settings'
  | 'team' | 'profile' | 'reports' | 'coverage' | 'moderation'
  | 'more';

export type EspacioId = 'inicio' | 'trabajo' | 'mesas' | 'aire' | 'equipo';

export interface Pestana {
  vista: Vista;
  etiqueta: string;
  visible?: (p: Permisos) => boolean;
}

export interface Espacio {
  id: EspacioId;
  etiqueta: string;
  icono: 'home' | 'check' | 'layers' | 'rocket' | 'users';
  pestanas: Pestana[];
}

const coordina = (p: Permisos) => p.coordina;
const coordinaODirige = (p: Permisos) => p.coordinaODirige;
const esAdmin = (p: Permisos) => p.esAdmin;

export const ESPACIOS: Espacio[] = [
  {
    id: 'inicio', etiqueta: 'Inicio', icono: 'home',
    pestanas: [
      { vista: 'muro', etiqueta: 'Inicio' },
      { vista: 'plaza', etiqueta: 'Comunidad' },
      { vista: 'recognition', etiqueta: 'Logros del equipo', visible: coordinaODirige },
    ],
  },
  {
    id: 'trabajo', etiqueta: 'Mi trabajo', icono: 'check',
    pestanas: [
      { vista: 'agenda', etiqueta: 'Mi mesa' },
      { vista: 'calendario', etiqueta: 'Dos calendarios' },
      { vista: 'tasks', etiqueta: 'Mis encargos' },
      { vista: 'gantt', etiqueta: 'Tiempo de trabajo' },
      { vista: 'home', etiqueta: 'Resumen' },
      { vista: 'notifications', etiqueta: 'Avisos' },
      { vista: 'preferences', etiqueta: 'Mis avisos' },
    ],
  },
  {
    id: 'mesas', etiqueta: 'Mesas', icono: 'layers',
    pestanas: [
      { vista: 'mesas', etiqueta: 'Mis mesas' },
      { vista: 'metro', etiqueta: 'Mesa de trabajo' },
      { vista: 'scrum', etiqueta: 'Sprints' },
      { vista: 'campaigns', etiqueta: 'Proyectos' },
      { vista: 'library', etiqueta: 'Entregables' },
      { vista: 'brands', etiqueta: 'Marcas y mínimos' },
      { vista: 'strategy', etiqueta: 'Mesa estratégica', visible: coordinaODirige },
    ],
  },
  {
    id: 'aire', etiqueta: 'Al aire', icono: 'rocket',
    pestanas: [
      { vista: 'aire', etiqueta: 'Mesa al aire' },
      { vista: 'calendario', etiqueta: 'Dos calendarios' },
      { vista: 'bases', etiqueta: 'Bases y segmentos', visible: coordina },
      { vista: 'connections', etiqueta: 'Correo y WhatsApp', visible: coordina },
      { vista: 'settings', etiqueta: 'Plataformas', visible: coordina },
    ],
  },
  {
    id: 'equipo', etiqueta: 'Equipo', icono: 'users',
    pestanas: [
      { vista: 'team', etiqueta: 'Equipo', visible: esAdmin },
      { vista: 'profile', etiqueta: 'Mi perfil' },
      { vista: 'reports', etiqueta: 'Informes', visible: coordinaODirige },
      { vista: 'coverage', etiqueta: 'Alcance', visible: coordina },
      { vista: 'moderation', etiqueta: 'Moderación', visible: esAdmin },
    ],
  },
];

export const pestanasVisibles = (e: Espacio, p: Permisos) => e.pestanas.filter((t) => !t.visible || t.visible(p));

/**
 * Espacio de una vista. "calendario" vive en dos espacios: se respeta el espacio
 * desde el que se entró (corrección al prototipo, que siempre marcaba Mi trabajo).
 */
export const espacioDe = (vista: Vista, preferido?: EspacioId): EspacioId | null => {
  const candidatos = ESPACIOS.filter((e) => e.pestanas.some((t) => t.vista === vista)).map((e) => e.id);
  if (!candidatos.length) return null;
  return preferido && candidatos.includes(preferido) ? preferido : candidatos[0];
};

export const vistaPermitida = (vista: Vista, p: Permisos) =>
  vista === 'more' || ESPACIOS.some((e) => pestanasVisibles(e, p).some((t) => t.vista === vista));

export interface OpcionCrear {
  id: 'tarea' | 'aire' | 'catalogo' | 'compromiso';
  titulo: string;
  detalle: string;
  visible: (p: Permisos) => boolean;
}

/** Botón ＋ "¿Qué quieres crear?" (muroCreate · línea 1300). */
export const OPCIONES_CREAR: OpcionCrear[] = [
  { id: 'tarea', titulo: 'Una tarea', detalle: 'Para una persona o un equipo, con plazo y entregable.', visible: (p) => p.coordina },
  { id: 'aire', titulo: 'Una salida al aire', detalle: 'Programa piezas o series en sus canales.', visible: (p) => p.coordina },
  { id: 'catalogo', titulo: 'Una campaña o trabajo del catálogo', detalle: 'Campaña 360, webinar y trabajos estándar.', visible: () => true },
  { id: 'compromiso', titulo: 'Mi compromiso de hoy', detalle: 'Para celebrar el Día cumplido.', visible: (p) => p.esEquipo },
];
