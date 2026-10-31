// Proyectos y campañas (§4.14, §5.3), entregables (§4.15), bases y segmentos (§4.20, §5.8).
import { Hono } from 'hono';
import { z } from 'zod';
import { analizarContactos, exportarCSV, MAX_CSV, parsearCSV, revisionDeCampana } from '../shared/dominio/contactos';
import { hoySantiago } from '../shared/fechas';
import { ErrorApi } from './errores';
import { exigir, type Ctx, type Entorno } from './identidad';
import { auditoria, cuerpo, nuevoId } from './util';

type Fila = Record<string, any>;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const URL_WEB = /^https?:\/\/\S+$/;

export const campanas = new Hono<Entorno>();

const marcasVisibles = (c: Ctx) => {
  const p = c.get('persona');
  return p.permisos.esAdmin ? null : p.marcas;
};

const cargarCampana = async (c: Ctx, id: string) => {
  const camp = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?1').bind(id).first<Fila>();
  const marcas = marcasVisibles(c);
  if (!camp || (marcas && !marcas.includes(camp.brand_id))) throw new ErrorApi(404, 'no_encontrado', 'Esa campaña no existe.');
  return camp;
};

const htmlDe = async (env: Env, clave: string | null) => (clave ? (await (await env.ARCHIVOS.get(clave))?.text()) ?? '' : '');

/** Cuenta los contactos habilitados de un segmento, sin bajas de la marca (supresión por marca). */
export const contarSegmento = async (db: D1Database, seg: { base_id: string; brand_id: string; location: string; interest: string }) =>
  (await db.prepare(`SELECT count(DISTINCT r.email) AS n FROM contact_rows r
      WHERE r.base_id = ?1 AND r.status = 'Habilitado' AND r.location LIKE ?2 AND r.interest LIKE ?3
        AND r.email NOT IN (SELECT r2.email FROM contact_rows r2 JOIN contact_bases b2 ON b2.id = r2.base_id WHERE b2.brand_id = ?4 AND r2.status = 'Baja')
        AND r.email NOT IN (SELECT email FROM suppressions WHERE brand_id = ?4)`)
    .bind(seg.base_id, `%${seg.location}%`, `%${seg.interest}%`, seg.brand_id).first<{ n: number }>())?.n ?? 0;

const revision = async (c: Ctx, camp: Fila) => {
  const db = c.env.DB;
  const seg = camp.segment_id ? await db.prepare('SELECT * FROM segments WHERE id = ?1').bind(camp.segment_id).first<Fila>() : null;
  const pend = await db.prepare("SELECT count(*) AS n FROM tasks WHERE campaign_id = ?1 AND status NOT IN ('Aprobada','Completada')").bind(camp.id).first<{ n: number }>();
  return revisionDeCampana({
    objective: camp.objective, metric: camp.metric, target: camp.target,
    segmentoContactos: seg ? await contarSegmento(db, seg as never) : 0, segmentoMismaMarca: !!seg && seg.brand_id === camp.brand_id,
    html: !!camp.html_key, subject: camp.subject, sender: camp.sender, reply_to: camp.reply_to, tareasPendientes: pend?.n ?? 0,
  });
};

campanas.get('/campanas', async (c) => {
  const marcas = marcasVisibles(c);
  const cond = marcas ? `c.brand_id IN (${marcas.map((_, i) => `?${i + 1}`).join(',') || "''"})` : '1 = 1';
  const { results } = await c.env.DB.prepare(`
    SELECT c.id, c.name, c.type, c.status, c.version, c.approved_version, c.brand_id, b.name AS marca, b.color, c.start_date, c.end_date,
           c.live_start, c.live_end, c.event_date, c.launched_at, c.html_key IS NOT NULL AS tiene_html,
           (SELECT count(*) FROM tasks t WHERE t.campaign_id = c.id) AS tareas,
           (SELECT count(*) FROM tasks t WHERE t.campaign_id = c.id AND t.status IN ('Aprobada','Completada')) AS terminadas
      FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE ${cond} ORDER BY c.updated_at DESC`).bind(...(marcas ?? [])).all();
  return c.json({ campanas: results });
});

