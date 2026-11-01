// Campana de alertas (§7.2). Las alertas se calculan al momento; en D1 solo se guarda qué leyó cada persona.
// La clave incluye la condición (plazo, versión, motivo, piezas): si cambia, vuelve a aparecer como no leída.
import { Hono } from 'hono';
import { z } from 'zod';
import { DIAS_REVISION_AIRE } from '../shared/constantes';
import { hoySantiago, utcASantiago } from '../shared/fechas';
import type { Entorno, Persona } from './identidad';
import { filtroVisible } from './tareas';
import { cuerpo } from './util';

type Fila = Record<string, any>;
export interface Alerta { clave: string; tono: 'roja' | 'ambar' | 'violeta' | 'teal' | 'verde' | 'rosa'; titulo: string; detalle: string; tareaId: string | null; destino: string | null; en: string }
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const calcularAlertas = async (db: D1Database, p: Persona, ahora = new Date()): Promise<Alerta[]> => {
  const v = filtroVisible(p, 2);
  const hoy = hoySantiago(ahora), pared = utcASantiago(ahora.toISOString());
  const hace7 = new Date(ahora.getTime() - 7 * 86_400_000).toISOString();
  const involucra = `(t.owner_id = ?1 OR t.reviewer_id = ?1 OR EXISTS (SELECT 1 FROM task_people x WHERE x.task_id = t.id AND x.person_id = ?1))`;
  const general = p.permisos.coordinaODirige ? '1 = 1' : involucra;
  const n = v.params.length + 1;
  const base = [p.id, ...v.params];
  const [mias, revisar, bloqueadas, sprint, aire, solas, nuevas, menciones] = await db.batch<Fila>([
    db.prepare(`SELECT t.id, t.title, t.due, t.status, t.version, t.updated_at FROM tasks t WHERE t.owner_id = ?1 AND ${v.sql}
                 AND (t.status = 'Ajustes solicitados' OR (t.status NOT IN ('Aprobada','Completada') AND t.due < ?${n + 1}))`).bind(...base, hoy),
    db.prepare(`SELECT t.id, t.title, t.version, t.updated_at FROM tasks t WHERE t.status = 'Entregada para revisión' AND ${v.sql}
                 AND (t.reviewer_id = ?1 OR EXISTS (SELECT 1 FROM task_people x WHERE x.task_id = t.id AND x.person_id = ?1 AND x.role = 'approver'))`).bind(...base),
    db.prepare(`SELECT t.id, t.title, t.owner_id, t.block_reason, t.updated_at FROM tasks t WHERE t.blocked = 1 AND t.status NOT IN ('Aprobada','Completada') AND ${v.sql} AND ${general}`).bind(...base),
    db.prepare(`SELECT e.task_id, e.sprint_id, e.created_at, t.title, s.name FROM task_events e JOIN tasks t ON t.id = e.task_id LEFT JOIN sprints s ON s.id = e.sprint_id
                 WHERE t.owner_id = ?1 AND e.event = 'Agregada' AND e.reason LIKE 'Automática%' AND e.created_at >= ?${n + 1} AND ${v.sql}`).bind(...base, hace7),
    db.prepare(`SELECT s.id, s.task_id, s.at, t.title FROM air_slots s JOIN tasks t ON t.id = s.task_id
                 WHERE s.status = 'Programada' AND t.status NOT IN ('Aprobada','Completada') AND s.at <= ?${n + 1} AND ${v.sql} AND ${general}`).bind(...base, `${sumarDias(hoy, DIAS_REVISION_AIRE)}T23:59`),
    db.prepare(`SELECT s.task_id, count(*) AS n, max(s.published_at) AS en, t.title FROM air_slots s JOIN tasks t ON t.id = s.task_id
                 WHERE s.auto = 1 AND s.status = 'Al aire' AND s.published_at >= ?${n + 1} AND ${v.sql} AND ${general} GROUP BY s.task_id`).bind(...base, hace7),
    db.prepare(`SELECT o.task_id, max(o.created_at) AS en, t.title FROM outbox o JOIN tasks t ON t.id = o.task_id
                 WHERE o.person_id = ?1 AND o.event = 'Nueva tarea asignada' AND o.created_at >= ?${n + 1} AND ${v.sql} GROUP BY o.task_id`).bind(...base, hace7),
    db.prepare(`SELECT m.id, m.created_at, pe.name AS de FROM mentions m LEFT JOIN people pe ON pe.id = m.from_id WHERE m.person_id = ?1 AND m.read_at IS NULL`).bind(p.id),
  ]);
  const a: Alerta[] = [];
  for (const m of menciones!.results) a.push({ clave: `m:${m.id}`, tono: 'rosa', titulo: `${m.de ?? 'Alguien'} te mencionó`, detalle: 'En un logro de la Comunidad', tareaId: null, destino: '/comunidad', en: m.created_at });
  for (const t of mias!.results) {
    if (t.status === 'Ajustes solicitados') a.push({ clave: `adj:${t.id}:${t.version}`, tono: 'ambar', titulo: 'Te pidieron ajustes', detalle: t.title, tareaId: t.id, destino: null, en: t.updated_at });
    else a.push({ clave: `late:${t.id}:${t.due}`, tono: 'roja', titulo: 'Tarea atrasada', detalle: `${t.title} · vencía el ${t.due}`, tareaId: t.id, destino: null, en: `${t.due}T12:00:00.000Z` });
  }
  for (const t of revisar!.results) a.push({ clave: `rev:${t.id}:${t.version}`, tono: 'violeta', titulo: 'Tienes una entrega para revisar', detalle: t.title, tareaId: t.id, destino: null, en: t.updated_at });
  for (const t of bloqueadas!.results) a.push({ clave: `blk:${t.id}:${t.block_reason}`, tono: 'roja', titulo: t.owner_id === p.id ? 'Tu tarea está bloqueada' : 'Tarea bloqueada', detalle: `${t.title} · ${t.block_reason}`, tareaId: t.id, destino: null, en: t.updated_at });
  for (const e of sprint!.results) a.push({ clave: `spr:${e.task_id}:${e.sprint_id}`, tono: 'teal', titulo: 'Tu tarea entró sola a un sprint', detalle: `${e.title} · ${e.name ?? ''}`, tareaId: e.task_id, destino: null, en: e.created_at });
  const porTarea = new Map<string, Fila[]>();
  for (const s of aire!.results) porTarea.set(s.task_id, [...(porTarea.get(s.task_id) ?? []), s]);
  for (const [tareaId, piezas] of porTarea) {
    const atrasada = piezas.some((s) => s.at < pared);
    a.push({ clave: `air:${tareaId}:${piezas.map((s) => s.id).sort().join(',')}`, tono: atrasada ? 'roja' : 'ambar', tareaId, destino: null,
      titulo: atrasada ? 'Piezas atrasadas: no salieron al aire' : 'Piezas en riesgo de no salir al aire', detalle: `${piezas[0]!.title} · ${piezas.length} pieza(s) y la tarea aún no está aprobada`,
      en: new Date().toISOString() });
  }
  for (const s of solas!.results) a.push({ clave: `on:${s.task_id}:${s.n}`, tono: 'verde', titulo: `Salió al aire · ${s.n} pieza(s) publicada(s) sola(s)`, detalle: s.title, tareaId: s.task_id, destino: null, en: s.en });
  for (const t of nuevas!.results) a.push({ clave: `new:${t.task_id}`, tono: 'violeta', titulo: 'Te asignaron una tarea', detalle: t.title, tareaId: t.task_id, destino: null, en: t.en });
  return a;
};

