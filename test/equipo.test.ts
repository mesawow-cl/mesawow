import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const ADMIN = 'ana@mesawow.test';
const COORD = 'bruno@mesawow.test';
const fila = <T>(sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).first<T>();

const datosDiego = (cambios: Record<string, unknown> = {}) => ({
  nombre: 'Diego Ensayo', telefono: '+56911112222', rol: 'Ejecutor', mesaId: 'mesa-marketing', activo: true, marcas: ['demo-aurora'], ...cambios,
});

describe('equipo y permisos', () => {
  beforeEach(cargarSemilla);

  it('solo la administración general ve y administra el equipo', async () => {
    expect((await llamar('/equipo', { como: COORD })).status).toBe(403);
    const r = await llamar('/equipo', { como: ADMIN });
    expect(r.status).toBe(200);
    expect(r.cuerpo.personas).toHaveLength(9);
    expect(r.cuerpo.personas.find((p: any) => p.id === 'demo-carla').marcas).toEqual(['demo-aurora', 'demo-boreal']);
  });

  it('edita rol, mesa, WhatsApp y marcas, y deja auditoría', async () => {
    const r = await llamar('/personas/demo-diego', { como: ADMIN, metodo: 'PATCH', cuerpo: datosDiego({ rol: 'Revisor o aprobador' }) });
    expect(r.status).toBe(200);
    expect(await fila('SELECT role, phone FROM people WHERE id = ?1', 'demo-diego')).toEqual({ role: 'Revisor o aprobador', phone: '+56911112222' });
    expect((await env.DB.prepare("SELECT brand_id FROM person_brands WHERE person_id = 'demo-diego'").all()).results).toEqual([{ brand_id: 'demo-aurora' }]);
    expect(await fila<{ n: number }>("SELECT count(*) AS n FROM audit_log WHERE entity_id = 'demo-diego'")).toEqual({ n: 1 });
  });

  it('valida WhatsApp, marcas y nombres repetidos', async () => {
    const e = async (cambios: Record<string, unknown>) => (await llamar('/personas/demo-diego', { como: ADMIN, metodo: 'PATCH', cuerpo: datosDiego(cambios) })).cuerpo.error.message;
    expect(await e({ telefono: '912345678' })).toMatch(/\+56912345678/);
    expect(await e({ marcas: [] })).toMatch(/al menos una marca/);
    expect(await e({ marcas: ['no-existe'] })).toMatch(/no existe/);
    expect(await e({ nombre: 'Bruno Ejemplo' })).toMatch(/otra persona con ese nombre/);
  });

  it('el administrador no puede desactivarse ni degradarse sin transferir antes', async () => {
    const r = await llamar('/personas/demo-ana', { como: ADMIN, metodo: 'PATCH', cuerpo: { ...datosDiego(), nombre: 'Ana Prueba', rol: 'Ejecutor' } });
    expect(r.status).toBe(409);
    expect(r.cuerpo.error.code).toBe('transferir_primero');
  });

  it('transfiere la administración general: la anterior pasa a Coordinación de Marketing', async () => {
    expect((await llamar('/personas/demo-bruno/transferir-admin', { como: ADMIN, metodo: 'POST' })).status).toBe(200);
    expect(await fila('SELECT role FROM people WHERE id = ?1', 'demo-bruno')).toEqual({ role: 'Administrador general' });
    expect(await fila('SELECT role FROM people WHERE id = ?1', 'demo-ana')).toEqual({ role: 'Coordinación de Marketing' });
    // Ya no es admin: no puede volver a transferir.
    expect((await llamar('/personas/demo-diego/transferir-admin', { como: ADMIN, metodo: 'POST' })).status).toBe(403);
  });

  it('la salida de un integrante lo desactiva, cancela sus avisos y bloquea sus tareas abiertas', async () => {
    await env.DB.prepare("INSERT INTO outbox (id, dedupe_key, person_id, channel, event) VALUES ('o1','k1','demo-diego','email','Nueva tarea asignada')").run();
    const r = await llamar('/personas/demo-diego/salida', { como: ADMIN, metodo: 'POST', cuerpo: { nota: 'Terminó su contrato' } });
    expect(r.status).toBe(200);
    expect(r.cuerpo.tareasBloqueadas).toBe(2); // demo-t2 y demo-t3 (abiertas); ninguna aprobada
    expect(await fila('SELECT active, departed FROM people WHERE id = ?1', 'demo-diego')).toEqual({ active: 0, departed: 1 });
    expect(await fila("SELECT status FROM outbox WHERE id = 'o1'")).toEqual({ status: 'cancelado' });
    expect(await fila("SELECT blocked, block_reason FROM tasks WHERE id = 'demo-t2'")).toEqual({ blocked: 1, block_reason: 'Revisar asignación por salida de Diego Ensayo.' });
    // Ya no puede entrar.
    expect((await llamar('/me', { como: 'diego@mesawow.test' })).status).toBe(403);
  });

  it('no se registra la salida del administrador sin transferir', async () => {
    const r = await llamar('/personas/demo-ana/salida', { como: ADMIN, metodo: 'POST', cuerpo: { nota: 'Se va' } });
    expect(r.status).toBe(409);
  });
});

