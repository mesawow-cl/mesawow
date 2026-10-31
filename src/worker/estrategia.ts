// Inicio (§4.1), Mesa estratégica (§4.17, §5.11) y vista pública de mandantes (§4.18).
import { Hono } from 'hono';
import { z } from 'zod';
import { hoySantiago } from '../shared/fechas';
import { fechaCampana } from '../shared/dominio/protocolos';
import { ErrorApi } from './errores';
import { exigir, type Ctx, type Entorno } from './identidad';
import { filtroVisible } from './tareas';
import { auditoria, cuerpo, nuevoId } from './util';

type Fila = Record<string, any>;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const URL_WEB = /^https?:\/\/\S+$/;

export const estrategia = new Hono<Entorno>();

// ─────────────────────────────── Inicio

estrategia.get('/inicio', async (c) => {
  const p = c.get('persona');
  const db = c.env.DB;
  const hoy = hoySantiago();
  const v = filtroVisible(p, 2);
  const mias = `t.owner_id = ?1 AND ${v.sql}`;
  const [stats, delDia, pendientes, sprint, campanas, mesas, actividad] = await db.batch<Fila>([
    db.prepare(`SELECT
        sum(CASE WHEN t.status NOT IN ('Aprobada','Completada') THEN 1 ELSE 0 END) AS abiertas,
        sum(CASE WHEN t.status = 'En curso' THEN 1 ELSE 0 END) AS en_curso,
        sum(CASE WHEN t.status IN ('Aprobada','Completada') THEN 1 ELSE 0 END) AS completadas
      FROM tasks t WHERE ${mias}`).bind(p.id, ...v.params),
    db.prepare(`SELECT t.id, t.title, t.status FROM tasks t WHERE ${mias} AND t.due = ?${2 + v.params.length}`).bind(p.id, ...v.params, hoy),
    db.prepare(`SELECT t.id, t.title, t.due, t.status FROM tasks t WHERE ${mias} AND t.status NOT IN ('Aprobada','Completada') ORDER BY t.due LIMIT 4`).bind(p.id, ...v.params),
    db.prepare(`SELECT s.name FROM sprints s JOIN sprint_members sm ON sm.sprint_id = s.id AND sm.person_id = ?1 WHERE s.status = 'Activo' LIMIT 1`).bind(p.id),
    db.prepare(`SELECT count(*) AS n FROM campaigns WHERE brand_id IN (${p.marcas.map((_, i) => `?${i + 1}`).join(',') || "''"})`).bind(...p.marcas),
    db.prepare('SELECT count(*) AS n FROM mesas WHERE active = 1'),
    // Actividad: lo visible para la persona; lo de tareas que no ve se muestra como "una tarea de otra mesa".
    db.prepare(`SELECT a.at, a.action, a.entity, a.entity_id, pe.name AS persona,
        CASE WHEN a.entity <> 'task' THEN 1 ELSE EXISTS (SELECT 1 FROM tasks t WHERE t.id = a.entity_id AND ${v.sql}) END AS visible
      FROM audit_log a LEFT JOIN people pe ON pe.id = a.actor_id ORDER BY a.at DESC LIMIT 40`).bind(p.id, ...v.params),
  ]);
  const verbos: [RegExp, string, string][] = [
    [/^Tarea iniciada /, 'empezó', 'entrega'], [/^Tarea entregada /, 'entregó', 'entrega'], [/^Revisión solicitada /, 'pidió revisión de', 'revision'],
    [/^Ajustes solicitados /, 'pidió ajustes en', 'revision'], [/^Tarea aprobada /, 'aprobó', 'logro'], [/^Versión aprobada /, 'aprobó una versión de', 'logro'],
    [/^Sprint iniciado /, 'inició el sprint', 'sprint'], [/^Sprint en revisión /, 'llevó a revisión el sprint', 'sprint'], [/^Sprint cerrado /, 'cerró el sprint', 'sprint'],
  ];
  const eventos = actividad!.results.flatMap((e) => {
    const m = verbos.find(([re]) => re.test(e.action));
    if (!m) return [];
    const objeto = e.visible ? e.action.replace(m[0], '') : e.entity === 'task' ? 'una tarea de otra mesa' : 'de otra mesa';
    return [{ at: e.at, persona: e.persona ?? 'mesawow', verbo: m[1], objeto, tipo: m[2], tareaId: e.entity === 'task' && e.visible ? e.entity_id : null }];
  }).slice(0, 20);
  const s = stats!.results[0] ?? {};
  return c.json({
    stats: { misTareas: s.abiertas ?? 0, enProgreso: s.en_curso ?? 0, completadas: s.completadas ?? 0, logrosHoy: 0 },
    tuDia: { tareas: delDia!.results, hechas: delDia!.results.filter((t) => ['Aprobada', 'Completada'].includes(t.status)).length, pendientes: pendientes!.results },
    paneles: { encargos: s.abiertas ?? 0, hoyRestantes: delDia!.results.filter((t) => !['Aprobada', 'Completada'].includes(t.status)).length,
      mesas: mesas!.results[0]?.n ?? 0, sprint: sprint!.results[0]?.name ?? null, campanas: campanas!.results[0]?.n ?? 0, menciones: 0 },
    actividad: eventos,
  });
});

