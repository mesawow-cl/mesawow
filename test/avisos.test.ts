import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { despachar, enviarMensaje, enviarResumenes } from '../src/worker/despacho';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const COORD = 'bruno@mesawow.test', DIEGO = 'diego@mesawow.test';
const todos = (sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).all<any>().then((r) => r.results);
const fila = (sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).first<any>();
const sinCola = { ...env, AVISOS: undefined } as unknown as Env;
const conBrevo = { ...sinCola, BREVO_API_KEY: 'k', BREVO_REMITENTE: 'avisos@mesawow.test', BREVO_RESPONDER_A: 'contacto@mesawow.test', WHATSAPP_REMITENTE: '56900000000', WHATSAPP_PLANTILLA_ID: '7' } as unknown as Env;
const tarea = (cambios: Record<string, unknown> = {}) => llamar('/tareas', { como: COORD, metodo: 'POST', cuerpo: {
  titulo: 'Banner', marcaId: 'demo-aurora', descripcion: 'Banner', entregable: 'PNG', criterio: 'Ok', responsableId: 'demo-diego', revisorId: 'demo-fabian',
  inicio: '2030-01-07', plazo: '2030-01-11', ...cambios,
} }).then((r) => r.cuerpo.id as string);

describe('tarea lista para desarrollar (D2)', () => {
  beforeEach(cargarSemilla);

  it('avisa al crear una tarea sin pendientes y, al aprobar la previa, a la que dependía de ella', async () => {
    const a = await tarea();
    const b = await tarea({ titulo: 'Después', dependencias: [a] });
    const listas = () => todos("SELECT task_id FROM outbox WHERE event = 'Tarea lista para desarrollar' AND channel = 'app' ORDER BY created_at");
    expect(await listas()).toEqual([{ task_id: a }]);
    await llamar(`/tareas/${a}/entregar`, { como: DIEGO, metodo: 'POST', cuerpo: { resultado: 'Listo' } });
    await llamar(`/tareas/${a}/aprobar`, { como: 'fabian@mesawow.test', metodo: 'POST', cuerpo: {} });
    expect(await listas()).toEqual([{ task_id: a }, { task_id: b }]);
    // No se repite.
    await llamar(`/tareas/${b}`, { como: COORD, metodo: 'PATCH', cuerpo: { titulo: 'Después', marcaId: 'demo-aurora', descripcion: 'x', entregable: 'x', criterio: 'Ok', responsableId: 'demo-diego', inicio: '2030-01-07', plazo: '2030-01-11', dependencias: [a] } });
    expect(await listas()).toHaveLength(2);
  });

  it('varias tareas que quedan listas a la vez generan un solo WhatsApp para la persona', async () => {
    await env.DB.prepare("UPDATE people SET phone = '+56911112222' WHERE id = 'demo-diego'").run();
    const previa = await tarea({ responsableId: 'demo-elena', titulo: 'Previa' });
    await tarea({ titulo: 'Segunda pieza', dependencias: [previa] });
    await tarea({ titulo: 'Tercera pieza', dependencias: [previa] });
    await llamar(`/tareas/${previa}/entregar`, { como: 'elena@mesawow.test', metodo: 'POST', cuerpo: { resultado: 'Listo' } });
    await llamar(`/tareas/${previa}/aprobar`, { como: 'fabian@mesawow.test', metodo: 'POST', cuerpo: {} });
    await despachar(sinCola);
    const wa = await todos("SELECT payload FROM outbox WHERE channel = 'whatsapp' AND person_id = 'demo-diego'");
    expect(wa).toHaveLength(1);
    expect(JSON.parse(wa[0].payload).cantidad).toBe(2);
    // Con WhatsApp apagado no hay WhatsApp.
    await env.DB.prepare("UPDATE preferences SET whatsapp = 0 WHERE person_id = 'demo-diego'").run();
    await tarea({ titulo: 'Cuarta pieza' });
    await despachar(sinCola);
    expect(await todos("SELECT id FROM outbox WHERE channel = 'whatsapp' AND person_id = 'demo-diego'")).toHaveLength(1);
  });
});

