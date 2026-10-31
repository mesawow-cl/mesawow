// Centro de planificación (§4.14, §5.7): campaña 360, webinar, catálogo, plantillas y propuesta semanal.
import { Hono } from 'hono';
import { z } from 'zod';
import type { PasoPlantilla } from '../shared/catalogo';
import { aMinuto, aPared, type Rango } from '../shared/dominio/agenda';
import { diaHabil, fechaCampana, generar360, generarTrabajo, generarWebinar, proponerSemanas, type Rol, type TareaGenerada } from '../shared/dominio/protocolos';
import { finDeSprint } from '../shared/dominio/sprints';
import { hoySantiago } from '../shared/fechas';
import { configJornada, recalcularAgenda } from './agenda';
import { encolarAvisos } from './avisos';
import { ErrorApi } from './errores';
import { exigir, type Ctx, type Entorno } from './identidad';
import { auditoria, cuerpo, nuevoId } from './util';

type Fila = Record<string, any>;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MESA_DE_AREA: Record<string, string | null> = {
  Marketing: 'mesa-marketing', Comercial: 'mesa-comercial-y-ventas', 'Operación': 'mesa-operaciones', 'Diseño': 'mesa-marketing', 'Coordinación': null,
};

export const planificacion = new Hono<Entorno>();

const validarPersonas = async (db: D1Database, marcaId: string, ids: (string | null | undefined)[]) => {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return;
  const { results } = await db.prepare(`SELECT p.id, p.name, p.active, p.role, EXISTS (SELECT 1 FROM person_brands pb WHERE pb.person_id = p.id AND pb.brand_id = ?1) AS tiene
      FROM people p WHERE p.id IN (${unicos.map((_, i) => `?${i + 2}`).join(',')})`).bind(marcaId, ...unicos).all<Fila>();
  for (const id of unicos) {
    const p = results.find((r) => r.id === id);
    if (!p || !p.active) throw new ErrorApi(400, 'datos_invalidos', 'Una de las personas elegidas no existe o está inactiva.');
    if (!p.tiene && p.role !== 'Administrador general') throw new ErrorApi(400, 'datos_invalidos', `${p.name} no tiene asignada esta marca.`);
  }
};

const marcaDelActor = (c: Ctx, marcaId: string) => {
  const a = c.get('actor');
  if (!a.permisos.esAdmin && !a.marcas.includes(marcaId)) throw new ErrorApi(403, 'sin_permiso', 'No tienes asignada esa marca.');
};

