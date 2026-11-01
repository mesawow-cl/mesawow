import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { hoySantiago, santiagoAUtc } from '../src/shared/fechas';
import { reconciliarLogros } from '../src/worker/logros';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const ANA = 'ana@mesawow.test', COORD = 'bruno@mesawow.test', DIEGO = 'diego@mesawow.test', ELENA = 'elena@mesawow.test', FABIAN = 'fabian@mesawow.test';
const todos = (sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).all<any>().then((r) => r.results);
const fila = (sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).first<any>();
const hoy = hoySantiago();

const tarea = (cambios: Record<string, unknown> = {}) => llamar('/tareas', { como: COORD, metodo: 'POST', cuerpo: {
  titulo: 'Banner de Aurora', marcaId: 'demo-aurora', descripcion: 'Banner', entregable: 'PNG', criterio: 'Cumple la guía de marca', responsableId: 'demo-diego', revisorId: 'demo-fabian',
  inicio: hoy, plazo: hoy, ...cambios,
} }).then((r) => { expect(r.status).toBe(201); return r.cuerpo.id as string; });

const aprobar = async (id: string, quien = DIEGO) => {
  expect((await llamar(`/tareas/${id}/entregar`, { como: quien, metodo: 'POST', cuerpo: { resultado: 'Listo: https://x.test/banner.png' } })).status).toBe(200);
  expect((await llamar(`/tareas/${id}/aprobar`, { como: FABIAN, metodo: 'POST', cuerpo: {} })).status).toBe(200);
};
const logrosDe = (tipo: string) => todos('SELECT id, key, valid, restricted FROM achievements WHERE type = ?1', tipo);