describe('invitaciones', () => {
  beforeEach(cargarSemilla);
  const invitar = (cuerpo: Record<string, unknown> = {}) => llamar('/invitaciones', {
    como: ADMIN, metodo: 'POST', cuerpo: { correo: 'Nueva@Mesawow.test', rol: 'Ejecutor', mesaId: 'mesa-marketing', marcas: ['demo-aurora', 'demo-cumbre'], ...cuerpo },
  });

  it('solo la administración general invita', async () => {
    const r = await llamar('/invitaciones', { como: COORD, metodo: 'POST', cuerpo: { correo: 'x@y.test', rol: 'Ejecutor', mesaId: null, marcas: ['demo-aurora'] } });
    expect(r.status).toBe(403);
  });

  it('entrega el enlace una sola vez y guarda solo la huella del token', async () => {
    const r = await invitar();
    expect(r.status).toBe(201);
    const token = new URL(r.cuerpo.enlace).searchParams.get('invitacion')!;
    expect(r.cuerpo.enlace).toMatch(/^http:\/\/localhost:5173\/\?invitacion=/);
    const guardada = await fila<{ token_hash: string; email: string; status: string }>('SELECT token_hash, email, status FROM invitations WHERE id = ?1', r.cuerpo.id);
    expect(guardada!.email).toBe('nueva@mesawow.test');
    expect(guardada!.status).toBe('Pendiente');
    expect(guardada!.token_hash).not.toContain(token);
    expect(guardada!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no invita correos del equipo, repetidos ni con roles no invitables', async () => {
    expect((await invitar({ correo: 'diego@mesawow.test' })).cuerpo.error.code).toBe('ya_existe');
    await invitar();
    expect((await invitar()).cuerpo.error.code).toBe('invitacion_vigente');
    expect((await invitar({ correo: 'otra@mesawow.test', rol: 'Administrador general' })).status).toBe(400);
    expect((await invitar({ correo: 'otra@mesawow.test', marcas: [] })).cuerpo.error.message).toMatch(/al menos una marca/);
  });

  it('la persona invitada completa sus datos y entra con el rol, mesa y marcas de la invitación', async () => {
    const { cuerpo: inv } = await invitar();
    const token = new URL(inv.enlace).searchParams.get('invitacion')!;
    const nueva = 'nueva@mesawow.test';
    // Antes de aceptar, /me avisa que hay una invitación pendiente.
    expect((await llamar('/me', { como: nueva })).cuerpo.error.code).toBe('invitacion_pendiente');
    expect((await llamar('/invitaciones/mia', { como: nueva })).cuerpo.invitacion).toMatchObject({ role: 'Ejecutor', mesa: 'Marketing', marcas: 'Aurora Café, Cumbre Viajes' });
    expect((await llamar('/invitaciones/aceptar', { como: nueva, metodo: 'POST', cuerpo: { nombre: 'Nueva Persona', telefono: '123', token } })).status).toBe(400);
    const r = await llamar('/invitaciones/aceptar', { como: nueva, metodo: 'POST', cuerpo: { nombre: 'Nueva Persona', telefono: '+56933334444', token } });
    expect(r.status).toBe(201);
    const me = await llamar('/me', { como: nueva });
    expect(me.cuerpo.persona).toMatchObject({ name: 'Nueva Persona', role: 'Ejecutor', mesa: 'Marketing', marcas: ['demo-aurora', 'demo-cumbre'] });
    expect(await fila('SELECT status FROM invitations WHERE id = ?1', inv.id)).toEqual({ status: 'Aceptada' });
    // Un solo uso.
    expect((await llamar('/invitaciones/aceptar', { como: nueva, metodo: 'POST', cuerpo: { nombre: 'Otra', telefono: '+56933334444' } })).status).toBe(409);
  });

  it('un enlace de otra invitación no sirve', async () => {
    await invitar();
    const r = await llamar('/invitaciones/aceptar', { como: 'nueva@mesawow.test', metodo: 'POST', cuerpo: { nombre: 'Nueva Persona', telefono: '+56933334444', token: 'otro' } });
    expect(r.cuerpo.error.code).toBe('token_invalido');
  });

  it('las invitaciones vencen a los 7 días y se pueden revocar', async () => {
    const { cuerpo: a } = await invitar();
    await env.DB.prepare("UPDATE invitations SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?1").bind(a.id).run();
    expect((await llamar('/invitaciones/mia', { como: 'nueva@mesawow.test' })).status).toBe(404);
    expect(await fila('SELECT status FROM invitations WHERE id = ?1', a.id)).toEqual({ status: 'Vencida' });
    const { cuerpo: b } = await invitar();
    expect((await llamar(`/invitaciones/${b.id}/revocar`, { como: ADMIN, metodo: 'POST' })).status).toBe(200);
    expect((await llamar('/me', { como: 'nueva@mesawow.test' })).cuerpo.error.code).toBe('sin_acceso');
  });
});

describe('ver la app como y solo lectura', () => {
  beforeEach(cargarSemilla);

  it('el administrador ve la app como otra persona, solo para leer', async () => {
    const r = await llamar('/me', { como: ADMIN, cabeceras: { 'x-mesawow-ver-como': 'demo-elena' } });
    expect(r.cuerpo.persona.id).toBe('demo-elena');
    expect(r.cuerpo.actor.id).toBe('demo-ana');
    const cambio = await llamar('/me/perfil', { como: ADMIN, metodo: 'PUT', cuerpo: { bio: 'x' }, cabeceras: { 'x-mesawow-ver-como': 'demo-elena' } });
    expect(cambio.cuerpo.error.code).toBe('solo_lectura');
  });

  it('nadie más puede usar "Ver la app como"', async () => {
    const r = await llamar('/me', { como: COORD, cabeceras: { 'x-mesawow-ver-como': 'demo-elena' } });
    expect(r.status).toBe(403);
  });

  it('el rol Consulta no hace cambios, salvo su propio perfil', async () => {
    const hugo = 'hugo@mesawow.test';
    expect((await llamar('/me/perfil', { como: hugo, metodo: 'PUT', cuerpo: { bio: 'Hola' } })).status).toBe(200);
    const r = await llamar('/invitaciones', { como: hugo, metodo: 'POST', cuerpo: {} });
    expect(r.cuerpo.error.code).toBe('solo_lectura');
  });
});

describe('perfil y foto', () => {
  beforeEach(cargarSemilla);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it('guarda la presentación (máx. 300) y la muestra en el perfil', async () => {
    expect((await llamar('/me/perfil', { como: 'diego@mesawow.test', metodo: 'PUT', cuerpo: { bio: 'x'.repeat(301) } })).status).toBe(400);
    await llamar('/me/perfil', { como: 'diego@mesawow.test', metodo: 'PUT', cuerpo: { bio: 'Diseño y mailings' } });
    const r = await llamar('/personas/demo-diego/perfil', { como: 'elena@mesawow.test' });
    expect(r.cuerpo.perfil).toMatchObject({ bio: 'Diseño y mailings', propio: false, foto: null });
    // Elena no tiene Boreal: no la ve en el perfil de Diego.
    expect(r.cuerpo.perfil.marcas.map((m: any) => m.id)).toEqual(['demo-aurora', 'demo-cumbre']);
  });

  it('sube la foto a R2, la sirve al equipo y reemplaza la anterior', async () => {
    const subir = () => llamar('/me/foto', { como: 'diego@mesawow.test', metodo: 'PUT', cuerpo: PNG, cabeceras: { 'content-type': 'image/png' } });
    expect((await subir()).status).toBe(200);
    const primera = (await fila<{ photo_key: string }>("SELECT photo_key FROM people WHERE id = 'demo-diego'"))!.photo_key;
    await subir();
    expect(await env.ARCHIVOS.get(primera)).toBeNull();
    const foto = await llamar('/fotos/demo-diego', { como: 'elena@mesawow.test' });
    expect(foto.status).toBe(200);
    expect(foto.cabeceras.get('content-type')).toBe('image/png');
    expect(new Uint8Array(foto.cuerpo)).toEqual(PNG);
    expect((await llamar('/fotos/demo-diego', { como: 'ines@mesawow.test' })).status).toBe(403);
  });

  it('rechaza formatos no admitidos y fotos de más de 100 KB', async () => {
    const r1 = await llamar('/me/foto', { como: 'diego@mesawow.test', metodo: 'PUT', cuerpo: PNG, cabeceras: { 'content-type': 'image/gif' } });
    expect(r1.status).toBe(415);
    const grande = new Uint8Array(100 * 1024 + 1);
    const r2 = await llamar('/me/foto', { como: 'diego@mesawow.test', metodo: 'PUT', cuerpo: grande, cabeceras: { 'content-type': 'image/png' } });
    expect(r2.status).toBe(413);
  });
});
