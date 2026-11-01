// Comunidad (§4.2): logros, felicitaciones, comentarios, reportes y moderación; compromisos del día (§4.4);
// recepción entre áreas; Logros del equipo e Informes (§4.23).
import { Hono } from 'hono';
import { z } from 'zod';
import { hoySantiago } from '../shared/fechas';
import { tareaHecha } from '../shared/constantes';
import { ErrorApi } from './errores';
import { exigir, type Ctx, type Entorno } from './identidad';
import { SQL_ACEPTABLE } from './logros';
import { cargarTarea, filtroVisible, puedeVer } from './tareas';
import { auditoria, cuerpo, nuevoId } from './util';

type Fila = Record<string, any>;
type Persona = Parameters<typeof filtroVisible>[0];
export const comunidad = new Hono<Entorno>();

const POR_PAGINA = 12;
const HITOS = ['Sprint completo', 'Objetivo del sprint alcanzado', 'Lanzamiento verificado'];
const GENERICO = 'Un aporte al equipo ha sido completado';

/** ¿La persona ve el detalle del logro (alias a)? Sin restringir, marca permitida y todas sus tareas visibles. */
export const sqlDetalle = (p: Persona, desde: number) => {
  if (p.permisos.esAdmin) return { sql: '1', params: [] as unknown[] };
  const v = filtroVisible(p, desde);
  const marcas = p.marcas.map((_, i) => `?${desde + 1 + i}`).join(',') || `''`;
  return {
    sql: `(a.restricted = 0 AND (a.brand_id IS NULL OR a.brand_id IN (${marcas}))
      AND NOT EXISTS (SELECT 1 FROM achievement_tasks x JOIN tasks t ON t.id = x.task_id WHERE x.achievement_id = a.id AND NOT ${v.sql}))`,
    params: v.params,
  };
};

const COLUMNAS = (yo: string) => `a.id, a.type, a.title, a.valid, a.created_at, a.grp, a.source,
  m.name AS mesa, b.name AS marca,
  (SELECT count(*) FROM reactions r WHERE r.achievement_id = a.id) AS felicitaciones,
  EXISTS (SELECT 1 FROM reactions r WHERE r.achievement_id = a.id AND r.person_id = ${yo}) AS felicitaste,
  (SELECT count(*) FROM achievement_comments k WHERE k.achievement_id = a.id AND k.removed = 0) AS comentarios,
  (SELECT json_group_array(json_object('id', pe.id, 'name', pe.name, 'foto', CASE WHEN pe.photo_key IS NULL THEN NULL ELSE '/api/v1/fotos/' || pe.id || '?v=' || pe.updated_at END))
     FROM achievement_people ap JOIN people pe ON pe.id = ap.person_id WHERE ap.achievement_id = a.id) AS personas,
  (SELECT CASE WHEN count(*) = 1 THEN min(x.task_id) END FROM achievement_tasks x WHERE x.achievement_id = a.id) AS tarea_unica`;

/** Tarjeta de logro con privacidad aplicada. */
const tarjeta = (a: Fila) => {
  const detalle = !!a.detalle;
  return {
    id: a.id, tipo: a.type, valido: !!a.valid, creado: a.created_at, detalle,
    titulo: detalle ? a.title : GENERICO, mesa: detalle ? a.mesa : null, marca: detalle ? a.marca : null,
    grupo: a.source === 'task' ? `${a.grp}:${String(a.created_at).slice(0, 10)}` : a.id,
    personas: JSON.parse(a.personas ?? '[]'), felicitaciones: a.felicitaciones, felicitaste: !!a.felicitaste, comentarios: a.comentarios,
    tareaId: detalle ? a.tarea_unica : null,
  };
};