describe('envío por canal', () => {
  beforeEach(cargarSemilla);
  const mensaje = async (canal: string, evento = 'Salida al aire en riesgo') => {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO outbox (id, dedupe_key, person_id, channel, event, payload) VALUES (?1, ?1, 'demo-diego', ?2, ?3, '{\"cantidad\":1}')").bind(id, canal, evento).run();
    return id;
  };

  it('correo por Brevo: guarda el messageId; error temporal reintenta; error permanente falla', async () => {
    const id = await mensaje('email');
    let cuerpo: any;
    const brevo: typeof fetch = async (_u, init) => { cuerpo = JSON.parse(String(init!.body)); return Response.json({ messageId: '<m1@brevo>' }); };
    expect(await enviarMensaje(conBrevo, id, brevo)).toBe('ok');
    expect(cuerpo).toMatchObject({ sender: { email: 'avisos@mesawow.test' }, replyTo: { email: 'contacto@mesawow.test' }, to: [{ email: 'diego@mesawow.test' }], subject: '[mesawow] Una salida al aire está en riesgo' });
    expect(cuerpo.htmlContent).toContain('mesa<span style="color:#F22E62">wow</span>');
    expect(await fila('SELECT status, provider_id FROM outbox WHERE id = ?1', id)).toEqual({ status: 'enviado', provider_id: '<m1@brevo>' });
    expect(await enviarMensaje(conBrevo, await mensaje('email'), async () => new Response('caído', { status: 503 }))).toBe('reintentar');
    expect(await enviarMensaje(conBrevo, await mensaje('email'), async () => new Response('mal', { status: 400 }))).toBe('fallido');
    const sin = await mensaje('email');
    expect(await enviarMensaje(sinCola, sin)).toBe('fallido');
    expect((await fila('SELECT error FROM outbox WHERE id = ?1', sin)).error).toMatch(/sin configurar/);
  });

  it('WhatsApp usa la plantilla aprobada con el número de la persona', async () => {
    await env.DB.prepare("UPDATE people SET phone = '+56911112222' WHERE id = 'demo-diego'").run();
    let cuerpo: any;
    expect(await enviarMensaje(conBrevo, await mensaje('whatsapp', 'Tarea lista para desarrollar'), async (_u, init) => { cuerpo = JSON.parse(String(init!.body)); return Response.json({ messageId: 'w1' }); })).toBe('ok');
    expect(cuerpo).toMatchObject({ senderNumber: '56900000000', contactNumbers: ['56911112222'], templateId: 7, params: { NOMBRE: 'Diego', CANTIDAD: '1' } });
  });

  it('push firma con VAPID y borra las suscripciones vencidas', async () => {
    const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const pub = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey) as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const d = (await crypto.subtle.exportKey('jwk', k.privateKey) as JsonWebKey).d;
    const conPush = { ...sinCola, VAPID_PUBLICA: pub, VAPID_PRIVADA: d } as unknown as Env;
    await env.DB.prepare("INSERT INTO push_subscriptions (id, person_id, endpoint, keys_json) VALUES ('s1','demo-diego','https://push.test/a','{}'), ('s2','demo-diego','https://push.test/b','{}')").run();
    const cabeceras: string[] = [];
    const servicio: typeof fetch = async (u, init) => { cabeceras.push(new Headers(init!.headers).get('authorization')!); return new Response(null, { status: String(u).endsWith('/b') ? 410 : 201 }); };
    expect(await enviarMensaje(conPush, await mensaje('push'), servicio)).toBe('ok');
    expect(cabeceras[0]).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${pub}$`));
    expect(await todos('SELECT id FROM push_subscriptions')).toEqual([{ id: 's1' }]);
  });
});

describe('resúmenes, invitaciones y webhook', () => {
  beforeEach(cargarSemilla);

  it('el resumen diario sale una sola vez por período y solo si hay avisos', async () => {
    await env.DB.prepare("UPDATE preferences SET summary = 'Diario' WHERE person_id = 'demo-diego'").run();
    await tarea();
    const ahora = new Date(Date.now() + 60_000);
    expect(await enviarResumenes(sinCola, ahora)).toBe(1);
    expect(await enviarResumenes(sinCola, ahora)).toBe(0);
    expect(JSON.parse((await fila("SELECT payload FROM outbox WHERE event = 'Resumen' AND person_id = 'demo-diego'")).payload).cantidad).toBeGreaterThan(0);
  });

  it('la invitación se envía por correo y luego no conserva el enlace con el token', async () => {
    await llamar('/invitaciones', { como: 'ana@mesawow.test', metodo: 'POST', cuerpo: { correo: 'nueva@mesawow.test', rol: 'Ejecutor', mesaId: null, marcas: ['demo-aurora'] } });
    const inv = await fila("SELECT id, payload FROM outbox WHERE event = 'Invitación a mesawow'");
    expect(JSON.parse(inv.payload).enlace).toMatch(/invitacion=/);
    let para = '';
    await enviarMensaje(conBrevo, inv.id, async (_u, init) => { para = JSON.parse(String(init!.body)).to[0].email; return Response.json({ messageId: 'i1' }); });
    expect(para).toBe('nueva@mesawow.test');
    expect(JSON.parse((await fila('SELECT payload FROM outbox WHERE id = ?1', inv.id)).payload)).toEqual({ para: 'nueva@mesawow.test' });
  });

  it('el webhook de Brevo registra la entrega y exige su clave', async () => {
    const entorno = { ...env, BREVO_WEBHOOK_CLAVE: 'secreta' } as unknown as Env;
    await env.DB.prepare("INSERT INTO outbox (id, dedupe_key, person_id, channel, event, status, provider_id) VALUES ('o1','o1','demo-diego','email','x','enviado','<m9@brevo>')").run();
    expect((await llamar('/webhooks/brevo?clave=otra', { metodo: 'POST', cuerpo: {}, entorno })).status).toBe(401);
    await llamar('/webhooks/brevo?clave=secreta', { metodo: 'POST', cuerpo: { event: 'delivered', 'message-id': '<m9@brevo>', email: 'diego@mesawow.test' }, entorno });
    expect(await fila("SELECT status FROM outbox WHERE id = 'o1'")).toEqual({ status: 'entregado' });
  });
});

describe('pantallas de avisos: permisos', () => {
  beforeEach(cargarSemilla);
  const ANA = 'ana@mesawow.test';

  it('cada persona ve solo sus avisos; la administración puede ver los de todo el equipo', async () => {
    await tarea();
    expect((await llamar('/avisos', { como: DIEGO })).cuerpo.avisos.length).toBeGreaterThan(0);
    expect((await llamar('/avisos', { como: 'elena@mesawow.test' })).cuerpo.avisos).toHaveLength(0);
    expect((await llamar('/avisos?todos=1', { como: 'elena@mesawow.test' })).cuerpo.avisos).toHaveLength(0);
    const todos = (await llamar('/avisos?todos=1', { como: ANA })).cuerpo.avisos;
    expect(new Set(todos.map((a: any) => a.persona)).size).toBeGreaterThan(1);
  });

  it('preferencias propias: guardar y leer; push solo con https', async () => {
    const r = await llamar('/me/preferencias', { como: DIEGO, metodo: 'PUT', cuerpo: { menciones: false, resumen: 'Diario', correo: false, whatsapp: false, push: true } });
    expect(r.status).toBe(200);
    expect((await llamar('/me/preferencias', { como: DIEGO })).cuerpo).toMatchObject({ menciones: false, resumen: 'Diario', whatsapp: false });
    expect((await llamar('/me/push', { como: DIEGO, metodo: 'POST', cuerpo: { endpoint: 'http://inseguro.test/x', keys: { p256dh: 'a', auth: 'b' } } })).status).toBe(400);
    expect((await llamar('/me/push', { como: DIEGO, metodo: 'POST', cuerpo: { endpoint: 'https://push.test/x', keys: { p256dh: 'a', auth: 'b' } } })).status).toBe(201);
    expect((await llamar('/me/preferencias', { como: DIEGO })).cuerpo.dispositivos).toBe(1);
  });

  it('Correo y WhatsApp: lo revisa coordinación; fichas y pruebas solo la administración general', async () => {
    expect((await llamar('/canales', { como: DIEGO })).status).toBe(403);
    expect((await llamar('/canales', { como: COORD })).status).toBe(200);
    const ficha = { proveedor: 'Brevo', cuenta: 'avisos@mesawow.test', responsableId: null, plantilla: 'tarea_lista' };
    expect((await llamar('/canales/Correo', { como: COORD, metodo: 'PUT', cuerpo: ficha })).status).toBe(403);
    expect((await llamar('/canales/Correo', { como: ANA, metodo: 'PUT', cuerpo: ficha })).status).toBe(200);
    expect((await llamar('/canales/prueba', { como: COORD, metodo: 'POST', cuerpo: { canal: 'email' } })).status).toBe(403);
  });

  it('Plataformas: coordinación edita las fichas y nunca acepta claves', async () => {
    expect((await llamar('/plataformas', { como: DIEGO })).status).toBe(403);
    const editar = (cuenta: string, url = '') => llamar('/plataformas/Meta%20Ads', { como: COORD, metodo: 'PUT', cuerpo: { cuenta, url, responsableId: null } });
    expect((await editar('Cuenta de Aurora')).status).toBe(200);
    expect((await editar('password: 1234')).status).toBe(400);
    expect((await editar('Cuenta', 'http://sin-https.test')).status).toBe(400);
  });
});

describe('seguridad de las pruebas', () => {
  it('las pruebas no cargan la clave real de Brevo', () => {
    expect((env as unknown as { BREVO_API_KEY?: string }).BREVO_API_KEY ?? '').toBe('');
  });
});
