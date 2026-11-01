// Mesa al aire (requerimiento §5.6). Funciones puras: piezas de una serie, horas, estado y plazos.
import { DIAS_REVISION_AIRE, esCanalDeAnuncios } from '../constantes.ts';

export type ModoSerie = 'dias' | 'periodo';
export interface Serie {
  id?: string; name: string; channel: string; mode: ModoSerie; days: string[]; time: string; from: string; weeks: number; count?: number | null; hours: number;
}
export interface PiezaGenerada { piece: string; at: string; end: string | null }

export const NOMBRE_POR_CANAL = (canal: string) =>
  canal === 'Correo (Brevo)' ? 'Mail' : ['Instagram', 'Facebook', 'LinkedIn'].includes(canal) ? 'Post' : ['TikTok', 'YouTube'].includes(canal) ? 'Video'
    : canal === 'WhatsApp' ? 'Mensaje' : ['Sitio web', 'Prensa y medios'].includes(canal) ? 'Nota' : esCanalDeAnuncios(canal) ? 'Anuncio' : 'Pieza';

export const PLANTILLAS_SERIE: Record<'mail' | 'organico' | 'ads', Omit<Serie, 'from'>> = {
  mail: { name: 'Mail', channel: 'Correo (Brevo)', mode: 'dias', days: ['1', '3', '5'], time: '10:00', weeks: 4, hours: 0.5 },
  organico: { name: 'Post', channel: 'Instagram', mode: 'dias', days: ['1', '2', '3', '4', '5'], time: '12:00', weeks: 4, hours: 1 },
  ads: { name: 'Anuncio', channel: 'Meta Ads', mode: 'periodo', days: [], time: '09:00', weeks: 4, count: 3, hours: 2 },
};

const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Piezas de una serie: en días fijos, una por día elegido durante `weeks` semanas; por período, `count` creatividades activas hasta el fin. */
export const piezasDeSerie = (s: Serie): PiezaGenerada[] => {
  const nombre = s.name.trim() || 'Pieza';
  if (s.mode === 'periodo') {
    const fin = sumarDias(s.from, s.weeks * 7 - 1);
    return Array.from({ length: Math.max(1, s.count ?? 3) }, (_, i) => ({ piece: `${nombre} ${i + 1}`, at: `${s.from}T${s.time || '09:00'}`, end: fin }));
  }
  const piezas: PiezaGenerada[] = [];
  for (let i = 0; i < s.weeks * 7; i++) {
    const d = sumarDias(s.from, i);
    if (s.days.includes(String(new Date(`${d}T12:00:00Z`).getUTCDay()))) piezas.push({ piece: `${nombre} ${piezas.length + 1}`, at: `${d}T${s.time}`, end: null });
  }
  return piezas;
};

export const horasDeSeries = (series: Serie[]) => series.reduce((n, s) => n + piezasDeSerie(s).length * (s.hours || 0), 0);

export type EstadoPieza = 'En la mesa' | 'En riesgo' | 'Lista para salir' | 'Atrasada' | 'Al aire';

/** Estado de una pieza (primera regla que se cumple). `ahora` es la hora de pared de Santiago. */
export const estadoPieza = (p: { status: string; at: string }, t: { hecha: boolean; plazo: string }, ahora: string): EstadoPieza => {
  if (p.status === 'Al aire') return 'Al aire';
  if (p.at < ahora) return 'Atrasada';
  if (t.hecha) return 'Lista para salir';
  if (t.plazo > p.at.slice(0, 10) || p.at.slice(0, 10) <= sumarDias(ahora.slice(0, 10), DIAS_REVISION_AIRE)) return 'En riesgo';
  return 'En la mesa';
};

/** Fecha límite propuesta: primera salida − 2 días, acotada a hoy y a la primera salida. */
export const plazoPropuesto = (primeraSalida: string, hoy: string) => {
  const dia = primeraSalida.slice(0, 10);
  const propuesta = sumarDias(dia, -DIAS_REVISION_AIRE);
  return propuesta < hoy ? (hoy > dia ? dia : hoy) : propuesta;
};

export const validarSerie = (s: Serie): string | null => {
  if (!s.channel) return 'Elige el canal de la serie.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.from)) return 'Indica desde cuándo sale la serie.';
  if (!(s.weeks >= 1 && s.weeks <= 52)) return 'Las semanas van de 1 a 52.';
  if (s.mode === 'dias') {
    if (!s.days.length) return 'Elige al menos un día.';
    if (!/^\d{2}:\d{2}$/.test(s.time)) return 'Indica la hora de publicación.';
  } else if (!(s.count && s.count >= 1 && s.count <= 50)) return 'Las creatividades van de 1 a 50.';
  if (!(s.hours >= 0)) return 'Las horas por pieza no pueden ser negativas.';
  return null;
};