/** Consulta de logros visibles para la persona, con filtros opcionales. */
const buscarLogros = async (db: D1Database, p: Persona, f: { tipo?: string; persona?: string; mesa?: string; marca?: string; soloValidos?: boolean; desde?: string; limite: number; salto?: number }) => {
  const det = sqlDetalle(p, 2);
  const params: unknown[] = [p.id, ...det.params];
  const donde: string[] = [];
  const agregar = (sql: string, v: unknown) => { params.push(v); donde.push(sql.replace('?', `?${params.length}`)); };
  if (f.tipo) agregar('a.type = ?', f.tipo);
  if (f.persona) agregar('EXISTS (SELECT 1 FROM achievement_people ap WHERE ap.achievement_id = a.id AND ap.person_id = ?)', f.persona);
  // Mesa y marca solo filtran logros cuyo detalle se puede ver.
  if (f.mesa) agregar(`(${det.sql} AND a.mesa_id = ?)`, f.mesa);
  if (f.marca) agregar(`(${det.sql} AND a.brand_id = ?)`, f.marca);
  if (f.soloValidos) donde.push('a.valid = 1');
  if (f.desde) agregar('a.created_at >= ?', f.desde);
  const { results } = await db.prepare(`SELECT ${COLUMNAS('?1')}, ${det.sql} AS detalle FROM achievements a
      LEFT JOIN mesas m ON m.id = a.mesa_id LEFT JOIN brands b ON b.id = a.brand_id
      ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''} ORDER BY a.created_at DESC LIMIT ${f.limite + 1} OFFSET ${f.salto ?? 0}`).bind(...params).all<Fila>();
  return { logros: results.slice(0, f.limite).map(tarjeta), hayMas: results.length > f.limite };
};

const logroVisible = async (c: Ctx, id: string) => {
  const p = c.get('persona');
  const det = sqlDetalle(p, 3);
  const a = await c.env.DB.prepare(`SELECT ${COLUMNAS('?2')}, a.restricted, a.updated_at, ${det.sql} AS detalle FROM achievements a
      LEFT JOIN mesas m ON m.id = a.mesa_id LEFT JOIN brands b ON b.id = a.brand_id WHERE a.id = ?1`).bind(id, p.id, ...det.params).first<Fila>();
  if (!a) throw new ErrorApi(404, 'no_encontrado', 'Ese logro no existe.');
  return a;
};

comunidad.use('/logros/*', async (c, next) => { exigir(c, 'esEquipo', 'La Comunidad es solo del equipo.'); await next(); });
comunidad.use('/logros', async (c, next) => { exigir(c, 'esEquipo', 'La Comunidad es solo del equipo.'); await next(); });

comunidad.get('/logros', async (c) => {
  const q = c.req.query();
  const pagina = Math.max(1, Math.min(50, Number(q.pagina) || 1));
  return c.json(await buscarLogros(c.env.DB, c.get('persona'), { tipo: q.tipo, persona: q.persona, mesa: q.mesa, marca: q.marca, limite: POR_PAGINA * pagina }));
});

comunidad.get('/logros/:id', async (c) => {
  const a = await logroVisible(c, c.req.param('id'));
  const db = c.env.DB;
  const yo = c.get('actor').id;
  const [tareas, comentarios, historial] = await db.batch<Fila>([
    db.prepare('SELECT t.id, t.title FROM achievement_tasks x JOIN tasks t ON t.id = x.task_id WHERE x.achievement_id = ?1').bind(a.id),
    db.prepare(`SELECT k.id, k.text, k.created_at, k.person_id, pe.name AS persona, mn.name AS mencion FROM achievement_comments k
        LEFT JOIN people pe ON pe.id = k.person_id LEFT JOIN people mn ON mn.id = k.mention_id
       WHERE k.achievement_id = ?1 AND k.removed = 0 ORDER BY k.created_at`).bind(a.id),
    db.prepare('SELECT at, valid FROM achievement_history WHERE achievement_id = ?1 ORDER BY at').bind(a.id),
  ]);
  return c.json({
    logro: { ...tarjeta(a), actualizado: a.updated_at },
    tareas: a.detalle ? tareas!.results : [],
    comentarios: comentarios!.results.map((k) => ({ id: k.id, texto: k.text, creado: k.created_at, persona: k.persona, mencion: k.mencion, propio: k.person_id === yo })),
    historial: historial!.results,
  });
});

