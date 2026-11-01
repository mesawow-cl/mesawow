// Logros automáticos (§5.9). Se reconcilian en el servidor tras cada cambio y en el cron de 5 minutos.
// Idempotente: cada logro tiene una clave única; si deja de cumplirse queda "en actualización" con historial.
import { utcASantiago } from '../shared/fechas';
import { nuevoId } from './util';

type Fila = Record<string, any>;

interface Deseado {
  key: string; type: string; source: string; sourceId: string; title: string;
  brandId: string | null; mesaId: string | null; sprintId: string | null; grp: string | null; day: string | null;
  people: string[]; tasks: string[]; valid: boolean;
}

/** Condición SQL de tarea aceptable (alias t): hecha, sin bloqueo, con criterio, evidencia y ≥ 1 participante activo. */
export const SQL_ACEPTABLE = `(t.status IN ('Aprobada','Completada') AND t.blocked = 0 AND trim(t.acceptance) <> ''
  AND EXISTS (SELECT 1 FROM task_results r WHERE r.task_id = t.id)
  AND EXISTS (SELECT 1 FROM people pa WHERE pa.active = 1 AND (pa.id = t.owner_id OR pa.id = t.reviewer_id
      OR pa.id IN (SELECT tp.person_id FROM task_people tp WHERE tp.task_id = t.id))))`;

