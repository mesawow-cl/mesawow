// Sprints y Scrum (§4.13, §5.5) y entrada automática al sprint planificado (A3).
import { Hono } from 'hono';
import { z } from 'zod';
import { tareaHecha } from '../shared/constantes';
import { aMinuto, type Rango } from '../shared/dominio/agenda';
import { capacidad, diasDelSprint, esLunes, faltasDePreparacion, FALTAS_DE_DATOS, finDeSprint, minutosOcupados } from '../shared/dominio/sprints';
import { hoySantiago } from '../shared/fechas';
import { configJornada } from './agenda';
import { encolarAvisos } from './avisos';
import { ErrorApi } from './errores';
import { exigir, type Ctx, type Entorno } from './identidad';
import { auditoria, cuerpo, nuevoId } from './util';

type Fila = Record<string, any>;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const cargarSprint = async (c: Ctx, id: string) => {
  const s = await c.env.DB.prepare('SELECT * FROM sprints WHERE id = ?1').bind(id).first<Fila>();
  const p = c.get('persona');
  if (!s || (!p.permisos.esAdmin && !p.marcas.includes(s.brand_id))) throw new ErrorApi(404, 'no_encontrado', 'Ese sprint no existe.');
  return s;
};

const miembros = async (db: D1Database, sprintId: string) =>
  (await db.prepare(`SELECT sm.person_id, sm.daily_hours, p.name, p.active FROM sprint_members sm JOIN people p ON p.id = sm.person_id
                      WHERE sm.sprint_id = ?1 ORDER BY p.name`).bind(sprintId).all<Fila>()).results;

/** Tareas del sprint con lo necesario para tablero, preparación y capacidad. */
const tareasDelSprint = async (db: D1Database, sprintId: string) =>
  (await db.prepare(`
    SELECT t.id, t.title, t.status, t.owner_id, o.name AS responsable, o.active AS owner_activo, t.description, t.deliverable, t.acceptance,
           t.estimated_hours, t.blocked, t.inputs_ready, t.mesa_id, m.name AS mesa, t.due,
           (SELECT count(*) FROM task_dependencies d JOIN tasks x ON x.id = d.depends_on_id
             WHERE d.task_id = t.id AND x.status NOT IN ('Aprobada','Completada') AND (x.sprint_id IS NULL OR x.sprint_id <> ?1)) AS externas,
           (SELECT count(*) FROM task_dependencies d WHERE d.task_id = t.id) AS dependencias
      FROM tasks t LEFT JOIN people o ON o.id = t.owner_id LEFT JOIN mesas m ON m.id = t.mesa_id
     WHERE t.sprint_id = ?1 ORDER BY t.due, t.title`).bind(sprintId).all<Fila>()).results;

const preparacion = (t: Fila) => faltasDePreparacion({
  owner_activo: !!t.owner_activo, description: t.description ?? '', deliverable: t.deliverable ?? '', acceptance: t.acceptance ?? '',
  estimated_hours: t.estimated_hours, blocked: !!t.blocked, inputs_ready: !!t.inputs_ready, dependenciasExternasPendientes: t.externas ?? 0,
});

/** Capacidad por miembro: ocupado = reuniones + bloques de tareas que no son de este sprint. */
const capacidades = async (db: D1Database, s: Fila, gente: Fila[], tareas: Fila[]) => {
  const cfg = await configJornada(db);
  const dias = diasDelSprint(s.start_date, cfg);
  const desde = `${s.start_date}T00:00`, hasta = `${s.end_date}T23:59`;
  const [reuniones, bloques] = await db.batch<Fila>([
    db.prepare('SELECT person_id, starts_at, ends_at FROM meetings WHERE ends_at > ?1 AND starts_at < ?2').bind(desde, hasta),
    db.prepare(`SELECT w.person_id, w.starts_at, w.ends_at FROM work_blocks w JOIN tasks t ON t.id = w.task_id
                 WHERE w.ends_at > ?1 AND w.starts_at < ?2 AND (t.sprint_id IS NULL OR t.sprint_id <> ?3)`).bind(desde, hasta, s.id),
  ]);
  return gente.map((m) => {
    const ocupado: Rango[] = [...reuniones!.results, ...bloques!.results].filter((r) => r.person_id === m.person_id)
      .map((r) => ({ inicio: aMinuto(r.starts_at), fin: aMinuto(r.ends_at) }));
    const comprometido = tareas.filter((t) => t.owner_id === m.person_id).reduce((n, t) => n + (t.estimated_hours ?? 0), 0);
    return { personaId: m.person_id, nombre: m.name, horasDiarias: m.daily_hours, dias: dias.length,
      ...capacidad(dias.length, m.daily_hours, minutosOcupados(dias, ocupado, cfg), comprometido) };
  });
};