/** Inserta tareas generadas por lotes (json_each), con sus dependencias y aprobadores. Devuelve sus IDs. */
const insertarGeneradas = (db: D1Database, gen: TareaGenerada[], ctx: {
  marcaId: string; campanaId?: string | null; trabajoId?: string | null; planId?: string | null; responsables: Partial<Record<Rol, string | null>>;
  revisorId: string | null; prioridad?: string; protocolo?: string | null; creadaPor: string; mesaId?: string | null;
}) => {
  const ids = new Map(gen.map((t) => [t.clave, nuevoId()]));
  const filas = gen.map((t) => ({
    id: ids.get(t.clave), title: t.titulo, description: t.descripcion, deliverable: t.entregable, acceptance: t.criterio,
    owner: (t.rol === 'Revisión' ? ctx.revisorId ?? ctx.responsables.Marketing : ctx.responsables[t.rol]) ?? null,
    start: t.inicio, due: t.plazo, hours: t.horas, tool: t.herramienta, step: t.paso, fixed: t.eventoFijo ? 1 : 0,
    ready: t.inputsListos ? 1 : 0, complexity: t.complejidad, mesa: ctx.mesaId ?? MESA_DE_AREA[t.area] ?? null,
  }));
  const sentencias: D1PreparedStatement[] = [];
  for (let i = 0; i < filas.length; i += 150) {
    sentencias.push(db.prepare(`INSERT INTO tasks (id, brand_id, campaign_id, job_id, plan_id, mesa_id, title, description, deliverable, acceptance, owner_id, reviewer_id,
        start_date, due, estimated_hours, remaining_hours, tool, protocol_version, protocol_step, fixed_event, inputs_ready, complexity, priority, status, created_by)
      SELECT j.value ->> 'id', ?2, ?3, ?4, ?5, j.value ->> 'mesa', j.value ->> 'title', j.value ->> 'description', j.value ->> 'deliverable', j.value ->> 'acceptance',
             j.value ->> 'owner', ?6, j.value ->> 'start', j.value ->> 'due', j.value ->> 'hours', j.value ->> 'hours', j.value ->> 'tool', ?7, j.value ->> 'step',
             j.value ->> 'fixed', j.value ->> 'ready', j.value ->> 'complexity', ?8, 'Pendiente', ?9
        FROM json_each(?1) AS j`)
      .bind(JSON.stringify(filas.slice(i, i + 150)), ctx.marcaId, ctx.campanaId ?? null, ctx.trabajoId ?? null, ctx.planId ?? null, ctx.revisorId,
        ctx.protocolo ?? null, ctx.prioridad ?? 'Media', ctx.creadaPor));
  }
  const deps = gen.flatMap((t) => t.dependencias.map((d) => [ids.get(t.clave), ids.get(d)]));
  for (let i = 0; i < deps.length; i += 1000) {
    sentencias.push(db.prepare(`INSERT INTO task_dependencies (task_id, depends_on_id) SELECT j.value ->> 0, j.value ->> 1 FROM json_each(?1) AS j`).bind(JSON.stringify(deps.slice(i, i + 1000))));
  }
  if (ctx.revisorId) {
    const todos = [...ids.values()];
    for (let i = 0; i < todos.length; i += 1000) {
      sentencias.push(db.prepare(`INSERT INTO task_people (task_id, person_id, role) SELECT j.value, ?2, 'approver' FROM json_each(?1) AS j`).bind(JSON.stringify(todos.slice(i, i + 1000)), ctx.revisorId));
    }
  }
  return { sentencias, ids: [...ids.values()], horas: gen.reduce((n, t) => n + t.horas, 0) };
};

// ─────────────────────────────── Campaña 360

const esquema360 = z.object({
  nombre: z.string().trim().min(3, 'Ponle nombre a la campaña.').max(200), marcaId: z.string(), planId: z.string().nullable().default(null),
  inicio: z.string().regex(FECHA), objetivo: z.string().trim().min(1, 'Escribe el objetivo.').max(1000), indicador: z.string().trim().max(300).default(''),
  presupuesto: z.number().min(0).nullable().default(null),
  alcance: z.object({ organic: z.number().int().min(0).max(60), video: z.number().int().min(0).max(30), email: z.number().int().min(0).max(30), ads: z.number().int().min(0).max(30) }),
  inputsListos: z.boolean().default(false), canales: z.array(z.string()).min(1, 'Elige al menos un canal.'),
  alAireDesde: z.string().regex(FECHA), alAireHasta: z.string().regex(FECHA),
  responsableMarketingId: z.string().min(1, 'Elige a la persona responsable de Marketing.'), responsableComercialId: z.string().min(1, 'Elige a la persona responsable de inputs comerciales.'),
  revisorId: z.string().min(1, 'Elige quién revisa los entregables.'),
}).refine((d) => d.alAireHasta >= d.alAireDesde, { message: 'La ventana al aire debe terminar después de empezar.' });

