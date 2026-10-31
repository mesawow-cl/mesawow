// Reglas de las tareas (requerimiento §5.1). Funciones puras: las usa el servidor (autoridad)
// y la app (para mostrar u ocultar acciones).
import { tareaHecha, type EstadoTarea } from '../constantes.ts';
import type { Permisos } from '../roles.ts';

export interface TareaReglas {
  status: EstadoTarea;
  blocked: boolean;
  owner_id: string | null;
  reviewer_id: string | null;
  collaborators: string[];
  approvers: string[];
  acceptance: string;
  tieneEvidencia: boolean;
  dependenciasPendientes: number;
  confidential: boolean;
}

export const participa = (t: Pick<TareaReglas, 'owner_id' | 'reviewer_id' | 'collaborators' | 'approvers'>, personaId: string) =>
  t.owner_id === personaId || t.reviewer_id === personaId || t.collaborators.includes(personaId) || t.approvers.includes(personaId);

export const revisa = (t: Pick<TareaReglas, 'reviewer_id' | 'approvers'>, personaId: string) =>
  t.reviewer_id === personaId || t.approvers.includes(personaId);

export interface Acciones {
  editar: boolean;
  empezar: boolean;
  bloquear: boolean;
  desbloquear: boolean;
  entregar: boolean;
  adjuntar: boolean;
  aprobar: boolean;
  pedirAjustes: boolean;
  reabrir: boolean;
  comentar: boolean;
  confidencial: boolean;
}

/** Qué puede hacer una persona sobre una tarea, y por qué no (primer motivo). */
export const accionesPosibles = (t: TareaReglas, personaId: string, p: Permisos): Acciones => {
  const hecha = tareaHecha(t.status);
  const lee = p.soloLectura;
  const participante = participa(t, personaId);
  const ejecuta = t.owner_id === personaId || t.collaborators.includes(personaId);
  const entregaPermitida = p.esAdmin || t.owner_id === personaId || revisa(t, personaId);
  const revisor = p.esAdmin || revisa(t, personaId);
  return {
    editar: !lee && p.coordina,
    empezar: !lee && t.status === 'Pendiente' && (p.coordina || ejecuta),
    bloquear: !lee && !hecha && !t.blocked && (p.coordina || participante),
    desbloquear: !lee && t.blocked && (p.coordina || participante),
    entregar: !lee && !hecha && t.status !== 'Entregada para revisión' && entregaPermitida,
    adjuntar: !lee && entregaPermitida,
    aprobar: !lee && t.status === 'Entregada para revisión' && revisor,
    pedirAjustes: !lee && t.status === 'Entregada para revisión' && revisor,
    reabrir: !lee && hecha && p.coordina,
    comentar: !lee && (p.coordina || participante),
    confidencial: !lee && p.coordina,
  };
};

/** Motivo por el que no se puede empezar o entregar (null = se puede). */
export const impedimentoParaAvanzar = (t: Pick<TareaReglas, 'blocked' | 'dependenciasPendientes'>) => {
  if (t.blocked) return 'La tarea está bloqueada: resuelve el bloqueo primero.';
  if (t.dependenciasPendientes > 0) return 'La tarea previa todavía no está aprobada.';
  return null;
};

export const impedimentoParaAprobar = (t: Pick<TareaReglas, 'acceptance' | 'tieneEvidencia' | 'blocked' | 'dependenciasPendientes'>) => {
  if (!t.acceptance.trim()) return 'Falta el criterio de aceptación.';
  if (!t.tieneEvidencia) return 'Falta la evidencia: adjunta o escribe el resultado.';
  return impedimentoParaAvanzar(t);
};

/** Estado al entregar: con revisor o aprobadores va a revisión; si no, queda completada. */
export const estadoAlEntregar = (t: Pick<TareaReglas, 'reviewer_id' | 'approvers'>): EstadoTarea =>
  t.reviewer_id || t.approvers.length ? 'Entregada para revisión' : 'Completada';

export const atrasada = (t: { status: string; due: string }, hoy: string) => !tareaHecha(t.status) && t.due < hoy;

/** ¿Agregar estas dependencias a `tareaId` crea un ciclo? `aristas`: tarea → sus dependencias. */
export const creaCiclo = (tareaId: string, nuevas: string[], aristas: Map<string, string[]>) => {
  const visto = new Set<string>();
  const pila = [...nuevas];
  while (pila.length) {
    const x = pila.pop()!;
    if (x === tareaId) return true;
    if (visto.has(x)) continue;
    visto.add(x);
    pila.push(...(aristas.get(x) ?? []));
  }
  return false;
};

export const PRIORIDAD_VALOR: Record<string, number> = { Urgente: 4, Alta: 3, Media: 2, Baja: 1 };