export const reconciliarLogros = async (db: D1Database, ahora = new Date()) => {
  const pared = utcASantiago(ahora.toISOString()); // 'YYYY-MM-DDTHH:MM' en Santiago
  const [tareas, gente, lineas, compromisos, compTareas, sprints, registros, campanas, existentes, marketing] = await db.batch<Fila>([
    db.prepare(`SELECT t.id, t.title, t.brand_id, coalesce(t.mesa_id, (SELECT o.mesa_id FROM people o WHERE o.id = t.owner_id)) AS mesa_id, t.sprint_id, t.job_id, t.campaign_id, t.execution_cycle, t.owner_id, t.reviewer_id,
        t.exchange_mesa_id, t.exchange_person_id, t.exchange_accepted_at, ${SQL_ACEPTABLE} AS aceptable FROM tasks t`),
    db.prepare('SELECT task_id, person_id FROM task_people'),
    db.prepare('SELECT task_id, cycle, aceptable FROM achievement_baseline'),
    db.prepare('SELECT id, person_id, day, end_time FROM commitments'),
    db.prepare('SELECT commitment_id, task_id FROM commitment_tasks'),
    db.prepare(`SELECT id, name, goal, brand_id, mesa_id, status, goal_result, goal_evidence, review FROM sprints WHERE status = 'Cerrado'`),
    db.prepare(`SELECT r.sprint_id, r.task_id, r.approved FROM sprint_closed_records r JOIN sprints s ON s.id = r.sprint_id WHERE s.status = 'Cerrado'`),
    db.prepare(`SELECT id, name, brand_id FROM campaigns WHERE launched_at IS NOT NULL OR id IN (SELECT source_id FROM achievements WHERE source = 'campaign')`),
    db.prepare('SELECT id, key, valid, mesa_id FROM achievements'),
    db.prepare(`SELECT id FROM mesas WHERE name = 'Marketing' LIMIT 1`),
  ]);
  const t = new Map(tareas!.results.map((x) => [x.id as string, x]));
  const extra = new Map<string, string[]>();
  for (const g of gente!.results) extra.set(g.task_id, [...(extra.get(g.task_id) ?? []), g.person_id]);
  const participantes = (id: string) => {
    const x = t.get(id);
    return x ? [...new Set([x.owner_id, x.reviewer_id, ...(extra.get(id) ?? [])].filter(Boolean))] as string[] : [];
  };
  const aceptable = (id: string) => !!t.get(id)?.aceptable;
  const base = new Map(lineas!.results.map((l) => [`${l.task_id}:${l.cycle}`, !!l.aceptable]));
  const previos = new Map(existentes!.results.map((a) => [a.key as string, a]));
  const deseados: Deseado[] = [];
  const sentencias: D1PreparedStatement[] = [];

  // Tarea aceptada: clave tarea + ciclo. Nace solo al cambiar a aceptable.
  for (const x of tareas!.results) {
    const key = `task:${x.id}:${x.execution_cycle}`;
    const ahoraAcept = !!x.aceptable;
    const antes = base.get(`${x.id}:${x.execution_cycle}`);
    if (antes === undefined || antes !== ahoraAcept)
      sentencias.push(db.prepare('INSERT INTO achievement_baseline (task_id, cycle, aceptable) VALUES (?1, ?2, ?3) ON CONFLICT(task_id, cycle) DO UPDATE SET aceptable = excluded.aceptable')
        .bind(x.id, x.execution_cycle, ahoraAcept ? 1 : 0));
    if (previos.has(key) || (ahoraAcept && antes === false))
      deseados.push({ key, type: 'Tarea aceptada', source: 'task', sourceId: x.id, title: x.title, brandId: x.brand_id, mesaId: x.mesa_id, sprintId: x.sprint_id,
        grp: x.job_id ?? x.campaign_id ?? x.id, day: null, people: participantes(x.id), tasks: [x.id], valid: ahoraAcept });
    // Entrega entre áreas: aceptable y recepción confirmada; personas = participantes + receptor.
    if (x.exchange_accepted_at || previos.has(`exchange:${x.id}`))
      deseados.push({ key: `exchange:${x.id}`, type: 'Entrega entre áreas', source: 'exchange', sourceId: x.id, title: x.title, brandId: x.brand_id, mesaId: x.mesa_id,
        sprintId: x.sprint_id, grp: `exchange:${x.id}`, day: null, people: [...new Set([...participantes(x.id), x.exchange_person_id].filter(Boolean))],
        tasks: [x.id], valid: ahoraAcept && !!x.exchange_accepted_at });
  }

  // Día cumplido: ≥ 1 tarea, todas aceptables y ya pasó la hora de término (Santiago).
  const porCompromiso = new Map<string, string[]>();
  for (const r of compTareas!.results) porCompromiso.set(r.commitment_id, [...(porCompromiso.get(r.commitment_id) ?? []), r.task_id]);
  for (const c of compromisos!.results) {
    const ids = porCompromiso.get(c.id) ?? [];
    const key = `day:${c.person_id}:${c.day}`;
    const valido = ids.length > 0 && ids.every(aceptable) && pared >= `${c.day}T${c.end_time}`;
    if (valido || previos.has(key))
      deseados.push({ key, type: 'Día cumplido', source: 'day', sourceId: c.id, title: `Compromisos del ${c.day} cumplidos`, brandId: null, mesaId: null, sprintId: null,
        grp: `day:${c.day}`, day: c.day, people: [c.person_id], tasks: ids, valid: valido });
  }

  // Sprint completo y Objetivo del sprint alcanzado.
  const porSprint = new Map<string, Fila[]>();
  for (const r of registros!.results) porSprint.set(r.sprint_id, [...(porSprint.get(r.sprint_id) ?? []), r]);
  for (const s of sprints!.results) {
    const regs = porSprint.get(s.id) ?? [];
    const ids = regs.map((r) => r.task_id as string).filter((id) => t.has(id));
    const people = [...new Set(ids.flatMap(participantes))];
    const comun = { source: 'sprint', sourceId: s.id, brandId: s.brand_id, mesaId: s.mesa_id ?? (ids.length ? t.get(ids[0]!)?.mesa_id ?? null : null), sprintId: s.id, grp: `sprint:${s.id}`, day: null, people, tasks: ids };
    const completo = regs.length > 0 && regs.every((r) => r.approved) && ids.length === regs.length && ids.every(aceptable);
    if (completo || previos.has(`sprint:${s.id}`)) deseados.push({ ...comun, key: `sprint:${s.id}`, type: 'Sprint completo', title: s.name, valid: completo });
    const objetivo = s.goal_result === 'Alcanzado' && !!s.review?.trim() && !!s.goal_evidence?.trim();
    if (objetivo || previos.has(`goal:${s.id}`)) deseados.push({ ...comun, key: `goal:${s.id}`, type: 'Objetivo del sprint alcanzado', title: s.goal || s.name, valid: objetivo });
  }

  // Lanzamiento verificado: fecha y evidencia de lanzamiento (mesa Marketing).
  if (campanas!.results.length) {
    const { results: lanz } = await db.prepare(`SELECT c.id, c.launched_at IS NOT NULL AND trim(coalesce(c.launch_evidence, '')) <> '' AS ok FROM campaigns c`).all<Fila>();
    const ok = new Map(lanz.map((l) => [l.id, !!l.ok]));
    for (const c of campanas!.results) {
      const ids = tareas!.results.filter((x) => x.campaign_id === c.id).map((x) => x.id as string);
      const valid = !!ok.get(c.id);
      if (valid || previos.has(`launch:${c.id}`))
        deseados.push({ key: `launch:${c.id}`, type: 'Lanzamiento verificado', source: 'campaign', sourceId: c.id, title: c.name, brandId: c.brand_id,
          mesaId: marketing!.results[0]?.id ?? null, sprintId: null, grp: `launch:${c.id}`, day: null, people: [...new Set(ids.flatMap(participantes))], tasks: ids, valid });
    }
  }

  const momento = ahora.toISOString();
  let nuevos = 0;
  for (const d of deseados) {
    const prev = previos.get(d.key);
    if (!prev) {
      if (!d.valid) continue;
      const id = nuevoId();
      nuevos++;
      sentencias.push(db.prepare(`INSERT INTO achievements (id, key, type, source, source_id, title, brand_id, mesa_id, sprint_id, grp, day, valid, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?12) ON CONFLICT(key) DO NOTHING`)
        .bind(id, d.key, d.type, d.source, d.sourceId, d.title, d.brandId, d.mesaId, d.sprintId, d.grp, d.day, momento));
      for (const p of d.people) sentencias.push(db.prepare('INSERT OR IGNORE INTO achievement_people (achievement_id, person_id) SELECT id, ?2 FROM achievements WHERE key = ?1').bind(d.key, p));
      for (const x of d.tasks) sentencias.push(db.prepare('INSERT OR IGNORE INTO achievement_tasks (achievement_id, task_id) SELECT id, ?2 FROM achievements WHERE key = ?1').bind(d.key, x));
      sentencias.push(db.prepare(`INSERT INTO audit_log (id, actor_id, action, entity, entity_id, details) VALUES (?1, NULL, ?2, 'achievement', ?3, NULL)`)
        .bind(nuevoId(), `Logro publicado ${d.title}`, id));
    } else if (!prev.mesa_id && d.mesaId) {
      sentencias.push(db.prepare('UPDATE achievements SET mesa_id = ?2 WHERE id = ?1').bind(prev.id, d.mesaId));
    }
    if (prev && !!prev.valid !== d.valid) {
      sentencias.push(
        db.prepare('INSERT INTO achievement_history (achievement_id, at, valid) VALUES (?1, ?2, ?3)').bind(prev.id, momento, prev.valid),
        db.prepare('UPDATE achievements SET valid = ?2, updated_at = ?3 WHERE id = ?1').bind(prev.id, d.valid ? 1 : 0, momento),
      );
      if (d.valid) for (const p of d.people) sentencias.push(db.prepare('INSERT OR IGNORE INTO achievement_people (achievement_id, person_id) VALUES (?1, ?2)').bind(prev.id, p));
    }
  }
  for (let i = 0; i < sentencias.length; i += 50) await db.batch(sentencias.slice(i, i + 50));
  return { nuevos };
};