campanas.get('/campanas/:id', async (c) => {
  const camp = await cargarCampana(c, c.req.param('id'));
  const db = c.env.DB;
  const [canales, tareas, segmento] = await db.batch<Fila>([
    db.prepare('SELECT channel FROM campaign_channels WHERE campaign_id = ?1').bind(camp.id),
    db.prepare(`SELECT t.id, t.title, t.status, t.due, o.name AS responsable FROM tasks t LEFT JOIN people o ON o.id = t.owner_id
                WHERE t.campaign_id = ?1 ORDER BY t.due, t.protocol_step, t.title`).bind(camp.id),
    db.prepare('SELECT id, name FROM segments WHERE id = ?1').bind(camp.segment_id ?? ''),
  ]);
  return c.json({
    campana: { ...camp, html: await htmlDe(c.env, camp.html_key), canales: canales!.results.map((x) => x.channel), segmento: segmento!.results[0] ?? null },
    tareas: tareas!.results,
    revision: await revision(c, camp),
  });
});

campanas.post('/campanas', async (c) => {
  exigir(c, 'coordina', 'Las campañas las crea coordinación.');
  const d = await cuerpo(c, z.object({ nombre: z.string().trim().min(3, 'Ponle nombre a la campaña.').max(200), marcaId: z.string() }));
  const a = c.get('actor');
  if (!a.permisos.esAdmin && !a.marcas.includes(d.marcaId)) throw new ErrorApi(403, 'sin_permiso', 'No tienes asignada esa marca.');
  const id = nuevoId();
  const hoy = hoySantiago();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO campaigns (id, brand_id, name, platform, start_date, end_date) VALUES (?1, ?2, ?3, 'Brevo', ?4, ?4)").bind(id, d.marcaId, d.nombre, hoy),
    auditoria(c.env.DB, a.id, `Campaña creada ${d.nombre}`, 'campaign', id),
  ]);
  return c.json({ id }, 201);
});

/** Toda edición crea una versión nueva en borrador y anula la aprobación anterior (invalidate del prototipo). */
const editar = async (c: Ctx, cambios: Record<string, unknown>, accion: string) => {
  exigir(c, 'coordina', 'Las campañas las edita coordinación.');
  const camp = await cargarCampana(c, c.req.param('id')!);
  const cols = Object.keys(cambios);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE campaigns SET ${cols.map((k, i) => `${k} = ?${i + 2}`).join(', ')}, version = version + 1, status = 'Borrador',
                      approved_version = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`).bind(camp.id, ...cols.map((k) => cambios[k])),
    auditoria(c.env.DB, c.get('actor').id, `${accion} ${camp.name}`, 'campaign', camp.id),
  ]);
  return c.json({ ok: true, version: camp.version + 1 });
};

campanas.patch('/campanas/:id/brief', async (c) => {
  const d = await cuerpo(c, z.object({
    nombre: z.string().trim().min(3).max(200), objetivo: z.string().trim().min(1, 'Escribe el objetivo.').max(1000),
    indicador: z.string().trim().max(300).default(''), meta: z.string().trim().max(300).default(''), presupuesto: z.number().min(0).nullable().default(null),
    plataforma: z.string().trim().max(100).default(''), inicio: z.string().regex(FECHA), fin: z.string().regex(FECHA),
    publico: z.string().trim().max(1000).default(''), notas: z.string().trim().max(3000).default(''),
  }).refine((x) => x.inicio <= x.fin, { message: 'Revisa las fechas de la campaña.' }));
  return editar(c, { name: d.nombre, objective: d.objetivo, metric: d.indicador, target: d.meta, budget: d.presupuesto, platform: d.plataforma,
    start_date: d.inicio, end_date: d.fin, audience: d.publico, notes: d.notas }, 'Brief actualizado');
});

campanas.patch('/campanas/:id/contenido', async (c) => {
  const d = await cuerpo(c, z.object({
    asunto: z.string().trim().max(200).default(''), preheader: z.string().trim().max(250).default(''), cta: z.string().trim().max(100).default(''),
    url: z.union([z.literal(''), z.string().regex(URL_WEB, 'La URL debe empezar con http:// o https://.')]), html: z.string().max(500_000, 'El HTML es demasiado grande.'),
  }));
  const camp = await cargarCampana(c, c.req.param('id'));
  const clave = d.html ? `campanas/${camp.id}/v${camp.version + 1}.html` : null;
  if (clave) await c.env.ARCHIVOS.put(clave, d.html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
  return editar(c, { subject: d.asunto, preheader: d.preheader, cta: d.cta, url: d.url, html_key: clave }, 'Versión de contenido guardada');
});

campanas.patch('/campanas/:id/configuracion', async (c) => {
  const d = await cuerpo(c, z.object({
    remitente: z.string().trim().max(200).default(''), respuesta: z.string().trim().max(200).default(''), cuenta: z.string().trim().max(200).default(''),
    utmSource: z.string().trim().max(100).default(''), utmCampaign: z.string().trim().max(100).default(''),
  }));
  return editar(c, { sender: d.remitente, reply_to: d.respuesta, account: d.cuenta, utm_source: d.utmSource, utm_campaign: d.utmCampaign }, 'Configuración actualizada');
});

campanas.patch('/campanas/:id/segmento', async (c) => {
  const { segmentoId } = await cuerpo(c, z.object({ segmentoId: z.string().nullable() }));
  const camp = await cargarCampana(c, c.req.param('id'));
  if (segmentoId && !(await c.env.DB.prepare('SELECT 1 FROM segments WHERE id = ?1 AND brand_id = ?2').bind(segmentoId, camp.brand_id).first())) {
    throw new ErrorApi(400, 'datos_invalidos', 'El segmento debe ser de la misma marca.');
  }
  return editar(c, { segment_id: segmentoId }, 'Segmento elegido');
});

const transicion = async (c: Ctx, nuevo: string, cambios: Record<string, unknown>, accion: string) => {
  const camp = await cargarCampana(c, c.req.param('id')!);
  const cols = Object.keys(cambios);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE campaigns SET status = ?2${cols.map((k, i) => `, ${k} = ?${i + 3}`).join('')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`)
      .bind(camp.id, nuevo, ...cols.map((k) => cambios[k])),
    auditoria(c.env.DB, c.get('actor').id, `${accion} ${camp.name}`, 'campaign', camp.id, { version: camp.version }),
  ]);
  return c.json({ ok: true });
};

