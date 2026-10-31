// Agenda: Mi mesa, reuniones, planes de trabajo, feriados y recálculo (§4.6, §5.4, D3, D6).
import { Hono } from 'hono';
import { z } from 'zod';
import { JORNADA_POR_DEFECTO } from '../shared/constantes';
import { aMinuto, aPared, CicloDePlanificacion, recalcular, SinDisponibilidad, type ConfigJornada, type Rango } from '../shared/dominio/agenda';
import { utcASantiago } from '../shared/fechas';
import { encolarAvisos } from './avisos';
import { ErrorApi } from './errores';
import { exigir, type Ctx, type Entorno } from './identidad';
import { auditoria, cuerpo, nuevoId } from './util';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PARED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const configJornada = async (db: D1Database): Promise<ConfigJornada> => {
  const [ajustes, feriados] = await db.batch([
    db.prepare("SELECT key, value FROM settings WHERE key IN ('jornada','dias_laborales')"),
    db.prepare('SELECT date FROM holidays'),
  ]);
  const a = Object.fromEntries((ajustes!.results as { key: string; value: string }[]).map((r) => [r.key, JSON.parse(r.value)]));
  return {
    ventanas: a.jornada ?? JORNADA_POR_DEFECTO,
    dias: a.dias_laborales ?? [1, 2, 3, 4, 5],
    feriados: new Set((feriados!.results as { date: string }[]).map((r) => r.date)),
  };
};

export interface CambioDeTermino { tarea: string; titulo: string; antes: string; ahora: string }

/**
 * Recalcula todos los planes de tareas no terminadas y guarda bloques y términos.
 * Cuando un término se mueve más tarde, lo registra y avisa a responsable, involucrados y director de la marca.
 */