comunidad.post('/logros/:id/felicitar', async (c) => {
  const a = await logroVisible(c, c.req.param('id'));
  const yo = c.get('actor');
  const db = c.env.DB;
  if (a.felicitaste) {
    await db.prepare('DELETE FROM reactions WHERE achievement_id = ?1 AND person_id = ?2').bind(a.id, yo.id).run();
    return c.json({ felicitaste: false, felicitaciones: a.felicitaciones - 1 });
  }
  const personas = (JSON.parse(a.personas ?? '[]') as { id: string }[]).filter((x) => x.id !== yo.id);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO reactions (achievement_id, person_id) VALUES (?1, ?2)').bind(a.id, yo.id),
    // Reconocimiento → aviso a la persona reconocida (una sola vez por quien felicita).
    ...personas.map((x) => db.prepare(`INSERT INTO outbox (id, dedupe_key, person_id, channel, event, payload) VALUES (?1, ?2, ?3, 'app', 'Te felicitaron', ?4)
        ON CONFLICT(dedupe_key) DO NOTHING`).bind(nuevoId(), `felicita:${a.id}:${yo.id}:${x.id}`, x.id, JSON.stringify({ de: yo.name, logro: a.id, cantidad: 1 }))),
  ]);
  return c.json({ felicitaste: true, felicitaciones: a.felicitaciones + 1 });
});

comunidad.post('/logros/:id/comentarios', async (c) => {
  const a = await logroVisible(c, c.req.param('id'));
  const d = await cuerpo(c, z.object({ texto: z.string().trim().min(1, 'Escribe tu comentario.').max(1000, 'El comentario puede tener hasta 1.000 caracteres.'), mencionId: z.string().nullable().optional() }));
  const yo = c.get('actor');
  const db = c.env.DB;
  let mencion: Fila | null = null;
  if (d.mencionId) {
    mencion = await db.prepare(`SELECT p.id, coalesce(pr.mentions, 1) AS quiere FROM people p LEFT JOIN preferences pr ON pr.person_id = p.id WHERE p.id = ?1 AND p.active = 1`).bind(d.mencionId).first<Fila>();
    if (!mencion) throw new ErrorApi(400, 'datos_invalidos', 'Esa persona no está activa en el equipo.');
  }
  const id = nuevoId();
  const sentencias = [db.prepare('INSERT INTO achievement_comments (id, achievement_id, person_id, text, mention_id) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, a.id, yo.id, d.texto, mencion?.id ?? null)];
  // Menciones → bandeja, salvo que la persona las desactive.
  if (mencion && mencion.id !== yo.id && mencion.quiere) {
    sentencias.push(
      db.prepare('INSERT INTO mentions (id, person_id, achievement_id, from_id) VALUES (?1, ?2, ?3, ?4)').bind(nuevoId(), mencion.id, a.id, yo.id),
      db.prepare(`INSERT INTO outbox (id, dedupe_key, person_id, channel, event, payload) VALUES (?1, ?2, ?3, 'app', 'Mención', ?4)`)
        .bind(nuevoId(), `mencion:${id}`, mencion.id, JSON.stringify({ de: yo.name, logro: a.id, cantidad: 1 })),
    );
  }
  await db.batch(sentencias);
  return c.json({ id }, 201);
});

comunidad.delete('/comentarios/:id', async (c) => {
  const k = await c.env.DB.prepare('SELECT id, person_id FROM achievement_comments WHERE id = ?1 AND removed = 0').bind(c.req.param('id')).first<Fila>();
  if (!k) throw new ErrorApi(404, 'no_encontrado', 'Ese comentario no existe.');
  if (k.person_id !== c.get('actor').id) throw new ErrorApi(403, 'sin_permiso', 'Solo puedes retirar tus propios comentarios.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE achievement_comments SET removed = 1 WHERE id = ?1').bind(k.id),
    auditoria(c.env.DB, k.person_id, 'Comentario propio retirado', 'comment', k.id),
  ]);
  return c.json({ ok: true });
});

comunidad.post('/logros/:id/reportar', async (c) => {
  const a = await logroVisible(c, c.req.param('id'));
  const { motivo } = await cuerpo(c, z.object({ motivo: z.string().trim().min(1, 'Cuéntanos qué debemos revisar.').max(1000) }));
  await c.env.DB.prepare('INSERT INTO achievement_reports (id, achievement_id, by_id, reason) VALUES (?1, ?2, ?3, ?4)').bind(nuevoId(), a.id, c.get('actor').id, motivo).run();
  return c.json({ ok: true }, 201);
});