// ─────────────────────────────── Mesa estratégica

const planVisible = async (c: Ctx, id: string) => {
  const plan = await c.env.DB.prepare('SELECT * FROM strategic_plans WHERE id = ?1').bind(id).first<Fila>();
  const p = c.get('persona');
  if (!plan || (!p.permisos.esAdmin && !p.marcas.includes(plan.brand_id))) throw new ErrorApi(404, 'no_encontrado', 'Ese plan no existe.');
  return plan;
};

/** Trabajo del plan: tareas vinculadas o de sus campañas. */
const trabajoDelPlan = `(t.plan_id = ?1 OR t.campaign_id IN (SELECT id FROM campaigns WHERE plan_id = ?1))`;

/** Borradores de reporte por cada sprint cerrado con trabajo del plan (se actualizan mientras no se aprueben). */
const reportesDeSprints = async (db: D1Database, planId: string) => {
  const { results } = await db.prepare(`
    SELECT s.id, s.name, s.start_date, s.end_date, s.close_exception_json, count(r.task_id) AS total, sum(r.approved) AS hechas
      FROM sprints s JOIN sprint_closed_records r ON r.sprint_id = s.id JOIN tasks t ON t.id = r.task_id
     WHERE s.status = 'Cerrado' AND ${trabajoDelPlan.replace(/\?1/g, '?1')} GROUP BY s.id`).bind(planId).all<Fila>();
  if (!results.length) return;
  const metricas = (await db.prepare('SELECT * FROM plan_metrics WHERE plan_id = ?1').bind(planId).all()).results;
  await db.batch(results.map((s) => db.prepare(`INSERT INTO plan_reports (id, plan_id, sprint_id, name, start_date, end_date, total, done, summary, next, exception, metrics_snapshot)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'Por definir por coordinación', ?10, ?11)
      ON CONFLICT(plan_id, sprint_id) DO UPDATE SET total = excluded.total, done = excluded.done, summary = excluded.summary WHERE plan_reports.approved = 0`)
    .bind(nuevoId(), planId, s.id, s.name, s.start_date, s.end_date, s.total, s.hechas ?? 0, `${s.hechas ?? 0} de ${s.total} entregables comprometidos aprobados.`,
      s.close_exception_json ? JSON.parse(s.close_exception_json).causa ?? null : null, JSON.stringify(metricas))));
};

estrategia.get('/planes', async (c) => {
  exigir(c, 'coordinaODirige', 'La mesa estratégica es para coordinación y dirección.');
  const p = c.get('persona');
  const db = c.env.DB;
  const marcas = p.permisos.esAdmin ? null : p.marcas;
  const { results: planes } = await db.prepare(`SELECT sp.*, b.name AS marca, b.color FROM strategic_plans sp JOIN brands b ON b.id = sp.brand_id
      WHERE ${marcas ? `sp.brand_id IN (${marcas.map((_, i) => `?${i + 1}`).join(',') || "''"})` : '1 = 1'} ORDER BY sp.start_date DESC`).bind(...(marcas ?? [])).all<Fila>();
  const detalle = await Promise.all(planes.map(async (pl) => {
    await reportesDeSprints(db, pl.id);
    const [metricas, iniciativas, reportes, avance, publicada] = await db.batch<Fila>([
      db.prepare('SELECT * FROM plan_metrics WHERE plan_id = ?1').bind(pl.id),
      db.prepare('SELECT i.*, c.name AS campana FROM plan_initiatives i LEFT JOIN campaigns c ON c.id = i.campaign_id WHERE i.plan_id = ?1 ORDER BY i.start_date').bind(pl.id),
      db.prepare('SELECT * FROM plan_reports WHERE plan_id = ?1 ORDER BY start_date DESC').bind(pl.id),
      db.prepare(`SELECT count(*) AS total, sum(CASE WHEN t.status IN ('Aprobada','Completada') THEN 1 ELSE 0 END) AS hechas, sum(t.estimated_hours) AS horas
                  FROM tasks t WHERE ${trabajoDelPlan}`).bind(pl.id),
      db.prepare('SELECT published_at FROM public_snapshots WHERE plan_id = ?1').bind(pl.id),
    ]);
    return { ...pl, metricas: metricas!.results, iniciativas: iniciativas!.results, reportes: reportes!.results, avance: avance!.results[0], publicadoEl: publicada!.results[0]?.published_at ?? null };
  }));
  return c.json({ planes: detalle });
});

