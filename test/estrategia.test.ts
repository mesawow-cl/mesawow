import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const ADMIN = 'ana@mesawow.test', DIEGO = 'diego@mesawow.test';
const post = (ruta: string, cuerpo: unknown, como = ADMIN) => llamar(ruta, { como, metodo: 'POST', cuerpo });

describe('inicio', () => {
  beforeEach(cargarSemilla);
  it('trae mis números y la actividad del equipo, ocultando lo que no puedo ver', async () => {
    await post('/tareas/demo-t1/reabrir', { motivo: 'Cambió la oferta' }, 'carla@mesawow.test');
    await post('/tareas/demo-t3/empezar', {}, DIEGO);
    const r = await llamar('/inicio', { como: DIEGO });
    expect(r.cuerpo.stats).toMatchObject({ misTareas: 2, enProgreso: 2 });
    expect(r.cuerpo.actividad[0]).toMatchObject({ persona: 'Diego Ensayo', verbo: 'empezó', objeto: 'Publicaciones de la semana' });
  });
});

describe('mesa estratégica y vista de mandantes', () => {
  beforeEach(cargarSemilla);

  it('el plan es trimestral; publicar exige métrica e iniciativa y expone solo lo aprobado', async () => {
    expect((await post('/planes', { nombre: 'Plan', marcaId: 'demo-aurora', inicio: '2030-01-01' }, 'bruno@mesawow.test')).status).toBe(403);
    const { cuerpo: { id } } = await post('/planes', { nombre: 'Primer trimestre', marcaId: 'demo-aurora', inicio: '2030-01-01', objetivo: 'Crecer' });
    expect(await env.DB.prepare('SELECT end_date FROM strategic_plans WHERE id = ?1').bind(id).first()).toEqual({ end_date: '2030-03-31' });
    expect((await post(`/planes/${id}/publicar`, {})).cuerpo.error.code).toBe('incompleto');
    expect((await post(`/planes/${id}/metricas`, { tipo: 'KPI', nombre: 'Leads', actual: '30', direccion: 'Subir' })).cuerpo.error.message).toMatch(/fuente/);
    await post(`/planes/${id}/metricas`, { tipo: 'KPI', nombre: 'Leads', meta: '100', actual: '30', fuente: 'GA4', direccion: 'Subir' });
    expect((await post(`/planes/${id}/iniciativas`, { nombre: 'Webinar', tipo: 'Webinar', inicio: '2030-05-01', fin: '2030-05-02' })).status).toBe(400);
    await post(`/planes/${id}/iniciativas`, { nombre: 'Webinar', tipo: 'Webinar', inicio: '2030-02-01', fin: '2030-02-02', evidencia: 'https://x.test' });
    expect((await post(`/planes/${id}/publicar`, {})).status).toBe(200);
    const pub = await llamar('/publico/mesa');
    expect(pub.status).toBe(200);
    expect(pub.cuerpo.planes[0]).toMatchObject({ nombre: 'Primer trimestre', marca: 'Aurora Café', metricas: [{ name: 'Leads', current: '30' }] });
    expect(JSON.stringify(pub.cuerpo)).not.toMatch(/demo-|@mesawow/);
  });
});
