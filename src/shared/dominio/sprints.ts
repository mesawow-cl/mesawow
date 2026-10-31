// Reglas de sprints (requerimiento §5.5). Funciones puras.
import { TOPE_CARGA_SPRINT } from '../constantes.ts';
import { aMinuto, esLaboral, type ConfigJornada, type Rango } from './agenda.ts';

export const ESTADOS_SPRINT = ['Planificado', 'Activo', 'En revisión', 'Cerrado'] as const;
export type EstadoSprint = (typeof ESTADOS_SPRINT)[number];

const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const esLunes = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay() === 1;
export const finDeSprint = (inicio: string) => sumarDias(inicio, 4);

/** Días de trabajo del sprint: lunes a viernes de esa semana, sin feriados (reducen capacidad, no extienden). */
export const diasDelSprint = (inicio: string, cfg: ConfigJornada) =>
  [0, 1, 2, 3, 4].map((i) => sumarDias(inicio, i)).filter((d) => esLaboral(d, cfg));

/** Minutos ocupados dentro de las ventanas de trabajo de esos días (unión de rangos, sin contar dos veces). */
export const minutosOcupados = (dias: string[], ocupados: Rango[], cfg: ConfigJornada) => {
  const ventanas: Rango[] = dias.flatMap((d) => cfg.ventanas.map((v) => ({ inicio: aMinuto(`${d}T00:00`) + v.inicio, fin: aMinuto(`${d}T00:00`) + v.fin })));
  const recortes = ocupados.flatMap((o) => ventanas.map((v) => ({ inicio: Math.max(o.inicio, v.inicio), fin: Math.min(o.fin, v.fin) })).filter((r) => r.fin > r.inicio));
  recortes.sort((a, b) => a.inicio - b.inicio);
  let total = 0, hasta = -Infinity;
  for (const r of recortes) {
    if (r.fin <= hasta) continue;
    total += r.fin - Math.max(r.inicio, hasta);
    hasta = r.fin;
  }
  return total;
};

export interface Capacidad { disponible: number; comprometido: number; ocupado: number; sobrecarga: boolean; sobreTope: boolean }

/** Capacidad de un miembro en horas: días × jornada diaria − ocupado; comprometido = horas de sus tareas del sprint. */
export const capacidad = (dias: number, horasDiarias: number, minutosOcupadosMiembro: number, comprometido: number): Capacidad => {
  const ocupado = Math.round((minutosOcupadosMiembro / 60) * 10) / 10;
  const disponible = Math.max(0, Math.round((dias * horasDiarias - ocupado) * 10) / 10);
  return { disponible, comprometido, ocupado, sobrecarga: comprometido > disponible, sobreTope: comprometido > disponible * TOPE_CARGA_SPRINT };
};

export interface TareaPreparacion {
  owner_activo: boolean; description: string; deliverable: string; acceptance: string; estimated_hours: number;
  blocked: boolean; inputs_ready: boolean; dependenciasExternasPendientes: number;
}

/** "Lista para sprint" (readyIssues del prototipo): lo que falta, en el orden en que se muestra. */
export const faltasDePreparacion = (t: TareaPreparacion) => {
  const faltas: string[] = [];
  if (!t.owner_activo) faltas.push('Responsable activo');
  if (!t.description.trim()) faltas.push('Instrucción');
  if (!t.deliverable.trim()) faltas.push('Entregable');
  if (!t.acceptance.trim()) faltas.push('Criterio de aceptación');
  if (!(t.estimated_hours > 0)) faltas.push('Estimación de horas');
  if (t.blocked) faltas.push('Bloqueo sin resolver');
  if (!t.inputs_ready) faltas.push('Inputs sin validar');
  if (t.dependenciasExternasPendientes > 0) faltas.push('Dependencia externa pendiente');
  return faltas;
};

/** Faltas que se corrigen preparando la tarea (las demás bloquean el inicio por sí mismas). */
export const FALTAS_DE_DATOS = new Set(['Responsable activo', 'Instrucción', 'Entregable', 'Criterio de aceptación', 'Estimación de horas']);