campanas.post('/campanas/:id/enviar-revision', async (c) => {
  exigir(c, 'coordina', 'Solo coordinación envía campañas a revisión.');
  return transicion(c, 'En revisión', {}, 'Revisión solicitada');
});

campanas.post('/campanas/:id/pedir-ajustes', async (c) => {
  exigir(c, 'coordina', 'Solo coordinación revisa campañas.');
  const { comentario } = await cuerpo(c, z.object({ comentario: z.string().trim().min(3, 'Escribe qué ajustes se necesitan.').max(2000) }));
  return transicion(c, 'Ajustes solicitados', { review_comment: comentario }, 'Ajustes solicitados');
});

campanas.post('/campanas/:id/aprobar', async (c) => {
  exigir(c, 'coordina', 'Solo coordinación aprueba versiones de campaña.');
  const camp = await cargarCampana(c, c.req.param('id'));
  const faltas = (await revision(c, camp)).filter((x) => !x.ok);
  if (faltas.length) throw new ErrorApi(409, 'revision', `Antes de aprobar: ${faltas.map((f) => f.item.toLowerCase()).join('; ')}.`);
  return transicion(c, 'Aprobada', { approved_version: camp.version, approved_at: new Date().toISOString(), approved_by: c.get('actor').id }, 'Versión aprobada');
});

const esquemaProgramar = z.object({
  fecha: z.string().regex(FECHA, 'Indica la fecha.'), hora: z.string().regex(/^\d{2}:\d{2}$/, 'Indica la hora.'),
  idExterno: z.string().trim().max(200).default(''), evidencia: z.union([z.literal(''), z.string().regex(URL_WEB, 'La evidencia debe ser un enlace http(s).')]).default(''),
});

campanas.post('/campanas/:id/programar', async (c) => {
  exigir(c, 'coordina', 'Solo coordinación programa campañas.');
  const d = await cuerpo(c, esquemaProgramar.extend({ externa: z.boolean().default(false) }));
  const camp = await cargarCampana(c, c.req.param('id'));
  if (camp.approved_version !== camp.version) throw new ErrorApi(409, 'sin_aprobar', 'Solo se programa la versión aprobada.');
  if (d.externa && (!d.idExterno || !d.evidencia)) throw new ErrorApi(400, 'datos_invalidos', 'La programación externa requiere el ID externo y la evidencia.');
  return transicion(c, d.externa ? 'Programada en el canal' : 'Calendarizada',
    { sched_date: d.fecha, sched_time: d.hora, external_id: d.idExterno, evidence: d.evidencia }, d.externa ? 'Programación externa registrada' : 'Campaña calendarizada');
});

