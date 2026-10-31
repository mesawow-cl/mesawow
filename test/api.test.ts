import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { llamar as llamarApi } from './cliente';
import { cargarSemilla } from './utilidades';

const llamar = (ruta: string, como?: string, entorno?: Env) => llamarApi(ruta, { como, entorno });

describe('API /api/v1', () => {
  beforeEach(cargarSemilla);

  it('salud responde sin sesión', async () => {
    const r = await llamar('/salud');
    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual({ ok: true, entorno: 'local' });
  });

  it('sin sesión pide elegir persona en local', async () => {
    const r = await llamar('/me');
    expect(r.status).toBe(401);
    expect(r.cuerpo.error.code).toBe('sin_sesion');
  });

  it('/me entrega persona, marcas y permisos calculados en el servidor', async () => {
    const r = await llamar('/me', 'carla@mesawow.test');
    expect(r.status).toBe(200);
    expect(r.cuerpo.persona).toMatchObject({
      id: 'demo-carla', role: 'Responsable de marca o área', mesa: 'Comercial y Ventas',
      marcas: ['demo-aurora', 'demo-boreal'],
      permisos: { esAdmin: false, coordina: true, coordinaODirige: true, esEquipo: true, soloLectura: false },
    });
  });

  it('el administrador recibe todas las marcas activas', async () => {
    const r = await llamar('/me', 'ana@mesawow.test');
    expect(r.cuerpo.persona.marcas).toHaveLength(3);
    expect(r.cuerpo.persona.permisos.esAdmin).toBe(true);
  });

  it('una persona inactiva no entra', async () => {
    await env.DB.prepare("UPDATE people SET active = 0 WHERE id = 'demo-elena'").run();
    const r = await llamar('/me', 'elena@mesawow.test');
    expect(r.status).toBe(403);
    expect(r.cuerpo.error.code).toBe('sin_acceso');
  });

  it('un correo desconocido no entra', async () => {
    const r = await llamar('/me', 'intruso@otro.test');
    expect(r.status).toBe(403);
  });

  it('el directorio del equipo no está disponible para roles externos', async () => {
    expect((await llamar('/personas', 'ines@mesawow.test')).status).toBe(403);
    const r = await llamar('/personas', 'diego@mesawow.test');
    expect(r.status).toBe(200);
    expect(r.cuerpo.personas.length).toBe(9);
  });

  it('/marcas devuelve solo las marcas asignadas', async () => {
    const r = await llamar('/marcas', 'elena@mesawow.test');
    expect(r.cuerpo.marcas.map((m: { id: string }) => m.id)).toEqual(['demo-aurora', 'demo-cumbre']);
  });

  describe('fuera de local (staging y production)', () => {
    const produccion = { ...env, ENTORNO: 'production' } as Env;

    it('sin Access configurado no deja entrar a nadie, ni con la identidad de desarrollo', async () => {
      const r = await llamar('/me', 'ana@mesawow.test', produccion);
      expect(r.status).toBe(503);
      expect(r.cuerpo.error.code).toBe('acceso_sin_configurar');
    });

    it('el selector "Entrar como" no existe', async () => {
      expect((await llamar('/dev/personas', undefined, produccion)).status).toBe(404);
    });
  });
});
