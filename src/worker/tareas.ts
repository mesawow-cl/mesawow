// Tareas (requerimiento §4.8 y §5.1).
import { Hono } from 'hono';
import { z } from 'zod';
import { ESTADOS_TAREA, tareaHecha, type EstadoTarea } from '../shared/constantes';
import {
  accionesPosibles, creaCiclo, estadoAlEntregar, impedimentoParaAprobar, impedimentoParaAvanzar, participa, type TareaReglas,
} from '../shared/dominio/tareas';
import { hoySantiago } from '../shared/fechas';
import { encolarAvisos } from './avisos';
import { ErrorApi } from './errores';
import { exigir, type Ctx, type Entorno, type Persona } from './identidad';
import { auditoria, cuerpo, nuevoId } from './util';

type Fila = Record<string, any>;

export interface TareaCompleta extends TareaReglas {
  fila: Fila;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Carga una tarea con sus personas y dependencias. */
export const cargarTarea = async (db: D1Database, id: string): Promise<TareaCompleta | null> => {
  const [t, gente, deps, resultados] = await db.batch([
    db.prepare('SELECT * FROM tasks WHERE id = ?1').bind(id),
    db.prepare('SELECT person_id, role FROM task_people WHERE task_id = ?1').bind(id),
    db.prepare(`SELECT d.depends_on_id AS id, x.status FROM task_dependencies d JOIN tasks x ON x.id = d.depends_on_id WHERE d.task_id = ?1`).bind(id),
    db.prepare('SELECT count(*) AS n FROM task_results WHERE task_id = ?1').bind(id),
  ]);
  const fila = t!.results[0] as Fila | undefined;
  if (!fila) return null;
  const personas = gente!.results as { person_id: string; role: string }[];
  return {
    fila,
    status: fila.status,
    blocked: !!fila.blocked,
    owner_id: fila.owner_id,
    reviewer_id: fila.reviewer_id,
    collaborators: personas.filter((p) => p.role === 'collaborator').map((p) => p.person_id),
    approvers: personas.filter((p) => p.role === 'approver').map((p) => p.person_id),
    acceptance: fila.acceptance ?? '',
    tieneEvidencia: ((resultados!.results[0] as { n: number }).n ?? 0) > 0,
    dependenciasPendientes: (deps!.results as { status: string }[]).filter((d) => !tareaHecha(d.status)).length,
    confidential: !!fila.confidential,
  };
};

/** Visibilidad (§5.2): marca permitida y (admin, coordinación o participa); confidencial solo participantes o admin. */
export const puedeVer = (t: TareaCompleta, p: Persona) => {
  if (p.permisos.esAdmin) return true;
  if (!p.marcas.includes(t.fila.brand_id)) return false;
  const esParte = participa(t, p.id);
  if (t.confidential) return esParte;
  return p.permisos.coordina || esParte;
};

/** Condición SQL equivalente a `puedeVer` sobre la tabla tasks con alias `t`. */
export const filtroVisible = (p: Persona, desde = 1): { sql: string; params: unknown[] } => {
  if (p.permisos.esAdmin) return { sql: '1 = 1', params: [] };
  const n = (i: number) => `?${desde + i}`;
  const marcas = p.marcas.length ? p.marcas.map((_, i) => n(i + 1)).join(',') : `''`;
  const yo = n(0);
  const parte = `(t.owner_id = ${yo} OR t.reviewer_id = ${yo} OR EXISTS (SELECT 1 FROM task_people tp WHERE tp.task_id = t.id AND tp.person_id = ${yo}))`;
  const general = p.permisos.coordina ? `(t.confidential = 0 OR ${parte})` : parte;
  return { sql: `(t.brand_id IN (${marcas}) AND ${general})`, params: [p.id, ...p.marcas] };
};

const tareaVisible = async (c: Ctx, id: string) => {
  const t = await cargarTarea(c.env.DB, id);
  if (!t || !puedeVer(t, c.get('persona'))) throw new ErrorApi(404, 'no_encontrado', 'Esa tarea no existe o no está asignada a tu vista.');
  return t;
};

const participantes = (t: TareaReglas) =>
  [t.owner_id, t.reviewer_id, ...t.collaborators, ...t.approvers].filter((x): x is string => !!x);

const actualizar = (db: D1Database, id: string, cambios: Record<string, unknown>) => {
  const cols = Object.keys(cambios);
  return db.prepare(`UPDATE tasks SET ${cols.map((c, i) => `${c} = ?${i + 2}`).join(', ')}, version = version + 1,
                      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`)
    .bind(id, ...cols.map((c) => cambios[c]));
};

// ─────────────────────────────── esquema del formulario

const esquemaTarea = z.object({
  titulo: z.string().trim().min(3, 'Escribe un título para la tarea.').max(200),
  marcaId: z.string().min(1, 'Elige la marca.'),
  campanaId: z.string().nullable().optional(),
  planId: z.string().nullable().optional(),
  mesaId: z.string().nullable().optional(),
  descripcion: z.string().trim().min(1, 'Escribe qué hay que hacer.').max(5000),
  entregable: z.string().trim().min(1, 'Indica el entregable.').max(1000),
  criterio: z.string().trim().min(1, 'Escribe el criterio de aceptación: cómo sabremos que está lista.').max(2000),
  responsableId: z.string().min(1, 'Elige a la persona responsable.'),
  revisorId: z.string().nullable().optional(),
  colaboradores: z.array(z.string()).default([]),
  aprobadores: z.array(z.string()).default([]),
  inicio: z.string().regex(FECHA, 'Fecha de inicio inválida.'),
  plazo: z.string().regex(FECHA, 'Fecha límite inválida.'),
  horas: z.number().min(0).max(320).multipleOf(0.25).optional(),
  complejidad: z.enum(['Baja', 'Media', 'Alta']).default('Media'),
  prioridad: z.enum(['Urgente', 'Alta', 'Media', 'Baja']).default('Media'),
  dependencias: z.array(z.string()).default([]),
  version: z.number().int().optional(),
}).refine((d) => d.inicio <= d.plazo, { message: 'La fecha límite debe ser igual o posterior al inicio.' });

type DatosTarea = z.infer<typeof esquemaTarea>;

const validarTarea = async (db: D1Database, d: DatosTarea, tareaId: string | null) => {
  const marca = await db.prepare('SELECT id FROM brands WHERE id = ?1 AND archived = 0').bind(d.marcaId).first();
  if (!marca) throw new ErrorApi(400, 'datos_invalidos', 'La marca no existe.');
  if (d.campanaId && !(await db.prepare('SELECT 1 FROM campaigns WHERE id = ?1 AND brand_id = ?2').bind(d.campanaId, d.marcaId).first())) {
    throw new ErrorApi(400, 'datos_invalidos', 'La campaña no pertenece a esa marca.');
  }
  if (d.planId && !(await db.prepare('SELECT 1 FROM strategic_plans WHERE id = ?1 AND brand_id = ?2').bind(d.planId, d.marcaId).first())) {
    throw new ErrorApi(400, 'datos_invalidos', 'El plan estratégico no pertenece a esa marca.');
  }
  if (d.mesaId && !(await db.prepare('SELECT 1 FROM mesas WHERE id = ?1 AND active = 1').bind(d.mesaId).first())) {
    throw new ErrorApi(400, 'datos_invalidos', 'La mesa no existe o está archivada.');
  }
  // Toda persona asignada debe estar activa y tener la marca (o ser administradora general).
  const ids = [...new Set([d.responsableId, d.revisorId, ...d.colaboradores, ...d.aprobadores].filter((x): x is string => !!x))];
  const { results } = await db.prepare(`SELECT p.id, p.name, p.active, p.role,
        EXISTS (SELECT 1 FROM person_brands pb WHERE pb.person_id = p.id AND pb.brand_id = ?1) AS tiene_marca
      FROM people p WHERE p.id IN (${ids.map((_, i) => `?${i + 2}`).join(',')})`).bind(d.marcaId, ...ids).all<Fila>();
  for (const id of ids) {
    const p = results.find((r) => r.id === id);
    if (!p || !p.active) throw new ErrorApi(400, 'datos_invalidos', 'Una de las personas asignadas no existe o está inactiva.');
    if (!p.tiene_marca && p.role !== 'Administrador general') throw new ErrorApi(400, 'datos_invalidos', `${p.name} no tiene asignada esta marca. Revisa Equipo.`);
  }
  // Dependencias: existen, no son la misma tarea y no forman ciclos.
  const deps = [...new Set(d.dependencias)];
  if (tareaId && deps.includes(tareaId)) throw new ErrorApi(400, 'datos_invalidos', 'Una tarea no puede depender de sí misma.');
  if (deps.length) {
    const existen = await db.prepare(`SELECT count(*) AS n FROM tasks WHERE id IN (${deps.map((_, i) => `?${i + 1}`).join(',')})`).bind(...deps).first<{ n: number }>();
    if (existen?.n !== deps.length) throw new ErrorApi(400, 'datos_invalidos', 'Alguna dependencia no existe.');
    if (tareaId) {
      const { results: aristas } = await db.prepare('SELECT task_id, depends_on_id FROM task_dependencies').all<{ task_id: string; depends_on_id: string }>();
      const mapa = new Map<string, string[]>();
      for (const a of aristas) if (a.task_id !== tareaId) mapa.set(a.task_id, [...(mapa.get(a.task_id) ?? []), a.depends_on_id]);
      if (creaCiclo(tareaId, deps, mapa)) throw new ErrorApi(400, 'datos_invalidos', 'Esta dependencia crea un ciclo.');
    }
  }
  return deps;
};

const columnas = (d: DatosTarea) => ({
  brand_id: d.marcaId, campaign_id: d.campanaId || null, plan_id: d.planId || null, mesa_id: d.mesaId || null,
  title: d.titulo, description: d.descripcion, deliverable: d.entregable, acceptance: d.criterio,
  owner_id: d.responsableId, reviewer_id: d.revisorId || null, start_date: d.inicio, due: d.plazo,
  estimated_hours: d.horas ?? 0, complexity: d.complejidad, priority: d.prioridad,
});

const sentenciasPersonas = (db: D1Database, id: string, d: DatosTarea, deps: string[]) => [
  db.prepare('DELETE FROM task_people WHERE task_id = ?1').bind(id),
  ...[...new Set(d.colaboradores)].filter((p) => p !== d.responsableId).map((p) =>
    db.prepare("INSERT INTO task_people (task_id, person_id, role) VALUES (?1, ?2, 'collaborator')").bind(id, p)),
  ...[...new Set(d.aprobadores)].map((p) => db.prepare("INSERT INTO task_people (task_id, person_id, role) VALUES (?1, ?2, 'approver')").bind(id, p)),
  db.prepare('DELETE FROM task_dependencies WHERE task_id = ?1').bind(id),
  ...deps.map((x) => db.prepare('INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?1, ?2)').bind(id, x)),
];

// ─────────────────────────────── rutas

export const tareas = new Hono<Entorno>();

tareas.get('/tareas', async (c) => {
  const p = c.get('persona');
  const q = c.req.query();
  const v = filtroVisible(p);
  const cond = [v.sql];
  const params = [...v.params];
  const agregar = (sql: string, valor: unknown) => { params.push(valor); cond.push(sql.replace('?', `?${params.length}`)); };
  if (q.estado && (ESTADOS_TAREA as readonly string[]).includes(q.estado)) agregar('t.status = ?', q.estado);
  if (q.marca) agregar('t.brand_id = ?', q.marca);
  if (q.campana) agregar('t.campaign_id = ?', q.campana);
  if (q.sprint) agregar('t.sprint_id = ?', q.sprint);
  if (q.persona) {
    params.push(q.persona);
    const n = `?${params.length}`;
    cond.push(`(t.owner_id = ${n} OR t.reviewer_id = ${n} OR EXISTS (SELECT 1 FROM task_people x WHERE x.task_id = t.id AND x.person_id = ${n}))`);
  }
  if (q.q) {
    params.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`);
    const n = `?${params.length}`;
    cond.push(`(t.title LIKE ${n} ESCAPE '\\' OR o.name LIKE ${n} ESCAPE '\\')`);
  }
  const { results } = await c.env.DB.prepare(`
    SELECT t.id, t.title, t.status, t.due, t.start_date, t.complexity, t.priority, t.blocked, t.brand_id, b.name AS marca, b.color,
           t.owner_id, o.name AS responsable, t.campaign_id, t.mesa_id, m.name AS mesa, t.estimated_hours, t.sprint_id, t.confidential
      FROM tasks t JOIN brands b ON b.id = t.brand_id LEFT JOIN people o ON o.id = t.owner_id LEFT JOIN mesas m ON m.id = t.mesa_id
     WHERE ${cond.join(' AND ')}
     ORDER BY CASE WHEN t.status IN ('Aprobada','Completada') THEN 1 ELSE 0 END, t.due, t.title
     LIMIT 500`).bind(...params).all<Fila>();
  const hoy = hoySantiago();
  return c.json({ tareas: results.map((t) => ({ ...t, atrasada: !tareaHecha(t.status) && t.due < hoy })) });
});

tareas.get('/tareas/:id', async (c) => {
  const db = c.env.DB;
  const t = await tareaVisible(c, c.req.param('id'));
  const id = t.fila.id;
  const [gente, necesita, despues, resultados, comentarios, eventos, campana] = await db.batch([
    db.prepare(`SELECT id, name FROM people WHERE id IN (SELECT ?1 UNION SELECT ?2 UNION SELECT person_id FROM task_people WHERE task_id = ?3)`)
      .bind(t.owner_id ?? '', t.reviewer_id ?? '', id),
    db.prepare(`SELECT x.id, x.title, x.status, o.name AS responsable FROM task_dependencies d JOIN tasks x ON x.id = d.depends_on_id
                LEFT JOIN people o ON o.id = x.owner_id WHERE d.task_id = ?1`).bind(id),
    db.prepare(`SELECT x.id, x.title, x.status, o.name AS responsable FROM task_dependencies d JOIN tasks x ON x.id = d.task_id
                LEFT JOIN people o ON o.id = x.owner_id WHERE d.depends_on_id = ?1`).bind(id),
    db.prepare(`SELECT r.id, r.type, r.text, r.file_key IS NOT NULL AS archivo, r.filename, r.created_at, p.name AS autor
                FROM task_results r LEFT JOIN people p ON p.id = r.created_by WHERE r.task_id = ?1 ORDER BY r.created_at DESC`).bind(id),
    db.prepare(`SELECT k.id, k.text, k.created_at, p.name AS autor FROM task_comments k LEFT JOIN people p ON p.id = k.author_id
                WHERE k.task_id = ?1 ORDER BY k.created_at`).bind(id),
    db.prepare(`SELECT a.action, a.at, p.name AS autor FROM audit_log a LEFT JOIN people p ON p.id = a.actor_id
                WHERE a.entity = 'task' AND a.entity_id = ?1 ORDER BY a.at DESC LIMIT 30`).bind(id),
    db.prepare('SELECT c.id, c.name FROM campaigns c WHERE c.id = ?1').bind(t.fila.campaign_id ?? ''),
  ]);
  const nombres = new Map((gente!.results as { id: string; name: string }[]).map((g) => [g.id, g.name]));
  const persona = c.get('persona');
  const actor = c.get('actor');
  const acciones = accionesPosibles(t, actor.id, actor.permisos);
  const viendoOtra = actor.id !== persona.id;
  return c.json({
    tarea: {
      ...t.fila,
      responsable: t.owner_id ? { id: t.owner_id, nombre: nombres.get(t.owner_id) } : null,
      revisor: t.reviewer_id ? { id: t.reviewer_id, nombre: nombres.get(t.reviewer_id) } : null,
      colaboradores: t.collaborators.map((id) => ({ id, nombre: nombres.get(id) })),
      aprobadores: t.approvers.map((id) => ({ id, nombre: nombres.get(id) })),
      necesita: necesita!.results, despues: despues!.results,
      resultados: resultados!.results, comentarios: comentarios!.results, historial: eventos!.results,
      campana: campana!.results[0] ?? null,
      atrasada: !tareaHecha(t.status) && t.fila.due < hoySantiago(),
      dependenciasPendientes: t.dependenciasPendientes,
      acciones: viendoOtra ? Object.fromEntries(Object.keys(acciones).map((k) => [k, false])) : acciones,
      impedimento: impedimentoParaAvanzar(t),
    },
  });
});

tareas.post('/tareas', async (c) => {
  exigir(c, 'coordina', 'Solicita a coordinación la creación o reasignación de tareas.');
  const d = await cuerpo(c, esquemaTarea);
  const db = c.env.DB;
  const actor = c.get('actor');
  if (!actor.permisos.esAdmin && !actor.marcas.includes(d.marcaId)) throw new ErrorApi(403, 'sin_permiso', 'No tienes asignada esa marca.');
  const deps = await validarTarea(db, d, null);
  const id = nuevoId();
  const fila = { id, ...columnas(d), status: 'Pendiente', created_by: actor.id };
  const cols = Object.keys(fila);
  await db.batch([
    db.prepare(`INSERT INTO tasks (${cols.join(',')}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(',')})`).bind(...cols.map((k) => (fila as Fila)[k])),
    ...sentenciasPersonas(db, id, d, deps),
    auditoria(db, actor.id, `Tarea creada ${d.titulo}`, 'task', id),
    ...encolarAvisos(db, 'Nueva tarea asignada', id, [d.responsableId, d.revisorId, ...d.colaboradores, ...d.aprobadores].filter((x): x is string => !!x && x !== actor.id)),
  ]);
  return c.json({ id }, 201);
});

tareas.patch('/tareas/:id', async (c) => {
  exigir(c, 'coordina', 'Solicita a coordinación la creación o reasignación de tareas.');
  const d = await cuerpo(c, esquemaTarea);
  const db = c.env.DB;
  const actor = c.get('actor');
  const t = await tareaVisible(c, c.req.param('id'));
  if (d.version !== undefined && d.version !== t.fila.version) {
    throw new ErrorApi(409, 'version', 'Otra persona cambió esta tarea mientras la editabas. Vuelve a abrirla para ver los cambios.');
  }
  const deps = await validarTarea(db, d, t.fila.id);
  const antes = new Set(participantes(t));
  const ahora = new Set([d.responsableId, d.revisorId, ...d.colaboradores, ...d.aprobadores].filter((x): x is string => !!x));
  await db.batch([
    actualizar(db, t.fila.id, columnas(d)),
    ...sentenciasPersonas(db, t.fila.id, d, deps),
    auditoria(db, actor.id, `Tarea editada ${d.titulo}`, 'task', t.fila.id),
    ...encolarAvisos(db, 'Cambio de tarea o asignación', t.fila.id, [...ahora].filter((x) => x !== actor.id)),
    ...encolarAvisos(db, 'Retiro de asignación', t.fila.id, [...antes].filter((x) => !ahora.has(x) && x !== actor.id)),
  ]);
  return c.json({ ok: true });
});

/** Ejecuta una acción del ciclo de vida verificando permisos con las reglas compartidas. */
const accion = (nombre: keyof ReturnType<typeof accionesPosibles>, mensaje: string,
  hacer: (c: Ctx, t: TareaCompleta, actor: Persona) => Promise<D1PreparedStatement[]>) =>
  async (c: Ctx) => {
    const t = await tareaVisible(c, c.req.param('id')!);
    const actor = c.get('actor');
    if (!accionesPosibles(t, actor.id, actor.permisos)[nombre]) throw new ErrorApi(403, 'sin_permiso', mensaje);
    await c.env.DB.batch(await hacer(c, t, actor));
    return c.json({ ok: true });
  };

tareas.post('/tareas/:id/empezar', accion('empezar', 'Solo quien ejecuta la tarea o coordinación puede empezarla.', async (c, t, a) => {
  const impedimento = impedimentoParaAvanzar(t);
  if (impedimento) throw new ErrorApi(409, 'impedimento', impedimento);
  return [actualizar(c.env.DB, t.fila.id, { status: 'En curso' }), auditoria(c.env.DB, a.id, `Tarea iniciada ${t.fila.title}`, 'task', t.fila.id)];
}));

tareas.post('/tareas/:id/bloquear', accion('bloquear', 'No puedes bloquear esta tarea.', async (c, t, a) => {
  const { motivo } = await cuerpo(c, z.object({ motivo: z.string().trim().min(3, 'Cuéntanos qué falta para avanzar.').max(500) }));
  const db = c.env.DB;
  return [
    actualizar(db, t.fila.id, { blocked: 1, block_reason: motivo }),
    auditoria(db, a.id, `Bloqueo registrado ${t.fila.title}`, 'task', t.fila.id, { motivo }),
    ...encolarAvisos(db, 'Bloqueo registrado', t.fila.id, participantes(t).filter((x) => x !== a.id), { motivo }),
  ];
}));

tareas.post('/tareas/:id/desbloquear', accion('desbloquear', 'No puedes desbloquear esta tarea.', async (c, t, a) => [
  actualizar(c.env.DB, t.fila.id, { blocked: 0, block_reason: '', block_resolver_id: null, block_due: null }),
  auditoria(c.env.DB, a.id, `Bloqueo resuelto ${t.fila.title}`, 'task', t.fila.id),
]));

tareas.post('/tareas/:id/entregar', accion('entregar', 'Solo responsable, revisión o aprobación pueden entregar.', async (c, t, a) => {
  const { resultado } = await cuerpo(c, z.object({ resultado: z.string().trim().max(10000).default('') }));
  if (!resultado && !t.tieneEvidencia) throw new ErrorApi(400, 'sin_resultado', 'Escribe el resultado o adjunta un archivo antes de entregar.');
  const impedimento = impedimentoParaAvanzar(t);
  if (impedimento) throw new ErrorApi(409, 'impedimento', impedimento);
  const db = c.env.DB;
  const estado = estadoAlEntregar(t);
  return [
    ...(resultado ? [db.prepare("INSERT INTO task_results (id, task_id, type, text, created_by) VALUES (?1, ?2, 'text', ?3, ?4)").bind(nuevoId(), t.fila.id, resultado, a.id)] : []),
    actualizar(db, t.fila.id, { status: estado }),
    auditoria(db, a.id, `Tarea entregada ${t.fila.title}`, 'task', t.fila.id),
    ...(estado === 'Entregada para revisión'
      ? encolarAvisos(db, 'Entrega para revisión', t.fila.id, [t.reviewer_id, ...t.approvers].filter((x): x is string => !!x && x !== a.id))
      : []),
  ];
}));

tareas.post('/tareas/:id/aprobar', accion('aprobar', 'Solo revisión, aprobación o la administración general pueden aprobar.', async (c, t, a) => {
  const impedimento = impedimentoParaAprobar(t);
  if (impedimento) throw new ErrorApi(409, 'impedimento', impedimento);
  const db = c.env.DB;
  return [
    actualizar(db, t.fila.id, { status: 'Aprobada', approved_by: a.id, approved_at: new Date().toISOString() }),
    auditoria(db, a.id, `Tarea aprobada ${t.fila.title}`, 'task', t.fila.id),
    ...encolarAvisos(db, 'Tarea aprobada', t.fila.id, [t.owner_id, ...t.collaborators].filter((x): x is string => !!x && x !== a.id)),
  ];
}));

tareas.post('/tareas/:id/pedir-ajustes', accion('pedirAjustes', 'Solo revisión, aprobación o la administración general piden ajustes.', async (c, t, a) => {
  const { motivo } = await cuerpo(c, z.object({ motivo: z.string().trim().min(3, 'Explica qué ajustes se necesitan.').max(2000) }));
  const db = c.env.DB;
  return [
    actualizar(db, t.fila.id, { status: 'Ajustes solicitados' }),
    db.prepare('INSERT INTO task_comments (id, task_id, author_id, text) VALUES (?1, ?2, ?3, ?4)').bind(nuevoId(), t.fila.id, a.id, `Ajustes: ${motivo}`),
    auditoria(db, a.id, `Ajustes solicitados ${t.fila.title}`, 'task', t.fila.id, { motivo }),
    ...encolarAvisos(db, 'Ajustes solicitados', t.fila.id, [t.owner_id, ...t.collaborators].filter((x): x is string => !!x && x !== a.id), { motivo }),
  ];
}));

tareas.post('/tareas/:id/reabrir', accion('reabrir', 'Solo coordinación reabre tareas terminadas.', async (c, t, a) => {
  const { motivo } = await cuerpo(c, z.object({ motivo: z.string().trim().min(3, 'Escribe el motivo para reabrir.').max(1000) }));
  const db = c.env.DB;
  return [
    // Reabrir inicia un nuevo ciclo de ejecución (un nuevo logro al volver a aprobarse; §14-P13).
    db.prepare(`UPDATE tasks SET status = 'Ajustes solicitados', reopened_at = ?2, execution_cycle = execution_cycle + 1, approved_by = NULL,
                approved_at = NULL, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`)
      .bind(t.fila.id, new Date().toISOString()),
    db.prepare('INSERT INTO task_comments (id, task_id, author_id, text) VALUES (?1, ?2, ?3, ?4)').bind(nuevoId(), t.fila.id, a.id, `Reabierta: ${motivo}`),
    auditoria(db, a.id, `Tarea reabierta ${t.fila.title}`, 'task', t.fila.id, { motivo }),
    ...encolarAvisos(db, 'Tarea reabierta', t.fila.id, [t.owner_id, ...t.collaborators].filter((x): x is string => !!x && x !== a.id), { motivo }),
  ];
}));

tareas.post('/tareas/:id/comentarios', accion('comentar', 'No puedes comentar esta tarea.', async (c, t, a) => {
  const { texto } = await cuerpo(c, z.object({ texto: z.string().trim().min(1, 'Escribe un comentario.').max(2000) }));
  const db = c.env.DB;
  return [
    db.prepare('INSERT INTO task_comments (id, task_id, author_id, text) VALUES (?1, ?2, ?3, ?4)').bind(nuevoId(), t.fila.id, a.id, texto),
    ...encolarAvisos(db, 'Nuevo comentario', t.fila.id, participantes(t).filter((x) => x !== a.id), { texto: texto.slice(0, 200) }),
  ];
}));

tareas.post('/tareas/:id/confidencial', accion('confidencial', 'Solo coordinación marca tareas confidenciales.', async (c, t, a) => {
  const { valor } = await cuerpo(c, z.object({ valor: z.boolean() }));
  return [actualizar(c.env.DB, t.fila.id, { confidential: valor ? 1 : 0 }), auditoria(c.env.DB, a.id, `Confidencialidad ${valor ? 'activada' : 'desactivada'}`, 'task', t.fila.id)];
}));

// ─────────────────────────────── resultados (texto o archivo ≤ 700 KB en R2)

const TIPOS_RESULTADO: Record<string, { tipo: 'html' | 'image' | 'pdf' | 'text'; ext: string }> = {
  'text/html': { tipo: 'html', ext: 'html' }, 'text/plain': { tipo: 'text', ext: 'txt' }, 'application/pdf': { tipo: 'pdf', ext: 'pdf' },
  'image/png': { tipo: 'image', ext: 'png' }, 'image/jpeg': { tipo: 'image', ext: 'jpg' }, 'image/webp': { tipo: 'image', ext: 'webp' },
};
const MAX_RESULTADO = 700 * 1024;

/** Cambiar el resultado de una tarea hecha la devuelve a revisión. */
const alCambiarResultado = (db: D1Database, t: TareaCompleta, a: Persona) =>
  tareaHecha(t.status) ? [actualizar(db, t.fila.id, { status: 'Entregada para revisión' as EstadoTarea }), auditoria(db, a.id, `Revisión solicitada ${t.fila.title}`, 'task', t.fila.id)] : [];

tareas.put('/tareas/:id/archivo', async (c) => {
  const t = await tareaVisible(c, c.req.param('id'));
  const a = c.get('actor');
  if (!accionesPosibles(t, a.id, a.permisos).adjuntar) throw new ErrorApi(403, 'sin_permiso', 'Solo responsable, revisión o aprobación adjuntan resultados.');
  const tipo = TIPOS_RESULTADO[(c.req.header('content-type') ?? '').split(';')[0]!.trim()];
  if (!tipo) throw new ErrorApi(415, 'formato_no_admitido', 'Formato no admitido: usa HTML, texto, PDF, PNG, JPEG o WebP.');
  const datos = await c.req.arrayBuffer();
  if (!datos.byteLength) throw new ErrorApi(400, 'datos_invalidos', 'El archivo está vacío.');
  if (datos.byteLength > MAX_RESULTADO) throw new ErrorApi(413, 'muy_grande', 'El archivo puede pesar hasta 700 KB.');
  const nombre = (c.req.header('x-nombre-archivo') ?? `resultado.${tipo.ext}`).slice(0, 120);
  const id = nuevoId();
  const clave = `resultados/${t.fila.id}/${id}.${tipo.ext}`;
  await c.env.ARCHIVOS.put(clave, datos, { httpMetadata: { contentType: c.req.header('content-type')! } });
  const db = c.env.DB;
  await db.batch([
    db.prepare('INSERT INTO task_results (id, task_id, type, file_key, filename, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(id, t.fila.id, tipo.tipo, clave, nombre, a.id),
    ...alCambiarResultado(db, t, a),
  ]);
  return c.json({ id }, 201);
});

tareas.get('/tareas/:id/resultados/:rid', async (c) => {
  const t = await tareaVisible(c, c.req.param('id'));
  const r = await c.env.DB.prepare('SELECT file_key, filename FROM task_results WHERE id = ?1 AND task_id = ?2').bind(c.req.param('rid'), t.fila.id).first<{ file_key: string | null; filename: string | null }>();
  const obj = r?.file_key ? await c.env.ARCHIVOS.get(r.file_key) : null;
  if (!obj) throw new ErrorApi(404, 'no_encontrado', 'Ese archivo no existe.');
  const tipo = obj.httpMetadata?.contentType ?? 'application/octet-stream';
  return new Response(obj.body, {
    headers: {
      'content-type': tipo,
      // El HTML de un resultado se descarga, nunca se ejecuta en el dominio de la app.
      'content-disposition': `${tipo === 'text/html' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(r!.filename ?? 'resultado')}"`,
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=300',
    },
  });
});
