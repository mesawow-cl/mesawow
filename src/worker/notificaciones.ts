// Mis avisos, preferencias, push, Correo y WhatsApp, Plataformas y webhook de Brevo (Fase 6).
import { Hono } from 'hono';
import { z } from 'zod';
import { PLATAFORMAS } from '../shared/constantes';
import { correoConfigurado, pushConfigurado, whatsappConfigurado } from './canales';
import { despachar, registrarEventoBrevo, tituloDe } from './despacho';
import { ErrorApi } from './errores';
import { exigir, type Entorno } from './identidad';
import { auditoria, cuerpo, nuevoId } from './util';

type Fila = Record<string, any>;
export const notificaciones = new Hono<Entorno>();

notificaciones.get('/avisos', async (c) => {
  const p = c.get('actor');
  const todos = p.permisos.esAdmin && c.req.query('todos') === '1';
  const { results } = await c.env.DB.prepare(`
    SELECT o.id, o.event_id, o.event, o.created_at, o.task_id, o.payload, t.title, pe.name AS persona,
           (SELECT json_group_array(json_object('canal', x.channel, 'estado', x.status, 'error', x.error))
              FROM outbox x WHERE x.channel <> 'app' AND x.person_id = o.person_id AND x.dedupe_key LIKE '%' || o.id || '%') AS canales
      FROM outbox o LEFT JOIN tasks t ON t.id = o.task_id LEFT JOIN people pe ON pe.id = o.person_id
     WHERE o.channel = 'app' AND (?1 = 1 OR o.person_id = ?2) ORDER BY o.created_at DESC LIMIT 100`).bind(todos ? 1 : 0, p.id).all<Fila>();
  return c.json({ avisos: results.map((a) => ({ ...a, titulo: tituloDe(a.event, { cantidad: 1 }), canales: JSON.parse(a.canales), payload: undefined })) });
});

/** El service worker pide el último aviso para mostrarlo en la notificación push. */
notificaciones.get('/avisos/ultimo', async (c) => {
  const a = await c.env.DB.prepare(`SELECT o.event, o.task_id, t.title FROM outbox o LEFT JOIN tasks t ON t.id = o.task_id
      WHERE o.person_id = ?1 AND o.channel = 'app' ORDER BY o.created_at DESC LIMIT 1`).bind(c.get('actor').id).first<Fila>();
  if (!a) return c.json({ titulo: 'mesawow', cuerpo: 'Tienes avisos nuevos.', url: '/' });
  return c.json({ titulo: tituloDe(a.event, { cantidad: 1 }), cuerpo: a.title ?? 'Abre mesawow para verlo.', url: a.task_id ? `/encargos?tarea=${a.task_id}` : '/' });
});

const esquemaPreferencias = z.object({
  menciones: z.boolean(), resumen: z.enum(['Diario', 'Semanal', 'Sin resumen externo']), correo: z.boolean(), whatsapp: z.boolean(), push: z.boolean(),
});

notificaciones.get('/me/preferencias', async (c) => {
  const id = c.get('actor').id;
  const p = await c.env.DB.prepare('SELECT * FROM preferences WHERE person_id = ?1').bind(id).first<Fila>();
  const tel = await c.env.DB.prepare('SELECT phone FROM people WHERE id = ?1').bind(id).first<{ phone: string | null }>();
  const subs = await c.env.DB.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE person_id = ?1').bind(id).first<{ n: number }>();
  return c.json({
    menciones: !!(p?.mentions ?? 1), resumen: p?.summary ?? 'Semanal', correo: !!(p?.email ?? 0), whatsapp: !!(p?.whatsapp ?? 1), push: !!(p?.push ?? 1),
    telefono: tel?.phone ?? null, dispositivos: subs?.n ?? 0, pushDisponible: pushConfigurado(c.env), clavePush: c.env.VAPID_PUBLICA || null,
  });
});

notificaciones.put('/me/preferencias', async (c) => {
  const d = await cuerpo(c, esquemaPreferencias);
  await c.env.DB.prepare(`INSERT INTO preferences (person_id, mentions, summary, email, whatsapp, push) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(person_id) DO UPDATE SET mentions = excluded.mentions, summary = excluded.summary, email = excluded.email, whatsapp = excluded.whatsapp, push = excluded.push`)
    .bind(c.get('actor').id, d.menciones ? 1 : 0, d.resumen, d.correo ? 1 : 0, d.whatsapp ? 1 : 0, d.push ? 1 : 0).run();
  return c.json({ ok: true });
});

notificaciones.post('/me/push', async (c) => {
  const d = await cuerpo(c, z.object({ endpoint: z.string().url().startsWith('https://'), keys: z.object({ p256dh: z.string(), auth: z.string() }) }));
  await c.env.DB.prepare(`INSERT INTO push_subscriptions (id, person_id, endpoint, keys_json) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(endpoint) DO UPDATE SET person_id = excluded.person_id, keys_json = excluded.keys_json`).bind(nuevoId(), c.get('actor').id, d.endpoint, JSON.stringify(d.keys)).run();
  return c.json({ ok: true }, 201);
});

notificaciones.delete('/me/push', async (c) => {
  const { endpoint } = await cuerpo(c, z.object({ endpoint: z.string() }));
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1 AND person_id = ?2').bind(endpoint, c.get('actor').id).run();
  return c.json({ ok: true });
});

