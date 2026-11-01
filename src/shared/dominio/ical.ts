// Lectura de calendarios iCal (RFC 5545) para traer reuniones de Google Calendar sin OAuth.
// Soporta zonas horarias (TZID), eventos repetidos (RRULE: DAILY, WEEKLY, MONTHLY, YEARLY con INTERVAL,
// COUNT, UNTIL, BYDAY y BYMONTHDAY), EXDATE y excepciones (RECURRENCE-ID). Ignora eventos de todo el día,
// cancelados y marcados como "disponible". Devuelve horas de pared de Santiago.
import { ZONA_HORARIA } from '../constantes.ts';
import { utcASantiago } from '../fechas.ts';

export interface ReunionIcal { id: string; titulo: string; inicio: string; fin: string }
interface Prop { nombre: string; params: Record<string, string>; valor: string }

const desdobla = (texto: string) => texto.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
const propiedad = (linea: string): Prop | null => {
  const i = linea.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (i < 0) return null;
  const [nombre, ...params] = linea.slice(0, i).split(';');
  return {
    nombre: nombre!.toUpperCase(),
    params: Object.fromEntries(params.map((p) => { const [k, v = ''] = p.split('='); return [k!.toUpperCase(), v.replace(/^"|"$/g, '')]; })),
    valor: linea.slice(i + 1),
  };
};
const texto = (v: string) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');

