import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { accionesPosibles, creaCiclo, estadoAlEntregar } from '../src/shared/dominio/tareas';
import { permisosDe } from '../src/shared/roles';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const ADMIN = 'ana@mesawow.test', COORD = 'bruno@mesawow.test', CARLA = 'carla@mesawow.test', DIEGO = 'diego@mesawow.test';
const ELENA = 'elena@mesawow.test', FABIAN = 'fabian@mesawow.test', HUGO = 'hugo@mesawow.test';
const fila = <T = any>(sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).first<T>();

const nueva = (cambios: Record<string, unknown> = {}) => ({
  titulo: 'Diseñar banner', marcaId: 'demo-aurora', mesaId: 'mesa-marketing', descripcion: 'Banner para la web', entregable: 'PNG 1200x628',
  criterio: 'Aprobado por revisión', responsableId: 'demo-diego', revisorId: 'demo-fabian', colaboradores: ['demo-elena'], aprobadores: [],
  inicio: '2026-11-02', plazo: '2026-11-06', horas: 4, complejidad: 'Media', prioridad: 'Alta', dependencias: [], ...cambios,
});
const crear = async (cambios: Record<string, unknown> = {}, como = COORD) => {
  const r = await llamar('/tareas', { como, metodo: 'POST', cuerpo: nueva(cambios) });
  return r.cuerpo.id as string;
};
const post = (ruta: string, como: string, cuerpo: unknown = {}) => llamar(ruta, { como, metodo: 'POST', cuerpo });

describe('reglas puras de tareas', () => {
  const base = { status: 'Pendiente' as const, blocked: false, owner_id: 'o', reviewer_id: 'r', collaborators: ['c'], approvers: [], acceptance: 'x', tieneEvidencia: false, dependenciasPendientes: 0, confidential: false };
  const ej = permisosDe({ role: 'Ejecutor' });

  it('con revisor va a revisión; sin revisor ni aprobadores queda completada', () => {
    expect(estadoAlEntregar(base)).toBe('Entregada para revisión');
    expect(estadoAlEntregar({ reviewer_id: null, approvers: [] })).toBe('Completada');
  });

  it('los colaboradores empiezan pero no entregan; solo revisión aprueba', () => {
    const c = accionesPosibles(base, 'c', ej);
    expect(c.empezar).toBe(true);
    expect(c.entregar).toBe(false);
    const enRevision = { ...base, status: 'Entregada para revisión' as const };
    expect(accionesPosibles(enRevision, 'o', ej).aprobar).toBe(false);
    expect(accionesPosibles(enRevision, 'r', ej).aprobar).toBe(true);
  });

  it('el rol Consulta no puede hacer nada', () => {
    const a = accionesPosibles(base, 'o', permisosDe({ role: 'Consulta' }));
    expect(Object.values(a).every((v) => !v)).toBe(true);
  });

  it('detecta ciclos de dependencias', () => {
    const aristas = new Map([['b', ['c']], ['c', ['a']]]);
    expect(creaCiclo('a', ['b'], aristas)).toBe(true);
    expect(creaCiclo('a', ['x'], aristas)).toBe(false);
  });
});

describe('visibilidad de tareas', () => {
  beforeEach(cargarSemilla);
  const ids = async (como: string) => (await llamar('/tareas', { como })).cuerpo.tareas.map((t: any) => t.id).sort();

  it('la administración ve todo; coordinación ve todo lo de sus marcas', async () => {
    expect(await ids(ADMIN)).toEqual(['demo-t1', 'demo-t2', 'demo-t3', 'demo-t4']);
    expect(await ids(CARLA)).toEqual(['demo-t1', 'demo-t2', 'demo-t3']); // Carla coordina Aurora y Boreal
  });

  it('quien ejecuta solo ve las tareas en que participa', async () => {
    expect(await ids(DIEGO)).toEqual(['demo-t2', 'demo-t3']);
    expect(await ids(ELENA)).toEqual(['demo-t4']);
    expect((await llamar('/tareas/demo-t1', { como: DIEGO })).status).toBe(404);
  });

  it('una tarea confidencial solo la ven sus participantes y la administración', async () => {
    await post('/tareas/demo-t3/confidencial', COORD, { valor: true });
    expect(await ids(CARLA)).not.toContain('demo-t3');
    expect(await ids(DIEGO)).toContain('demo-t3');
    expect(await ids(ADMIN)).toContain('demo-t3');
  });

  it('filtra por estado, persona y texto', async () => {
    const r = await llamar('/tareas?estado=Pendiente', { como: ADMIN });
    expect(r.cuerpo.tareas.map((t: any) => t.id)).toEqual(['demo-t3']);
    const p = await llamar('/tareas?persona=demo-elena', { como: ADMIN });
    expect(p.cuerpo.tareas.map((t: any) => t.id)).toEqual(['demo-t4']);
    const q = await llamar('/tareas?q=mailing', { como: ADMIN });
    expect(q.cuerpo.tareas.map((t: any) => t.id)).toEqual(['demo-t2']);
  });
});

