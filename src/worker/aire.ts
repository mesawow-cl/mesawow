// Mesa al aire (§4.19, §5.6) y automatizaciones A1, A4, A5 y A6.
import { Hono } from 'hono';
import { z } from 'zod';
import { CANALES_AL_AIRE, DIAS_REVISION_AIRE, esCanalDeAnuncios, tareaHecha } from '../shared/constantes';
import { estadoPieza, horasDeSeries, piezasDeSerie, plazoPropuesto, validarSerie, type Serie } from '../shared/dominio/aire';
import { hoySantiago, santiagoAUtc, utcASantiago } from '../shared/fechas';
import { asegurarPlanDeTarea } from './agenda';
import { ErrorApi } from './errores';
import { exigir, type Entorno } from './identidad';
import { entrarSolaAlSprint } from './sprints';
import { cargarTarea, filtroVisible, puedeVer } from './tareas';
import { auditoria, cuerpo, nuevoId } from './util';

type Fila = Record<string, any>;
const PARED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const aire = new Hono<Entorno>();

const esquemaSerie = z.object({
  id: z.string().optional(), name: z.string().trim().max(60).default('Pieza'), channel: z.enum(CANALES_AL_AIRE), mode: z.enum(['dias', 'periodo']),
  days: z.array(z.string().regex(/^[0-6]$/)).default([]), time: z.string().regex(/^\d{2}:\d{2}$/).default('10:00'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), weeks: z.number().int().min(1).max(52), count: z.number().int().min(1).max(50).nullable().optional(),
  hours: z.number().min(0).max(40).multipleOf(0.25),
});

