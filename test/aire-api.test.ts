import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { procesarAire } from '../src/worker/aire';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const COORD = 'bruno@mesawow.test', DIEGO = 'diego@mesawow.test';
const fila = <T = any>(sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).first<T>();
const todos = (sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).all().then((r) => r.results);

const tarea = async () => (await llamar('/tareas', { como: COORD, metodo: 'POST', cuerpo: {
  titulo: 'Mails de enero', marcaId: 'demo-aurora', descripcion: 'Serie de mails', entregable: 'HTML', criterio: 'Aprobado',
  responsableId: 'demo-diego', revisorId: 'demo-fabian', inicio: '2030-01-01', plazo: '2030-01-31', horas: 1,
} })).cuerpo.id as string;
const serieMail = { name: 'Mail', channel: 'Correo (Brevo)', mode: 'dias', days: ['1', '3', '5'], time: '10:00', from: '2030-01-14', weeks: 4, hours: 0.5 };
const programar = (id: string, cuerpo: unknown) => llamar(`/tareas/${id}/aire`, { como: COORD, metodo: 'PUT', cuerpo });

describe('salidas al aire', () => {
  beforeEach(cargarSemilla);

  it('la serie genera sus piezas, sus horas pasan a la tarea y el plazo se ajusta a 2 días antes de la primera salida (A1)', async () => {
    const id = await tarea();
    const r = await programar(id, { activo: true, series: [serieMail], sueltas: [{ channel: 'Instagram', at: '2030-01-20T12:00' }] });
    expect(r.cuerpo).toMatchObject({ piezas: 13, horas: 6, plazo: '2030-01-12', plazoAjustado: true });
    expect(await fila('SELECT due, estimated_hours FROM tasks WHERE id = ?1', id)).toEqual({ due: '2030-01-12', estimated_hours: 6 });
    // Editar la tarea con un plazo posterior a la primera salida se rechaza.
    const editar = await llamar(`/tareas/${id}`, { como: COORD, metodo: 'PATCH', cuerpo: {
      titulo: 'Mails de enero', marcaId: 'demo-aurora', descripcion: 'Serie', entregable: 'HTML', criterio: 'Aprobado', responsableId: 'demo-diego', inicio: '2030-01-01', plazo: '2030-01-20',
    } });
    expect(editar.cuerpo.error.message).toBe('La fecha límite de trabajo debe ser antes de la salida al aire.');
  });

  it('volver a guardar la serie conserva el estado y el aviso de las piezas que no cambian', async () => {
    const id = await tarea();
    await programar(id, { activo: true, series: [serieMail] });
    await env.DB.prepare("UPDATE air_slots SET risk_notified_at = 'x' WHERE task_id = ?1 AND piece = 'Mail 1'").bind(id).run();
    const { series } = (await llamar(`/tareas/${id}/aire`, { como: COORD })).cuerpo;
    await programar(id, { activo: true, series: [{ ...serieMail, id: series[0].id, weeks: 5 }] });
    expect(await fila("SELECT count(*) AS n FROM air_slots WHERE task_id = ?1", id)).toEqual({ n: 15 });
    expect(await fila("SELECT risk_notified_at FROM air_slots WHERE task_id = ?1 AND piece = 'Mail 1'", id)).toEqual({ risk_notified_at: 'x' });
  });

  it('exige al menos una serie o salida, y solo coordinación programa', async () => {
    const id = await tarea();
    expect((await programar(id, { activo: true })).cuerpo.error.message).toMatch(/Agrega una serie/);
    expect((await llamar(`/tareas/${id}/aire`, { como: DIEGO, metodo: 'PUT', cuerpo: { activo: true, series: [serieMail] } })).status).toBe(403);
  });

  it('marcar al aire exige la tarea aprobada; con enlace verifica el lanzamiento de la campaña (A6)', async () => {
    const camp = (await llamar('/campanas', { como: COORD, metodo: 'POST', cuerpo: { nombre: 'Enero', marcaId: 'demo-aurora' } })).cuerpo.id;
    const id = (await llamar('/tareas', { como: COORD, metodo: 'POST', cuerpo: {
      titulo: 'Post', marcaId: 'demo-aurora', campanaId: camp, descripcion: 'Post', entregable: 'Post', criterio: 'Ok', responsableId: 'demo-diego', inicio: '2030-01-01', plazo: '2030-01-05',
    } })).cuerpo.id;
    await programar(id, { activo: true, sueltas: [{ channel: 'Instagram', at: '2030-01-10T12:00' }] });
    const pieza = await fila<{ id: string }>('SELECT id FROM air_slots WHERE task_id = ?1', id);
    expect((await llamar(`/aire/${pieza!.id}/publicar`, { como: DIEGO, metodo: 'POST', cuerpo: {} })).cuerpo.error.code).toBe('sin_aprobar');
    await llamar(`/tareas/${id}/entregar`, { como: DIEGO, metodo: 'POST', cuerpo: { resultado: 'Listo' } });
    expect((await llamar(`/aire/${pieza!.id}/publicar`, { como: DIEGO, metodo: 'POST', cuerpo: { url: 'https://instagram.com/p/1' } })).status).toBe(200);
    expect(await fila('SELECT launch_evidence FROM campaigns WHERE id = ?1', camp)).toEqual({ launch_evidence: 'Post en Instagram: https://instagram.com/p/1' });
  });
});

describe('automatizaciones al aire', () => {
  beforeEach(cargarSemilla);

  it('A4: la pieza de una tarea aprobada sale sola al llegar su hora (idempotente)', async () => {
    const id = await tarea();
    await programar(id, { activo: true, sueltas: [{ channel: 'Instagram', at: '2030-01-10T12:00' }] });
    await env.DB.prepare("UPDATE tasks SET status = 'Aprobada' WHERE id = ?1").bind(id).run();
    expect((await procesarAire(env.DB, new Date('2030-01-10T14:00:00Z'))).alAire).toBe(0); // 11:00 en Santiago
    expect((await procesarAire(env.DB, new Date('2030-01-10T15:30:00Z'))).alAire).toBe(1);
    expect((await procesarAire(env.DB, new Date('2030-01-10T15:35:00Z'))).alAire).toBe(0);
    expect(await fila('SELECT status, auto, published_at FROM air_slots WHERE task_id = ?1', id)).toEqual({ status: 'Al aire', auto: 1, published_at: '2030-01-10T15:00:00.000Z' });
  });

  it('A5: avisa una sola vez por pieza a responsable, revisión y aprobación; si la fecha cambia vuelve a avisar', async () => {
    const id = await tarea();
    await programar(id, { activo: true, sueltas: [{ channel: 'Instagram', at: '2030-01-10T12:00' }] });
    await procesarAire(env.DB, new Date('2030-01-07T13:00:00Z'));
    await procesarAire(env.DB, new Date('2030-01-08T13:00:00Z'));
    expect((await procesarAire(env.DB, new Date('2030-01-09T13:00:00Z'))).avisos).toBe(0);
    expect(await todos("SELECT person_id FROM outbox WHERE event = 'Salida al aire en riesgo' ORDER BY person_id")).toEqual([{ person_id: 'demo-diego' }, { person_id: 'demo-fabian' }]);
    await programar(id, { activo: true, sueltas: [{ channel: 'Instagram', at: '2030-01-11T12:00' }] });
    expect((await procesarAire(env.DB, new Date('2030-01-09T13:00:00Z'))).avisos).toBe(1);
  });
});
