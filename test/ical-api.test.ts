import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { cifrar } from '../src/worker/google';
import { sincronizarIcal } from '../src/worker/ical';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const CLAVE = btoa(String.fromCharCode(...new Uint8Array(32).fill(9))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const entorno = { ...env, CLAVE_CIFRADO: CLAVE } as Env;
const ICS = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:r1', 'SUMMARY:Cliente', 'DTSTART;TZID=America/Santiago:20300107T100000', 'DTEND;TZID=America/Santiago:20300107T120000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b@mesawow.cl', 'SUMMARY:🛠 Bloque', 'DTSTART;TZID=America/Santiago:20300108T090000', 'DTEND;TZID=America/Santiago:20300108T100000', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

describe('Google Calendar por iCal', () => {
  beforeEach(cargarSemilla);

  it('las reuniones del iCal corren las tareas; los bloques propios no vuelven como reuniones', async () => {
    const t = await llamar('/tareas', { como: 'bruno@mesawow.test', metodo: 'POST', cuerpo: {
      titulo: 'Landing', marcaId: 'demo-aurora', descripcion: 'Landing', entregable: 'URL', criterio: 'Ok', responsableId: 'demo-diego', inicio: '2030-01-07', plazo: '2030-01-11', horas: 8,
    } });
    await env.DB.prepare("INSERT INTO calendar_links (person_id, ical_cifrado) VALUES ('demo-diego', ?1)").bind(await cifrar('https://calendar.google.com/x/basic.ics', CLAVE)).run();
    const fuente: typeof fetch = async () => new Response(ICS);
    const r = await sincronizarIcal(env.DB, entorno, 'demo-diego', fuente, new Date('2030-01-06T12:00:00Z'));
    expect(r).toMatchObject({ cambios: 1, reuniones: 1 });
    expect((await env.DB.prepare('SELECT starts_at FROM work_blocks WHERE task_id = ?1 ORDER BY starts_at LIMIT 2').bind(t.cuerpo.id).all()).results)
      .toEqual([{ starts_at: '2030-01-07T09:00' }, { starts_at: '2030-01-07T12:00' }]);
    expect((await sincronizarIcal(env.DB, entorno, 'demo-diego', fuente, new Date('2030-01-06T12:05:00Z'))).cambios).toBe(0);
    // Si la reunión desaparece de Google, se quita de mesawow.
    expect((await sincronizarIcal(env.DB, entorno, 'demo-diego', async () => new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR'), new Date('2030-01-06T12:10:00Z'))).cambios).toBe(1);
  });

  it('un calendario que no responde deja el aviso para revisarlo', async () => {
    await env.DB.prepare("INSERT INTO calendar_links (person_id, ical_cifrado) VALUES ('demo-diego', ?1)").bind(await cifrar('https://x.test/a.ics', CLAVE)).run();
    const r = await sincronizarIcal(env.DB, entorno, 'demo-diego', async () => new Response('', { status: 404 }));
    expect(r.error).toMatch(/dirección secreta/);
  });

  it('el enlace privado entrega los bloques de trabajo sin sesión, y uno inválido no entrega nada', async () => {
    await llamar('/tareas', { como: 'bruno@mesawow.test', metodo: 'POST', cuerpo: {
      titulo: 'Informe', marcaId: 'demo-aurora', descripcion: 'Informe', entregable: 'PDF', criterio: 'Ok', responsableId: 'demo-diego',
      inicio: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), plazo: new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10), horas: 2,
    } });
    const { cuerpo } = await llamar('/ical/enlace', { como: 'diego@mesawow.test', metodo: 'POST' });
    const ruta = new URL(cuerpo.url).pathname.replace('/api/v1', '');
    const r = await llamar(ruta);
    expect(r.cabeceras.get('content-type')).toMatch(/text\/calendar/);
    expect(new TextDecoder().decode(r.cuerpo)).toContain('SUMMARY:🛠 Informe');
    expect((await llamar('/ical/feed/inventado.ics')).status).toBe(404);
    // Renovar el enlace invalida el anterior.
    await llamar('/ical/enlace', { como: 'diego@mesawow.test', metodo: 'POST' });
    expect((await llamar(ruta)).status).toBe(404);
  });
});
