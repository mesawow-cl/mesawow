// Google Calendar por enlaces iCal (sin Google Cloud):
//   Google → mesawow: la "dirección secreta en formato iCal" de cada persona se lee cada 5 minutos.
//   mesawow → Google: un enlace privado con sus bloques de trabajo, que se agrega en Google "Desde URL".
import { Hono } from 'hono';
import { z } from 'zod';
import { generarIcal, leerIcal } from '../shared/dominio/ical';
import { utcASantiago } from '../shared/fechas';
import { recalcularAgenda } from './agenda';
import { ErrorApi } from './errores';
import { cifrar, descifrar } from './google';
import type { Entorno } from './identidad';
import { auditoria, cuerpo, nuevoId, sha256, tokenAleatorio } from './util';

type Fila = Record<string, any>;
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const clave = (env: Env) => (env as Env & { CLAVE_CIFRADO?: string }).CLAVE_CIFRADO || null;
const MAX_ICAL = 5 * 1024 * 1024;

const descargar = async (url: string, f: typeof fetch) => {
  const r = await f(url, { headers: { accept: 'text/calendar' }, redirect: 'follow' });
  if (!r.ok) throw new ErrorApi(400, 'ical', 'No pudimos leer ese calendario. Revisa que sea la dirección secreta en formato iCal.');
  const texto = await r.text();
  if (texto.length > MAX_ICAL || !/BEGIN:VCALENDAR/i.test(texto)) throw new ErrorApi(400, 'ical', 'Esa dirección no entrega un calendario iCal.');
  return texto;
};

/** Trae las reuniones del calendario de una persona; si cambian, recalcula la agenda. */
export const sincronizarIcal = async (db: D1Database, env: Env, personaId: string, f: typeof fetch = fetch, ahora = new Date()) => {
  const k = clave(env);
  const fila = await db.prepare('SELECT ical_cifrado FROM calendar_links WHERE person_id = ?1').bind(personaId).first<{ ical_cifrado: string | null }>();
  if (!k || !fila?.ical_cifrado) return { cambios: 0 };
  const hoy = utcASantiago(ahora.toISOString()).slice(0, 10);
  let reuniones;
  try {
    reuniones = leerIcal(await descargar(await descifrar(fila.ical_cifrado, k), f), `${sumarDias(hoy, -1)}T00:00`, `${sumarDias(hoy, 60)}T23:59`)
      .filter((r) => !r.titulo.startsWith('🛠 ')); // los bloques de mesawow no vuelven como reuniones
  } catch (e) {
    await db.prepare("UPDATE calendar_links SET status = 'No se pudo leer el calendario' WHERE person_id = ?1").bind(personaId).run();
    return { cambios: 0, error: e instanceof ErrorApi ? e.message : 'No se pudo leer el calendario.' };
  }
  const { results: previas } = await db.prepare("SELECT id, external_id, title, starts_at, ends_at FROM meetings WHERE person_id = ?1 AND source = 'google'").bind(personaId).all<Fila>();
  const sentencias: D1PreparedStatement[] = [];
  let cambios = 0;
  for (const r of reuniones) {
    const p = previas.find((x) => x.external_id === r.id);
    if (p && p.title === r.titulo && p.starts_at === r.inicio && p.ends_at === r.fin) continue;
    cambios++;
    sentencias.push(db.prepare(`INSERT INTO meetings (id, person_id, title, starts_at, ends_at, source, external_id) VALUES (?1, ?2, ?3, ?4, ?5, 'google', ?6)
        ON CONFLICT(person_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at`)
      .bind(p?.id ?? nuevoId(), personaId, r.titulo, r.inicio, r.fin, r.id));
  }
  const vigentes = new Set(reuniones.map((r) => r.id));
  for (const p of previas) if (!vigentes.has(p.external_id) && p.ends_at >= `${hoy}T00:00`) { cambios++; sentencias.push(db.prepare('DELETE FROM meetings WHERE id = ?1').bind(p.id)); }
  sentencias.push(db.prepare("UPDATE calendar_links SET status = 'Conectado por iCal', sync_cursor = ?2 WHERE person_id = ?1").bind(personaId, ahora.toISOString()));
  await db.batch(sentencias);
  if (cambios) await recalcularAgenda(db, 'Cambio en Google Calendar', null, ahora);
  return { cambios, reuniones: reuniones.length };
};

export const sincronizarIcalTodos = async (db: D1Database, env: Env) => {
  const { results } = await db.prepare('SELECT person_id FROM calendar_links WHERE ical_cifrado IS NOT NULL').all<{ person_id: string }>();
  for (const r of results) await sincronizarIcal(db, env, r.person_id).catch((e) => console.error('ical', r.person_id, e));
};