const cambioSprint = (db: D1Database, sprintId: string, accion: string, motivo: string, actorId: string) =>
  db.prepare('INSERT INTO sprint_changes (id, sprint_id, action, reason, actor_id) VALUES (?1, ?2, ?3, ?4, ?5)').bind(nuevoId(), sprintId, accion, motivo, actorId);

const eventoTarea = (db: D1Database, tareaId: string, evento: string, sprintId: string | null, motivo: string | null, actorId: string | null, estado: string | null = null) =>
  db.prepare('INSERT INTO task_events (id, task_id, event, sprint_id, reason, status, actor_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(nuevoId(), tareaId, evento, sprintId, motivo, estado, actorId);

/**
 * A3: la tarea entra sola al sprint Planificado de la semana en que quedaron sus horas,
 * si coinciden la marca y la persona responsable es miembro. Nunca a un sprint ya iniciado.
 */
export const entrarSolaAlSprint = async (db: D1Database, tareaId: string) => {
  const t = await db.prepare('SELECT id, title, brand_id, owner_id, sprint_id, status, start_date FROM tasks WHERE id = ?1').bind(tareaId).first<Fila>();
  if (!t || t.sprint_id || tareaHecha(t.status) || !t.owner_id) return null;
  const primero = await db.prepare('SELECT min(starts_at) AS d FROM work_blocks WHERE task_id = ?1').bind(tareaId).first<{ d: string | null }>();
  const dia = (primero?.d ?? t.start_date).slice(0, 10);
  const s = await db.prepare(`SELECT s.id, s.name FROM sprints s JOIN sprint_members sm ON sm.sprint_id = s.id AND sm.person_id = ?2
                               WHERE s.status = 'Planificado' AND s.brand_id = ?1 AND ?3 BETWEEN s.start_date AND s.end_date
                               ORDER BY s.start_date LIMIT 1`).bind(t.brand_id, t.owner_id, dia).first<Fila>();
  if (!s) return null;
  const motivo = 'Automática: sus horas de trabajo caen en la semana del sprint';
  await db.batch([
    db.prepare('UPDATE tasks SET sprint_id = ?2 WHERE id = ?1 AND sprint_id IS NULL').bind(tareaId, s.id),
    eventoTarea(db, tareaId, 'Agregada', s.id, motivo, null),
    db.prepare("INSERT INTO sprint_changes (id, sprint_id, action, reason) VALUES (?1, ?2, ?3, ?4)").bind(nuevoId(), s.id, `Tarea agregada: ${t.title}`, motivo),
    ...encolarAvisos(db, 'Tu tarea entró sola a un sprint', tareaId, [t.owner_id], { sprint: s.name }),
  ]);
  return s.name as string;
};

// ─────────────────────────────── rutas

export const sprints = new Hono<Entorno>();

sprints.get('/sprints', async (c) => {
  const p = c.get('persona');
  const marcas = p.permisos.esAdmin ? null : p.marcas;
  const cond = marcas ? `s.brand_id IN (${marcas.map((_, i) => `?${i + 2}`).join(',') || "''"})` : '1 = 1';
  // Quien no coordina ve los sprints de los que es miembro.
  const miembro = p.permisos.coordina || p.permisos.coordinaODirige ? '' : 'AND EXISTS (SELECT 1 FROM sprint_members sm WHERE sm.sprint_id = s.id AND sm.person_id = ?1)';
  const { results } = await c.env.DB.prepare(`
    SELECT s.id, s.name, s.status, s.start_date, s.end_date, s.goal, s.brand_id, b.name AS marca, b.color,
           (SELECT count(*) FROM tasks t WHERE t.sprint_id = s.id) AS tareas,
           (SELECT count(*) FROM tasks t WHERE t.sprint_id = s.id AND t.status IN ('Aprobada','Completada')) AS terminadas
      FROM sprints s JOIN brands b ON b.id = s.brand_id
     WHERE ${cond} ${miembro}
     ORDER BY CASE s.status WHEN 'Activo' THEN 0 WHEN 'En revisión' THEN 1 WHEN 'Planificado' THEN 2 ELSE 3 END, s.start_date DESC`)
    .bind(p.id, ...(marcas ?? [])).all();
  return c.json({ sprints: results });
});

sprints.get('/sprints/:id', async (c) => {
  const db = c.env.DB;
  const s = await cargarSprint(c, c.req.param('id'));
  const [gente, tareas, diario, cambios, cerrados] = await Promise.all([
    miembros(db, s.id),
    tareasDelSprint(db, s.id),
    db.prepare(`SELECT d.*, t.title, p.name AS persona, r.name AS resuelve FROM sprint_daily d LEFT JOIN tasks t ON t.id = d.task_id
                LEFT JOIN people p ON p.id = d.person_id LEFT JOIN people r ON r.id = d.resolver_id WHERE d.sprint_id = ?1 ORDER BY d.created_at DESC`).bind(s.id).all(),
    db.prepare(`SELECT sc.action, sc.reason, sc.created_at, p.name AS autor FROM sprint_changes sc LEFT JOIN people p ON p.id = sc.actor_id
                WHERE sc.sprint_id = ?1 ORDER BY sc.created_at DESC`).bind(s.id).all(),
    db.prepare('SELECT * FROM sprint_closed_records WHERE sprint_id = ?1').bind(s.id).all(),
  ]);
  const p = c.get('persona');
  let backlog: Fila[] = [];
  if (p.permisos.coordina && s.status !== 'Cerrado') {
    backlog = (await db.prepare(`
      SELECT t.id, t.title, t.status, t.owner_id, o.name AS responsable, o.active AS owner_activo, t.description, t.deliverable, t.acceptance,
             t.estimated_hours, t.blocked, t.inputs_ready, t.priority, t.backlog_rank, t.due,
             (SELECT count(*) FROM task_dependencies d JOIN tasks x ON x.id = d.depends_on_id WHERE d.task_id = t.id AND x.status NOT IN ('Aprobada','Completada')) AS externas
        FROM tasks t LEFT JOIN people o ON o.id = t.owner_id
       WHERE t.brand_id = ?1 AND t.sprint_id IS NULL AND t.status NOT IN ('Aprobada','Completada')
       ORDER BY coalesce(t.backlog_rank, 999), CASE t.priority WHEN 'Urgente' THEN 0 WHEN 'Alta' THEN 1 WHEN 'Media' THEN 2 ELSE 3 END, t.due`)
      .bind(s.brand_id).all<Fila>()).results.map((t) => ({ ...t, faltas: preparacion(t) }));
  }
  return c.json({
    sprint: s,
    miembros: await capacidades(db, s, gente, tareas),
    tareas: tareas.map((t) => ({ ...t, faltas: preparacion(t) })),
    backlog, diario: diario.results, cambios: cambios.results, cerrados: cerrados.results,
  });
});

const esquemaSprint = z.object({
  marcaId: z.string().min(1, 'Elige la marca.'),
  nombre: z.string().trim().min(3, 'Ponle nombre al sprint.').max(120),
  objetivo: z.string().trim().min(3, 'Escribe el objetivo del sprint.').max(500),
  inicio: z.string().regex(FECHA, 'Fecha de inicio inválida.').refine(esLunes, 'El sprint semanal comienza el lunes.'),
  facilitadorId: z.string().nullable().default(null),
  miembros: z.array(z.object({ personaId: z.string(), horasDiarias: z.number().min(0).max(8).multipleOf(0.5) })).min(1, 'Agrega al menos un miembro.'),
  motivo: z.string().trim().max(500).optional(),
});

const validarMiembros = async (db: D1Database, marcaId: string, ids: string[]) => {
  const { results } = await db.prepare(`SELECT p.id, p.name, p.active, p.role, EXISTS (SELECT 1 FROM person_brands pb WHERE pb.person_id = p.id AND pb.brand_id = ?1) AS tiene
      FROM people p WHERE p.id IN (${ids.map((_, i) => `?${i + 2}`).join(',')})`).bind(marcaId, ...ids).all<Fila>();
  for (const id of ids) {
    const p = results.find((r) => r.id === id);
    if (!p || !p.active) throw new ErrorApi(400, 'datos_invalidos', 'Uno de los miembros no existe o está inactivo.');
    if (!p.tiene && p.role !== 'Administrador general') throw new ErrorApi(400, 'datos_invalidos', `${p.name} no tiene asignada la marca del sprint.`);
  }
};

sprints.post('/sprints', async (c) => {
  exigir(c, 'coordina', 'La planificación corresponde a coordinación y Marketing.');
  const d = await cuerpo(c, esquemaSprint);
  const db = c.env.DB;
  const a = c.get('actor');
  if (!a.permisos.esAdmin && !a.marcas.includes(d.marcaId)) throw new ErrorApi(403, 'sin_permiso', 'No tienes asignada esa marca.');
  await validarMiembros(db, d.marcaId, d.miembros.map((m) => m.personaId));
  const id = nuevoId();
  await db.batch([
    db.prepare('INSERT INTO sprints (id, brand_id, name, goal, start_date, end_date, facilitator_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(id, d.marcaId, d.nombre, d.objetivo, d.inicio, finDeSprint(d.inicio), d.facilitadorId ?? a.id),
    ...d.miembros.map((m) => db.prepare('INSERT INTO sprint_members (sprint_id, person_id, daily_hours) VALUES (?1, ?2, ?3)').bind(id, m.personaId, m.horasDiarias)),
    cambioSprint(db, id, 'Sprint creado', 'Planificación inicial', a.id),
    auditoria(db, a.id, `Sprint creado ${d.nombre}`, 'sprint', id),
  ]);
  return c.json({ id }, 201);
});

sprints.patch('/sprints/:id', async (c) => {
  exigir(c, 'coordina', 'La planificación corresponde a coordinación y Marketing.');
  const d = await cuerpo(c, esquemaSprint);
  const db = c.env.DB;
  const s = await cargarSprint(c, c.req.param('id'));
  if (s.status !== 'Planificado') throw new ErrorApi(409, 'iniciado', 'El sprint ya empezó: registra los cambios de alcance agregando o retirando tareas.');
  if (!d.motivo) throw new ErrorApi(400, 'datos_invalidos', 'Escribe el motivo del cambio de planificación.');
  if (d.marcaId !== s.brand_id) throw new ErrorApi(400, 'datos_invalidos', 'La marca de un sprint no cambia.');
  await validarMiembros(db, d.marcaId, d.miembros.map((m) => m.personaId));
  const a = c.get('actor');
  await db.batch([
    db.prepare(`UPDATE sprints SET name = ?2, goal = ?3, start_date = ?4, end_date = ?5, facilitator_id = ?6, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`)
      .bind(s.id, d.nombre, d.objetivo, d.inicio, finDeSprint(d.inicio), d.facilitadorId ?? s.facilitator_id),
    db.prepare('DELETE FROM sprint_members WHERE sprint_id = ?1').bind(s.id),
    ...d.miembros.map((m) => db.prepare('INSERT INTO sprint_members (sprint_id, person_id, daily_hours) VALUES (?1, ?2, ?3)').bind(s.id, m.personaId, m.horasDiarias)),
    cambioSprint(db, s.id, 'Planificación editada', d.motivo, a.id),
  ]);
  return c.json({ ok: true });
});

sprints.post('/sprints/:id/iniciar', async (c) => {
  exigir(c, 'coordina', 'La planificación corresponde a coordinación y Marketing.');
  const { excepcion } = await cuerpo(c, z.object({ excepcion: z.string().trim().max(500).optional() }));
  const db = c.env.DB;
  const s = await cargarSprint(c, c.req.param('id'));
  if (s.status !== 'Planificado') throw new ErrorApi(409, 'estado', 'Solo se inicia un sprint planificado.');
  if (!esLunes(s.start_date)) throw new ErrorApi(409, 'estado', 'El sprint semanal comienza el lunes.');
  const [gente, tareas] = await Promise.all([miembros(db, s.id), tareasDelSprint(db, s.id)]);
  if (!tareas.length) throw new ErrorApi(409, 'sin_tareas', 'Agrega al menos una tarea antes de iniciar.');
  for (const t of tareas) {
    const faltas = preparacion(t);
    const datos = faltas.filter((f) => FALTAS_DE_DATOS.has(f));
    if (datos.length) throw new ErrorApi(409, 'no_lista', `"${t.title}" no está lista: falta ${datos.slice(0, 2).join(' y ').toLowerCase()}.`);
    if (t.blocked) throw new ErrorApi(409, 'bloqueada', `"${t.title}" está bloqueada: resuélvelo antes de iniciar.`);
    if (!t.inputs_ready) throw new ErrorApi(409, 'inputs', `"${t.title}" tiene inputs sin validar.`);
    if (t.externas) throw new ErrorApi(409, 'dependencia', `"${t.title}" depende de trabajo fuera del sprint que no está terminado.`);
  }
  const caps = await capacidades(db, s, gente, tareas);
  const sobre = caps.find((m) => m.sobreTope);
  if (sobre) throw new ErrorApi(409, 'sobrecarga', `${sobre.nombre} supera el 80 % de su capacidad (${sobre.comprometido} h de ${sobre.disponible} h disponibles). Retira o reasigna tareas.`);
  // Un miembro en otro sprint abierto que se cruza en fechas exige autorización con motivo.
  const cruce = await db.prepare(`SELECT p.name, s2.name AS sprint FROM sprint_members a JOIN sprint_members b ON b.person_id = a.person_id AND b.sprint_id <> a.sprint_id
      JOIN sprints s2 ON s2.id = b.sprint_id JOIN people p ON p.id = a.person_id
     WHERE a.sprint_id = ?1 AND s2.status IN ('Activo','En revisión') AND s2.start_date <= ?3 AND s2.end_date >= ?2 LIMIT 1`)
    .bind(s.id, s.start_date, s.end_date).first<Fila>();
  if (cruce && !excepcion) {
    return c.json({ error: { code: 'requiere_excepcion', message: `${cruce.name} también está en el sprint "${cruce.sprint}" esas fechas. Indica el motivo para autorizar el inicio.` } }, 409);
  }
  const a = c.get('actor');
  const linea = { at: new Date().toISOString(), goal: s.goal, start: s.start_date, end: s.end_date, tasks: tareas.map((t) => ({ id: t.id, owner: t.owner_id, hours: t.estimated_hours, due: t.due })), capacity: caps, exception: excepcion ?? null };
  await db.batch([
    db.prepare("UPDATE sprints SET status = 'Activo', baseline_json = ?2 WHERE id = ?1").bind(s.id, JSON.stringify(linea)),
    cambioSprint(db, s.id, 'Sprint iniciado', excepcion ? `Excepción autorizada: ${excepcion}` : 'Inicio según planificación', a.id),
    auditoria(db, a.id, `Sprint iniciado ${s.name}`, 'sprint', s.id),
    ...encolarAvisos(db, 'Inicio de sprint', null, gente.map((m) => m.person_id).filter((x) => x !== a.id), { sprint: s.name }),
  ]);
  return c.json({ ok: true });
});

sprints.post('/sprints/:id/revision', async (c) => {
  exigir(c, 'coordina', 'La planificación corresponde a coordinación y Marketing.');
  const db = c.env.DB;
  const s = await cargarSprint(c, c.req.param('id'));
  if (s.status !== 'Activo') throw new ErrorApi(409, 'estado', 'Solo un sprint activo pasa a revisión.');
  const a = c.get('actor');
  const gente = await miembros(db, s.id);
  await db.batch([
    db.prepare("UPDATE sprints SET status = 'En revisión' WHERE id = ?1").bind(s.id),
    auditoria(db, a.id, `Sprint en revisión ${s.name}`, 'sprint', s.id),
    ...encolarAvisos(db, 'Sprint en revisión', null, gente.map((m) => m.person_id).filter((x) => x !== a.id), { sprint: s.name }),
  ]);
  return c.json({ ok: true });
});

const esquemaCierre = z.object({
  resultado: z.enum(['Alcanzado', 'Parcialmente alcanzado', 'No alcanzado']),
  evidenciaObjetivo: z.string().trim().max(2000).default(''),
  revision: z.string().trim().min(3, 'Escribe la revisión del sprint.').max(5000),
  retro: z.string().trim().min(3, 'Escribe la retrospectiva.').max(5000),
  mejora: z.string().trim().max(300).default(''),
  mejoraResponsableId: z.string().nullable().default(null),
  mejoraFecha: z.string().regex(FECHA).nullable().default(null),
  excepcion: z.object({ causa: z.string().trim().min(3), responsableId: z.string().min(1), fecha: z.string().regex(FECHA) }).nullable().default(null),
});

sprints.post('/sprints/:id/cerrar', async (c) => {
  exigir(c, 'coordina', 'La planificación corresponde a coordinación y Marketing.');
  const d = await cuerpo(c, esquemaCierre);
  const db = c.env.DB;
  const s = await cargarSprint(c, c.req.param('id'));
  if (s.status !== 'En revisión') throw new ErrorApi(409, 'estado', 'Primero pasa el sprint a revisión.');
  if (d.resultado === 'Alcanzado' && !d.evidenciaObjetivo) throw new ErrorApi(400, 'datos_invalidos', 'Si el objetivo se alcanzó, agrega la evidencia.');
  if (d.mejora && (!d.mejoraResponsableId || !d.mejoraFecha)) throw new ErrorApi(400, 'datos_invalidos', 'La mejora necesita responsable y fecha.');
  const tareas = await tareasDelSprint(db, s.id);
  const pendientes = tareas.filter((t) => !tareaHecha(t.status));
  if (pendientes.length && !d.excepcion) {
    throw new ErrorApi(409, 'requiere_excepcion', `Quedan ${pendientes.length} tarea(s) sin terminar: el cierre requiere una excepción con causa, responsable y fecha.`);
  }
  if (d.excepcion && d.excepcion.fecha < hoySantiago()) throw new ErrorApi(400, 'datos_invalidos', 'La fecha de resolución de la excepción no puede ser pasada.');
  const a = c.get('actor');
  const riesgo = 'Excepción de cierre: requiere nueva planificación explícita.';
  const sentencias: D1PreparedStatement[] = [
    db.prepare(`UPDATE sprints SET status = 'Cerrado', goal_result = ?2, goal_evidence = ?3, review = ?4, retro = ?5, improvement = ?6,
                improvement_owner_id = ?7, improvement_date = ?8, close_exception_json = ?9, closed_at = ?10 WHERE id = ?1`)
      .bind(s.id, d.resultado, d.evidenciaObjetivo || null, d.revision, d.retro, d.mejora || null, d.mejoraResponsableId, d.mejoraFecha,
        d.excepcion ? JSON.stringify({ ...d.excepcion, tareas: pendientes.map((t) => t.id), por: a.id, en: new Date().toISOString() }) : null, new Date().toISOString()),
    ...tareas.map((t) => db.prepare('INSERT INTO sprint_closed_records (sprint_id, task_id, title, status, approved) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT DO NOTHING')
      .bind(s.id, t.id, t.title, t.status, tareaHecha(t.status) ? 1 : 0)),
    // Lo pendiente vuelve al backlog, con su historial.
    ...pendientes.flatMap((t) => [
      db.prepare('UPDATE tasks SET sprint_id = NULL, planning_risk = ?2 WHERE id = ?1').bind(t.id, riesgo),
      eventoTarea(db, t.id, 'Excepción de cierre registrada', s.id, d.excepcion!.causa, a.id, t.status),
    ]),
    ...tareas.filter((t) => tareaHecha(t.status)).map((t) => eventoTarea(db, t.id, 'Terminada y aprobada', s.id, null, a.id, t.status)),
    cambioSprint(db, s.id, pendientes.length ? `Excepción de cierre con ${pendientes.length} pendientes` : 'Sprint cerrado', d.excepcion?.causa ?? 'Todo terminado', a.id),
    auditoria(db, a.id, `Sprint cerrado ${s.name}`, 'sprint', s.id),
  ];
  if (d.mejora) {
    const id = nuevoId();
    sentencias.push(db.prepare(`INSERT INTO tasks (id, brand_id, title, description, deliverable, acceptance, owner_id, reviewer_id, start_date, due, complexity, priority, status, created_by)
        VALUES (?1, ?2, ?3, ?4, 'Mejora documentada', 'Revisión de cumplimiento de la mejora', ?5, ?6, ?7, ?8, 'Baja', 'Media', 'Pendiente', ?6)`)
      .bind(id, s.brand_id, d.mejora, `Acción de retrospectiva del sprint ${s.name}`, d.mejoraResponsableId, a.id, s.end_date < d.mejoraFecha! ? s.end_date : d.mejoraFecha, d.mejoraFecha));
  }
  const gente = await miembros(db, s.id);
  sentencias.push(...encolarAvisos(db, 'Cierre de sprint', null, gente.map((m) => m.person_id).filter((x) => x !== a.id), { sprint: s.name, resultado: d.resultado }));
  await db.batch(sentencias);
  return c.json({ ok: true, alBacklog: pendientes.length });
});

sprints.post('/sprints/:id/tareas', async (c) => {
  exigir(c, 'coordina', 'La planificación corresponde a coordinación y Marketing.');
  const d = await cuerpo(c, z.object({ tareaId: z.string(), motivo: z.string().trim().max(500).optional() }));
  const db = c.env.DB;
  const s = await cargarSprint(c, c.req.param('id'));
  if (s.status === 'Cerrado') throw new ErrorApi(409, 'cerrado', 'El sprint está cerrado.');
  const t = await db.prepare('SELECT id, title, brand_id, owner_id, sprint_id, status FROM tasks WHERE id = ?1').bind(d.tareaId).first<Fila>();
  if (!t || t.brand_id !== s.brand_id) throw new ErrorApi(404, 'no_encontrado', 'Esa tarea no existe en la marca del sprint.');
  if (t.sprint_id) throw new ErrorApi(409, 'en_sprint', 'La tarea ya está en un sprint.');
  if (tareaHecha(t.status)) throw new ErrorApi(409, 'terminada', 'La tarea ya está terminada.');
  if (!(await db.prepare('SELECT 1 FROM sprint_members WHERE sprint_id = ?1 AND person_id = ?2').bind(s.id, t.owner_id ?? '').first())) {
    throw new ErrorApi(409, 'no_miembro', 'La persona responsable no es miembro del sprint.');
  }
  const motivo = s.status === 'Planificado' ? 'Planificación inicial' : d.motivo;
  if (!motivo) throw new ErrorApi(400, 'datos_invalidos', 'El sprint ya empezó: escribe el motivo del cambio de alcance.');
  const a = c.get('actor');
  await db.batch([
    db.prepare("UPDATE tasks SET sprint_id = ?2, planning_risk = '' WHERE id = ?1").bind(t.id, s.id),
    eventoTarea(db, t.id, 'Agregada', s.id, motivo, a.id),
    cambioSprint(db, s.id, `Tarea agregada: ${t.title}`, motivo, a.id),
  ]);
  return c.json({ ok: true });
});

sprints.post('/sprints/:id/retirar', async (c) => {
  exigir(c, 'coordina', 'La planificación corresponde a coordinación y Marketing.');
  const d = await cuerpo(c, z.object({ tareaId: z.string(), motivo: z.string().trim().min(3, 'Escribe por qué se retira.').max(500) }));
  const db = c.env.DB;
  const s = await cargarSprint(c, c.req.param('id'));
  if (s.status === 'Cerrado') throw new ErrorApi(409, 'cerrado', 'El sprint está cerrado.');
  const r = await db.prepare('UPDATE tasks SET sprint_id = NULL WHERE id = ?1 AND sprint_id = ?2').bind(d.tareaId, s.id).run();
  if (!r.meta.changes) throw new ErrorApi(404, 'no_encontrado', 'Esa tarea no está en el sprint.');
  const a = c.get('actor');
  await db.batch([eventoTarea(db, d.tareaId, 'Retirada con motivo', s.id, d.motivo, a.id), cambioSprint(db, s.id, 'Tarea retirada', d.motivo, a.id)]);
  return c.json({ ok: true });
});

sprints.post('/sprints/:id/diario', async (c) => {
  const d = await cuerpo(c, z.object({
    tareaId: z.string(), dia: z.string().regex(FECHA), avance: z.string().trim().min(2, 'Cuenta qué avanzaste.').max(2000),
    siguiente: z.string().trim().max(2000).default(''), bloqueo: z.string().trim().max(1000).default(''),
    resuelveId: z.string().nullable().default(null), fechaRequerida: z.string().regex(FECHA).nullable().default(null),
  }));
  const db = c.env.DB;
  const s = await cargarSprint(c, c.req.param('id'));
  if (s.status !== 'Activo') throw new ErrorApi(409, 'estado', 'El avance diario se registra con el sprint activo.');
  if (d.dia < s.start_date || d.dia > s.end_date) throw new ErrorApi(400, 'datos_invalidos', 'La fecha debe ser un día del sprint.');
  const t = await db.prepare(`SELECT t.id, t.title, t.owner_id, t.reviewer_id, EXISTS (SELECT 1 FROM task_people tp WHERE tp.task_id = t.id AND tp.person_id = ?3 AND tp.role = 'collaborator') AS colabora
      FROM tasks t WHERE t.id = ?1 AND t.sprint_id = ?2`).bind(d.tareaId, s.id, c.get('actor').id).first<Fila>();
  if (!t) throw new ErrorApi(404, 'no_encontrado', 'Esa tarea no está en el sprint.');
  const a = c.get('actor');
  if (t.owner_id !== a.id && !t.colabora && !a.permisos.coordina) throw new ErrorApi(403, 'sin_permiso', 'Solo quien ejecuta la tarea registra su avance.');
  if (d.bloqueo && (!d.resuelveId || !d.fechaRequerida)) throw new ErrorApi(400, 'datos_invalidos', 'Un bloqueo necesita quién lo resuelve y para cuándo.');
  await db.batch([
    db.prepare(`INSERT INTO sprint_daily (id, sprint_id, task_id, person_id, day, progress, next, block, resolver_id, required_date)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(nuevoId(), s.id, t.id, a.id, d.dia, d.avance, d.siguiente, d.bloqueo, d.resuelveId, d.fechaRequerida),
    ...(d.bloqueo ? [
      db.prepare('UPDATE tasks SET blocked = 1, block_reason = ?2, block_resolver_id = ?3, block_due = ?4, version = version + 1 WHERE id = ?1').bind(t.id, d.bloqueo, d.resuelveId, d.fechaRequerida),
      auditoria(db, a.id, `Bloqueo registrado ${t.title}`, 'task', t.id, { bloqueo: d.bloqueo }),
      ...encolarAvisos(db, 'Bloqueo registrado en sprint', t.id, [t.owner_id, t.reviewer_id, d.resuelveId].filter((x): x is string => !!x && x !== a.id), { bloqueo: d.bloqueo }),
    ] : []),
  ]);
  return c.json({ ok: true }, 201);
});

sprints.post('/backlog/orden', async (c) => {
  exigir(c, 'coordina', 'El orden del backlog lo define coordinación.');
  const { marcaId, orden } = await cuerpo(c, z.object({ marcaId: z.string(), orden: z.array(z.string()).max(500) }));
  const db = c.env.DB;
  await db.batch(orden.map((id, i) => db.prepare('UPDATE tasks SET backlog_rank = ?2 WHERE id = ?1 AND brand_id = ?3 AND sprint_id IS NULL').bind(id, i, marcaId)));
  return c.json({ ok: true });
});

sprints.post('/tareas/:id/preparar', async (c) => {
  exigir(c, 'coordina', 'Preparar tareas corresponde a coordinación.');
  const d = await cuerpo(c, z.object({
    horas: z.number().min(0.5).max(320).multipleOf(0.5), criterio: z.string().trim().min(1, 'Escribe el criterio de aceptación.').max(2000),
    instruccion: z.string().trim().min(1, 'Escribe la instrucción.').max(5000), inputsListos: z.boolean().optional(),
  }));
  const db = c.env.DB;
  const a = c.get('actor');
  const t = await db.prepare('SELECT brand_id FROM tasks WHERE id = ?1').bind(c.req.param('id')).first<{ brand_id: string }>();
  if (!t || (!a.permisos.esAdmin && !a.marcas.includes(t.brand_id))) throw new ErrorApi(404, 'no_encontrado', 'Esa tarea no existe.');
  const r = await db.prepare(`UPDATE tasks SET estimated_hours = ?2, acceptance = ?3, description = ?4, inputs_ready = coalesce(?5, inputs_ready), version = version + 1 WHERE id = ?1`)
    .bind(c.req.param('id'), d.horas, d.criterio, d.instruccion, d.inputsListos === undefined ? null : d.inputsListos ? 1 : 0).run();
  if (!r.meta.changes) throw new ErrorApi(404, 'no_encontrado', 'Esa tarea no existe.');
  return c.json({ ok: true });
});
