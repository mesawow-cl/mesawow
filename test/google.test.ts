import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { cifrar, descifrar, firmarEstado, sincronizarPersona, verificarEstado } from '../src/worker/google';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const CLAVE = btoa(String.fromCharCode(...new Uint8Array(32).fill(7))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cfg = { clienteId: 'id.apps.googleusercontent.com', secreto: 's', clave: CLAVE, redireccion: 'http://localhost/api/v1/google/callback' };

describe('seguridad de la conexión con Google', () => {
  it('el token se guarda cifrado y se recupera', async () => {
    const c = await cifrar('refresh-123', CLAVE);
    expect(c).not.toContain('refresh-123');
    expect(await descifrar(c, CLAVE)).toBe('refresh-123');
  });
  it('el regreso desde Google solo acepta un state firmado y vigente', async () => {
    const e = await firmarEstado('demo-diego', CLAVE);
    expect(await verificarEstado(e, CLAVE)).toBe('demo-diego');
    expect(await verificarEstado(`${e.split('.')[0]}x.${e.split('.')[1]}`, CLAVE)).toBeNull();
    expect(await verificarEstado(await firmarEstado('demo-diego', CLAVE, Date.now() - 1), CLAVE)).toBeNull();
  });
});

describe('sincronización con Google Calendar', () => {
  beforeEach(cargarSemilla);

  it('trae las reuniones, recalcula la agenda y escribe los bloques en Google', async () => {
    const t = await llamar('/tareas', { como: 'bruno@mesawow.test', metodo: 'POST', cuerpo: {
      titulo: 'Landing', marcaId: 'demo-aurora', descripcion: 'Landing', entregable: 'URL', criterio: 'Ok', responsableId: 'demo-diego', inicio: '2030-01-07', plazo: '2030-01-11', horas: 8,
    } });
    await env.DB.prepare("INSERT INTO calendar_links (person_id, token_ref) VALUES ('demo-diego', ?1)").bind(await cifrar('refresh', CLAVE)).run();
    const llamadas: string[] = [];
    const google: typeof fetch = async (url, init) => {
      const u = String(url);
      llamadas.push(`${init?.method ?? 'GET'} ${u.split('?')[0]}`);
      if (u.includes('oauth2')) return Response.json({ access_token: 'a' });
      if (init?.method) return new Response(null, { status: 200 });
      return Response.json({ items: [
        { id: 'g1', summary: 'Cliente', start: { dateTime: '2030-01-07T10:00:00-03:00' }, end: { dateTime: '2030-01-07T12:00:00-03:00' } },
        { id: 'g2', summary: 'Feriado propio', start: { date: '2030-01-08' }, end: { date: '2030-01-09' } },
        { id: 'g3', summary: 'Libre', transparency: 'transparent', start: { dateTime: '2030-01-07T15:00:00-03:00' }, end: { dateTime: '2030-01-07T16:00:00-03:00' } },
        { id: 'viejo', summary: '🛠 Viejo', extendedProperties: { private: { mesawow: '1', bloque: 'x|y|z' } }, start: { dateTime: '2030-01-06T09:00:00-03:00' }, end: { dateTime: '2030-01-06T10:00:00-03:00' } },
      ] });
    };
    const r = await sincronizarPersona(env.DB, cfg, 'demo-diego', google, new Date('2030-01-06T12:00:00Z'));
    expect(r.cambios).toBe(1);
    expect(await env.DB.prepare("SELECT title, starts_at, ends_at FROM meetings WHERE source = 'google'").all().then((x) => x.results))
      .toEqual([{ title: 'Cliente', starts_at: '2030-01-07T10:00', ends_at: '2030-01-07T12:00' }]);
    const bloques = (await env.DB.prepare('SELECT starts_at, ends_at FROM work_blocks WHERE task_id = ?1 ORDER BY starts_at').bind(t.cuerpo.id).all()).results;
    expect(bloques[0]).toEqual({ starts_at: '2030-01-07T09:00', ends_at: '2030-01-07T10:00' });
    expect(llamadas).toContain('DELETE https://www.googleapis.com/calendar/v3/calendars/primary/events/viejo');
    expect(llamadas.filter((l) => l.startsWith('POST https://www.googleapis.com/calendar')).length).toBe(bloques.length);
    // Una segunda pasada sin cambios no toca nada en mesawow.
    expect((await sincronizarPersona(env.DB, cfg, 'demo-diego', google, new Date('2030-01-06T12:05:00Z'))).cambios).toBe(0);
  });

  it('si Google rechaza el permiso, pide volver a conectar', async () => {
    await env.DB.prepare("INSERT INTO calendar_links (person_id, token_ref) VALUES ('demo-diego', ?1)").bind(await cifrar('refresh', CLAVE)).run();
    const r = await sincronizarPersona(env.DB, cfg, 'demo-diego', async () => new Response('', { status: 400 }));
    expect(r.error).toMatch(/volver a conectar/);
    expect(await env.DB.prepare("SELECT status FROM calendar_links WHERE person_id = 'demo-diego'").first()).toEqual({ status: 'Reconectar Google Calendar' });
  });

  it('sin credenciales configuradas, conectar avisa que falta configurar', async () => {
    const r = await llamar('/google/conectar', { como: 'diego@mesawow.test', entorno: { ...env, GOOGLE_CLIENT_ID: '' } as Env });
    expect(r.cuerpo.error.code).toBe('google_sin_configurar');
  });
});