// ─────────────────────────────── rutas con sesión

export const ical = new Hono<Entorno>();

ical.get('/ical/estado', async (c) => {
  const r = await c.env.DB.prepare('SELECT status, sync_cursor, ical_cifrado IS NOT NULL AS fuente, enlace_hash IS NOT NULL AS enlace FROM calendar_links WHERE person_id = ?1')
    .bind(c.get('actor').id).first<Fila>();
  return c.json({ disponible: !!clave(c.env), fuente: !!r?.fuente, enlace: !!r?.enlace, estado: r?.status ?? 'Sin conexión Google', ultimaSincronizacion: r?.sync_cursor ?? null });
});

ical.put('/ical/fuente', async (c) => {
  const k = clave(c.env);
  if (!k) throw new ErrorApi(503, 'sin_clave', 'Falta configurar la clave de cifrado de mesawow.');
  const { url } = await cuerpo(c, z.object({ url: z.string().trim().regex(/^https:\/\/\S+$/, 'Pega la dirección completa, que empieza con https://.') }));
  const id = c.get('actor').id;
  await descargar(url, fetch); // valida que sea un calendario antes de guardarlo
  const db = c.env.DB;
  await db.batch([
    db.prepare(`INSERT INTO calendar_links (person_id, calendar_id, status, ical_cifrado) VALUES (?1, 'ical', 'Conectado por iCal', ?2)
        ON CONFLICT(person_id) DO UPDATE SET ical_cifrado = excluded.ical_cifrado, status = 'Conectado por iCal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(id, await cifrar(url, k)),
    auditoria(db, id, 'Google Calendar conectado por iCal', 'person', id),
  ]);
  return c.json(await sincronizarIcal(db, c.env, id));
});

ical.delete('/ical/fuente', async (c) => {
  const db = c.env.DB;
  const id = c.get('actor').id;
  await db.batch([
    db.prepare("UPDATE calendar_links SET ical_cifrado = NULL, status = 'Sin conexión Google' WHERE person_id = ?1").bind(id),
    db.prepare("DELETE FROM meetings WHERE person_id = ?1 AND source = 'google'").bind(id),
  ]);
  await recalcularAgenda(db, 'Google Calendar desconectado', id);
  return c.json({ ok: true });
});

ical.post('/ical/sincronizar', async (c) => c.json(await sincronizarIcal(c.env.DB, c.env, c.get('actor').id)));

/** Crea (o renueva, invalidando el anterior) el enlace privado con los bloques de trabajo. */
ical.post('/ical/enlace', async (c) => {
  const id = c.get('actor').id;
  const token = tokenAleatorio();
  await c.env.DB.prepare(`INSERT INTO calendar_links (person_id, status, enlace_hash) VALUES (?1, 'Sin conexión Google', ?2)
      ON CONFLICT(person_id) DO UPDATE SET enlace_hash = excluded.enlace_hash`).bind(id, await sha256(token)).run();
  return c.json({ url: `${c.env.APP_URL}/api/v1/ical/feed/${token}.ics` });
});

// ─────────────────────────────── enlace privado (sin sesión: lo lee Google)

export const icalPublico = new Hono<Entorno>();
icalPublico.get('/ical/feed/:archivo', async (c) => {
  const token = c.req.param('archivo').replace(/\.ics$/, '');
  const db = c.env.DB;
  const p = await db.prepare('SELECT p.id, p.name FROM calendar_links l JOIN people p ON p.id = l.person_id WHERE l.enlace_hash = ?1 AND p.active = 1')
    .bind(await sha256(token)).first<{ id: string; name: string }>();
  if (!p) return c.text('No encontrado', 404);
  const hoy = utcASantiago(new Date().toISOString()).slice(0, 10);
  const { results } = await db.prepare(`SELECT w.id, w.starts_at, w.ends_at, w.task_id, t.title FROM work_blocks w JOIN tasks t ON t.id = w.task_id
      WHERE w.person_id = ?1 AND w.starts_at >= ?2 AND w.starts_at <= ?3 ORDER BY w.starts_at`).bind(p.id, `${sumarDias(hoy, -14)}T00:00`, `${sumarDias(hoy, 60)}T23:59`).all<Fila>();
  const ics = generarIcal(p.name, results.map((b) => ({ id: b.id, titulo: b.title, inicio: b.starts_at, fin: b.ends_at, enlace: `${c.env.APP_URL}/encargos?tarea=${b.task_id}` })), new Date().toISOString());
  return new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=900' } });
});