aire.put('/tareas/:id/aire', async (c) => {
  exigir(c, 'coordina', 'Las salidas al aire las programa coordinación.');
  const d = await cuerpo(c, z.object({
    activo: z.boolean(), reservar: z.boolean().default(true), series: z.array(esquemaSerie).max(20).default([]),
    sueltas: z.array(z.object({ id: z.string().optional(), channel: z.enum(CANALES_AL_AIRE), at: z.string().regex(PARED, 'Indica fecha y hora de la salida.') })).max(50).default([]),
  }));
  const db = c.env.DB;
  const t = await cargarTarea(db, c.req.param('id'));
  if (!t || !puedeVer(t, c.get('persona'))) throw new ErrorApi(404, 'no_encontrado', 'Esa tarea no existe.');
  const a = c.get('actor');
  const series: Serie[] = d.activo ? d.series.map((s) => ({ ...s, mode: esCanalDeAnuncios(s.channel) ? 'periodo' : 'dias', count: s.count ?? 3 })) : [];
  const sueltas = d.activo ? d.sueltas : [];
  if (d.activo && !series.length && !sueltas.length) throw new ErrorApi(400, 'datos_invalidos', 'Agrega una serie o una salida suelta, o desmarca la salida al aire.');
  for (const s of series) { const e = validarSerie(s); if (e) throw new ErrorApi(400, 'datos_invalidos', e); }

  // Piezas nuevas; las existentes conservan su estado, enlace y aviso de riesgo (corrección al prototipo).
  const { results: actuales } = await db.prepare('SELECT * FROM air_slots WHERE task_id = ?1').bind(t.fila.id).all<Fila>();
  const sentencias: D1PreparedStatement[] = [db.prepare('DELETE FROM air_series WHERE task_id = ?1').bind(t.fila.id)];
  const conservadas = new Set<string>();
  const piezas: { id: string; serie: string | null; channel: string; piece: string; at: string; end: string | null }[] = [];
  for (const s of series) {
    const serieId = s.id ?? nuevoId();
    sentencias.push(db.prepare(`INSERT INTO air_series (id, task_id, name, channel, mode, days, time, from_date, weeks, count, hours) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
      .bind(serieId, t.fila.id, s.name || 'Pieza', s.channel, s.mode, s.days.join(','), s.time, s.from, s.weeks, s.mode === 'periodo' ? s.count : null, s.hours));
    for (const p of piezasDeSerie(s)) {
      const previa = actuales.find((x) => !conservadas.has(x.id) && x.series_id && x.channel === s.channel && x.piece === p.piece && x.at === p.at);
      const id = previa?.id ?? nuevoId();
      if (previa) conservadas.add(id);
      piezas.push({ id, serie: serieId, channel: s.channel, piece: p.piece, at: p.at, end: p.end });
    }
  }
  for (const s of sueltas) {
    const previa = actuales.find((x) => !conservadas.has(x.id) && !x.series_id && x.channel === s.channel && (x.id === s.id || x.at === s.at));
    const id = previa?.id ?? nuevoId();
    if (previa) conservadas.add(id);
    piezas.push({ id, serie: null, channel: s.channel, piece: '', at: s.at, end: null });
  }
  sentencias.push(...actuales.filter((x) => !conservadas.has(x.id)).map((x) => db.prepare('DELETE FROM air_slots WHERE id = ?1').bind(x.id)));
  for (const p of piezas) {
    sentencias.push(db.prepare(`INSERT INTO air_slots (id, task_id, series_id, channel, piece, at, end_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(id) DO UPDATE SET series_id = excluded.series_id, channel = excluded.channel, piece = excluded.piece, at = excluded.at, end_date = excluded.end_date,
        risk_notified_at = CASE WHEN air_slots.at = excluded.at THEN air_slots.risk_notified_at ELSE NULL END`)
      .bind(p.id, t.fila.id, p.serie, p.channel, p.piece, p.at, p.end));
  }
  // A1: el plazo de trabajo nunca queda después de la primera salida; se propone con 2 días de revisión.
  const primera = piezas.map((p) => p.at).sort()[0];
  let plazo = t.fila.due as string, inicio = t.fila.start_date as string, plazoAjustado = false;
  if (primera && plazo > primera.slice(0, 10)) {
    plazo = plazoPropuesto(primera, hoySantiago());
    if (inicio > plazo) inicio = plazo;
    plazoAjustado = true;
  }
  const horas = horasDeSeries(series);
  sentencias.push(
    db.prepare(`UPDATE tasks SET due = ?2, start_date = ?3, air_book = ?4, estimated_hours = CASE WHEN ?5 > 0 THEN ?5 ELSE estimated_hours END,
                version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`).bind(t.fila.id, plazo, inicio, d.reservar ? 1 : 0, horas),
    auditoria(db, a.id, `Salida al aire programada ${t.fila.title} · ${[...new Set(piezas.map((p) => p.channel))].join(', ')} · ${piezas.length} pieza(s)`, 'task', t.fila.id),
  );
  await db.batch(sentencias);
  const cambios = await asegurarPlanDeTarea(db, t.fila.id, a.id).catch((e) => { if (e instanceof ErrorApi) return []; throw e; });
  const sprint = await entrarSolaAlSprint(db, t.fila.id);
  const fin = (await db.prepare('SELECT planned_finish FROM tasks WHERE id = ?1').bind(t.fila.id).first<{ planned_finish: string | null }>())?.planned_finish;
  const margen = primera ? (Date.parse(`${primera.slice(0, 10)}T12:00:00Z`) - Date.parse(`${plazo}T12:00:00Z`)) / 86_400_000 : null;
  return c.json({
    piezas: piezas.length, horas, plazo, plazoAjustado, cambios, sprint,
    avisos: [
      ...(margen !== null && margen < DIAS_REVISION_AIRE ? [`Te recomendamos dejar al menos ${DIAS_REVISION_AIRE} días de revisión antes de la primera salida.`] : []),
      ...(fin && primera && fin > primera ? [`Ojo: con las horas reservadas, el trabajo terminaría el ${fin.replace('T', ' ')}, después de la primera salida.`] : []),
    ],
  });
});

aire.get('/tareas/:id/aire', async (c) => {
  const db = c.env.DB;
  const t = await cargarTarea(db, c.req.param('id'));
  if (!t || !puedeVer(t, c.get('persona'))) throw new ErrorApi(404, 'no_encontrado', 'Esa tarea no existe.');
  const [series, piezas] = await db.batch<Fila>([
    db.prepare('SELECT * FROM air_series WHERE task_id = ?1').bind(t.fila.id),
    db.prepare('SELECT * FROM air_slots WHERE task_id = ?1 ORDER BY at').bind(t.fila.id),
  ]);
  const ahora = utcASantiago(new Date().toISOString());
  return c.json({
    reservar: !!t.fila.air_book,
    series: series!.results.map((s) => ({ ...s, days: s.days ? s.days.split(',') : [], from: s.from_date })),
    piezas: piezas!.results.map((p) => ({ ...p, estado: estadoPieza(p as never, { hecha: tareaHecha(t.status), plazo: t.fila.due }, ahora) })),
  });
});

aire.get('/aire', async (c) => {
  const db = c.env.DB;
  await procesarAire(db);
  const p = c.get('persona');
  const v = filtroVisible(p);
  const q = c.req.query();
  const desde = q.desde ?? '0000-01-01', hasta = q.hasta ?? '9999-12-31';
  const params: unknown[] = [...v.params, `${desde}T00:00`, `${hasta}T23:59`];
  let extra = '';
  if (q.canal) { params.push(q.canal); extra += ` AND s.channel = ?${params.length}`; }
  if (q.persona) { params.push(q.persona); extra += ` AND t.owner_id = ?${params.length}`; }
  const { results } = await db.prepare(`
    SELECT s.id, s.task_id, s.channel, s.piece, s.at, s.end_date, s.status, s.url, s.auto, s.published_at,
           t.title, t.status AS estado_tarea, t.due, t.owner_id, o.name AS responsable, b.name AS marca, b.color, m.name AS mesa
      FROM air_slots s JOIN tasks t ON t.id = s.task_id JOIN brands b ON b.id = t.brand_id
      LEFT JOIN people o ON o.id = t.owner_id LEFT JOIN mesas m ON m.id = t.mesa_id
     WHERE ${v.sql} AND (s.at BETWEEN ?${v.params.length + 1} AND ?${v.params.length + 2} OR (s.end_date IS NOT NULL AND s.end_date >= substr(?${v.params.length + 1}, 1, 10) AND s.at <= ?${v.params.length + 2}))${extra}
     ORDER BY s.at`).bind(...params).all<Fila>();
  const ahora = utcASantiago(new Date().toISOString());
  const hoy = ahora.slice(0, 10);
  const piezas: Fila[] = results.map((s) => ({ ...s, estado: estadoPieza(s as never, { hecha: tareaHecha(s.estado_tarea), plazo: s.due }, ahora) }));
  const marcas = p.permisos.esAdmin ? null : p.marcas;
  const { results: campanas } = await db.prepare(`SELECT c.id, c.name, c.type, c.live_start, c.live_end, c.event_date, c.event_time, b.name AS marca, b.color
      FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE ((c.live_end IS NOT NULL AND c.live_end >= ?1) OR (c.event_date IS NOT NULL AND c.event_date >= ?1))
      ${marcas ? `AND c.brand_id IN (${marcas.map((_, i) => `?${i + 2}`).join(',') || "''"})` : ''} ORDER BY coalesce(c.live_start, c.event_date)`).bind(hoy, ...(marcas ?? [])).all();
  const semana = sumarDias(hoy, 7);
  return c.json({
    piezas, campanas,
    stats: {
      estaSemana: piezas.filter((x) => x.estado !== 'Al aire' && x.at.slice(0, 10) <= semana && x.at.slice(0, 10) >= hoy).length,
      listas: piezas.filter((x) => x.estado === 'Lista para salir').length,
      riesgo: piezas.filter((x) => x.estado === 'En riesgo' || x.estado === 'Atrasada').length,
      alAire: piezas.filter((x) => x.estado === 'Al aire').length,
    },
  });
});

aire.post('/aire/:id/publicar', async (c) => {
  const { url } = await cuerpo(c, z.object({ url: z.union([z.literal(''), z.string().regex(/^https?:\/\/\S+$/, 'El enlace debe empezar con http:// o https://.')]).default('') }));
  const db = c.env.DB;
  const s = await db.prepare('SELECT * FROM air_slots WHERE id = ?1').bind(c.req.param('id')).first<Fila>();
  const t = s ? await cargarTarea(db, s.task_id) : null;
  if (!s || !t || !puedeVer(t, c.get('persona'))) throw new ErrorApi(404, 'no_encontrado', 'Esa pieza no existe.');
  const a = c.get('actor');
  if (a.permisos.soloLectura || (!a.permisos.coordina && t.owner_id !== a.id)) throw new ErrorApi(403, 'sin_permiso', 'Solo coordinación o la persona responsable marcan piezas al aire.');
  if (!tareaHecha(t.status)) throw new ErrorApi(409, 'sin_aprobar', 'Primero la tarea debe estar aprobada en su mesa de trabajo.');
  if (s.status === 'Al aire') throw new ErrorApi(409, 'ya_al_aire', 'Esa pieza ya salió al aire.');
  const sentencias = [
    db.prepare("UPDATE air_slots SET status = 'Al aire', published_at = ?2, url = ?3, published_by = ?4 WHERE id = ?1").bind(s.id, new Date().toISOString(), url || null, a.id),
    auditoria(db, a.id, `Salió al aire ${t.fila.title} en ${s.channel}`, 'task', t.fila.id),
  ];
  // A6: una pieza con enlace verifica el lanzamiento de su campaña.
  if (url && t.fila.campaign_id) {
    sentencias.push(db.prepare('UPDATE campaigns SET launched_at = ?2, launch_evidence = ?3 WHERE id = ?1 AND launched_at IS NULL')
      .bind(t.fila.campaign_id, hoySantiago(), `${s.piece || t.fila.title} en ${s.channel}: ${url}`));
  }
  await db.batch(sentencias);
  return c.json({ ok: true });
});

/**
 * A4: las piezas de tareas aprobadas pasan solas a "Al aire" al llegar su hora.
 * A5: una pieza que sale en 2 días o menos con la tarea sin aprobar avisa una sola vez (por pieza y fecha)
 * a responsable, revisión y aprobación. Idempotente: se puede ejecutar cuantas veces se quiera.
 */
export const procesarAire = async (db: D1Database, ahora = new Date()) => {
  const pared = utcASantiago(ahora.toISOString());
  const limite = `${sumarDias(pared.slice(0, 10), DIAS_REVISION_AIRE)}T23:59`;
  const [salen, riesgo] = await db.batch<Fila>([
    db.prepare(`SELECT s.id, s.at FROM air_slots s JOIN tasks t ON t.id = s.task_id WHERE s.status = 'Programada' AND s.at <= ?1 AND t.status IN ('Aprobada','Completada')`).bind(pared),
    db.prepare(`SELECT s.id, s.at, s.task_id, t.title, t.owner_id, t.reviewer_id FROM air_slots s JOIN tasks t ON t.id = s.task_id
                 WHERE s.status = 'Programada' AND s.risk_notified_at IS NULL AND s.at <= ?1 AND t.status NOT IN ('Aprobada','Completada')`).bind(limite),
  ]);
  const sentencias: D1PreparedStatement[] = salen!.results.map((s) =>
    db.prepare("UPDATE air_slots SET status = 'Al aire', auto = 1, published_at = ?2 WHERE id = ?1 AND status = 'Programada'").bind(s.id, santiagoAUtc(s.at)));
  const porTarea = new Map<string, Fila[]>();
  for (const r of riesgo!.results) porTarea.set(r.task_id, [...(porTarea.get(r.task_id) ?? []), r]);
  for (const [tareaId, piezas] of porTarea) {
    const t = piezas[0]!;
    const { results: aprueban } = await db.prepare("SELECT person_id FROM task_people WHERE task_id = ?1 AND role = 'approver'").bind(tareaId).all<{ person_id: string }>();
    const primera = piezas.map((p) => p.at).sort()[0]!;
    const destinatarios = [...new Set([t.owner_id, t.reviewer_id, ...aprueban.map((x) => x.person_id)].filter((x): x is string => !!x))];
    sentencias.push(
      ...piezas.map((p) => db.prepare('UPDATE air_slots SET risk_notified_at = ?2 WHERE id = ?1 AND risk_notified_at IS NULL').bind(p.id, ahora.toISOString())),
      ...destinatarios.map((persona) => db.prepare(`INSERT INTO outbox (id, dedupe_key, event_id, person_id, channel, event, task_id, payload)
          VALUES (?1, ?2, ?3, ?4, 'app', 'Salida al aire en riesgo', ?5, ?6) ON CONFLICT(dedupe_key) DO NOTHING`)
        .bind(nuevoId(), `riesgo:${tareaId}:${piezas.map((p) => `${p.id}@${p.at}`).sort().join('|')}:${persona}`, `riesgo:${tareaId}`, persona, tareaId,
          JSON.stringify({ piezas: piezas.length, desde: primera, mensaje: `${piezas.length} pieza(s) desde el ${primera.replace('T', ' ')} y la tarea aún no está aprobada` }))),
      auditoria(db, null, `Aviso automático: ${t.title} en riesgo de no salir al aire`, 'task', tareaId),
    );
  }
  if (sentencias.length) await db.batch(sentencias);
  return { alAire: salen!.results.length, avisos: porTarea.size };
};
