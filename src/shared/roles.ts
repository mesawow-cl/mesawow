// Roles y permisos derivados (docs/requerimiento-mesawow.md §2).
// El servidor es la autoridad: la app usa estas mismas funciones solo para ocultar lo que no corresponde.

export const ROLES = [
  'Administrador general',
  'Administración',
  'Coordinación de Marketing',
  'Responsable de marca o área',
  'Ejecutor',
  'Revisor o aprobador',
  'Consulta',
  'Mandante',
  'Consulta externa',
  'Administrador técnico',
] as const;
export type Rol = (typeof ROLES)[number];

export const ROLES_COORDINACION: readonly Rol[] = [
  'Administración',
  'Coordinación de Marketing',
  'Responsable de marca o área',
];

export const ROLES_EXTERNOS: readonly Rol[] = ['Mandante', 'Consulta externa', 'Administrador técnico'];

/** Roles que se pueden asignar al invitar (el Administrador general se transfiere, no se invita). */
export const ROLES_INVITABLES: readonly Rol[] = [
  'Coordinación de Marketing',
  'Responsable de marca o área',
  'Ejecutor',
  'Revisor o aprobador',
  'Consulta',
];

export interface PersonaConRol {
  role: Rol;
  /** Nombre de la mesa de la persona; "dirige" quien pertenece a la mesa Dirección (§14-P8, provisorio). */
  mesa?: string | null;
}

export const esAdmin = (p: PersonaConRol | null | undefined) => p?.role === 'Administrador general';

export const coordina = (p: PersonaConRol | null | undefined) =>
  !!p && (esAdmin(p) || ROLES_COORDINACION.includes(p.role));

export const dirige = (p: PersonaConRol | null | undefined) => !!p && /Direcci[oó]n|Director/i.test(p.mesa ?? '');

export const coordinaODirige = (p: PersonaConRol | null | undefined) => coordina(p) || dirige(p);

export const esEquipo = (p: PersonaConRol | null | undefined) => !!p && !ROLES_EXTERNOS.includes(p.role);

export const soloLectura = (p: PersonaConRol | null | undefined) => p?.role === 'Consulta';

export interface Permisos {
  esAdmin: boolean;
  coordina: boolean;
  coordinaODirige: boolean;
  esEquipo: boolean;
  soloLectura: boolean;
}

export const permisosDe = (p: PersonaConRol | null | undefined): Permisos => ({
  esAdmin: esAdmin(p),
  coordina: coordina(p),
  coordinaODirige: coordinaODirige(p),
  esEquipo: esEquipo(p),
  soloLectura: soloLectura(p),
});