// ─────────────────────────────── Correo y WhatsApp (coordinación)

notificaciones.get('/canales', async (c) => {
  exigir(c, 'coordina', 'Los canales los revisa coordinación.');
  const { results } = await c.env.DB.prepare(`SELECT channel, status, count(*) AS n FROM outbox WHERE channel <> 'app' AND created_at >= ?1 GROUP BY channel, status`)
    .bind(new Date(Date.now() - 30 * 86_400_000).toISOString()).all();
  const { results: ultimos } = await c.env.DB.prepare(`SELECT o.channel, o.event, o.status, o.error, o.created_at, p.name AS persona FROM outbox o LEFT JOIN people p ON p.id = o.person_id
      WHERE o.channel <> 'app' ORDER BY o.created_at DESC LIMIT 20`).all();
  const tarjetas = (await c.env.DB.prepare('SELECT * FROM channel_cards').all()).results;
  return c.json({
    correo: { configurado: correoConfigurado(c.env), remitente: c.env.BREVO_REMITENTE || null },
    whatsapp: { configurado: whatsappConfigurado(c.env), remitente: c.env.WHATSAPP_REMITENTE || null },
    push: { configurado: pushConfigurado(c.env) },
    ultimos30: results, ultimos, tarjetas,
  });
});

notificaciones.post('/canales/prueba', async (c) => {
  exigir(c, 'esAdmin', 'La prueba de envío la hace la administración general.');
  const { canal } = await cuerpo(c, z.object({ canal: z.enum(['email', 'whatsapp', 'push']) }));
  const a = c.get('actor');
  await c.env.DB.prepare(`INSERT INTO outbox (id, dedupe_key, person_id, channel, event, payload) VALUES (?1, ?2, ?3, ?4, 'Prueba de envío', ?5)`)
    .bind(nuevoId(), `prueba:${nuevoId()}`, a.id, canal, JSON.stringify({ mensaje: 'Si recibiste esto, el canal funciona.', cantidad: 1 })).run();
  await despachar(c.env);
  return c.json({ ok: true });
});

notificaciones.put('/canales/:canal', async (c) => {
  exigir(c, 'esAdmin', 'Las fichas las edita la administración general.');
  const canal = c.req.param('canal');
  if (!['Correo', 'WhatsApp'].includes(canal)) throw new ErrorApi(404, 'no_encontrado', 'Ese canal no existe.');
  const d = await cuerpo(c, z.object({ proveedor: z.string().max(100), cuenta: z.string().max(200), responsableId: z.string().nullable(), plantilla: z.string().max(200) }));
  await c.env.DB.prepare(`INSERT INTO channel_cards (channel, provider, account, owner_id, template) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(channel) DO UPDATE SET provider = excluded.provider, account = excluded.account, owner_id = excluded.owner_id, template = excluded.template`)
    .bind(canal, d.proveedor, d.cuenta, d.responsableId, d.plantilla).run();
  return c.json({ ok: true });
});

// ─────────────────────────────── Plataformas (fichas sin claves)

notificaciones.get('/plataformas', async (c) => {
  exigir(c, 'coordina', 'Las plataformas las revisa coordinación.');
  const { results } = await c.env.DB.prepare('SELECT f.*, p.name AS responsable FROM platform_cards f LEFT JOIN people p ON p.id = f.owner_id ORDER BY f.name').all();
  return c.json({ plataformas: results, nombres: PLATAFORMAS });
});

notificaciones.put('/plataformas/:nombre', async (c) => {
  exigir(c, 'coordina', 'Las plataformas las edita coordinación.');
  const d = await cuerpo(c, z.object({
    cuenta: z.string().trim().max(200), url: z.union([z.literal(''), z.string().regex(/^https:\/\/\S+$/, 'La URL debe empezar con https://.')]), responsableId: z.string().nullable(),
  }));
  if (/clave|password|token|secret/i.test(d.cuenta)) throw new ErrorApi(400, 'datos_invalidos', 'No escribas claves ni tokens en las fichas.');
  const nombre = c.req.param('nombre');
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO platform_cards (name, account, url, owner_id) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(name) DO UPDATE SET account = excluded.account, url = excluded.url, owner_id = excluded.owner_id`).bind(nombre, d.cuenta, d.url, d.responsableId),
    auditoria(c.env.DB, c.get('actor').id, `Ficha de plataforma actualizada ${nombre}`, 'platform', nombre),
  ]);
  return c.json({ ok: true });
});

// ─────────────────────────────── Webhook de Brevo (sin sesión, con clave en la URL)

export const webhookBrevo = new Hono<Entorno>();
webhookBrevo.post('/webhooks/brevo', async (c) => {
  const clave = (c.env as Env & { BREVO_WEBHOOK_CLAVE?: string }).BREVO_WEBHOOK_CLAVE;
  if (!clave || c.req.query('clave') !== clave) return c.text('No autorizado', 401);
  const cuerpoJson = await c.req.json().catch(() => null);
  const eventos = Array.isArray(cuerpoJson) ? cuerpoJson : cuerpoJson ? [cuerpoJson] : [];
  for (const ev of eventos.slice(0, 100)) await registrarEventoBrevo(c.env.DB, ev as Fila);
  return c.json({ ok: true });
});