campanas.post('/campanas/:id/lanzamiento', async (c) => {
  exigir(c, 'coordina', 'Solo coordinación registra lanzamientos.');
  const d = await cuerpo(c, z.object({ fecha: z.string().regex(FECHA), evidencia: z.string().regex(URL_WEB, 'La evidencia debe ser un enlace http(s).') }));
  if (d.fecha > hoySantiago()) throw new ErrorApi(400, 'datos_invalidos', 'El lanzamiento real no puede tener fecha futura.');
  const camp = await cargarCampana(c, c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE campaigns SET launched_at = ?2, launch_evidence = ?3 WHERE id = ?1').bind(camp.id, d.fecha, d.evidencia),
    auditoria(c.env.DB, c.get('actor').id, `Lanzamiento verificado ${camp.name}`, 'campaign', camp.id, d),
  ]);
  return c.json({ ok: true });
});

campanas.get('/entregables', async (c) => {
  const marcas = marcasVisibles(c);
  const cond = marcas ? `c.brand_id IN (${marcas.map((_, i) => `?${i + 1}`).join(',') || "''"})` : '1 = 1';
  const { results } = await c.env.DB.prepare(`SELECT c.id, c.name, c.version, c.approved_version, c.status, b.name AS marca, b.color, c.updated_at
      FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.html_key IS NOT NULL AND ${cond} ORDER BY c.updated_at DESC`).bind(...(marcas ?? [])).all();
  return c.json({ entregables: results });
});

// ─────────────────────────────── Bases y segmentos (datos personales: solo coordinación)

const POR_LOTE = 400;

campanas.get('/bases', async (c) => {
  exigir(c, 'coordina', 'Las bases de contactos son de coordinación.');
  const marcas = marcasVisibles(c);
  const cond = marcas ? `b.brand_id IN (${marcas.map((_, i) => `?${i + 1}`).join(',') || "''"})` : '1 = 1';
  const db = c.env.DB;
  const [bases, segs] = await db.batch<Fila>([
    db.prepare(`SELECT b.id, b.brand_id, m.name AS marca, b.filename, b.stats_json, b.created_at FROM contact_bases b JOIN brands m ON m.id = b.brand_id WHERE ${cond} ORDER BY b.created_at DESC`).bind(...(marcas ?? [])),
    db.prepare(`SELECT s.*, m.name AS marca FROM segments s JOIN brands m ON m.id = s.brand_id WHERE ${cond.replace(/b\.brand_id/g, 's.brand_id')} ORDER BY s.created_at DESC`).bind(...(marcas ?? [])),
  ]);
  const segmentos = await Promise.all(segs!.results.map(async (s) => ({ ...s, contactos: await contarSegmento(db, s as never) })));
  return c.json({ bases: bases!.results.map((b) => ({ ...b, stats: JSON.parse(b.stats_json) })), segmentos });
});

campanas.get('/bases/:id', async (c) => {
  exigir(c, 'coordina', 'Las bases de contactos son de coordinación.');
  const db = c.env.DB;
  const base = await db.prepare('SELECT * FROM contact_bases WHERE id = ?1').bind(c.req.param('id')).first<Fila>();
  const marcas = marcasVisibles(c);
  if (!base || (marcas && !marcas.includes(base.brand_id))) throw new ErrorApi(404, 'no_encontrado', 'Esa base no existe.');
  const { results } = await db.prepare('SELECT email, name, location, interest, status FROM contact_rows WHERE base_id = ?1 ORDER BY rowid LIMIT 30').bind(base.id).all();
  return c.json({ base: { ...base, stats: JSON.parse(base.stats_json) }, muestra: results });
});