export const recalcularAgenda = async (db: D1Database, causa: string, actorId: string | null, ahora = new Date()): Promise<CambioDeTermino[]> => {
  const ya = aMinuto(utcASantiago(ahora.toISOString()));
  const [planes, deps, reuniones, bloquesActuales] = await db.batch([
    db.prepare(`SELECT wp.task_id, wp.person_id, wp.starts_at, wp.hours, wp.finish, t.title, t.brand_id, t.owner_id, t.reviewer_id, b.director_id
                  FROM work_plans wp JOIN tasks t ON t.id = wp.task_id JOIN brands b ON b.id = t.brand_id
                 WHERE t.status NOT IN ('Aprobada','Completada')`),
    db.prepare('SELECT task_id, depends_on_id FROM task_dependencies'),
    db.prepare('SELECT person_id, starts_at, ends_at FROM meetings'),
    db.prepare('SELECT task_id, starts_at, ends_at FROM work_blocks WHERE starts_at < ?1').bind(aPared(ya)),
  ]);
  const filas = planes!.results as Record<string, any>[];
  if (!filas.length) return [];
  const cfg = await configJornada(db);
  const mapaDeps = new Map<string, string[]>();
  for (const d of deps!.results as { task_id: string; depends_on_id: string }[]) mapaDeps.set(d.task_id, [...(mapaDeps.get(d.task_id) ?? []), d.depends_on_id]);
  const mapaReuniones = new Map<string, Rango[]>();
  for (const r of reuniones!.results as { person_id: string; starts_at: string; ends_at: string }[]) {
    mapaReuniones.set(r.person_id, [...(mapaReuniones.get(r.person_id) ?? []), { inicio: aMinuto(r.starts_at), fin: aMinuto(r.ends_at) }]);
  }
  // Lo ya transcurrido queda fijo (se corta en "ahora"); solo se reubica lo que falta, desde ahora.
  const fijos = new Map<string, Rango[]>();
  for (const b of bloquesActuales!.results as { task_id: string; starts_at: string; ends_at: string }[]) {
    const r = { inicio: aMinuto(b.starts_at), fin: Math.min(aMinuto(b.ends_at), ya) };
    if (r.fin > r.inicio) fijos.set(b.task_id, [...(fijos.get(b.task_id) ?? []), r].sort((x, y) => x.inicio - y.inicio));
  }
  let resultado;
  try {
    resultado = recalcular(
      filas.map((p) => ({
        tarea: p.task_id, persona: p.person_id, inicio: Math.max(aMinuto(p.starts_at), ya), minutos: Math.round(p.hours * 60),
        finAnterior: p.finish ? aMinuto(p.finish) : null, fijos: fijos.get(p.task_id) ?? [],
      })),
      mapaDeps, mapaReuniones, cfg,
    );
  } catch (e) {
    if (e instanceof CicloDePlanificacion || e instanceof SinDisponibilidad) throw new ErrorApi(409, 'agenda', e.message);
    throw e;
  }
  const sentencias: D1PreparedStatement[] = [];
  const cambios: CambioDeTermino[] = [];
  const marca = ahora.toISOString();
  for (const p of filas) {
    const r = resultado.get(p.task_id)!;
    const fin = aPared(r.fin);
    sentencias.push(
      db.prepare('DELETE FROM work_blocks WHERE task_id = ?1').bind(p.task_id),
      ...r.bloques.map((b) => db.prepare('INSERT INTO work_blocks (id, task_id, person_id, starts_at, ends_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(nuevoId(), p.task_id, p.person_id, aPared(b.inicio), aPared(b.fin))),
    );
    if (fin !== p.finish) {
      sentencias.push(
        db.prepare('UPDATE work_plans SET finish = ?2 WHERE task_id = ?1').bind(p.task_id, fin),
        db.prepare('UPDATE tasks SET planned_finish = ?2 WHERE id = ?1').bind(p.task_id, fin),
      );
    }
    if (p.finish && fin > p.finish) {
      cambios.push({ tarea: p.task_id, titulo: p.title, antes: p.finish, ahora: fin });
      sentencias.push(db.prepare('INSERT INTO plan_changes (id, task_id, old_finish, new_finish, delay_minutes, cause, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(nuevoId(), p.task_id, p.finish, fin, aMinuto(fin) - aMinuto(p.finish), causa, marca));
    }
  }
  for (const ch of cambios) {
    const p = filas.find((x) => x.task_id === ch.tarea)!;
    const { results: gente } = await db.prepare('SELECT person_id FROM task_people WHERE task_id = ?1').bind(ch.tarea).all<{ person_id: string }>();
    const destinatarios = [p.owner_id, p.reviewer_id, p.director_id, ...gente.map((g) => g.person_id)].filter((x): x is string => !!x && x !== actorId);
    sentencias.push(...encolarAvisos(db, 'Término recalculado por agenda', ch.tarea, destinatarios, { antes: ch.antes, ahora: ch.ahora, causa }));
  }
  if (sentencias.length) await db.batch(sentencias);
  return cambios;
};

/**
 * A2: las horas estimadas se reservan solas en la agenda del responsable.
 * Si la tarea no tiene responsable, horas o ya está hecha, se quita su plan.
 */
export const asegurarPlanDeTarea = async (db: D1Database, tareaId: string, actorId: string | null) => {
  const t = await db.prepare('SELECT id, owner_id, estimated_hours, start_date, status, air_book FROM tasks WHERE id = ?1').bind(tareaId)
    .first<{ id: string; owner_id: string | null; estimated_hours: number; start_date: string; status: string; air_book: number }>();
  if (!t) return [];
  const plan = await db.prepare('SELECT starts_at FROM work_plans WHERE task_id = ?1').bind(tareaId).first<{ starts_at: string }>();
  if (['Aprobada', 'Completada'].includes(t.status)) {
    // Terminada: se conserva lo trabajado y se libera lo que quedaba reservado.
    await db.prepare('DELETE FROM work_blocks WHERE task_id = ?1 AND starts_at >= ?2').bind(tareaId, utcASantiago(new Date().toISOString())).run();
    return recalcularAgenda(db, 'Tarea terminada', actorId);
  }
  const corresponde = t.owner_id && t.estimated_hours > 0 && t.air_book;
  if (!corresponde) {
    if (plan) await db.batch([db.prepare('DELETE FROM work_plans WHERE task_id = ?1').bind(tareaId), db.prepare('UPDATE tasks SET planned_finish = NULL WHERE id = ?1').bind(tareaId)]);
    return [];
  }
  const inicio = plan && plan.starts_at.slice(0, 10) === t.start_date ? plan.starts_at : `${t.start_date}T09:00`;
  await db.prepare(`INSERT INTO work_plans (task_id, person_id, starts_at, hours) VALUES (?1, ?2, ?3, ?4)
                    ON CONFLICT(task_id) DO UPDATE SET person_id = excluded.person_id, starts_at = excluded.starts_at, hours = excluded.hours`)
    .bind(tareaId, t.owner_id, inicio, t.estimated_hours).run();
  return recalcularAgenda(db, 'Horas de trabajo de la tarea', actorId);
};

// ─────────────────────────────── feriados oficiales de Chile (D3)

type Feriado = { fecha: string; nombre: string };

/** Fuente principal: api.boostr.cl (lista oficial, solo nacionales). Respaldo: date.nager.at (nacionales). */
export const descargarFeriados = async (anio: number, f: typeof fetch = fetch): Promise<Feriado[]> => {
  try {
    const r = await f(`https://api.boostr.cl/holidays/${anio}.json`, { headers: { accept: 'application/json' } });
    if (r.ok) {
      const j = (await r.json()) as { status?: string; data?: { date: string; title: string }[] };
      if (j.status === 'success' && j.data?.length) return j.data.map((x) => ({ fecha: x.date, nombre: x.title }));
    }
  } catch { /* se intenta el respaldo */ }
  const r = await f(`https://date.nager.at/api/v3/PublicHolidays/${anio}/CL`);
  if (!r.ok) throw new Error(`No se pudieron obtener los feriados de ${anio}.`);
  const j = (await r.json()) as { date: string; localName: string; global: boolean }[];
  return j.filter((x) => x.global).map((x) => ({ fecha: x.date, nombre: x.localName }));
};

export const sincronizarFeriados = async (db: D1Database, anios: number[], f: typeof fetch = fetch) => {
  let total = 0;
  for (const anio of anios) {
    const lista = (await descargarFeriados(anio, f)).filter((x) => FECHA.test(x.fecha) && x.fecha.startsWith(String(anio)));
    if (!lista.length) continue;
    total += lista.length;
    // Reemplaza los oficiales del año; los días no laborables manuales se conservan.
    await db.batch([
      db.prepare("DELETE FROM holidays WHERE source = 'oficial' AND date LIKE ?1").bind(`${anio}-%`),
      ...lista.map((x) => db.prepare("INSERT INTO holidays (date, name, source) VALUES (?1, ?2, 'oficial') ON CONFLICT(date) DO NOTHING").bind(x.fecha, x.nombre)),
    ]);
  }
  return total;
};

// ─────────────────────────────── rutas

export const agenda = new Hono<Entorno>();

/** Mi mesa es de cada persona; coordinación y dirección pueden ver la de otros (§14-P10). */
const personaDeAgenda = (c: Ctx, pedida: string | undefined) => {
  const p = c.get('persona');
  const id = pedida || p.id;
  if (id !== p.id && !p.permisos.coordinaODirige) throw new ErrorApi(403, 'sin_permiso', 'Solo puedes ver tu propia agenda.');
  return id;
};

agenda.get('/agenda', async (c) => {
  const db = c.env.DB;
  const p = c.get('persona');
  const persona = personaDeAgenda(c, c.req.query('persona'));
  const desde = c.req.query('desde') ?? '';
  const hasta = c.req.query('hasta') ?? desde;
  if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde) throw new ErrorApi(400, 'datos_invalidos', 'Indica el rango de fechas.');
  const fin = `${hasta}T23:59`;
  const [bloques, reuniones, feriados, planes, cambios] = await db.batch<Record<string, any>>([
    db.prepare(`SELECT w.task_id, w.starts_at, w.ends_at, t.title, t.due, t.status, t.brand_id, t.confidential, t.owner_id, b.color, b.name AS marca
                  FROM work_blocks w JOIN tasks t ON t.id = w.task_id JOIN brands b ON b.id = t.brand_id
                 WHERE w.person_id = ?1 AND w.ends_at > ?2 AND w.starts_at < ?3 ORDER BY w.starts_at`).bind(persona, `${desde}T00:00`, fin),
    db.prepare(`SELECT id, title, starts_at, ends_at, source FROM meetings WHERE person_id = ?1 AND ends_at > ?2 AND starts_at < ?3 ORDER BY starts_at`)
      .bind(persona, `${desde}T00:00`, fin),
    db.prepare('SELECT date, name, source FROM holidays WHERE date BETWEEN ?1 AND ?2 ORDER BY date').bind(desde, hasta),
    db.prepare(`SELECT wp.task_id, wp.starts_at, wp.hours, wp.finish, t.title, t.due, t.status, t.brand_id, t.confidential,
                       (SELECT count(*) FROM work_blocks w WHERE w.task_id = wp.task_id) AS bloques
                  FROM work_plans wp JOIN tasks t ON t.id = wp.task_id
                 WHERE wp.person_id = ?1 AND t.status NOT IN ('Aprobada','Completada') ORDER BY wp.finish`).bind(persona),
    db.prepare(`SELECT pc.task_id, pc.old_finish, pc.new_finish, pc.delay_minutes, pc.cause, pc.created_at, t.title, t.brand_id, t.confidential
                  FROM plan_changes pc JOIN tasks t ON t.id = pc.task_id
                 WHERE t.owner_id = ?1 ORDER BY pc.created_at DESC LIMIT 10`).bind(persona),
  ]);
  // Lo que quien mira no puede ver se muestra como ocupado, sin detalle.
  const oculta = (x: Record<string, any>) => persona !== p.id && !p.permisos.esAdmin && (!p.marcas.includes(x.brand_id) || x.confidential);
  const limpiar = (x: Record<string, any>) => (oculta(x) ? { ...x, title: 'Trabajo de otra marca', task_id: null } : x);
  const jornada = await configJornada(db);
  return c.json({
    persona, jornada: { ventanas: jornada.ventanas, dias: jornada.dias },
    bloques: bloques!.results.map(limpiar), reuniones: reuniones!.results, feriados: feriados!.results,
    planes: planes!.results.map(limpiar), cambios: cambios!.results.map(limpiar),
  });
});

const esquemaReunion = z.object({
  personaId: z.string().optional(),
  titulo: z.string().trim().min(2, 'Escribe el nombre de la reunión.').max(200),
  inicio: z.string().regex(PARED, 'Hora de inicio inválida.'),
  fin: z.string().regex(PARED, 'Hora de término inválida.'),
}).refine((d) => d.fin > d.inicio, { message: 'La reunión debe terminar después de empezar.' });

const puedeTocarAgendaDe = (c: Ctx, personaId: string) => {
  const a = c.get('actor');
  if (personaId !== a.id && !a.permisos.coordina) throw new ErrorApi(403, 'sin_permiso', 'Solo puedes cambiar tu propia agenda.');
};

agenda.post('/reuniones', async (c) => {
  const d = await cuerpo(c, esquemaReunion);
  const a = c.get('actor');
  const personaId = d.personaId || a.id;
  puedeTocarAgendaDe(c, personaId);
  const db = c.env.DB;
  if (!(await db.prepare('SELECT 1 FROM people WHERE id = ?1 AND active = 1').bind(personaId).first())) throw new ErrorApi(404, 'no_encontrado', 'Esa persona no existe.');
  const id = nuevoId();
  await db.batch([
    db.prepare('INSERT INTO meetings (id, person_id, title, starts_at, ends_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, personaId, d.titulo, d.inicio, d.fin),
    auditoria(db, a.id, `Reunión agendada ${d.titulo}`, 'meeting', id),
  ]);
  const cambios = await recalcularAgenda(db, `Reunión: ${d.titulo}`, a.id);
  return c.json({ id, cambios }, 201);
});

agenda.delete('/reuniones/:id', async (c) => {
  const db = c.env.DB;
  const r = await db.prepare('SELECT person_id, source FROM meetings WHERE id = ?1').bind(c.req.param('id')).first<{ person_id: string; source: string }>();
  if (!r) throw new ErrorApi(404, 'no_encontrado', 'Esa reunión no existe.');
  if (r.source === 'google') throw new ErrorApi(409, 'externa', 'Esta reunión viene de Google Calendar: cámbiala allá.');
  puedeTocarAgendaDe(c, r.person_id);
  await db.prepare('DELETE FROM meetings WHERE id = ?1').bind(c.req.param('id')).run();
  const cambios = await recalcularAgenda(db, 'Reunión eliminada', c.get('actor').id);
  return c.json({ ok: true, cambios });
});

agenda.put('/planes/:tareaId', async (c) => {
  const d = await cuerpo(c, z.object({
    inicio: z.string().regex(PARED, 'Hora de inicio inválida.'),
    horas: z.number().min(0.5, 'Reserva al menos media hora.').max(320).multipleOf(0.5),
  }));
  const db = c.env.DB;
  const a = c.get('actor');
  const t = await db.prepare('SELECT id, title, owner_id, status FROM tasks WHERE id = ?1').bind(c.req.param('tareaId')).first<{ id: string; title: string; owner_id: string | null; status: string }>();
  if (!t || !t.owner_id) throw new ErrorApi(404, 'no_encontrado', 'Esa tarea no existe o no tiene responsable.');
  if (t.owner_id !== a.id && !a.permisos.coordina) throw new ErrorApi(403, 'sin_permiso', 'Solo la persona responsable o coordinación reservan horas.');
  if (['Aprobada', 'Completada'].includes(t.status)) throw new ErrorApi(409, 'terminada', 'La tarea ya está terminada.');
  await db.batch([
    db.prepare(`INSERT INTO work_plans (task_id, person_id, starts_at, hours) VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(task_id) DO UPDATE SET starts_at = excluded.starts_at, hours = excluded.hours, person_id = excluded.person_id`)
      .bind(t.id, t.owner_id, d.inicio, d.horas),
    db.prepare('UPDATE tasks SET estimated_hours = ?2 WHERE id = ?1').bind(t.id, d.horas),
    auditoria(db, a.id, `Horas reservadas ${t.title}`, 'task', t.id, d),
  ]);
  const cambios = await recalcularAgenda(db, 'Reserva de horas', a.id);
  return c.json({ ok: true, cambios });
});

agenda.get('/feriados', async (c) => {
  const anio = c.req.query('anio') ?? new Date().getUTCFullYear().toString();
  const { results } = await c.env.DB.prepare('SELECT date, name, source FROM holidays WHERE date LIKE ?1 ORDER BY date').bind(`${anio}-%`).all();
  return c.json({ feriados: results });
});

agenda.post('/feriados', async (c) => {
  exigir(c, 'coordina', 'Los días no laborables los define coordinación.');
  const d = await cuerpo(c, z.object({ fecha: z.string().regex(FECHA, 'Fecha inválida.'), nombre: z.string().trim().min(2).max(100) }));
  const db = c.env.DB;
  await db.batch([
    db.prepare("INSERT INTO holidays (date, name, source) VALUES (?1, ?2, 'manual') ON CONFLICT(date) DO UPDATE SET name = excluded.name").bind(d.fecha, d.nombre),
    auditoria(db, c.get('actor').id, `Día no laborable ${d.fecha}`, 'holiday', d.fecha, d),
  ]);
  const cambios = await recalcularAgenda(db, `Día no laborable: ${d.nombre}`, c.get('actor').id);
  return c.json({ ok: true, cambios }, 201);
});

agenda.delete('/feriados/:fecha', async (c) => {
  exigir(c, 'coordina', 'Los días no laborables los define coordinación.');
  const r = await c.env.DB.prepare("DELETE FROM holidays WHERE date = ?1 AND source = 'manual'").bind(c.req.param('fecha')).run();
  if (!r.meta.changes) throw new ErrorApi(409, 'oficial', 'Solo se pueden quitar días no laborables manuales; los feriados oficiales se mantienen.');
  await recalcularAgenda(c.env.DB, 'Día no laborable eliminado', c.get('actor').id);
  return c.json({ ok: true });
});

agenda.post('/feriados/sincronizar', async (c) => {
  exigir(c, 'coordina', 'Solo coordinación sincroniza feriados.');
  const anio = new Date().getUTCFullYear();
  const total = await sincronizarFeriados(c.env.DB, [anio, anio + 1]);
  await recalcularAgenda(c.env.DB, 'Feriados oficiales actualizados', c.get('actor').id);
  return c.json({ ok: true, total });
});