describe('crear y editar tareas', () => {
  beforeEach(cargarSemilla);

  it('solo coordinación crea tareas', async () => {
    const r = await llamar('/tareas', { como: DIEGO, metodo: 'POST', cuerpo: nueva() });
    expect(r.status).toBe(403);
    expect(r.cuerpo.error.message).toMatch(/Solicita a coordinación/);
  });

  it('exige criterio de aceptación, fechas coherentes y personas con la marca', async () => {
    const e = async (cambios: Record<string, unknown>) => (await llamar('/tareas', { como: COORD, metodo: 'POST', cuerpo: nueva(cambios) })).cuerpo.error.message;
    expect(await e({ criterio: '' })).toMatch(/criterio de aceptación/);
    expect(await e({ inicio: '2026-11-10' })).toMatch(/posterior al inicio/);
    expect(await e({ marcaId: 'demo-boreal', colaboradores: ['demo-elena'] })).toBe('Elena Simulada no tiene asignada esta marca. Revisa Equipo.');
  });

  it('crea la tarea, avisa a las personas asignadas y registra la auditoría', async () => {
    const id = await crear();
    expect(await fila('SELECT status, owner_id, estimated_hours FROM tasks WHERE id = ?1', id)).toEqual({ status: 'Pendiente', owner_id: 'demo-diego', estimated_hours: 4 });
    const avisos = (await env.DB.prepare("SELECT person_id FROM outbox WHERE task_id = ?1 AND event = 'Nueva tarea asignada' ORDER BY person_id").bind(id).all()).results;
    expect(avisos).toEqual([{ person_id: 'demo-diego' }, { person_id: 'demo-elena' }, { person_id: 'demo-fabian' }]);
  });

  it('impide dependencias en ciclo y avisa si otra persona editó antes', async () => {
    const a = await crear();
    const b = await crear({ titulo: 'Segunda', dependencias: [a] });
    const ciclo = await llamar(`/tareas/${a}`, { como: COORD, metodo: 'PATCH', cuerpo: nueva({ dependencias: [b] }) });
    expect(ciclo.cuerpo.error.message).toBe('Esta dependencia crea un ciclo.');
    const viejo = await llamar(`/tareas/${a}`, { como: COORD, metodo: 'PATCH', cuerpo: nueva({ version: 0 }) });
    expect(viejo.status).toBe(409);
  });

  it('al quitar a alguien de la tarea se le avisa el retiro', async () => {
    const id = await crear();
    await llamar(`/tareas/${id}`, { como: COORD, metodo: 'PATCH', cuerpo: nueva({ colaboradores: [] }) });
    expect(await fila("SELECT event FROM outbox WHERE task_id = ?1 AND person_id = 'demo-elena' ORDER BY created_at DESC, event DESC LIMIT 1", id))
      .toEqual({ event: 'Retiro de asignación' });
  });
});

