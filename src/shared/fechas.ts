// Fechas en America/Santiago.
import { ZONA_HORARIA } from './constantes.ts';

const partes = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_HORARIA, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Diferencia (ms) entre la hora de pared de Santiago y UTC en el instante `t`. */
const desfase = (t: number) => {
  const p = Object.fromEntries(partes.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - Math.floor(t / 1000) * 1000;
};

/** 'YYYY-MM-DDTHH:MM' (hora de Santiago) → ISO UTC. */
export const santiagoAUtc = (pared: string) => {
  const comoUtc = Date.parse(`${pared.slice(0, 16)}:00Z`);
  if (Number.isNaN(comoUtc)) throw new Error(`Fecha inválida: ${pared}`);
  let t = comoUtc - desfase(comoUtc);
  t = comoUtc - desfase(t);
  return new Date(t).toISOString();
};

/** ISO UTC → 'YYYY-MM-DDTHH:MM' en hora de Santiago. */
export const utcASantiago = (iso: string) => {
  const t = Date.parse(iso);
  return new Date(t + desfase(t)).toISOString().slice(0, 16);
};

/** Hoy en Santiago, 'YYYY-MM-DD'. */
export const hoySantiago = (ahora = new Date()) => utcASantiago(ahora.toISOString()).slice(0, 10);

/** Minutos "de pared" del prototipo (wallMinute: minutos desde 1970 tratando la hora local como UTC). */
export const minutoDeParedAIso = (minutos: number) => new Date(minutos * 60_000).toISOString().slice(0, 16);