planificacion.post('/campanas/360', async (c) => {
  exigir(c, 'coordina', 'Las campañas las crea coordinación.');
  const d = await cuerpo(c, esquema360);
  marcaDelActor(c, d.marcaId);
  const db = c.env.DB;
  await validarPersonas(db, d.marcaId, [d.responsableMarketingId, d.responsableComercialId, d.revisorId]);
  const id = nuevoId();
  const a = c.get('actor');
  const gen = generar360({ inicio: d.inicio, alcance: d.alcance, canales: d.canales, inputsListos: d.inputsListos });
  const { sentencias, ids, horas } = insertarGeneradas(db, gen, {
    marcaId: d.marcaId, campanaId: id, planId: d.planId, revisorId: d.revisorId, protocolo: '360-2', creadaPor: a.id,
    responsables: { Marketing: d.responsableMarketingId, Comercial: d.responsableComercialId },
  });
  await db.batch([
    db.prepare(`INSERT INTO campaigns (id, brand_id, plan_id, type, name, objective, metric, budget, start_date, end_date, live_start, live_end,
        protocol_version, protocol_reviewer_id, scope_json, estimated_hours, platform) VALUES (?1, ?2, ?3, '360', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, '360-2', ?12, ?13, ?14, ?15)`)
      .bind(id, d.marcaId, d.planId, d.nombre, d.objetivo, d.indicador, d.presupuesto, d.inicio, fechaCampana(d.inicio, 3, -1), d.alAireDesde, d.alAireHasta,
        d.revisorId, JSON.stringify(d.alcance), horas, d.canales.join(', ')),
    ...d.canales.map((x) => db.prepare('INSERT INTO campaign_channels (campaign_id, channel) VALUES (?1, ?2) ON CONFLICT DO NOTHING').bind(id, x)),
    ...sentencias,
    auditoria(db, a.id, `Campaña 360 creada ${d.nombre}`, 'campaign', id, { tareas: ids.length }),
    ...encolarAvisos(db, 'Nueva campaña asignada', null, [d.responsableMarketingId, d.responsableComercialId, d.revisorId].filter((x) => x !== a.id), { campana: d.nombre, tareas: ids.length }),
  ]);
  return c.json({ id, tareas: ids.length, horas }, 201);
});

// ─────────────────────────────── Webinar

const esquemaWebinar = z.object({
  nombre: z.string().trim().min(3, 'Ponle título al webinar.').max(200), marcaId: z.string(), planId: z.string().nullable().default(null),
  objetivo: z.string().trim().max(1000).default(''), presupuesto: z.number().min(0).nullable().default(null),
  fechaEvento: z.string().regex(FECHA), horaEvento: z.string().regex(/^\d{2}:\d{2}$/).default('18:00'),
  minutos: z.number().int().min(30).max(480).multipleOf(15).default(90), plataforma: z.string().trim().min(2).max(100).default('Google Meet'),
  relatores: z.string().trim().max(500).default(''),
  responsables: z.object({ Marketing: z.string().nullable(), Comercial: z.string().nullable(), 'Coordinación': z.string().nullable(), 'Diseño': z.string().nullable(), 'Operación': z.string().nullable() }).partial(),
  revisorId: z.string().nullable().default(null),
});