describe('ciclo de vida', () => {
  beforeEach(cargarSemilla);

  it('no se empieza ni se entrega con dependencias pendientes o bloqueada', async () => {
    const previa = await crear({ titulo: 'Previa' });
    const id = await crear({ titulo: 'Después', dependencias: [previa] });
    expect((await post(`/tareas/${id}/empezar`, DIEGO)).cuerpo.error.message).toBe('La tarea previa todavía no está aprobada.');
    await post(`/tareas/${previa}/bloquear`, DIEGO, { motivo: 'Falta el logo' });
    expect((await post(`/tareas/${previa}/empezar`, DIEGO)).cuerpo.error.message).toMatch(/bloqueada/);
    await post(`/tareas/${previa}/desbloquear`, DIEGO);
    expect((await post(`/tareas/${previa}/empezar`, DIEGO)).status).toBe(200);
  });

  it('entregar exige resultado; con revisor pasa a revisión y se avisa a revisión', async () => {
    const id = await crear();
    expect((await post(`/tareas/${id}/entregar`, DIEGO, { resultado: '' })).cuerpo.error.code).toBe('sin_resultado');
    expect((await post(`/tareas/${id}/entregar`, ELENA, { resultado: 'Listo' })).status).toBe(403); // colaboradora
    expect((await post(`/tareas/${id}/entregar`, DIEGO, { resultado: 'Banner listo: https://x.test/b.png' })).status).toBe(200);
    expect(await fila('SELECT status FROM tasks WHERE id = ?1', id)).toEqual({ status: 'Entregada para revisión' });
    expect(await fila("SELECT count(*) AS n FROM outbox WHERE task_id = ?1 AND event = 'Entrega para revisión' AND person_id = 'demo-fabian'", id)).toEqual({ n: 1 });
  });

  it('sin revisor ni aprobadores queda Completada', async () => {
    const id = await crear({ revisorId: null });
    await post(`/tareas/${id}/entregar`, DIEGO, { resultado: 'Listo' });
    expect(await fila('SELECT status FROM tasks WHERE id = ?1', id)).toEqual({ status: 'Completada' });
  });

  it('solo revisión aprueba; pedir ajustes exige motivo; aprobar guarda quién y cuándo', async () => {
    const id = await crear();
    await post(`/tareas/${id}/entregar`, DIEGO, { resultado: 'Listo' });
    expect((await post(`/tareas/${id}/aprobar`, DIEGO)).status).toBe(403);
    expect((await post(`/tareas/${id}/pedir-ajustes`, FABIAN, { motivo: '' })).status).toBe(400);
    await post(`/tareas/${id}/pedir-ajustes`, FABIAN, { motivo: 'Cambiar el color' });
    expect(await fila('SELECT status FROM tasks WHERE id = ?1', id)).toEqual({ status: 'Ajustes solicitados' });
    await post(`/tareas/${id}/entregar`, DIEGO, { resultado: 'Color corregido' });
    expect((await post(`/tareas/${id}/aprobar`, FABIAN)).status).toBe(200);
    expect(await fila('SELECT status, approved_by FROM tasks WHERE id = ?1', id)).toEqual({ status: 'Aprobada', approved_by: 'demo-fabian' });
  });

  it('reabrir es de coordinación, exige motivo e inicia un nuevo ciclo', async () => {
    expect((await post('/tareas/demo-t1/reabrir', CARLA, { motivo: 'Cambió la oferta' })).status).toBe(200);
    expect(await fila("SELECT status, execution_cycle, approved_by FROM tasks WHERE id = 'demo-t1'")).toEqual({ status: 'Ajustes solicitados', execution_cycle: 2, approved_by: null });
  });

  it('el rol Consulta y la vista "Ver la app como" no cambian nada', async () => {
    expect((await post('/tareas/demo-t3/empezar', HUGO)).status).toBe(403);
    const r = await llamar('/tareas/demo-t3/empezar', { como: ADMIN, metodo: 'POST', cuerpo: {}, cabeceras: { 'x-mesawow-ver-como': 'demo-diego' } });
    expect(r.cuerpo.error.code).toBe('solo_lectura');
    const detalle = await llamar('/tareas/demo-t3', { como: ADMIN, cabeceras: { 'x-mesawow-ver-como': 'demo-diego' } });
    expect(Object.values(detalle.cuerpo.tarea.acciones).every((v) => !v)).toBe(true);
  });

  it('el detalle trae personas, dependencias, comentarios y acciones posibles', async () => {
    await post('/tareas/demo-t2/comentarios', FABIAN, { texto: 'Revisa los enlaces' });
    const r = await llamar('/tareas/demo-t2', { como: DIEGO });
    expect(r.cuerpo.tarea).toMatchObject({
      responsable: { id: 'demo-diego', nombre: 'Diego Ensayo' }, revisor: { id: 'demo-fabian', nombre: 'Fabián Ficticio' },
      necesita: [{ id: 'demo-t1', status: 'Aprobada' }], comentarios: [{ text: 'Revisa los enlaces', autor: 'Fabián Ficticio' }],
    });
    expect(r.cuerpo.tarea.acciones).toMatchObject({ entregar: true, aprobar: false, editar: false });
  });
});

