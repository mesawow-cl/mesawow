import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const COORD = 'bruno@mesawow.test';
const fila = <T = any>(sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).first<T>();
const post = (ruta: string, cuerpo: unknown, como = COORD) => llamar(ruta, { como, metodo: 'POST', cuerpo });

describe('centro de planificación', () => {
  beforeEach(cargarSemilla);

  it('la campaña 360 crea 437 tareas con dependencias, responsables y aprobación', async () => {
    const r = await post('/campanas/360', {
      nombre: 'Campaña de verano', marcaId: 'demo-aurora', inicio: '2030-01-07', objetivo: 'Agendamientos', indicador: 'Reuniones',
      alcance: { organic: 12, video: 4, email: 4, ads: 4 }, inputsListos: true, canales: ['Meta Ads', 'Brevo · mailing y newsletter'],
      alAireDesde: '2030-01-21', alAireHasta: '2030-04-20', responsableMarketingId: 'demo-diego', responsableComercialId: 'demo-carla', revisorId: 'demo-fabian',
    });
    expect(r.status).toBe(201);
    expect(r.cuerpo.tareas).toBe(437);
    const id = r.cuerpo.id;
    expect(await fila('SELECT count(*) AS n FROM tasks WHERE campaign_id = ?1', id)).toEqual({ n: 437 });
    expect(await fila("SELECT owner_id, mesa_id FROM tasks WHERE campaign_id = ?1 AND title = 'Inputs y oferta comercial'", id)).toEqual({ owner_id: 'demo-carla', mesa_id: 'mesa-comercial-y-ventas' });
    const cierre = await fila<{ id: string }>("SELECT id FROM tasks WHERE campaign_id = ?1 AND title = 'Cierre trimestral y aprendizajes'", id);
    expect(await fila('SELECT count(*) AS n FROM task_dependencies WHERE task_id = ?1', cierre!.id)).toEqual({ n: 436 });
    expect(await fila("SELECT count(*) AS n FROM task_people WHERE person_id = 'demo-fabian' AND role = 'approver'")).toEqual({ n: 437 });
    expect(await fila('SELECT type, protocol_version, live_start FROM campaigns WHERE id = ?1', id)).toEqual({ type: '360', protocol_version: '360-2', live_start: '2030-01-21' });
  });

  it('el webinar crea 31 tareas con inputs por validar y pone el evento en la agenda', async () => {
    const r = await post('/campanas/webinar', {
      nombre: 'Webinar de inversión', marcaId: 'demo-aurora', fechaEvento: '2030-02-14', horaEvento: '18:00', minutos: 90, plataforma: 'Google Meet',
      responsables: { Marketing: 'demo-diego', Comercial: 'demo-carla' }, revisorId: 'demo-fabian',
    });
    expect(r.cuerpo).toMatchObject({ tareas: 31, horas: 84.5 });
    expect(r.cuerpo.sinAsignar).toBeGreaterThan(0);
    expect(await fila("SELECT count(*) AS n FROM tasks WHERE campaign_id = ?1 AND inputs_ready = 0", r.cuerpo.id)).toEqual({ n: 31 });
    expect(await fila("SELECT starts_at, ends_at FROM meetings WHERE person_id = 'demo-diego' AND campaign_id = ?1", r.cuerpo.id))
      .toEqual({ starts_at: '2030-02-14T18:00', ends_at: '2030-02-14T19:30' });
    // Sin inputs validados, la propuesta semanal no compromete nada.
    const ids = (await env.DB.prepare('SELECT id FROM tasks WHERE campaign_id = ?1').bind(r.cuerpo.id).all<{ id: string }>()).results.map((x) => x.id);
    const p = await post('/planificacion/propuesta', { tareaIds: ids, desde: '2030-01-14' });
    expect(p.cuerpo.propuestas).toHaveLength(0);
    expect(p.cuerpo.problemas.some((x: any) => x.motivo === 'Inputs sin validar.')).toBe(true);
    const v = await post(`/campanas/${r.cuerpo.id}/validar-inputs`, {});
    expect(v.cuerpo.tareas).toHaveLength(31);
  });

  it('un trabajo del catálogo crea una cadena por unidad; la plantilla nueva no cambia trabajos creados', async () => {
    const r = await post('/trabajos', { plantillaId: 'servicio-organic', nombre: 'Posts de enero', marcaId: 'demo-aurora', inicio: '2030-01-07', plazo: '2030-01-11', cantidad: 2, responsableId: 'demo-diego', revisorId: 'demo-fabian', inputsListos: true });
    expect(r.cuerpo.tareas).toHaveLength(12);
    expect(await fila("SELECT owner_id FROM tasks WHERE title = 'Posts de enero · Unidad 1 · Revisión y ajustes'")).toEqual({ owner_id: 'demo-fabian' });
    const paso = { title: 'Diseñar', hours: 2, tool: 'Canva', instruction: 'Diseña', deliverable: 'PNG', acceptance: 'Aprobado', dependency: 0, role: 'execute' };
    const pl = await post('/plantillas', { nombre: 'Afiche', pasos: [paso] });
    const t = await post('/trabajos', { plantillaId: pl.cuerpo.id, nombre: 'Afiche feria', marcaId: 'demo-aurora', inicio: '2030-01-07', plazo: '2030-01-11', responsableId: 'demo-diego' });
    await llamar(`/plantillas/${pl.cuerpo.id}`, { como: COORD, metodo: 'PUT', cuerpo: { nombre: 'Afiche', pasos: [paso, { ...paso, title: 'Imprimir', dependency: 1 }] } });
    expect(await fila('SELECT template_version, json_array_length(steps_snapshot_json) AS pasos FROM jobs WHERE id = ?1', t.cuerpo.id)).toEqual({ template_version: 1, pasos: 1 });
    expect((await post('/plantillas', { nombre: 'Mala', pasos: [{ ...paso, dependency: 2 }] })).cuerpo.error.message).toMatch(/paso anterior/);
  });

  it('aplicar la propuesta crea el sprint "Semana <lunes>", reserva la agenda y deja las tareas en el sprint', async () => {
    const r = await post('/trabajos', { plantillaId: 'servicio-graphic', nombre: 'Banner', marcaId: 'demo-aurora', inicio: '2030-01-07', plazo: '2030-01-11', responsableId: 'demo-diego', revisorId: 'demo-fabian', inputsListos: true });
    const a = await post('/planificacion/aplicar', { tareaIds: r.cuerpo.tareas, desde: '2030-01-07' });
    expect(a.cuerpo).toEqual({ aplicadas: 4, sprints: 1, problemas: 0 });
    expect(await fila("SELECT name, status, weekly FROM sprints WHERE brand_id = 'demo-aurora'")).toEqual({ name: 'Semana 2030-01-07', status: 'Planificado', weekly: 1 });
    expect(await fila('SELECT count(*) AS n FROM tasks WHERE id IN (SELECT value FROM json_each(?1)) AND sprint_id IS NOT NULL', JSON.stringify(r.cuerpo.tareas))).toEqual({ n: 4 });
    expect(await fila('SELECT min(starts_at) AS desde FROM work_blocks WHERE task_id IN (SELECT value FROM json_each(?1))', JSON.stringify(r.cuerpo.tareas))).toEqual({ desde: '2030-01-07T09:00' });
  });

  it('solo coordinación genera campañas y trabajos', async () => {
    expect((await post('/trabajos', {}, 'diego@mesawow.test')).status).toBe(403);
    expect((await post('/campanas/360', {}, 'diego@mesawow.test')).status).toBe(403);
  });
});
