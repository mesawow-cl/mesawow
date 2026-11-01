// Dos calendarios (§4.7, §4.7 bis) y Semana del equipo.
import { Hono } from 'hono';
import { HORAS_SEMANA_EQUIPO, tareaHecha } from '../shared/constantes';
import { aMinuto } from '../shared/dominio/agenda';
import { estadoPieza } from '../shared/dominio/aire';
import { hoySantiago, utcASantiago } from '../shared/fechas';
import { configJornada } from './agenda';
import { ErrorApi } from './errores';
import { exigir, type Entorno } from './identidad';
import { filtroVisible } from './tareas';

type Fila = Record<string, any>;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const calendario = new Hono<Entorno>();

calendario.get('/calendario', async (c) => {
  const p = c.get('persona');
  const { desde = '', hasta = '', persona = '' } = c.req.query();
  if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde || sumarDias(desde, 62) < hasta) throw new ErrorApi(400, 'datos_invalidos', 'Indica un rango de hasta dos meses.');
  // Todo el equipo o el calendario de otra persona: coordinación y dirección (§14-P10).
  const quien = persona || (p.permisos.coordinaODirige ? '' : p.id);
  if (quien !== p.id && !p.permisos.coordinaODirige) throw new ErrorApi(403, 'sin_permiso', 'Solo puedes ver tu propio calendario.');
  const db = c.env.DB;
  const v = filtroVisible(p);
  const n = v.params.length;
  const porPersona = (col: string) => (quien ? ` AND ${col} = ?${n + 3}` : '');
  const params = [...v.params, `${desde}T00:00`, `${hasta}T23:59`, ...(quien ? [quien] : [])];
  const [bloques, piezas, reuniones, feriados] = await db.batch<Fila>([
    db.prepare(`SELECT w.task_id, w.person_id, w.starts_at, w.ends_at, t.title, t.due, t.status, b.color, b.name AS marca, pe.name AS persona
        FROM work_blocks w JOIN tasks t ON t.id = w.task_id JOIN brands b ON b.id = t.brand_id JOIN people pe ON pe.id = w.person_id
       WHERE ${v.sql} AND w.ends_at > ?${n + 1} AND w.starts_at < ?${n + 2}${porPersona('w.person_id')} ORDER BY w.starts_at`).bind(...params),
    db.prepare(`SELECT s.id, s.task_id, s.channel, s.piece, s.at, s.end_date, s.status, t.title, t.status AS estado_tarea, t.due, b.color, b.name AS marca
        FROM air_slots s JOIN tasks t ON t.id = s.task_id JOIN brands b ON b.id = t.brand_id
       WHERE ${v.sql} AND ((s.at BETWEEN ?${n + 1} AND ?${n + 2}) OR (s.end_date IS NOT NULL AND s.end_date >= substr(?${n + 1}, 1, 10) AND s.at <= ?${n + 2}))${porPersona('t.owner_id')}
       ORDER BY s.at`).bind(...params),
    db.prepare(`SELECT id, person_id, title, starts_at, ends_at, source FROM meetings WHERE ?1 <> '' AND person_id = ?1 AND ends_at > ?2 AND starts_at < ?3 ORDER BY starts_at`)
      .bind(quien, `${desde}T00:00`, `${hasta}T23:59`),
    db.prepare('SELECT date, name FROM holidays WHERE date BETWEEN ?1 AND ?2').bind(desde, hasta),
  ]);
  const ahora = utcASantiago(new Date().toISOString());
  const jornada = await configJornada(db);
  return c.json({
    persona: quien || null, jornada: { ventanas: jornada.ventanas },
    bloques: bloques!.results, reuniones: reuniones!.results, feriados: feriados!.results,
    piezas: piezas!.results.map((s) => ({ ...s, estado: estadoPieza(s as never, { hecha: tareaHecha(s.estado_tarea), plazo: s.due }, ahora) })),
  });
});

calendario.get('/semana-equipo', async (c) => {
  exigir(c, 'coordinaODirige', 'La Semana del equipo es para coordinación y dirección.');
  const lunes = c.req.query('semana') ?? '';
  if (!FECHA.test(lunes)) throw new ErrorApi(400, 'datos_invalidos', 'Indica la semana.');
  const fin = sumarDias(lunes, 6);
  const p = c.get('persona');
  const db = c.env.DB;
  const v = filtroVisible(p);
  const n = v.params.length;
  const hoy = hoySantiago();
  const [gente, bloques, tareas, piezas] = await db.batch<Fila>([
    db.prepare(`SELECT id, name FROM people WHERE active = 1 AND role NOT IN ('Mandante','Consulta externa','Administrador técnico') ORDER BY name`),
    db.prepare(`SELECT w.person_id, w.starts_at, w.ends_at FROM work_blocks w WHERE w.ends_at > ?1 AND w.starts_at < ?2`).bind(`${lunes}T00:00`, `${fin}T23:59`),
    db.prepare(`SELECT t.id, t.title, t.owner_id, t.due, t.blocked, t.status FROM tasks t WHERE ${v.sql} AND t.status NOT IN ('Aprobada','Completada') AND t.owner_id IS NOT NULL`).bind(...v.params),
    db.prepare(`SELECT s.id, s.channel, s.piece, s.at, s.end_date, t.title, b.color FROM air_slots s JOIN tasks t ON t.id = s.task_id JOIN brands b ON b.id = t.brand_id
       WHERE ${v.sql} AND s.at BETWEEN ?${n + 1} AND ?${n + 2} ORDER BY s.at`).bind(...v.params, `${lunes}T00:00`, `${fin}T23:59`),
  ]);
  const personas = gente!.results.map((g) => {
    const horas = bloques!.results.filter((b) => b.person_id === g.id)
      .reduce((t, b) => t + (Math.min(aMinuto(b.ends_at), aMinuto(`${fin}T23:59`)) - Math.max(aMinuto(b.starts_at), aMinuto(`${lunes}T00:00`))) / 60, 0);
    const suyas = tareas!.results.filter((t) => t.owner_id === g.id);
    return {
      id: g.id, nombre: g.name, horas: Math.round(horas * 10) / 10, capacidad: HORAS_SEMANA_EQUIPO,
      abiertas: suyas.length, atrasadas: suyas.filter((t) => t.due < hoy).length, bloqueadas: suyas.filter((t) => t.blocked).length,
      tareas: suyas.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 3).map((t) => ({ id: t.id, title: t.title })),
    };
  }).sort((a, b) => b.horas - a.horas);
  return c.json({ semana: lunes, personas, alAire: piezas!.results });
});