describe('resultados adjuntos', () => {
  beforeEach(cargarSemilla);
  const PDF = new TextEncoder().encode('%PDF-1.4 prueba');

  it('sube un archivo a R2 y lo descarga con protecciones', async () => {
    const r = await llamar('/tareas/demo-t2/archivo', { como: DIEGO, metodo: 'PUT', cuerpo: PDF, cabeceras: { 'content-type': 'application/pdf', 'x-nombre-archivo': 'brief.pdf' } });
    expect(r.status).toBe(201);
    const d = await llamar(`/tareas/demo-t2/resultados/${r.cuerpo.id}`, { como: FABIAN });
    expect(d.cabeceras.get('content-type')).toBe('application/pdf');
    expect(d.cabeceras.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(d.cuerpo)).toEqual(PDF);
  });

  it('el HTML se descarga, no se ejecuta en la app', async () => {
    const r = await llamar('/tareas/demo-t2/archivo', { como: DIEGO, metodo: 'PUT', cuerpo: new TextEncoder().encode('<p>hola</p>'), cabeceras: { 'content-type': 'text/html' } });
    const d = await llamar(`/tareas/demo-t2/resultados/${r.cuerpo.id}`, { como: DIEGO });
    expect(d.cabeceras.get('content-disposition')).toMatch(/^attachment/);
  });

  it('cambiar el resultado de una tarea aprobada la devuelve a revisión', async () => {
    await llamar('/tareas/demo-t1/archivo', { como: CARLA, metodo: 'PUT', cuerpo: PDF, cabeceras: { 'content-type': 'application/pdf' } });
    expect(await fila("SELECT status FROM tasks WHERE id = 'demo-t1'")).toEqual({ status: 'Entregada para revisión' });
  });

  it('rechaza formatos no admitidos y archivos de más de 700 KB', async () => {
    expect((await llamar('/tareas/demo-t2/archivo', { como: DIEGO, metodo: 'PUT', cuerpo: PDF, cabeceras: { 'content-type': 'application/zip' } })).status).toBe(415);
    expect((await llamar('/tareas/demo-t2/archivo', { como: DIEGO, metodo: 'PUT', cuerpo: new Uint8Array(700 * 1024 + 1), cabeceras: { 'content-type': 'application/pdf' } })).status).toBe(413);
  });
});

describe('mesas y marcas', () => {
  beforeEach(cargarSemilla);

  it('solo la administración crea mesas, con nombre único', async () => {
    expect((await post('/mesas', COORD, { nombre: 'Diseño' })).status).toBe(403);
    expect((await post('/mesas', ADMIN, { nombre: 'Diseño', descripcion: 'Piezas gráficas' })).status).toBe(201);
    expect((await post('/mesas', ADMIN, { nombre: 'diseño' })).cuerpo.error.code).toBe('nombre_repetido');
  });

  it('no se archiva una mesa con tareas abiertas', async () => {
    const r = await post('/mesas/mesa-marketing/archivar', ADMIN, { archivar: true });
    expect(r.status).toBe(409);
    expect(r.cuerpo.tareas.length).toBeGreaterThan(0);
    expect((await post('/mesas/mesa-legal/archivar', ADMIN, { archivar: true })).status).toBe(200);
  });

  it('una marca nueva nace con sus 21 mínimos', async () => {
    const r = await post('/marcas', ADMIN, { nombre: 'Delta Tours', color: '#123456' });
    expect(await fila('SELECT count(*) AS n FROM brand_minimums WHERE brand_id = ?1', r.cuerpo.id)).toEqual({ n: 21 });
  });

  it('coordinación actualiza el diagnóstico solo de sus marcas', async () => {
    const cambio = { minimos: [{ idx: 3, estado: 'Vigente', nota: 'Manual 2026' }] };
    expect((await llamar('/marcas/demo-cumbre/minimos', { como: CARLA, metodo: 'PUT', cuerpo: cambio })).status).toBe(404);
    expect((await llamar('/marcas/demo-aurora/minimos', { como: CARLA, metodo: 'PUT', cuerpo: cambio })).status).toBe(200);
    expect(await fila("SELECT state, note, updated_by FROM brand_minimums WHERE brand_id = 'demo-aurora' AND idx = 3"))
      .toEqual({ state: 'Vigente', note: 'Manual 2026', updated_by: 'demo-carla' });
    expect((await llamar('/marcas/demo-aurora/minimos', { como: DIEGO, metodo: 'PUT', cuerpo: cambio })).status).toBe(403);
  });
});