/** Confeti del Momento WOW: una vez por persona y hito. */
comunidad.post('/logros/:id/visto', async (c) => {
  const a = await logroVisible(c, c.req.param('id'));
  if (c.get('actor').id === c.get('persona').id)
    await c.env.DB.prepare('INSERT OR IGNORE INTO wow_seen (person_id, achievement_id) VALUES (?1, ?2)').bind(c.get('actor').id, a.id).run();
  return c.json({ ok: true });
});

// ─────────────────────────────── Inicio: Momento WOW, logros de hoy y actividad social

comunidad.get('/comunidad/inicio', async (c) => {
  const p = c.get('persona');
  const db = c.env.DB;
  if (!p.permisos.esEquipo) return c.json({ logrosHoy: 0, wow: null, delDia: [], recientes: [], actividad: [], menciones: 0 });
  const hoy = hoySantiago();
  const inicioHoy = new Date(Date.now() - 36 * 3_600_000).toISOString(); // margen; se filtra por día de Santiago abajo
  const hace48 = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const [{ logros: ultimos }, { logros: hitos }] = await Promise.all([
    buscarLogros(db, p, { soloValidos: true, desde: inicioHoy, limite: 40 }),
    buscarLogros(db, p, { soloValidos: true, desde: hace48, limite: 20 }),
  ]);
  const deHoy = ultimos.filter((l) => hoySantiago(new Date(l.creado)) === hoy);
  const wow = hitos.find((l) => HITOS.includes(l.tipo)) ?? null;
  const visto = wow ? !!(await db.prepare('SELECT 1 FROM wow_seen WHERE person_id = ?1 AND achievement_id = ?2').bind(c.get('actor').id, wow.id).first()) : false;
  const recientes = deHoy.length ? [] : (await buscarLogros(db, p, { soloValidos: true, limite: 3 })).logros;
  const det = sqlDetalle(p, 1);
  const [felic, coments, menciones] = await db.batch<Fila>([
    db.prepare(`SELECT r.created_at AS at, pe.name AS persona, a.id, a.title, ${det.sql} AS detalle FROM reactions r JOIN achievements a ON a.id = r.achievement_id
        JOIN people pe ON pe.id = r.person_id ORDER BY r.created_at DESC LIMIT 10`).bind(...det.params),
    db.prepare(`SELECT k.created_at AS at, pe.name AS persona, k.text, a.id, a.title, ${det.sql} AS detalle FROM achievement_comments k JOIN achievements a ON a.id = k.achievement_id
        JOIN people pe ON pe.id = k.person_id WHERE k.removed = 0 ORDER BY k.created_at DESC LIMIT 10`).bind(...det.params),
    db.prepare('SELECT count(*) AS n FROM mentions WHERE person_id = ?1 AND read_at IS NULL').bind(c.get('actor').id),
  ]);
  const actividad = [
    ...ultimos.slice(0, 10).map((l) => ({ at: l.creado, persona: l.personas.map((x: Fila) => x.name).join(', ') || 'El equipo', verbo: l.personas.length > 1 ? 'lograron' : 'logró', objeto: l.titulo, tipo: 'logro', logroId: l.id })),
    ...felic!.results.map((r) => ({ at: r.at, persona: r.persona, verbo: 'reconoció a', objeto: r.detalle ? r.title : 'un aporte de otra mesa', tipo: 'reconocimiento', logroId: r.id })),
    ...coments!.results.map((k) => ({ at: k.at, persona: k.persona, verbo: 'comentó', objeto: `“${String(k.text).slice(0, 90)}”`, tipo: 'reconocimiento', logroId: k.id })),
  ];
  return c.json({
    logrosHoy: deHoy.length, wow: wow && { ...wow, visto }, delDia: deHoy.filter((l) => l.id !== wow?.id).slice(0, 6), recientes, actividad,
    menciones: menciones!.results[0]?.n ?? 0,
  });
});

// ─────────────────────────────── Compromisos del día (§4.4)

const compromisoDeHoy = async (db: D1Database, personaId: string, dia: string): Promise<(Fila & { tareas: string[]; base: string[] }) | null> => {
  const c = await db.prepare('SELECT * FROM commitments WHERE person_id = ?1 AND day = ?2').bind(personaId, dia).first<Fila>();
  if (!c) return null;
  const { results } = await db.prepare('SELECT task_id, baseline FROM commitment_tasks WHERE commitment_id = ?1').bind(c.id).all<Fila>();
  return { ...c, tareas: results.map((r) => r.task_id as string), base: results.filter((r) => r.baseline).map((r) => r.task_id as string) };
};