planificacion.post('/campanas/webinar', async (c) => {
  exigir(c, 'coordina', 'Los webinars los crea coordinación.');
  const d = await cuerpo(c, esquemaWebinar);
  marcaDelActor(c, d.marcaId);
  if (d.fechaEvento < hoySantiago()) throw new ErrorApi(400, 'datos_invalidos', 'La fecha del evento no puede ser pasada.');
  const db = c.env.DB;
  await validarPersonas(db, d.marcaId, [...Object.values(d.responsables), d.revisorId]);
  const id = nuevoId();
  const a = c.get('actor');
  const canales = ['Meta Ads', 'Landing y formulario', 'GA4 y Meta', 'Brevo', 'Redes orgánicas', d.plataforma];
  const gen = generarWebinar({ fechaEvento: d.fechaEvento, minutos: d.minutos, plataforma: d.plataforma, canales });
  const { sentencias, ids, horas } = insertarGeneradas(db, gen, {
    marcaId: d.marcaId, campanaId: id, planId: d.planId, revisorId: d.revisorId, protocolo: 'webinar-1', creadaPor: a.id, responsables: d.responsables,
  });
  const inicioEvento = `${d.fechaEvento}T${d.horaEvento}`;
  const finEvento = aPared(aMinuto(inicioEvento) + d.minutos);
  const conEvento = [...new Set(Object.values(d.responsables).filter((x): x is string => !!x))];
  await db.batch([
    db.prepare(`INSERT INTO campaigns (id, brand_id, plan_id, type, name, objective, metric, budget, start_date, end_date, event_date, event_time, event_minutes,
        event_platform, speakers, protocol_version, protocol_reviewer_id, estimated_hours, planning_note)
        VALUES (?1, ?2, ?3, 'webinar', ?4, ?5, 'Inscritos, asistentes, CPL y prospectos', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'webinar-1', ?14, ?15,
        'Valida inputs y asignaciones antes de proponer sprints.')`)
      .bind(id, d.marcaId, d.planId, d.nombre, d.objetivo, d.presupuesto, diaHabil(d.fechaEvento, -20), diaHabil(d.fechaEvento, 5), d.fechaEvento, d.horaEvento,
        d.minutos, d.plataforma, d.relatores, d.revisorId, horas),
    ...canales.map((x) => db.prepare('INSERT INTO campaign_channels (campaign_id, channel) VALUES (?1, ?2) ON CONFLICT DO NOTHING').bind(id, x)),
    ...sentencias,
    // El evento queda como reunión en la agenda de cada responsable.
    ...conEvento.map((p) => db.prepare('INSERT INTO meetings (id, person_id, title, starts_at, ends_at, campaign_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(nuevoId(), p, `${d.nombre} · Webinar`, inicioEvento, finEvento, id)),
    auditoria(db, a.id, `Webinar creado ${d.nombre}`, 'campaign', id, { tareas: ids.length }),
    ...encolarAvisos(db, 'Nueva campaña asignada', null, [...conEvento, d.revisorId].filter((x): x is string => !!x && x !== a.id), { campana: d.nombre, tareas: ids.length }),
  ]);
  await recalcularAgenda(db, `Webinar: ${d.nombre}`, a.id);
  return c.json({ id, tareas: ids.length, horas, sinAsignar: gen.filter((t) => !(d.responsables as Partial<Record<string, string | null>>)[t.rol]).length }, 201);
});

planificacion.post('/campanas/:id/validar-inputs', async (c) => {
  exigir(c, 'coordina', 'Validar inputs corresponde a coordinación.');
  const db = c.env.DB;
  const camp = await db.prepare('SELECT id, name, brand_id FROM campaigns WHERE id = ?1').bind(c.req.param('id')).first<Fila>();
  marcaDelActor(c, camp?.brand_id ?? '');
  if (!camp) throw new ErrorApi(404, 'no_encontrado', 'Esa campaña no existe.');
  const { results } = await db.prepare("SELECT id FROM tasks WHERE campaign_id = ?1 AND status NOT IN ('Aprobada','Completada')").bind(camp.id).all<{ id: string }>();
  await db.batch([
    db.prepare("UPDATE tasks SET inputs_ready = 1 WHERE campaign_id = ?1 AND status NOT IN ('Aprobada','Completada')").bind(camp.id),
    auditoria(db, c.get('actor').id, 'Inputs de campaña validados', 'campaign', camp.id),
  ]);
  return c.json({ tareas: results.map((r) => r.id) });
});

// ─────────────────────────────── Catálogo y plantillas

const esquemaPaso = z.object({
  title: z.string().trim().min(1, 'Cada paso necesita título.').max(200), hours: z.number().positive('Las horas deben ser mayores que cero.').max(320).multipleOf(0.25),
  tool: z.string().trim().min(1, 'Cada paso necesita herramienta.').max(100), instruction: z.string().trim().min(1, 'Cada paso necesita instrucción.').max(2000),
  deliverable: z.string().trim().min(1, 'Cada paso necesita entregable.').max(500), acceptance: z.string().trim().min(1, 'Cada paso necesita criterio de aceptación.').max(1000),
  dependency: z.number().int().min(0), role: z.enum(['execute', 'review']),
});
const validarPasos = (pasos: z.infer<typeof esquemaPaso>[]) => {
  if (!pasos.length) throw new ErrorApi(400, 'datos_invalidos', 'La plantilla necesita al menos un paso.');
  pasos.forEach((p, i) => { if (p.dependency > i) throw new ErrorApi(400, 'datos_invalidos', `El paso ${i + 1} solo puede depender de un paso anterior.`); });
};

planificacion.get('/catalogo', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, key, name, version, steps_json, builtin FROM service_templates WHERE archived = 0 ORDER BY builtin DESC, name').all<Fila>();
  return c.json({ servicios: results.map((s) => {
    const pasos = JSON.parse(s.steps_json) as PasoPlantilla[];
    return { id: s.id, clave: s.key, nombre: s.name, version: s.version, propio: !s.builtin, pasos, horas: pasos.reduce((n, p) => n + p.hours, 0) };
  }) });
});

planificacion.post('/plantillas', async (c) => {
  exigir(c, 'coordina', 'Las plantillas las administra coordinación.');
  const d = await cuerpo(c, z.object({ nombre: z.string().trim().min(3).max(200), pasos: z.array(esquemaPaso) }));
  validarPasos(d.pasos);
  const id = nuevoId();
  await c.env.DB.prepare("INSERT INTO service_templates (id, key, name, version, steps_json, builtin) VALUES (?1, 'personalizado', ?2, 1, ?3, 0)").bind(id, d.nombre, JSON.stringify(d.pasos)).run();
  return c.json({ id }, 201);
});

planificacion.put('/plantillas/:id', async (c) => {
  exigir(c, 'coordina', 'Las plantillas las administra coordinación.');
  const d = await cuerpo(c, z.object({ nombre: z.string().trim().min(3).max(200), pasos: z.array(esquemaPaso) }));
  validarPasos(d.pasos);
  // Una nueva versión no cambia los trabajos ya creados (guardan copia de sus pasos).
  const r = await c.env.DB.prepare(`UPDATE service_templates SET name = ?2, steps_json = ?3, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?1 AND builtin = 0`).bind(c.req.param('id'), d.nombre, JSON.stringify(d.pasos)).run();
  if (!r.meta.changes) throw new ErrorApi(404, 'no_encontrado', 'Esa plantilla no existe o es del catálogo base.');
  return c.json({ ok: true });
});

const esquemaTrabajo = z.object({
  plantillaId: z.string(), nombre: z.string().trim().min(3, 'Ponle nombre al trabajo.').max(200), marcaId: z.string(), planId: z.string().nullable().default(null),
  inicio: z.string().regex(FECHA), plazo: z.string().regex(FECHA), urgencia: z.enum(['Urgente', 'Alta', 'Media', 'Baja']).default('Media'),
  cantidad: z.number().int().min(1).max(30).default(1), responsableId: z.string().min(1, 'Elige a la persona responsable.'),
  revisorId: z.string().nullable().default(null), inputsListos: z.boolean().default(false), mesaId: z.string().nullable().default(null),
}).refine((d) => d.plazo >= d.inicio, { message: 'La entrega debe ser igual o posterior al inicio.' });

planificacion.post('/trabajos', async (c) => {
  exigir(c, 'coordina', 'Los trabajos del catálogo los crea coordinación.');
  const d = await cuerpo(c, esquemaTrabajo);
  marcaDelActor(c, d.marcaId);
  const db = c.env.DB;
  await validarPersonas(db, d.marcaId, [d.responsableId, d.revisorId]);
  const pl = await db.prepare('SELECT id, version, steps_json FROM service_templates WHERE id = ?1 AND archived = 0').bind(d.plantillaId).first<Fila>();
  if (!pl) throw new ErrorApi(404, 'no_encontrado', 'Ese servicio no existe.');
  const pasos = JSON.parse(pl.steps_json) as PasoPlantilla[];
  const id = nuevoId();
  const a = c.get('actor');
  const gen = generarTrabajo({ titulo: d.nombre, pasos, cantidad: d.cantidad, inicio: d.inicio, plazo: d.plazo, inputsListos: d.inputsListos });
  const { sentencias, ids } = insertarGeneradas(db, gen, {
    marcaId: d.marcaId, trabajoId: id, planId: d.planId, revisorId: d.revisorId, prioridad: d.urgencia, creadaPor: a.id,
    responsables: { Marketing: d.responsableId }, mesaId: d.mesaId ?? 'mesa-marketing',
  });
  await db.batch([
    db.prepare('INSERT INTO jobs (id, title, brand_id, template_id, template_version, steps_snapshot_json, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(id, d.nombre, d.marcaId, pl.id, pl.version, pl.steps_json, a.id),
    ...sentencias,
    auditoria(db, a.id, `Trabajo creado ${d.nombre}`, 'job', id, { tareas: ids.length }),
  ]);
  return c.json({ id, tareas: ids }, 201);
});

// ─────────────────────────────── Propuesta semanal

const proponer = async (c: Ctx, tareaIds: string[], desde: string) => {
  const db = c.env.DB;
  if (!tareaIds.length) return { propuestas: [], problemas: [], filas: [] as Fila[] };
  const marca = (i: number) => `?${i + 1}`;
  const { results: filas } = await db.prepare(`
    SELECT t.id, t.title, t.brand_id, t.owner_id, t.estimated_hours, t.due, t.priority, t.blocked, t.inputs_ready, t.status, s.status AS sprint_status,
           (SELECT json_group_array(depends_on_id) FROM task_dependencies WHERE task_id = t.id) AS deps,
           EXISTS (SELECT 1 FROM person_brands pb WHERE pb.person_id = t.owner_id AND pb.brand_id = t.brand_id)
             OR EXISTS (SELECT 1 FROM people p WHERE p.id = t.owner_id AND p.role = 'Administrador general') AS tiene_marca
      FROM tasks t LEFT JOIN sprints s ON s.id = t.sprint_id
     WHERE t.id IN (${tareaIds.map((_, i) => marca(i)).join(',')}) AND t.status NOT IN ('Aprobada','Completada')`).bind(...tareaIds).all<Fila>();
  const a = c.get('actor');
  for (const f of filas) if (!a.permisos.esAdmin && !a.marcas.includes(f.brand_id)) throw new ErrorApi(403, 'sin_permiso', 'Hay tareas de marcas que no tienes asignadas.');
  const [hechas, planes, reuniones, bloques] = await db.batch<Fila>([
    db.prepare("SELECT id FROM tasks WHERE status IN ('Aprobada','Completada')"),
    db.prepare('SELECT task_id, finish FROM work_plans WHERE finish IS NOT NULL'),
    db.prepare('SELECT person_id, starts_at, ends_at FROM meetings WHERE ends_at >= ?1').bind(`${desde}T00:00`),
    db.prepare(`SELECT w.person_id, w.starts_at, w.ends_at FROM work_blocks w WHERE w.ends_at >= ?1 AND w.task_id NOT IN (${tareaIds.map((_, i) => `?${i + 2}`).join(',')})`)
      .bind(`${desde}T00:00`, ...tareaIds),
  ]);
  const agrupar = (rs: Fila[]) => {
    const m = new Map<string, Rango[]>();
    for (const r of rs) m.set(r.person_id, [...(m.get(r.person_id) ?? []), { inicio: aMinuto(r.starts_at), fin: aMinuto(r.ends_at) }]);
    return m;
  };
  const r = proponerSemanas({
    tareas: filas.map((f) => ({
      id: f.id, titulo: f.title, responsable: f.owner_id, responsableTieneMarca: !!f.tiene_marca, horas: f.estimated_hours, plazo: f.due, prioridad: f.priority,
      bloqueada: !!f.blocked, inputsListos: !!f.inputs_ready, sprintIniciado: !!f.sprint_status && f.sprint_status !== 'Planificado', dependencias: JSON.parse(f.deps),
    })),
    hechas: new Set(hechas!.results.map((x) => x.id)),
    terminos: new Map(planes!.results.filter((p) => !tareaIds.includes(p.task_id)).map((p) => [p.task_id, aMinuto(p.finish)])),
    reuniones: agrupar(reuniones!.results), reservado: agrupar(bloques!.results), cfg: await configJornada(db), desde,
  });
  return { ...r, filas };
};

const esquemaPropuesta = z.object({ tareaIds: z.array(z.string()).min(1).max(1000), desde: z.string().regex(FECHA) });

planificacion.post('/planificacion/propuesta', async (c) => {
  exigir(c, 'coordina', 'La planificación corresponde a coordinación.');
  const d = await cuerpo(c, esquemaPropuesta);
  const r = await proponer(c, d.tareaIds, d.desde);
  const titulo = new Map(r.filas.map((f) => [f.id, f.title]));
  return c.json({
    propuestas: r.propuestas.map((p) => ({ id: p.id, titulo: titulo.get(p.id), semana: p.semana, fin: aPared(p.fin), tarde: p.tarde, horas: r.filas.find((f) => f.id === p.id)!.estimated_hours })),
    problemas: r.problemas.map((p) => ({ ...p, titulo: titulo.get(p.id) })),
  });
});

planificacion.post('/planificacion/aplicar', async (c) => {
  exigir(c, 'coordina', 'La planificación corresponde a coordinación.');
  const d = await cuerpo(c, esquemaPropuesta);
  const db = c.env.DB;
  const a = c.get('actor');
  // Se recalcula en el servidor: nunca se confía en una propuesta enviada por la app.
  const r = await proponer(c, d.tareaIds, d.desde);
  const sentencias: D1PreparedStatement[] = [];
  const sprints = new Map<string, string>();
  for (const p of r.propuestas) {
    const f = r.filas.find((x) => x.id === p.id)!;
    const clave = `${f.brand_id}|${p.semana}`;
    let sprintId = sprints.get(clave);
    if (!sprintId) {
      const existente = await db.prepare("SELECT id FROM sprints WHERE brand_id = ?1 AND start_date = ?2 AND status = 'Planificado' LIMIT 1").bind(f.brand_id, p.semana).first<{ id: string }>();
      sprintId = existente?.id ?? nuevoId();
      if (!existente) {
        sentencias.push(db.prepare(`INSERT INTO sprints (id, brand_id, name, goal, start_date, end_date, facilitator_id, weekly)
            VALUES (?1, ?2, ?3, 'Completar y aprobar los entregables comprometidos antes del viernes', ?4, ?5, ?6, 1)`)
          .bind(sprintId, f.brand_id, `Semana ${p.semana}`, p.semana, finDeSprint(p.semana), a.id));
      }
      sprints.set(clave, sprintId);
    }
    sentencias.push(
      db.prepare('INSERT INTO sprint_members (sprint_id, person_id, daily_hours) VALUES (?1, ?2, 8) ON CONFLICT DO NOTHING').bind(sprintId, f.owner_id),
      db.prepare(`UPDATE tasks SET sprint_id = ?2, planned_finish = ?3, planning_risk = ?4 WHERE id = ?1`)
        .bind(p.id, sprintId, aPared(p.fin), p.tarde ? 'Entrega posterior al compromiso original' : ''),
      db.prepare(`INSERT INTO work_plans (task_id, person_id, starts_at, hours, week, weekly, late, finish) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)
          ON CONFLICT(task_id) DO UPDATE SET person_id = excluded.person_id, starts_at = excluded.starts_at, hours = excluded.hours, week = excluded.week,
          weekly = 1, late = excluded.late, finish = excluded.finish`)
        .bind(p.id, f.owner_id, aPared(p.bloques[0]!.inicio), f.estimated_hours, p.semana, p.tarde ? 1 : 0, aPared(p.fin)),
      db.prepare('DELETE FROM work_blocks WHERE task_id = ?1').bind(p.id),
      ...p.bloques.map((b) => db.prepare('INSERT INTO work_blocks (id, task_id, person_id, starts_at, ends_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(nuevoId(), p.id, f.owner_id, aPared(b.inicio), aPared(b.fin))),
      db.prepare('INSERT INTO task_events (id, task_id, event, sprint_id, reason, actor_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(nuevoId(), p.id, 'Propuesta semanal aplicada', sprintId, `Semana ${p.semana}`, a.id),
    );
  }
  if (sentencias.length) await db.batch([...sentencias, auditoria(db, a.id, 'Propuesta semanal aplicada', 'planning', d.desde, { tareas: r.propuestas.length })]);
  return c.json({ aplicadas: r.propuestas.length, sprints: sprints.size, problemas: r.problemas.length });
});