campanas.post('/bases', async (c) => {
  exigir(c, 'coordina', 'Las bases de contactos son de coordinación.');
  const marcaId = c.req.query('marca') ?? '';
  const nombre = (c.req.query('nombre') ?? 'base.csv').slice(0, 120);
  const a = c.get('actor');
  if (!a.permisos.esAdmin && !a.marcas.includes(marcaId)) throw new ErrorApi(403, 'sin_permiso', 'No tienes asignada esa marca.');
  const texto = await c.req.text();
  if (texto.length > MAX_CSV) throw new ErrorApi(413, 'muy_grande', 'El archivo puede pesar hasta 2 MB.');
  let analisis;
  try { analisis = analizarContactos(parsearCSV(texto)); } catch (e) { throw new ErrorApi(400, 'csv_invalido', (e as Error).message); }
  const db = c.env.DB;
  const id = nuevoId();
  const lotes: D1PreparedStatement[] = [];
  for (let i = 0; i < analisis.filas.length; i += POR_LOTE) {
    const lote = analisis.filas.slice(i, i + POR_LOTE).map((f) => ({ e: f.email, n: f.name, l: f.location, i: f.interest, s: f.status }));
    lotes.push(db.prepare(`INSERT INTO contact_rows (id, base_id, email, name, location, interest, status)
        SELECT ?1 || '-' || (key + ?3), ?1, json_extract(value, '$.e'), json_extract(value, '$.n'), json_extract(value, '$.l'),
               json_extract(value, '$.i'), json_extract(value, '$.s') FROM json_each(?2)`).bind(id, JSON.stringify(lote), i));
  }
  await db.batch([
    db.prepare('INSERT INTO contact_bases (id, brand_id, filename, stats_json, created_by) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, marcaId, nombre, JSON.stringify(analisis.stats), a.id),
    ...lotes,
    auditoria(db, a.id, `Base cargada ${nombre}`, 'contact_base', id, analisis.stats),
  ]);
  return c.json({ id, stats: analisis.stats }, 201);
});

campanas.post('/segmentos', async (c) => {
  exigir(c, 'coordina', 'Los segmentos son de coordinación.');
  const d = await cuerpo(c, z.object({ baseId: z.string(), nombre: z.string().trim().min(2, 'Ponle nombre al segmento.').max(120),
    ubicacion: z.string().trim().max(100).default(''), interes: z.string().trim().max(100).default('') }));
  const db = c.env.DB;
  const base = await db.prepare('SELECT id, brand_id FROM contact_bases WHERE id = ?1').bind(d.baseId).first<Fila>();
  const marcas = marcasVisibles(c);
  if (!base || (marcas && !marcas.includes(base.brand_id))) throw new ErrorApi(404, 'no_encontrado', 'Esa base no existe.');
  const n = await contarSegmento(db, { base_id: base.id, brand_id: base.brand_id, location: d.ubicacion, interest: d.interes });
  if (!n) throw new ErrorApi(409, 'vacio', 'El segmento no tiene contactos habilitados.');
  const id = nuevoId();
  await db.prepare('INSERT INTO segments (id, brand_id, base_id, name, location, interest) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(id, base.brand_id, base.id, d.nombre, d.ubicacion, d.interes).run();
  return c.json({ id, contactos: n }, 201);
});

campanas.get('/segmentos/:id/exportar', async (c) => {
  exigir(c, 'coordina', 'Los segmentos son de coordinación.');
  const db = c.env.DB;
  const s = await db.prepare('SELECT * FROM segments WHERE id = ?1').bind(c.req.param('id')).first<Fila>();
  const marcas = marcasVisibles(c);
  if (!s || (marcas && !marcas.includes(s.brand_id))) throw new ErrorApi(404, 'no_encontrado', 'Ese segmento no existe.');
  const { results } = await db.prepare(`SELECT r.name, r.email, r.location, r.interest FROM contact_rows r
      WHERE r.base_id = ?1 AND r.status = 'Habilitado' AND r.location LIKE ?2 AND r.interest LIKE ?3
        AND r.email NOT IN (SELECT r2.email FROM contact_rows r2 JOIN contact_bases b2 ON b2.id = r2.base_id WHERE b2.brand_id = ?4 AND r2.status = 'Baja')
        AND r.email NOT IN (SELECT email FROM suppressions WHERE brand_id = ?4)
      GROUP BY r.email ORDER BY r.rowid`).bind(s.base_id, `%${s.location}%`, `%${s.interest}%`, s.brand_id).all<{ name: string; email: string; location: string; interest: string }>();
  await auditoria(db, c.get('actor').id, `Segmento exportado ${s.name}`, 'segment', s.id, { contactos: results.length }).run();
  return new Response(exportarCSV(results), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="segmento.csv"`, 'cache-control': 'no-store' },
  });
});