const opcionesCompromiso = async (db: D1Database, p: Persona, dia: string) => {
  const v = filtroVisible(p, 2);
  // Mis tareas visibles (las confidenciales solo si son mías: son mías por definición).
  const { results } = await db.prepare(`SELECT t.id, t.title, t.status, t.due FROM tasks t WHERE t.owner_id = ?1 AND ${v.sql}
      AND (t.status NOT IN ('Aprobada','Completada') OR t.due = ?${2 + v.params.length}) ORDER BY t.due, t.title`).bind(p.id, ...v.params, dia).all<Fila>();
  return results;
};

comunidad.get('/compromisos/hoy', async (c) => {
  exigir(c, 'esEquipo', 'Los compromisos son del equipo.');
  const p = c.get('persona');
  const dia = hoySantiago();
  const [actual, opciones] = await Promise.all([compromisoDeHoy(c.env.DB, p.id, dia), opcionesCompromiso(c.env.DB, p, dia)]);
  return c.json({
    dia, fin: actual?.end_time ?? '18:00', existe: !!actual,
    seleccion: actual?.tareas ?? opciones.filter((t) => t.due === dia).map((t) => t.id), opciones,
  });
});

comunidad.put('/compromisos/hoy', async (c) => {
  exigir(c, 'esEquipo', 'Los compromisos son del equipo.');
  const d = await cuerpo(c, z.object({
    fin: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Indica la hora de término.'),
    tareas: z.array(z.string()).min(1, 'Selecciona al menos una entrega.').max(40),
    motivo: z.string().trim().max(500).optional(),
  }));
  const p = c.get('actor');
  const db = c.env.DB;
  const dia = hoySantiago();
  const permitidas = new Set((await opcionesCompromiso(db, p, dia)).map((t) => t.id as string));
  if (d.tareas.some((id) => !permitidas.has(id))) throw new ErrorApi(400, 'datos_invalidos', 'Solo puedes comprometer tus propias tareas visibles.');
  const actual = await compromisoDeHoy(db, p.id, dia);
  if (!actual) {
    const id = nuevoId();
    await db.batch([
      db.prepare('INSERT INTO commitments (id, person_id, day, end_time) VALUES (?1, ?2, ?3, ?4)').bind(id, p.id, dia, d.fin),
      ...d.tareas.map((t) => db.prepare('INSERT INTO commitment_tasks (commitment_id, task_id, baseline) VALUES (?1, ?2, 1)').bind(id, t)),
    ]);
    return c.json({ ok: true }, 201);
  }
  if (!d.motivo) throw new ErrorApi(400, 'sin_motivo', 'Cuéntanos el motivo del cambio de compromisos.');
  if (!p.permisos.coordina && actual.tareas.some((t) => !d.tareas.includes(t)))
    throw new ErrorApi(403, 'sin_permiso', 'Solicita a coordinación retirar un compromiso ya confirmado.');
  await db.batch([
    db.prepare('INSERT INTO commitment_changes (id, commitment_id, tasks_json, reason, by_id) VALUES (?1, ?2, ?3, ?4, ?5)').bind(nuevoId(), actual.id, JSON.stringify(actual.tareas), d.motivo, p.id),
    db.prepare('UPDATE commitments SET end_time = ?2, updated_at = ?3 WHERE id = ?1').bind(actual.id, d.fin, new Date().toISOString()),
    db.prepare('DELETE FROM commitment_tasks WHERE commitment_id = ?1').bind(actual.id),
    ...d.tareas.map((t) => db.prepare('INSERT INTO commitment_tasks (commitment_id, task_id, baseline) VALUES (?1, ?2, ?3)').bind(actual.id, t, actual.base.includes(t) ? 1 : 0)),
  ]);
  return c.json({ ok: true });
});

// ─────────────────────────────── Logros del equipo (coordinaODirige) y Moderación (esAdmin)