/** Hora de pared en una zona → instante UTC (ms). */
export const zonaAUtc = (pared: string, zona: string) => {
  const comoUtc = Date.parse(`${pared}Z`);
  let formato: Intl.DateTimeFormat;
  try { formato = new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { formato = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_HORARIA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  const desfase = (t: number) => {
    const p = Object.fromEntries(formato.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - Math.floor(t / 1000) * 1000;
  };
  let t = comoUtc - desfase(comoUtc);
  t = comoUtc - desfase(t);
  return t;
};

/** Fecha iCal → { pared (en su zona), zona, todoElDia }. */
const fecha = (p: Prop) => {
  const v = p.valor.trim();
  if (p.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) return { pared: '', zona: '', todoElDia: true };
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const pared = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return { pared, zona: m[7] ? 'UTC' : p.params.TZID || ZONA_HORARIA, todoElDia: false };
};
const aSantiago = (pared: string, zona: string) => utcASantiago(new Date(zona === 'UTC' ? Date.parse(`${pared}Z`) : zonaAUtc(pared, zona)).toISOString());
const duracion = (v: string) => {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  return m ? ((+(m[1] ?? 0) * 7 + +(m[2] ?? 0)) * 86_400 + +(m[3] ?? 0) * 3600 + +(m[4] ?? 0) * 60 + +(m[5] ?? 0)) * 1000 : 0;
};

const DIA_SEMANA: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const sumarDias = (pared: string, n: number) => new Date(Date.parse(`${pared}Z`) + n * 86_400_000).toISOString().slice(0, 19);
const conFecha = (pared: string, dia: string) => `${dia}${pared.slice(10)}`;

/** Ocurrencias (hora de pared en la zona del evento) de una regla, hasta `hasta` (misma referencia). */
const expandir = (inicio: string, regla: string, hasta: string, zona: string): string[] => {
  const r = Object.fromEntries(regla.split(';').map((x) => x.split('=') as [string, string]));
  const freq = r.FREQ, intervalo = Math.max(1, +(r.INTERVAL ?? 1)), cuenta = r.COUNT ? +r.COUNT : Infinity;
  let limite = hasta;
  if (r.UNTIL) {
    const u = fecha({ nombre: 'UNTIL', params: {}, valor: r.UNTIL });
    if (u && !u.todoElDia) limite = [limite, u.zona === 'UTC' ? utcASantiagoEnZona(u.pared, zona) : u.pared].sort()[0]!;
    else if (/^\d{8}/.test(r.UNTIL)) limite = [limite, `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}T23:59:59`].sort()[0]!;
  }
  const porDia = r.BYDAY?.split(',') ?? [];
  const salida: string[] = [];
  const agregar = (x: string) => { if (x >= inicio && x <= limite && salida.length < cuenta) salida.push(x); };
  const [y0, m0, d0] = inicio.slice(0, 10).split('-').map(Number) as [number, number, number];
  for (let k = 0; k < 2000 && salida.length < cuenta; k++) {
    if (freq === 'DAILY') { const x = sumarDias(inicio, k * intervalo); if (x > limite) break; agregar(x); continue; }
    if (freq === 'WEEKLY') {
      const lunes = sumarDias(inicio, -((new Date(`${inicio}Z`).getUTCDay() + 6) % 7) + k * 7 * intervalo);
      if (lunes > limite) break;
      const dias = porDia.length ? porDia.map((d) => DIA_SEMANA[d.slice(-2)]!) : [new Date(`${inicio}Z`).getUTCDay()];
      for (const d of [...dias].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) agregar(conFecha(inicio, sumarDias(lunes, (d + 6) % 7).slice(0, 10)));
      continue;
    }
    if (freq === 'MONTHLY' || freq === 'YEARLY') {
      const meses = freq === 'MONTHLY' ? k * intervalo : k * 12 * intervalo;
      const y = y0 + Math.floor((m0 - 1 + meses) / 12), m = ((m0 - 1 + meses) % 12) + 1;
      const base = `${y}-${String(m).padStart(2, '0')}`;
      if (`${base}-01` > limite.slice(0, 10)) break;
      const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const candidatos: number[] = [];
      if (porDia.length && freq === 'MONTHLY') {
        for (const d of porDia) {
          const ord = parseInt(d, 10), dow = DIA_SEMANA[d.slice(-2)]!;
          const dias = Array.from({ length: ultimo }, (_, i) => i + 1).filter((n) => new Date(Date.UTC(y, m - 1, n)).getUTCDay() === dow);
          if (Number.isNaN(ord)) candidatos.push(...dias); else { const n = ord > 0 ? dias[ord - 1] : dias[dias.length + ord]; if (n) candidatos.push(n); }
        }
      } else {
        for (const v of (r.BYMONTHDAY ?? String(d0)).split(',').map(Number)) { const n = v > 0 ? v : ultimo + v + 1; if (n >= 1 && n <= ultimo) candidatos.push(n); }
      }
      for (const n of candidatos.sort((a, b) => a - b)) agregar(conFecha(inicio, `${base}-${String(n).padStart(2, '0')}`));
      continue;
    }
    agregar(inicio);
    break;
  }
  return salida;
};
// UNTIL viene en UTC; se compara en la zona del evento.
const utcASantiagoEnZona = (paredUtc: string, zona: string) => {
  const t = Date.parse(`${paredUtc}Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zona === 'UTC' ? 'UTC' : zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

/** Reuniones con hora dentro de [desde, hasta] (horas de pared de Santiago). */
export const leerIcal = (contenido: string, desde: string, hasta: string): ReunionIcal[] => {
  const eventos: Prop[][] = [];
  let actual: Prop[] | null = null;
  for (const linea of desdobla(contenido)) {
    if (/^BEGIN:VEVENT$/i.test(linea)) actual = [];
    else if (/^END:VEVENT$/i.test(linea)) { if (actual) eventos.push(actual); actual = null; }
    else if (actual) { const p = propiedad(linea); if (p) actual.push(p); }
  }
  const uno = (ev: Prop[], n: string) => ev.find((p) => p.nombre === n);
  const excepciones = new Map<string, Prop[]>();
  for (const ev of eventos) {
    const rid = uno(ev, 'RECURRENCE-ID');
    if (rid) { const f = fecha(rid); if (f && !f.todoElDia) excepciones.set(`${uno(ev, 'UID')?.valor}|${aSantiago(f.pared, f.zona)}`, ev); }
  }
  const salida: ReunionIcal[] = [];
  const agregar = (ev: Prop[], uid: string, inicioSantiago: string, finSantiago: string) => {
    if (uno(ev, 'STATUS')?.valor.toUpperCase() === 'CANCELLED' || uno(ev, 'TRANSP')?.valor.toUpperCase() === 'TRANSPARENT') return;
    const ini = inicioSantiago.slice(0, 16), fin = finSantiago.slice(0, 16);
    if (fin <= ini || fin < desde || ini > hasta) return;
    salida.push({ id: `${uid}@${ini}`, titulo: texto(uno(ev, 'SUMMARY')?.valor ?? 'Reunión') || 'Reunión', inicio: ini, fin });
  };
  for (const ev of eventos) {
    if (uno(ev, 'RECURRENCE-ID')) continue;
    const uid = uno(ev, 'UID')?.valor ?? '';
    const ini = uno(ev, 'DTSTART') ? fecha(uno(ev, 'DTSTART')!) : null;
    if (!ini || ini.todoElDia) continue;
    const pFin = uno(ev, 'DTEND') ? fecha(uno(ev, 'DTEND')!) : null;
    const largo = pFin && !pFin.todoElDia
      ? (pFin.zona === 'UTC' ? Date.parse(`${pFin.pared}Z`) : zonaAUtc(pFin.pared, pFin.zona)) - (ini.zona === 'UTC' ? Date.parse(`${ini.pared}Z`) : zonaAUtc(ini.pared, ini.zona))
      : duracion(uno(ev, 'DURATION')?.valor ?? 'PT0S');
    const regla = uno(ev, 'RRULE')?.valor;
    const ocurrencias = regla ? expandir(ini.pared, regla, `${hasta.slice(0, 10)}T23:59:59`, ini.zona) : [ini.pared];
    const excluidas = new Set(ev.filter((p) => p.nombre === 'EXDATE').flatMap((p) => p.valor.split(',').map((v) => {
      const f = fecha({ ...p, valor: v });
      return f && !f.todoElDia ? aSantiago(f.pared, f.zona) : '';
    })));
    for (const o of ocurrencias) {
      const inicioS = aSantiago(o, ini.zona);
      if (excluidas.has(inicioS)) continue;
      const cambio = excepciones.get(`${uid}|${inicioS}`);
      if (cambio) {
        const ci = fecha(uno(cambio, 'DTSTART')!), cf = uno(cambio, 'DTEND') ? fecha(uno(cambio, 'DTEND')!) : null;
        if (ci && !ci.todoElDia) {
          const finCambio = cf && !cf.todoElDia ? aSantiago(cf.pared, cf.zona) : utcASantiago(new Date((ci.zona === 'UTC' ? Date.parse(`${ci.pared}Z`) : zonaAUtc(ci.pared, ci.zona)) + largo).toISOString());
          agregar(cambio, uid, aSantiago(ci.pared, ci.zona), finCambio);
        }
        continue;
      }
      const t = ini.zona === 'UTC' ? Date.parse(`${o}Z`) : zonaAUtc(o, ini.zona);
      agregar(ev, uid, inicioS, utcASantiago(new Date(t + largo).toISOString()));
    }
  }
  return salida.sort((a, b) => a.inicio.localeCompare(b.inicio));
};

/** Calendario iCal con los bloques de trabajo de una persona (para agregar en Google "Desde URL"). */
export const generarIcal = (nombre: string, bloques: { id: string; titulo: string; inicio: string; fin: string; enlace: string }[], ahoraUtc: string) => {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const f = (pared: string) => pared.replace(/[-:]/g, '').slice(0, 13) + '00';
  const sello = ahoraUtc.replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const doblar = (l: string) => { const out: string[] = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}`; } out.push(s); return out.join('\r\n'); };
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mesawow//Agenda//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:mesawow · ${esc(nombre)}`, `X-WR-TIMEZONE:${ZONA_HORARIA}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...bloques.flatMap((b) => [
      'BEGIN:VEVENT', `UID:${b.id}@mesawow.cl`, `DTSTAMP:${sello}`, `DTSTART;TZID=${ZONA_HORARIA}:${f(b.inicio)}`, `DTEND;TZID=${ZONA_HORARIA}:${f(b.fin)}`,
      doblar(`SUMMARY:🛠 ${esc(b.titulo)}`), doblar(`DESCRIPTION:Bloque de trabajo reservado por mesawow. ${esc(b.enlace)}`), doblar(`URL:${b.enlace}`), 'TRANSP:OPAQUE', 'END:VEVENT',
    ]),
    'END:VCALENDAR', '',
  ].join('\r\n');
};
