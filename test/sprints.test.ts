import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const COORD = 'bruno@mesawow.test', DIEGO = 'diego@mesawow.test', ELENA = 'elena@mesawow.test';
const LUNES = '2030-01-07';
const fila = <T = any>(sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).first<T>();
const post = (ruta: string, como: string, cuerpo: unknown = {}) => llamar(ruta, { como, metodo: 'POST', cuerpo });

const crearSprint = async (cambios: Record<string, unknown> = {}) => (await post('/sprints', COORD, {
  marcaId: 'demo-aurora', nombre: 'Semana de lanzamiento', objetivo: 'Publicar la landing', inicio: LUNES,
  miembros: [{ personaId: 'demo-diego', horasDiarias: 8 }, { personaId: 'demo-elena', horasDiarias: 4 }], ...cambios,
})).cuerpo;
const crearTarea = async (cambios: Record<string, unknown> = {}) => (await post('/tareas', COORD, {
  titulo: 'Diseño de landing', marcaId: 'demo-aurora', descripcion: 'Diseñar', entregable: 'Figma', criterio: 'Aprobado',
  responsableId: 'demo-diego', revisorId: 'demo-fabian', inicio: LUNES, plazo: '2030-01-11', horas: 4, ...cambios,
})).cuerpo;

describe('planificar sprints', () => {
  beforeEach(cargarSemilla);

  it('el sprint semanal empieza el lunes y lo crea coordinación', async () => {
    expect((await post('/sprints', DIEGO, {})).status).toBe(403);
    const r = await post('/sprints', COORD, { marcaId: 'demo-aurora', nombre: 'Sprint', objetivo: 'Objetivo', inicio: '2030-01-08', miembros: [{ personaId: 'demo-diego', horasDiarias: 8 }] });
    expect(r.cuerpo.error.message).toBe('El sprint semanal comienza el lunes.');
    const { id } = await crearSprint();
    expect(await fila('SELECT status, start_date, end_date FROM sprints WHERE id = ?1', id)).toEqual({ status: 'Planificado', start_date: LUNES, end_date: '2030-01-11' });
  });

  it('todos los miembros deben tener la marca del sprint', async () => {
    const r = await post('/sprints', COORD, { marcaId: 'demo-boreal', nombre: 'Sprint', objetivo: 'Objetivo', inicio: LUNES, miembros: [{ personaId: 'demo-elena', horasDiarias: 8 }] });
    expect(r.cuerpo.error.message).toBe('Elena Simulada no tiene asignada la marca del sprint.');
  });

  it('una tarea entra sola al sprint planificado de la semana de sus horas (A3)', async () => {
    const s = await crearSprint();
    const t = await crearTarea();
    expect(t.sprint).toBe('Semana de lanzamiento');
    expect(await fila('SELECT sprint_id FROM tasks WHERE id = ?1', t.id)).toEqual({ sprint_id: s.id });
    expect(await fila("SELECT reason FROM task_events WHERE task_id = ?1 AND event = 'Agregada'", t.id))
      .toEqual({ reason: 'Automática: sus horas de trabajo caen en la semana del sprint' });
  });

  it('a un sprint ya iniciado no entra sola', async () => {
    const s = await crearSprint();
    await crearTarea();
    expect((await post(`/sprints/${s.id}/iniciar`, COORD)).status).toBe(200);
    const otra = await crearTarea({ titulo: 'Otra', horas: 2 });
    expect(otra.sprint).toBeUndefined();
  });

  it('agregar a mano exige que la persona responsable sea miembro, y motivo si ya empezó', async () => {
    const s = await crearSprint({ miembros: [{ personaId: 'demo-elena', horasDiarias: 8 }] });
    const t = await crearTarea({ inicio: '2030-02-04', plazo: '2030-02-08' });
    expect((await post(`/sprints/${s.id}/tareas`, COORD, { tareaId: t.id })).cuerpo.error.code).toBe('no_miembro');
  });

  it('la capacidad descuenta reuniones y feriados', async () => {
    const s = await crearSprint();
    await post('/reuniones', DIEGO, { titulo: 'Comité', inicio: '2030-01-07T10:00', fin: '2030-01-07T12:00' });
    await post('/feriados', COORD, { fecha: '2030-01-08', nombre: 'Aniversario' });
    const r = await llamar(`/sprints/${s.id}`, { como: COORD });
    const diego = r.cuerpo.miembros.find((m: any) => m.personaId === 'demo-diego');
    expect(diego).toMatchObject({ dias: 4, ocupado: 2, disponible: 30 });
  });
});