comunidad.get('/reconocimiento', async (c) => {
  exigir(c, 'coordinaODirige', 'La vista consolidada corresponde a Dirección y coordinación.');
  const p = c.get('persona');
  const det = sqlDetalle(p, 1);
  const marca = c.req.query('marca');
  const [{ results: porMesa }, { logros }] = await Promise.all([
    c.env.DB.prepare(`SELECT m.id, m.name, (SELECT count(*) FROM achievements a WHERE a.mesa_id = m.id AND a.valid = 1 AND ${det.sql}
        ${marca ? `AND a.brand_id = ?${det.params.length + 1}` : ''}) AS n FROM mesas m WHERE m.active = 1 ORDER BY m.name`).bind(...det.params, ...(marca ? [marca] : [])).all<Fila>(),
    buscarLogros(c.env.DB, p, { soloValidos: true, marca, limite: 24 }),
  ]);
  // Solo los logros con detalle visible cuentan en la vista consolidada.
  return c.json({ porMesa, recientes: logros.filter((l) => l.detalle) });
});

comunidad.get('/moderacion', async (c) => {
  exigir(c, 'esAdmin', 'Moderación es solo para la administración general.');
  const { results } = await c.env.DB.prepare(`SELECT r.id, r.reason, r.status, r.resolution, r.created_at, r.resolved_at, a.id AS logro_id, a.title, a.type, a.restricted, pe.name AS por
      FROM achievement_reports r JOIN achievements a ON a.id = r.achievement_id LEFT JOIN people pe ON pe.id = r.by_id
     ORDER BY r.status = 'Resuelto', r.created_at DESC LIMIT 200`).all();
  return c.json({ reportes: results });
});

comunidad.post('/moderacion/:id', async (c) => {
  exigir(c, 'esAdmin', 'Moderación es solo para la administración general.');
  const d = await cuerpo(c, z.object({ accion: z.enum(['revisado', 'restringir', 'comentarios']), motivo: z.string().trim().min(1, 'Escribe el motivo de la resolución.').max(1000) }));
  const db = c.env.DB;
  const r = await db.prepare(`SELECT id, achievement_id FROM achievement_reports WHERE id = ?1 AND status = 'Pendiente'`).bind(c.req.param('id')).first<Fila>();
  if (!r) throw new ErrorApi(404, 'no_encontrado', 'Ese reporte no existe o ya está resuelto.');
  const texto = { revisado: 'Revisado, se mantiene', restringir: 'Detalle restringido', comentarios: 'Comentarios retirados' }[d.accion];
  await db.batch([
    ...(d.accion === 'restringir' ? [db.prepare('UPDATE achievements SET restricted = 1 WHERE id = ?1').bind(r.achievement_id)] : []),
    ...(d.accion === 'comentarios' ? [db.prepare('UPDATE achievement_comments SET removed = 1 WHERE achievement_id = ?1').bind(r.achievement_id)] : []),
    db.prepare(`UPDATE achievement_reports SET status = 'Resuelto', resolution = ?2, resolved_at = ?3 WHERE id = ?1`).bind(r.id, `${texto}: ${d.motivo}`, new Date().toISOString()),
    auditoria(db, c.get('actor').id, `Moderación social ${texto}`, 'achievement', r.achievement_id, { motivo: d.motivo }),
  ]);
  return c.json({ ok: true });
});

// ─────────────────────────────── Recepción entre áreas

