import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const COORD = 'bruno@mesawow.test', DIEGO = 'diego@mesawow.test';
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const conectar = async (correo: string) => {
  const ctx = createExecutionContext();
  const r = await worker.fetch(new Request(`https://app.mesawow.test/api/v1/vivo?como=${correo}`, { headers: { upgrade: 'websocket' } }), env, ctx);
  await waitOnExecutionContext(ctx);
  expect(r.status).toBe(101);
  const ws = r.webSocket!;
  const mensajes: any[] = [];
  ws.accept();
  ws.addEventListener('message', (e) => mensajes.push(JSON.parse(e.data as string)));
  return { ws, mensajes };
};

const nueva = (cambios: Record<string, unknown> = {}) => llamar('/tareas', { como: COORD, metodo: 'POST', cuerpo: {
  titulo: 'Banner', marcaId: 'demo-aurora', descripcion: 'Banner', entregable: 'PNG', criterio: 'Ok', responsableId: 'demo-diego', revisorId: 'demo-fabian',
  inicio: '2030-01-07', plazo: '2030-01-11', ...cambios,
} });

describe('en vivo', () => {
  beforeEach(cargarSemilla);

  it('sin sesión no se conecta', async () => {
    const r = await llamar('/vivo', { cabeceras: { upgrade: 'websocket' } });
    expect(r.status).toBe(401);
  });

  it('cada cambio exitoso envía una señal (sin datos) a las pantallas abiertas', async () => {
    const { ws, mensajes } = await conectar(DIEGO);
    await nueva();
    await esperar(100);
    expect(mensajes.at(-1)).toMatchObject({ tipo: 'cambio', origen: 'tareas' });
    expect(Object.keys(mensajes.at(-1)).sort()).toEqual(['en', 'origen', 'tipo']);
    // Un intento rechazado no avisa.
    const antes = mensajes.length;
    await llamar('/tareas', { como: DIEGO, metodo: 'POST', cuerpo: {} });
    await esperar(100);
    expect(mensajes.length).toBe(antes);
    ws.close();
  });
});

describe('campana de alertas', () => {
  beforeEach(cargarSemilla);

  it('avisa la tarea nueva y la entrega por revisar; leída deja de contar y vuelve si cambia la condición', async () => {
    const { cuerpo } = await nueva();
    const d = await llamar('/alertas', { como: DIEGO });
    expect(d.cuerpo.alertas.map((a: any) => a.titulo)).toContain('Te asignaron una tarea');
    await llamar(`/tareas/${cuerpo.id}/entregar`, { como: DIEGO, metodo: 'POST', cuerpo: { resultado: 'Listo' } });
    const f = await llamar('/alertas', { como: 'fabian@mesawow.test' });
    const rev = f.cuerpo.alertas.find((a: any) => a.titulo === 'Tienes una entrega para revisar');
    expect(rev).toBeTruthy();
    await llamar('/alertas/leer', { como: 'fabian@mesawow.test', metodo: 'POST', cuerpo: { claves: [rev.clave] } });
    expect((await llamar('/alertas', { como: 'fabian@mesawow.test' })).cuerpo.sinLeer).toBe(f.cuerpo.sinLeer - 1);
    // Ajustes y nueva entrega: es otra versión, vuelve a aparecer sin leer.
    await llamar(`/tareas/${cuerpo.id}/pedir-ajustes`, { como: 'fabian@mesawow.test', metodo: 'POST', cuerpo: { motivo: 'Cambiar color' } });
    await llamar(`/tareas/${cuerpo.id}/entregar`, { como: DIEGO, metodo: 'POST', cuerpo: { resultado: 'Corregido' } });
    const otra = (await llamar('/alertas', { como: 'fabian@mesawow.test' })).cuerpo.alertas.find((a: any) => a.titulo === 'Tienes una entrega para revisar');
    expect(otra.leida).toBe(false);
  });

  it('las tareas atrasadas y bloqueadas avisan a quien corresponde', async () => {
    await env.DB.prepare("UPDATE tasks SET due = '2020-01-01', start_date = '2020-01-01' WHERE id = 'demo-t3'").run();
    await llamar('/tareas/demo-t2/bloquear', { como: DIEGO, metodo: 'POST', cuerpo: { motivo: 'Falta el logo' } });
    const titulos = (await llamar('/alertas', { como: DIEGO })).cuerpo.alertas.map((a: any) => a.titulo);
    expect(titulos).toEqual(expect.arrayContaining(['Tarea atrasada', 'Tu tarea está bloqueada']));
    // Dirección ve los bloqueos de sus marcas aunque no participe.
    expect((await llamar('/alertas', { como: 'gloria@mesawow.test' })).cuerpo.alertas.map((a: any) => a.titulo)).toContain('Tarea bloqueada');
    expect((await llamar('/alertas', { como: 'elena@mesawow.test' })).cuerpo.alertas.map((a: any) => a.titulo)).not.toContain('Tarea bloqueada');
  });
});