export const alertas = new Hono<Entorno>();

alertas.get('/alertas', async (c) => {
  const p = c.get('persona');
  const lista = await calcularAlertas(c.env.DB, p);
  const { results } = await c.env.DB.prepare('SELECT key FROM alerts WHERE person_id = ?1 AND read_at IS NOT NULL').bind(c.get('actor').id).all<{ key: string }>();
  const leidas = new Set(results.map((r) => r.key));
  const con = lista.map((x) => ({ ...x, leida: leidas.has(x.clave) }))
    .sort((x, y) => Number(x.leida) - Number(y.leida) || y.en.localeCompare(x.en)).slice(0, 40);
  return c.json({ alertas: con, sinLeer: lista.filter((x) => !leidas.has(x.clave)).length });
});

alertas.post('/alertas/leer', async (c) => {
  const { claves } = await cuerpo(c, z.object({ claves: z.array(z.string().max(2000)).max(200) }));
  const db = c.env.DB;
  const id = c.get('actor').id;
  const ahora = new Date().toISOString();
  if (claves.length) {
    await db.batch(claves.map((k) => db.prepare(`INSERT INTO alerts (id, person_id, key, type, title, read_at) VALUES (?1, ?2, ?3, ?4, '', ?5)
        ON CONFLICT(person_id, key) DO UPDATE SET read_at = excluded.read_at`).bind(crypto.randomUUID(), id, k, k.split(':')[0]!, ahora)));
    // Las menciones también quedan leídas en su tabla.
    const menciones = claves.filter((k) => k.startsWith('m:')).map((k) => k.slice(2));
    if (menciones.length) await db.prepare(`UPDATE mentions SET read_at = ?2 WHERE person_id = ?1 AND id IN (SELECT value FROM json_each(?3))`).bind(id, ahora, JSON.stringify(menciones)).run();
  }
  return c.json({ ok: true });
});
