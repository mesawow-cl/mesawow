// Motor de agenda (allocateWork y recalcPlans del prototipo, con jornada configurable y feriados).
// Trabaja en "minutos de pared": minutos desde 1970 tratando la hora de Santiago como si fuera UTC,
// así un día siempre tiene 1440 minutos y no hay saltos por horario de verano.

export interface Rango { inicio: number; fin: number }
export interface ConfigJornada {
  /** Ventanas de trabajo en minutos desde medianoche, ordenadas (D6: 09–14 y 15–18). */
  ventanas: readonly Rango[] | readonly { inicio: number; fin: number }[];
  /** Días laborales (0 = domingo … 6 = sábado). */
  dias: readonly number[];
  /** Feriados y días no laborables, 'YYYY-MM-DD'. */
  feriados: ReadonlySet<string>;
}

const DIA = 1440;
/** Horizonte máximo de búsqueda: dos años. */
const HORIZONTE = 2 * 366 * DIA;

export const aMinuto = (pared: string) => {
  const t = Date.parse(`${pared.slice(0, 16)}:00Z`);
  if (Number.isNaN(t)) throw new Error(`Fecha y hora inválidas: ${pared}`);
  return Math.floor(t / 60_000);
};
export const aPared = (minuto: number) => new Date(minuto * 60_000).toISOString().slice(0, 16);
const fechaDe = (dia: number) => new Date(dia * 86_400_000).toISOString().slice(0, 10);

export const esLaboral = (fecha: string, cfg: ConfigJornada) =>
  cfg.dias.includes(new Date(`${fecha}T12:00:00Z`).getUTCDay()) && !cfg.feriados.has(fecha);

export const minutosPorDia = (cfg: ConfigJornada) => cfg.ventanas.reduce((t, v) => t + (v.fin - v.inicio), 0);

export class SinDisponibilidad extends Error {
  constructor() { super('No se encontró disponibilidad suficiente en el horizonte de cálculo.'); }
}

/**
 * Reparte `minutos` de trabajo desde `inicio` en las ventanas laborales, saltando lo `ocupado`.
 * Devuelve los bloques y el minuto de término.
 */
export const asignar = (inicio: number, minutos: number, ocupado: readonly Rango[], cfg: ConfigJornada) => {
  const ocupados = ocupado.filter((b) => b.fin > b.inicio).slice().sort((a, b) => a.inicio - b.inicio);
  const bloques: Rango[] = [];
  let n = inicio;
  let falta = Math.round(minutos);
  while (falta > 0) {
    if (n - inicio > HORIZONTE) throw new SinDisponibilidad();
    const dia = Math.floor(n / DIA);
    const base = dia * DIA;
    if (!esLaboral(fechaDe(dia), cfg)) { n = base + DIA; continue; }
    const m = n - base;
    const ventana = cfg.ventanas.find((v) => m < v.fin);
    if (!ventana) { n = base + DIA; continue; }
    if (m < ventana.inicio) { n = base + ventana.inicio; continue; }
    const finVentana = base + ventana.fin;
    const cubre = ocupados.find((b) => b.inicio <= n && b.fin > n);
    if (cubre) { n = cubre.fin; continue; }
    const siguiente = ocupados.find((b) => b.inicio > n && b.inicio < finVentana);
    const fin = Math.min(finVentana, siguiente?.inicio ?? finVentana, n + falta);
    const ultimo = bloques.at(-1);
    if (ultimo && ultimo.fin === n) ultimo.fin = fin; else bloques.push({ inicio: n, fin });
    falta -= fin - n;
    n = fin;
  }
  return { bloques, fin: bloques.at(-1)?.fin ?? inicio };
};

export interface PlanEntrada {
  tarea: string;
  persona: string;
  /** Inicio pedido (minuto de pared). */
  inicio: number;
  minutos: number;
  /** Término calculado antes de este recálculo, para detectar atrasos. */
  finAnterior?: number | null;
  /** Bloques ya transcurridos: no se mueven y su tiempo se descuenta de `minutos`. */
  fijos?: Rango[];
}

export interface PlanResultado { tarea: string; persona: string; bloques: Rango[]; fin: number; finAnterior: number | null }

export class CicloDePlanificacion extends Error {
  constructor() { super('Hay una dependencia circular de planificación.'); }
}

/**
 * Recalcula todos los planes: cada uno empieza después de lo pedido y del término de sus dependencias
 * planificadas, y no se superpone con reuniones ni con otros planes de la misma persona.
 * Se procesan por inicio pedido (luego por tarea), resolviendo primero las dependencias.
 */
export const recalcular = (
  planes: readonly PlanEntrada[],
  dependencias: ReadonlyMap<string, readonly string[]>,
  reuniones: ReadonlyMap<string, readonly Rango[]>,
  cfg: ConfigJornada,
): Map<string, PlanResultado> => {
  const porTarea = new Map(planes.map((p) => [p.tarea, p]));
  const ocupado = new Map<string, Rango[]>();
  const hechos = new Map<string, PlanResultado>();
  const visitando = new Set<string>();

  const calcular = (p: PlanEntrada): PlanResultado => {
    const listo = hechos.get(p.tarea);
    if (listo) return listo;
    if (visitando.has(p.tarea)) throw new CicloDePlanificacion();
    visitando.add(p.tarea);
    let desde = p.inicio;
    for (const d of dependencias.get(p.tarea) ?? []) {
      const previo = porTarea.get(d);
      if (previo) desde = Math.max(desde, calcular(previo).fin);
    }
    const fijos = p.fijos ?? [];
    const restante = p.minutos - fijos.reduce((t, b) => t + (b.fin - b.inicio), 0);
    const propios = ocupado.get(p.persona) ?? [];
    const r = restante > 0
      ? asignar(desde, restante, [...(reuniones.get(p.persona) ?? []), ...propios], cfg)
      : { bloques: [], fin: fijos.at(-1)?.fin ?? desde };
    ocupado.set(p.persona, [...propios, ...r.bloques]);
    const resultado = { tarea: p.tarea, persona: p.persona, bloques: [...fijos, ...r.bloques], fin: r.fin, finAnterior: p.finAnterior ?? null };
    hechos.set(p.tarea, resultado);
    visitando.delete(p.tarea);
    return resultado;
  };

  for (const p of [...planes].sort((a, b) => a.inicio - b.inicio || a.tarea.localeCompare(b.tarea))) calcular(p);
  return hechos;
};