comunidad.post('/tareas/:id/recepcion', async (c) => {
  exigir(c, 'coordina', 'La recepción entre áreas la registra coordinación.');
  const d = await cuerpo(c, z.object({ mesaId: z.string().min(1, 'Elige el área receptora.'), receptorId: z.string().min(1, 'Elige quién recibe.'), evidencia: z.string().trim().min(1, 'Describe la evidencia de entrega.').max(2000) }));
  const db = c.env.DB;
  const t = await cargarTarea(db, c.req.param('id'));
  if (!t || !puedeVer(t, c.get('persona'))) throw new ErrorApi(404, 'no_encontrado', 'Esa tarea no existe o no está asignada a tu vista.');
  const ok = await db.prepare(`SELECT ${SQL_ACEPTABLE} AS ok FROM tasks t WHERE t.id = ?1`).bind(t.fila.id).first<{ ok: number }>();
  if (!ok?.ok) throw new ErrorApi(400, 'no_aceptable', 'La entrega necesita estar aprobada, con criterios y evidencia, antes de registrar la recepción.');
  const [mesa, receptor] = await db.batch<Fila>([
    db.prepare('SELECT id FROM mesas WHERE id = ?1 AND active = 1').bind(d.mesaId),
    db.prepare('SELECT p.id FROM people p JOIN person_brands pb ON pb.person_id = p.id AND pb.brand_id = ?2 WHERE p.id = ?1 AND p.active = 1').bind(d.receptorId, t.fila.brand_id),
  ]);
  if (!mesa!.results.length) throw new ErrorApi(400, 'datos_invalidos', 'Esa área no existe o está archivada.');
  if (!receptor!.results.length) throw new ErrorApi(400, 'datos_invalidos', 'Quien recibe debe estar activo y trabajar con la marca de la tarea.');
  await db.batch([
    db.prepare('UPDATE tasks SET exchange_mesa_id = ?2, exchange_person_id = ?3, exchange_evidence = ?4, exchange_accepted_at = NULL WHERE id = ?1').bind(t.fila.id, d.mesaId, d.receptorId, d.evidencia),
    auditoria(db, c.get('actor').id, `Recepción entre áreas registrada ${t.fila.title}`, 'task', t.fila.id),
    db.prepare(`INSERT INTO outbox (id, dedupe_key, person_id, channel, event, task_id, payload) VALUES (?1, ?2, ?3, 'app', 'Confirma una recepción entre áreas', ?4, ?5)
        ON CONFLICT(dedupe_key) DO NOTHING`).bind(nuevoId(), `recepcion:${t.fila.id}:${d.receptorId}:${Date.now()}`, d.receptorId, t.fila.id, JSON.stringify({ cantidad: 1 })),
  ]);
  return c.json({ ok: true });
});

comunidad.post('/tareas/:id/recepcion/confirmar', async (c) => {
  const a = c.get('actor');
  const t = await c.env.DB.prepare('SELECT id, title, exchange_person_id, exchange_accepted_at FROM tasks WHERE id = ?1').bind(c.req.param('id')).first<Fila>();
  if (!t?.exchange_person_id) throw new ErrorApi(404, 'no_encontrado', 'Esa tarea no tiene una recepción por confirmar.');
  if (t.exchange_person_id !== a.id && !a.permisos.esAdmin) throw new ErrorApi(403, 'sin_permiso', 'La recepción debe confirmarla quien recibe, desde su cuenta.');
  if (t.exchange_accepted_at) return c.json({ ok: true });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE tasks SET exchange_accepted_at = ?2 WHERE id = ?1').bind(t.id, new Date().toISOString()),
    auditoria(c.env.DB, a.id, `Recepción entre áreas confirmada ${t.title}`, 'task', t.id),
  ]);
  return c.json({ ok: true });
});

// ─────────────────────────────── Informes (§4.23)

comunidad.get('/informes', async (c) => {
  exigir(c, 'coordinaODirige', 'Los informes son para Dirección y coordinación.');
  const p = c.get('persona');
  const { persona, estado, marca } = c.req.query();
  const v = filtroVisible(p, 1);
  const params: unknown[] = [...v.params];
  const donde = [v.sql];
  if (persona) { params.push(persona); donde.push(`t.owner_id = ?${params.length}`); }
  if (estado) { params.push(estado); donde.push(`t.status = ?${params.length}`); }
  if (marca) { params.push(marca); donde.push(`t.brand_id = ?${params.length}`); }
  const { results } = await c.env.DB.prepare(`SELECT t.id, t.title, t.due, t.status, t.blocked, b.name AS marca, pe.name AS responsable,
      (SELECT group_concat(d.title, ', ') FROM task_dependencies td JOIN tasks d ON d.id = td.depends_on_id WHERE td.task_id = t.id) AS dependencia
      FROM tasks t JOIN brands b ON b.id = t.brand_id LEFT JOIN people pe ON pe.id = t.owner_id
     WHERE ${donde.join(' AND ')} ORDER BY t.due, t.title LIMIT 1000`).bind(...params).all<Fila>();
  const hoy = hoySantiago();
  return c.json({
    corte: new Date().toISOString(),
    total: results.length,
    completadas: results.filter((t) => tareaHecha(t.status)).length,
    atrasadas: results.filter((t) => !tareaHecha(t.status) && t.due < hoy).length,
    bloqueadas: results.filter((t) => t.blocked && !tareaHecha(t.status)).length,
    tareas: results.map((t) => ({ ...t, blocked: !!t.blocked })),
  });
});