const esquemaPlan = z.object({
  nombre: z.string().trim().min(3).max(200), marcaId: z.string(), inicio: z.string().regex(FECHA), objetivo: z.string().trim().max(2000).default(''),
  publico: z.string().trim().max(1000).default(''), presupuesto: z.number().min(0).nullable().default(null), diagnostico: z.string().trim().max(5000).default(''), notas: z.string().trim().max(3000).default(''),
});

estrategia.post('/planes', async (c) => {
  exigir(c, 'esAdmin', 'Los planes estratégicos los crea la administración general.');
  const d = await cuerpo(c, esquemaPlan);
  const id = nuevoId();
  await c.env.DB.prepare(`INSERT INTO strategic_plans (id, brand_id, name, start_date, end_date, objective, audience, budget, diagnosis, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
    .bind(id, d.marcaId, d.nombre, d.inicio, fechaCampana(d.inicio, 3, -1), d.objetivo, d.publico, d.presupuesto, d.diagnostico, d.notas).run();
  return c.json({ id }, 201);
});

estrategia.patch('/planes/:id', async (c) => {
  exigir(c, 'esAdmin', 'Los planes estratégicos los edita la administración general.');
  const d = await cuerpo(c, esquemaPlan);
  const plan = await planVisible(c, c.req.param('id'));
  const db = c.env.DB;
  if (d.marcaId !== plan.brand_id) {
    const usado = await db.prepare(`SELECT (SELECT count(*) FROM tasks WHERE plan_id = ?1) + (SELECT count(*) FROM plan_initiatives WHERE plan_id = ?1) AS n`).bind(plan.id).first<{ n: number }>();
    if (usado?.n) throw new ErrorApi(409, 'marca_fija', 'La marca no cambia: el plan ya tiene trabajo o iniciativas.');
  }
  await db.prepare(`UPDATE strategic_plans SET brand_id = ?2, name = ?3, start_date = ?4, end_date = ?5, objective = ?6, audience = ?7, budget = ?8, diagnosis = ?9, notes = ?10 WHERE id = ?1`)
    .bind(plan.id, d.marcaId, d.nombre, d.inicio, fechaCampana(d.inicio, 3, -1), d.objetivo, d.publico, d.presupuesto, d.diagnostico, d.notas).run();
  return c.json({ ok: true });
});

estrategia.post('/planes/:id/metricas', async (c) => {
  exigir(c, 'esAdmin', 'Las métricas las define la administración general.');
  const d = await cuerpo(c, z.object({
    id: z.string().optional(), tipo: z.enum(['KPI', 'Resultado clave OKR']), objetivo: z.string().trim().max(500).default(''), nombre: z.string().trim().min(2).max(200),
    base: z.string().trim().max(100).default(''), meta: z.string().trim().max(100).default(''), actual: z.string().trim().max(100).default(''),
    unidad: z.string().trim().max(50).default(''), fuente: z.string().trim().max(200).default(''), fecha: z.string().regex(FECHA).nullable().default(null), direccion: z.enum(['Subir', 'Bajar']),
  }));
  if (d.actual && !d.fuente) throw new ErrorApi(400, 'datos_invalidos', 'Si registras el valor actual, indica la fuente.');
  const plan = await planVisible(c, c.req.param('id'));
  await c.env.DB.prepare(`INSERT INTO plan_metrics (id, plan_id, kind, objective, name, baseline, target, current, unit, source, as_of, direction)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, objective = excluded.objective, name = excluded.name,
      baseline = excluded.baseline, target = excluded.target, current = excluded.current, unit = excluded.unit, source = excluded.source, as_of = excluded.as_of, direction = excluded.direction`)
    .bind(d.id ?? nuevoId(), plan.id, d.tipo, d.objetivo, d.nombre, d.base, d.meta, d.actual, d.unidad, d.fuente, d.fecha, d.direccion).run();
  return c.json({ ok: true });
});

estrategia.post('/planes/:id/iniciativas', async (c) => {
  exigir(c, 'esAdmin', 'Las iniciativas las define la administración general.');
  const d = await cuerpo(c, z.object({
    id: z.string().optional(), nombre: z.string().trim().min(2).max(200),
    tipo: z.enum(['Campaña 360', 'Webinar', 'Contenido continuo', 'Sitio web', 'Plataforma', 'Presentación', 'Otra iniciativa']),
    campanaId: z.string().nullable().default(null), inicio: z.string().regex(FECHA), fin: z.string().regex(FECHA),
    estado: z.enum(['Planificada', 'En preparación', 'Activa', 'Finalizada', 'Pausada']).default('Planificada'),
    evidencia: z.union([z.literal(''), z.string().regex(URL_WEB, 'La evidencia debe ser un enlace http(s).')]).default(''),
  }).refine((x) => x.inicio <= x.fin, { message: 'La iniciativa debe terminar después de empezar.' }));
  const plan = await planVisible(c, c.req.param('id'));
  if (d.inicio < plan.start_date || d.fin > plan.end_date) throw new ErrorApi(400, 'datos_invalidos', 'La iniciativa debe estar dentro del trimestre del plan.');
  const db = c.env.DB;
  await db.batch([
    db.prepare(`INSERT INTO plan_initiatives (id, plan_id, name, type, campaign_id, start_date, end_date, status, evidence) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, campaign_id = excluded.campaign_id, start_date = excluded.start_date,
        end_date = excluded.end_date, status = excluded.status, evidence = excluded.evidence`)
      .bind(d.id ?? nuevoId(), plan.id, d.nombre, d.tipo, d.campanaId, d.inicio, d.fin, d.estado, d.evidencia || null),
    ...(d.campanaId ? [db.prepare('UPDATE campaigns SET plan_id = ?1 WHERE id = ?2 AND brand_id = ?3').bind(plan.id, d.campanaId, plan.brand_id)] : []),
  ]);
  return c.json({ ok: true });
});

estrategia.post('/planes/:id/reportes/:reporte', async (c) => {
  exigir(c, 'esAdmin', 'Los reportes los aprueba la administración general.');
  const d = await cuerpo(c, z.object({ resumen: z.string().trim().min(3).max(3000), siguiente: z.string().trim().max(2000).default(''), aprobar: z.boolean() }));
  const plan = await planVisible(c, c.req.param('id'));
  await c.env.DB.prepare('UPDATE plan_reports SET summary = ?3, next = ?4, approved = ?5 WHERE id = ?1 AND plan_id = ?2')
    .bind(c.req.param('reporte'), plan.id, d.resumen, d.siguiente, d.aprobar ? 1 : 0).run();
  return c.json({ ok: true });
});

estrategia.post('/planes/:id/publicar', async (c) => {
  exigir(c, 'esAdmin', 'La vista de mandantes la aprueba la administración general.');
  const plan = await planVisible(c, c.req.param('id'));
  const db = c.env.DB;
  const [marca, metricas, iniciativas, reportes] = await db.batch<Fila>([
    db.prepare('SELECT name, color FROM brands WHERE id = ?1').bind(plan.brand_id),
    db.prepare('SELECT kind, name, baseline, target, current, unit, as_of, direction FROM plan_metrics WHERE plan_id = ?1').bind(plan.id),
    db.prepare('SELECT name, type, start_date, end_date, status, evidence FROM plan_initiatives WHERE plan_id = ?1 ORDER BY start_date').bind(plan.id),
    db.prepare('SELECT name, start_date, end_date, total, done, summary, next FROM plan_reports WHERE plan_id = ?1 AND approved = 1 ORDER BY start_date').bind(plan.id),
  ]);
  if (!metricas!.results.length || !iniciativas!.results.length) throw new ErrorApi(409, 'incompleto', 'Para publicar, el plan necesita al menos una métrica y una iniciativa.');
  // Solo lo aprobado y enlaces http(s): la instantánea nunca expone datos internos.
  const instantanea = {
    nombre: plan.name, marca: marca!.results[0]?.name, color: /^#[0-9a-f]{6}$/i.test(marca!.results[0]?.color ?? '') ? marca!.results[0]!.color : '#F22E62',
    inicio: plan.start_date, fin: plan.end_date, objetivo: plan.objective, metricas: metricas!.results,
    iniciativas: iniciativas!.results.map((i) => ({ ...i, evidence: i.evidence && URL_WEB.test(i.evidence) ? i.evidence : null })), reportes: reportes!.results,
    publicadoEl: new Date().toISOString(),
  };
  await db.batch([
    db.prepare(`INSERT INTO public_snapshots (plan_id, payload_json, published_at, published_by) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(plan_id) DO UPDATE SET payload_json = excluded.payload_json, published_at = excluded.published_at, published_by = excluded.published_by`)
      .bind(plan.id, JSON.stringify(instantanea), instantanea.publicadoEl, c.get('actor').id),
    auditoria(db, c.get('actor').id, `Vista de mandantes publicada ${plan.name}`, 'plan', plan.id),
  ]);
  return c.json({ ok: true });
});

/** Pública (sin sesión): solo las instantáneas aprobadas. */
export const publico = new Hono<Entorno>();
publico.get('/publico/mesa', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT payload_json FROM public_snapshots ORDER BY published_at DESC').all<{ payload_json: string }>();
  c.header('cache-control', 'public, max-age=60');
  return c.json({ planes: results.map((r) => JSON.parse(r.payload_json)) });
});