describe('logros automáticos (§5.9)', () => {
  beforeEach(cargarSemilla);

  it('Tarea aceptada nace al aprobar con criterio y evidencia, y queda en actualización si deja de cumplirse', async () => {
    const id = await tarea();
    expect(await logrosDe('Tarea aceptada')).toHaveLength(0);
    await aprobar(id);
    const [l] = await logrosDe('Tarea aceptada');
    expect(l).toMatchObject({ key: `task:${id}:1`, valid: 1 });
    expect((await todos('SELECT person_id FROM achievement_people WHERE achievement_id = ?1 ORDER BY person_id', l.id)).map((x) => x.person_id)).toEqual(['demo-diego', 'demo-fabian']);
    // Un bloqueo posterior la deja "en actualización" y guarda el historial.
    await env.DB.prepare('UPDATE tasks SET blocked = 1 WHERE id = ?1').bind(id).run();
    await reconciliarLogros(env.DB);
    expect(await fila('SELECT valid FROM achievements WHERE id = ?1', l.id)).toEqual({ valid: 0 });
    expect(await todos('SELECT valid FROM achievement_history WHERE achievement_id = ?1', l.id)).toEqual([{ valid: 1 }]);
  });

  it('no publica logros retroactivos de tareas que ya estaban hechas', async () => {
    const id = await tarea();
    await env.DB.batch([
      env.DB.prepare("UPDATE tasks SET status = 'Aprobada' WHERE id = ?1").bind(id),
      env.DB.prepare("INSERT INTO task_results (id, task_id, type, text) VALUES ('r1', ?1, 'text', 'ok')").bind(id),
      env.DB.prepare('DELETE FROM achievement_baseline WHERE task_id = ?1').bind(id),
    ]);
    await reconciliarLogros(env.DB);
    await reconciliarLogros(env.DB);
    expect(await logrosDe('Tarea aceptada')).toHaveLength(0);
  });

  it('Día cumplido: solo después de la hora de término y con todas las tareas aceptables', async () => {
    const id = await tarea();
    expect((await llamar('/compromisos/hoy', { como: DIEGO, metodo: 'PUT', cuerpo: { fin: '18:00', tareas: [id] } })).status).toBe(201);
    await aprobar(id);
    const antes = new Date(santiagoAUtc(`${hoy}T17:00`));
    const despues = new Date(santiagoAUtc(`${hoy}T18:30`));
    await reconciliarLogros(env.DB, antes);
    expect(await logrosDe('Día cumplido')).toHaveLength(0);
    await reconciliarLogros(env.DB, despues);
    expect(await logrosDe('Día cumplido')).toMatchObject([{ key: `day:demo-diego:${hoy}`, valid: 1 }]);
  });

  it('Sprint completo, Objetivo alcanzado y Lanzamiento verificado', async () => {
    const id = await tarea();
    await aprobar(id);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO sprints (id, name, brand_id, goal, start_date, end_date, status, goal_result, goal_evidence, review)
          VALUES ('sp1', 'Sprint 1', 'demo-aurora', 'Lanzar la campaña', ?1, ?1, 'Cerrado', 'Alcanzado', 'https://x.test/informe', 'Salió bien')`).bind(hoy),
      env.DB.prepare(`INSERT INTO sprint_closed_records (sprint_id, task_id, title, status, approved) VALUES ('sp1', ?1, 'Banner', 'Aprobada', 1)`).bind(id),
      env.DB.prepare(`INSERT INTO campaigns (id, brand_id, name, launched_at, launch_evidence) VALUES ('c1', 'demo-aurora', 'Campaña de otoño', ?1, 'https://x.test/aviso')`).bind(hoy),
    ]);
    await reconciliarLogros(env.DB);
    expect((await logrosDe('Sprint completo')).map((l) => l.key)).toEqual(['sprint:sp1']);
    expect((await logrosDe('Objetivo del sprint alcanzado')).map((l) => l.key)).toEqual(['goal:sp1']);
    expect(await fila("SELECT mesa_id FROM achievements WHERE key = 'launch:c1'")).toEqual({ mesa_id: 'mesa-marketing' });
  });

  it('Entrega entre áreas: coordinación registra, solo quien recibe confirma', async () => {
    const id = await tarea();
    const registrar = (como: string) => llamar(`/tareas/${id}/recepcion`, { como, metodo: 'POST', cuerpo: { mesaId: 'mesa-operaciones', receptorId: 'demo-elena', evidencia: 'Archivo entregado en la carpeta compartida' } });
    expect((await registrar(COORD)).cuerpo.error.code).toBe('no_aceptable');
    await aprobar(id);
    expect((await registrar(DIEGO)).status).toBe(403);
    expect((await registrar(COORD)).status).toBe(200);
    expect((await llamar(`/tareas/${id}/recepcion/confirmar`, { como: DIEGO, metodo: 'POST', cuerpo: {} })).status).toBe(403);
    expect((await llamar(`/tareas/${id}/recepcion/confirmar`, { como: ELENA, metodo: 'POST', cuerpo: {} })).status).toBe(200);
    const [l] = await logrosDe('Entrega entre áreas');
    expect(l).toMatchObject({ key: `exchange:${id}`, valid: 1 });
    expect((await todos('SELECT person_id FROM achievement_people WHERE achievement_id = ?1', l.id)).map((x) => x.person_id)).toContain('demo-elena');
  });
});

describe('Comunidad: felicitar, comentar, privacidad y moderación', () => {
  beforeEach(cargarSemilla);
  const conLogro = async () => { const id = await tarea(); await aprobar(id); return (await logrosDe('Tarea aceptada'))[0].id as string; };

  it('solo el equipo entra; quien no ve la tarea ve un título genérico', async () => {
    const id = await conLogro();
    expect((await llamar('/logros', { como: 'ines@mesawow.test' })).status).toBe(403);
    const propio = (await llamar('/logros', { como: DIEGO })).cuerpo.logros[0];
    expect(propio).toMatchObject({ id, titulo: 'Banner de Aurora', detalle: true, tareaId: expect.any(String) });
    const ajeno = (await llamar('/logros', { como: ELENA })).cuerpo.logros[0];
    expect(ajeno).toMatchObject({ id, titulo: 'Un aporte al equipo ha sido completado', detalle: false, tareaId: null, marca: null });
    expect((await llamar(`/logros/${id}`, { como: ELENA })).cuerpo.tareas).toEqual([]);
  });

  it('felicitar alterna y avisa una sola vez a las personas reconocidas', async () => {
    const id = await conLogro();
    expect((await llamar(`/logros/${id}/felicitar`, { como: COORD, metodo: 'POST', cuerpo: {} })).cuerpo).toEqual({ felicitaste: true, felicitaciones: 1 });
    expect((await llamar(`/logros/${id}/felicitar`, { como: COORD, metodo: 'POST', cuerpo: {} })).cuerpo).toEqual({ felicitaste: false, felicitaciones: 0 });
    await llamar(`/logros/${id}/felicitar`, { como: COORD, metodo: 'POST', cuerpo: {} });
    const avisos = await todos("SELECT person_id FROM outbox WHERE event = 'Te felicitaron' AND channel = 'app' ORDER BY person_id");
    expect(avisos.map((a) => a.person_id)).toEqual(['demo-diego', 'demo-fabian']);
  });

  it('comentar con mención avisa salvo que la persona lo desactive; cada quien retira solo lo suyo', async () => {
    const id = await conLogro();
    const comentar = (como: string, mencionId: string | null) => llamar(`/logros/${id}/comentarios`, { como, metodo: 'POST', cuerpo: { texto: '¡Gran trabajo!', mencionId } });
    expect((await llamar(`/logros/${id}/comentarios`, { como: COORD, metodo: 'POST', cuerpo: { texto: 'x'.repeat(1001) } })).status).toBe(400);
    const c1 = (await comentar(COORD, 'demo-diego')).cuerpo.id;
    expect(await todos("SELECT person_id FROM mentions")).toEqual([{ person_id: 'demo-diego' }]);
    await env.DB.prepare("UPDATE preferences SET mentions = 0 WHERE person_id = 'demo-fabian'").run();
    await comentar(COORD, 'demo-fabian');
    expect(await todos("SELECT person_id FROM mentions")).toHaveLength(1);
    expect((await llamar(`/comentarios/${c1}`, { como: DIEGO, metodo: 'DELETE' })).status).toBe(403);
    expect((await llamar(`/comentarios/${c1}`, { como: COORD, metodo: 'DELETE' })).status).toBe(200);
    expect((await llamar(`/logros/${id}`, { como: COORD })).cuerpo.comentarios).toHaveLength(1);
  });

  it('reportar y moderar: solo administración; restringir oculta el detalle a todo el equipo', async () => {
    const id = await conLogro();
    await llamar(`/logros/${id}/comentarios`, { como: COORD, metodo: 'POST', cuerpo: { texto: 'Comentario' } });
    expect((await llamar(`/logros/${id}/reportar`, { como: DIEGO, metodo: 'POST', cuerpo: { motivo: 'Muestra un dato sensible' } })).status).toBe(201);
    expect((await llamar('/moderacion', { como: COORD })).status).toBe(403);
    const [r] = (await llamar('/moderacion', { como: ANA })).cuerpo.reportes;
    expect((await llamar(`/moderacion/${r.id}`, { como: ANA, metodo: 'POST', cuerpo: { accion: 'restringir', motivo: '' } })).status).toBe(400);
    expect((await llamar(`/moderacion/${r.id}`, { como: ANA, metodo: 'POST', cuerpo: { accion: 'restringir', motivo: 'Dato sensible' } })).status).toBe(200);
    expect((await llamar('/logros', { como: DIEGO })).cuerpo.logros[0].detalle).toBe(false);
    expect(await fila("SELECT status FROM achievement_reports")).toEqual({ status: 'Resuelto' });
    expect(await fila("SELECT count(*) AS n FROM audit_log WHERE action LIKE 'Moderación social%'")).toEqual({ n: 1 });
  });
});

describe('compromisos del día (§4.4), Logros del equipo e Informes', () => {
  beforeEach(cargarSemilla);

  it('exige al menos una tarea propia; editar pide motivo y solo coordinación quita una ya confirmada', async () => {
    const a = await tarea(), b = await tarea({ titulo: 'Segunda pieza' });
    const otra = await tarea({ responsableId: 'demo-elena' });
    const guardar = (tareas: string[], motivo?: string) => llamar('/compromisos/hoy', { como: DIEGO, metodo: 'PUT', cuerpo: { fin: '18:00', tareas, motivo } });
    expect((await guardar([])).status).toBe(400);
    expect((await guardar([otra])).status).toBe(400);
    expect((await guardar([a])).status).toBe(201);
    expect((await guardar([a, b])).cuerpo.error.code).toBe('sin_motivo');
    expect((await guardar([a, b], 'Llegó otra urgencia')).status).toBe(200);
    expect((await guardar([b], 'Ya no alcanzo')).status).toBe(403);
    expect((await llamar('/compromisos/hoy', { como: DIEGO })).cuerpo).toMatchObject({ existe: true, seleccion: expect.arrayContaining([a, b]) });
    expect(await fila('SELECT count(*) AS n FROM commitment_changes')).toEqual({ n: 1 });
  });

  it('Logros del equipo cuenta por mesa sin rankings; Informes resume el estado', async () => {
    const id = await tarea();
    await aprobar(id);
    await tarea({ titulo: 'Atrasada', inicio: '2020-01-06', plazo: '2020-01-10' });
    expect((await llamar('/reconocimiento', { como: DIEGO })).status).toBe(403);
    const r = (await llamar('/reconocimiento', { como: COORD })).cuerpo;
    expect(r.porMesa.find((m: any) => m.id === 'mesa-marketing').n).toBe(1);
    expect(r.porMesa.find((m: any) => m.id === 'mesa-operaciones').n).toBe(0);
    expect(r.recientes.every((l: any) => l.detalle)).toBe(true);
    expect((await llamar('/informes', { como: DIEGO })).status).toBe(403);
    const inf = (await llamar('/informes?persona=demo-diego', { como: COORD })).cuerpo;
    expect(inf).toMatchObject({ completadas: 1, atrasadas: 1 });
    expect(inf.total).toBe(inf.tareas.length);
  });
});