describe('iniciar, revisar y cerrar', () => {
  beforeEach(cargarSemilla);

  it('no inicia sin tareas, con tareas sin preparar o con sobrecarga sobre el 80 %', async () => {
    const s = await crearSprint();
    expect((await post(`/sprints/${s.id}/iniciar`, COORD)).cuerpo.error.code).toBe('sin_tareas');
    const t = await crearTarea({ horas: 34 }); // 34 h > 80 % de 40 h
    expect(t.sprint).toBe('Semana de lanzamiento');
    const r = await post(`/sprints/${s.id}/iniciar`, COORD);
    expect(r.cuerpo.error.message).toBe('Diego Ensayo supera el 80 % de su capacidad (34 h de 40 h disponibles). Retira o reasigna tareas.');
    await env.DB.prepare('UPDATE tasks SET estimated_hours = 0 WHERE id = ?1').bind(t.id).run();
    expect((await post(`/sprints/${s.id}/iniciar`, COORD)).cuerpo.error.message).toBe('"Diseño de landing" no está lista: falta estimación de horas.');
  });

  it('al iniciar guarda la línea base y avisa a los miembros', async () => {
    const s = await crearSprint();
    await crearTarea();
    expect((await post(`/sprints/${s.id}/iniciar`, COORD)).status).toBe(200);
    const sp = await fila<{ status: string; baseline_json: string }>('SELECT status, baseline_json FROM sprints WHERE id = ?1', s.id);
    expect(sp!.status).toBe('Activo');
    expect(JSON.parse(sp!.baseline_json).tasks).toHaveLength(1);
    expect((await env.DB.prepare("SELECT person_id FROM outbox WHERE event = 'Inicio de sprint' ORDER BY person_id").all()).results)
      .toEqual([{ person_id: 'demo-diego' }, { person_id: 'demo-elena' }]);
  });

  it('el avance diario solo con el sprint activo; un bloqueo exige quién y cuándo y bloquea la tarea', async () => {
    const s = await crearSprint();
    const t = await crearTarea();
    expect((await post(`/sprints/${s.id}/diario`, DIEGO, { tareaId: t.id, dia: LUNES, avance: 'Bocetos' })).status).toBe(409);
    await post(`/sprints/${s.id}/iniciar`, COORD);
    expect((await post(`/sprints/${s.id}/diario`, ELENA, { tareaId: t.id, dia: LUNES, avance: 'Algo' })).status).toBe(403);
    expect((await post(`/sprints/${s.id}/diario`, DIEGO, { tareaId: t.id, dia: LUNES, avance: 'Bocetos', bloqueo: 'Falta logo' })).status).toBe(400);
    expect((await post(`/sprints/${s.id}/diario`, DIEGO, { tareaId: t.id, dia: LUNES, avance: 'Bocetos', bloqueo: 'Falta logo', resuelveId: 'demo-carla', fechaRequerida: '2030-01-08' })).status).toBe(201);
    expect(await fila('SELECT blocked, block_resolver_id FROM tasks WHERE id = ?1', t.id)).toEqual({ blocked: 1, block_resolver_id: 'demo-carla' });
  });

  it('cerrar con pendientes exige excepción y devuelve lo pendiente al backlog', async () => {
    const s = await crearSprint();
    const t = await crearTarea();
    await post(`/sprints/${s.id}/iniciar`, COORD);
    await post(`/sprints/${s.id}/revision`, COORD);
    const base = { resultado: 'Parcialmente alcanzado', revision: 'Avanzamos el diseño', retro: 'Faltó tiempo de revisión' };
    expect((await post(`/sprints/${s.id}/cerrar`, COORD, base)).cuerpo.error.code).toBe('requiere_excepcion');
    expect((await post(`/sprints/${s.id}/cerrar`, COORD, { ...base, resultado: 'Alcanzado' })).cuerpo.error.message).toMatch(/evidencia/);
    const r = await post(`/sprints/${s.id}/cerrar`, COORD, {
      ...base, excepcion: { causa: 'Cambió la oferta', responsableId: 'demo-bruno', fecha: '2030-01-15' },
      mejora: 'Reservar un día de revisión', mejoraResponsableId: 'demo-fabian', mejoraFecha: '2030-01-18',
    });
    expect(r.cuerpo).toEqual({ ok: true, alBacklog: 1 });
    expect(await fila('SELECT sprint_id, planning_risk FROM tasks WHERE id = ?1', t.id))
      .toEqual({ sprint_id: null, planning_risk: 'Excepción de cierre: requiere nueva planificación explícita.' });
    expect(await fila('SELECT approved FROM sprint_closed_records WHERE sprint_id = ?1', s.id)).toEqual({ approved: 0 });
    expect(await fila("SELECT owner_id, due FROM tasks WHERE title = 'Reservar un día de revisión'")).toEqual({ owner_id: 'demo-fabian', due: '2030-01-18' });
  });
});
