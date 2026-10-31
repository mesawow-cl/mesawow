import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { descargarFeriados, sincronizarFeriados } from '../src/worker/agenda';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const COORD = 'bruno@mesawow.test', DIEGO = 'diego@mesawow.test', ELENA = 'elena@mesawow.test';
// 2030-01-07 es lunes: fechas futuras para que "lo ya trabajado" no interfiera.
const tarea = (horas = 8) => llamar('/tareas', {
  como: COORD, metodo: 'POST', cuerpo: {
    titulo: 'Landing de verano', marcaId: 'demo-aurora', descripcion: 'Landing', entregable: 'URL publicada', criterio: 'QA aprobado',
    responsableId: 'demo-diego', revisorId: 'demo-fabian', inicio: '2030-01-07', plazo: '2030-01-11', horas,
  },
});
const bloques = async (id: string) =>
  (await env.DB.prepare('SELECT starts_at, ends_at FROM work_blocks WHERE task_id = ?1 ORDER BY starts_at').bind(id).all()).results
    .map((b: any) => `${b.starts_at}–${b.ends_at.slice(11)}`);

describe('agenda', () => {
  beforeEach(cargarSemilla);

  it('las horas estimadas se reservan solas en la agenda del responsable', async () => {
    const { cuerpo } = await tarea();
    expect(await bloques(cuerpo.id)).toEqual(['2030-01-07T09:00–14:00', '2030-01-07T15:00–18:00']);
    expect(await env.DB.prepare('SELECT planned_finish FROM tasks WHERE id = ?1').bind(cuerpo.id).first()).toEqual({ planned_finish: '2030-01-07T18:00' });
  });

  it('una reunión inesperada corre la tarea, registra el cambio y avisa a revisión y dirección', async () => {
    const { cuerpo: t } = await tarea();
    const r = await llamar('/reuniones', { como: DIEGO, metodo: 'POST', cuerpo: { titulo: 'Cliente urgente', inicio: '2030-01-07T10:00', fin: '2030-01-07T11:00' } });
    expect(r.status).toBe(201);
    expect(r.cuerpo.cambios).toEqual([{ tarea: t.id, titulo: 'Landing de verano', antes: '2030-01-07T18:00', ahora: '2030-01-08T10:00' }]);
    expect(await bloques(t.id)).toEqual(['2030-01-07T09:00–10:00', '2030-01-07T11:00–14:00', '2030-01-07T15:00–18:00', '2030-01-08T09:00–10:00']);
    const avisados = (await env.DB.prepare("SELECT person_id FROM outbox WHERE event = 'Término recalculado por agenda' ORDER BY person_id").all()).results;
    expect(avisados).toEqual([{ person_id: 'demo-fabian' }, { person_id: 'demo-gloria' }]);
  });

  it('un día no laborable mueve el trabajo al siguiente día hábil', async () => {
    const { cuerpo: t } = await tarea(10);
    await llamar('/feriados', { como: COORD, metodo: 'POST', cuerpo: { fecha: '2030-01-08', nombre: 'Aniversario' } });
    expect(await bloques(t.id)).toEqual(['2030-01-07T09:00–14:00', '2030-01-07T15:00–18:00', '2030-01-09T09:00–11:00']);
  });

  it('al aprobarse, la tarea libera las horas que tenía reservadas', async () => {
    const { cuerpo: t } = await tarea();
    await llamar(`/tareas/${t.id}/entregar`, { como: DIEGO, metodo: 'POST', cuerpo: { resultado: 'Listo' } });
    await llamar(`/tareas/${t.id}/aprobar`, { como: 'fabian@mesawow.test', metodo: 'POST', cuerpo: {} });
    expect(await bloques(t.id)).toEqual([]);
  });

  it('cada persona ve su agenda; coordinación ve la de otros', async () => {
    await tarea();
    const propia = await llamar('/agenda?desde=2030-01-07&hasta=2030-01-11', { como: DIEGO });
    expect(propia.cuerpo.bloques).toHaveLength(2);
    expect((await llamar('/agenda?persona=demo-diego&desde=2030-01-07', { como: ELENA })).status).toBe(403);
    expect((await llamar('/agenda?persona=demo-diego&desde=2030-01-07', { como: COORD })).status).toBe(200);
  });

  it('nadie agenda reuniones en la agenda de otra persona salvo coordinación', async () => {
    const r = await llamar('/reuniones', { como: ELENA, metodo: 'POST', cuerpo: { personaId: 'demo-diego', titulo: 'Revisión', inicio: '2030-01-07T10:00', fin: '2030-01-07T11:00' } });
    expect(r.status).toBe(403);
    const m = await llamar('/reuniones', { como: DIEGO, metodo: 'POST', cuerpo: { titulo: 'Revisión', inicio: '2030-01-07T11:00', fin: '2030-01-07T10:00' } });
    expect(m.cuerpo.error.message).toBe('La reunión debe terminar después de empezar.');
  });
});

describe('feriados oficiales de Chile', () => {
  beforeEach(cargarSemilla);
  const respuesta = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

  it('usa la lista oficial y, si falla, el respaldo (solo feriados nacionales)', async () => {
    const boostr: typeof fetch = async () => respuesta({ status: 'success', data: [{ date: '2030-09-18', title: 'Independencia Nacional' }] });
    expect(await descargarFeriados(2030, boostr)).toEqual([{ fecha: '2030-09-18', nombre: 'Independencia Nacional' }]);
    const conRespaldo: typeof fetch = async (u) => String(u).includes('boostr') ? respuesta({}, 500)
      : respuesta([{ date: '2030-09-18', localName: 'Fiestas Patrias', global: true }, { date: '2030-06-07', localName: 'Morro de Arica', global: false }]);
    expect(await descargarFeriados(2030, conRespaldo)).toEqual([{ fecha: '2030-09-18', nombre: 'Fiestas Patrias' }]);
  });

  it('reemplaza los oficiales del año y conserva los días manuales', async () => {
    await env.DB.prepare("INSERT INTO holidays (date, name, source) VALUES ('2030-02-15', 'Aniversario', 'manual'), ('2030-03-01', 'Antiguo', 'oficial')").run();
    const fuente: typeof fetch = async () => respuesta({ status: 'success', data: [{ date: '2030-01-01', title: 'Año Nuevo' }, { date: '2030-05-01', title: 'Día del Trabajo' }] });
    expect(await sincronizarFeriados(env.DB, [2030], fuente)).toBe(2);
    expect((await env.DB.prepare('SELECT date, source FROM holidays ORDER BY date').all()).results).toEqual([
      { date: '2030-01-01', source: 'oficial' }, { date: '2030-02-15', source: 'manual' }, { date: '2030-05-01', source: 'oficial' },
    ]);
  });

  it('los feriados oficiales no se pueden borrar a mano', async () => {
    await env.DB.prepare("INSERT INTO holidays (date, name, source) VALUES ('2030-05-01', 'Día del Trabajo', 'oficial')").run();
    expect((await llamar('/feriados/2030-05-01', { como: COORD, metodo: 'DELETE' })).status).toBe(409);
  });
});
