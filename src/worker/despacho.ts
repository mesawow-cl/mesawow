// Despacho de avisos (Fase 6, A8 y D2).
// 1. Todo aviso nace en la app (outbox, canal 'app').
// 2. El despachador decide los canales extra según el evento y las preferencias, juntando lo que llega junto.
// 3. La cola (Queues) envía cada mensaje con reintentos y deja su estado real.
import { hoySantiago, utcASantiago } from '../shared/fechas';
import { enviarCorreo, enviarPush, enviarWhatsapp, ErrorCanal, plantillaCorreo } from './canales';
import { nuevoId } from './util';

type Fila = Record<string, any>;
export interface MensajeCola { id: string }

/** Eventos que además van al teléfono como push. */
const PUSH = new Set(['Nueva tarea asignada', 'Entrega para revisión', 'Ajustes solicitados', 'Tarea aprobada', 'Tarea reabierta', 'Bloqueo registrado',
  'Bloqueo registrado en sprint', 'Salida al aire en riesgo', 'Tarea lista para desarrollar', 'Término recalculado por agenda', 'Tu tarea entró sola a un sprint', 'Mención', 'Te felicitaron', 'Confirma una recepción entre áreas']);
/** Eventos que van por correo de inmediato (el resto llega en el resumen). */
const CORREO_INMEDIATO = new Set(['Salida al aire en riesgo']);
const LISTA = 'Tarea lista para desarrollar';

/**
 * D2: avisa a la persona responsable cuando una tarea queda lista para desarrollar
 * (pendiente, sin bloqueo y con sus dependencias terminadas). Una sola vez por ciclo de ejecución.
 */
export const avisarTareasListas = async (db: D1Database, ids: string[]) => {
  if (!ids.length) return;
  const { results } = await db.prepare(`
    SELECT t.id, t.owner_id, t.execution_cycle FROM tasks t JOIN people p ON p.id = t.owner_id AND p.active = 1
     WHERE t.id IN (SELECT value FROM json_each(?1)) AND t.status = 'Pendiente' AND t.blocked = 0
       AND NOT EXISTS (SELECT 1 FROM task_dependencies d JOIN tasks x ON x.id = d.depends_on_id WHERE d.task_id = t.id AND x.status NOT IN ('Aprobada','Completada'))`)
    .bind(JSON.stringify([...new Set(ids)])).all<Fila>();
  if (!results.length) return;
  await db.batch(results.map((t) => db.prepare(`INSERT INTO outbox (id, dedupe_key, event_id, person_id, channel, event, task_id, payload)
      VALUES (?1, ?2, ?3, ?4, 'app', ?5, ?6, '{}') ON CONFLICT(dedupe_key) DO NOTHING`)
    .bind(nuevoId(), `lista:${t.id}:${t.execution_cycle}:${t.owner_id}:app`, `lista:${t.id}`, t.owner_id, LISTA, t.id)));
};

/** Tareas que dependen de `id` (para revisar si quedaron listas cuando `id` termina). */
export const dependientes = async (db: D1Database, id: string) =>
  (await db.prepare('SELECT task_id FROM task_dependencies WHERE depends_on_id = ?1').bind(id).all<{ task_id: string }>()).results.map((r) => r.task_id);

/** Convierte los avisos nuevos de la app en mensajes por canal y los pone en la cola. Idempotente. */
export const despachar = async (env: Env) => {
  const db = env.DB;
  const { results: nuevos } = await db.prepare(`
    SELECT o.*, p.name, p.email, p.phone, p.active, coalesce(pr.push, 1) AS pref_push, coalesce(pr.whatsapp, 1) AS pref_whatsapp,
           (SELECT count(*) FROM push_subscriptions s WHERE s.person_id = o.person_id) AS suscripciones, t.title AS tarea
      FROM outbox o JOIN people p ON p.id = o.person_id LEFT JOIN preferences pr ON pr.person_id = o.person_id LEFT JOIN tasks t ON t.id = o.task_id
     WHERE o.channel = 'app' AND o.status = 'pendiente' ORDER BY o.created_at LIMIT 300`).all<Fila>();
  const sentencias: D1PreparedStatement[] = [];
  const crear = (clave: string, persona: string, canal: string, evento: string, tarea: string | null, datos: unknown, eventId: string | null) =>
    sentencias.push(db.prepare(`INSERT INTO outbox (id, dedupe_key, event_id, person_id, channel, event, task_id, payload) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(dedupe_key) DO NOTHING`).bind(nuevoId(), clave, eventId, persona, canal, evento, tarea, JSON.stringify(datos)));
  // Se agrupa por persona y evento: varias tareas listas a la vez = un solo WhatsApp y un solo push.
  const grupos = new Map<string, Fila[]>();
  for (const a of nuevos) {
    sentencias.push(db.prepare("UPDATE outbox SET status = 'enviado', sent_at = ?2 WHERE id = ?1").bind(a.id, new Date().toISOString()));
    if (!a.active) continue;
    const k = `${a.person_id}|${a.event}`;
    grupos.set(k, [...(grupos.get(k) ?? []), a]);
  }
  for (const [, avisos] of grupos) {
    const a = avisos[0]!;
    const datos = { cantidad: avisos.length, tareas: avisos.map((x) => ({ id: x.task_id, titulo: x.tarea })).slice(0, 10), ...JSON.parse(a.payload || '{}') };
    const base = `${avisos.map((x) => x.id).sort().join(',')}`;
    if (PUSH.has(a.event) && a.pref_push && a.suscripciones) crear(`push:${base}`, a.person_id, 'push', a.event, a.task_id, datos, a.event_id);
    if (a.event === LISTA && a.pref_whatsapp && a.phone) crear(`whatsapp:${base}`, a.person_id, 'whatsapp', a.event, a.task_id, datos, a.event_id);
    if (CORREO_INMEDIATO.has(a.event) && a.email && !/\.invalid$/.test(a.email)) crear(`email:${base}`, a.person_id, 'email', a.event, a.task_id, datos, a.event_id);
  }
  if (sentencias.length) await db.batch(sentencias);
  // Todo mensaje por canal que espera envío se pone en la cola (incluye invitaciones y resúmenes).
  const { results: porEnviar } = await db.prepare("SELECT id FROM outbox WHERE channel <> 'app' AND status = 'pendiente' LIMIT 500").all<{ id: string }>();
  if (porEnviar.length && env.AVISOS) {
    await env.AVISOS.sendBatch(porEnviar.map((r) => ({ body: { id: r.id } satisfies MensajeCola })));
    await db.prepare("UPDATE outbox SET status = 'encolado' WHERE id IN (SELECT value FROM json_each(?1)) AND status = 'pendiente'").bind(JSON.stringify(porEnviar.map((r) => r.id))).run();
  }
  return { procesados: nuevos.length, encolados: porEnviar.length };
};

// ─────────────────────────────── contenido de cada mensaje

const TITULOS: Record<string, (d: Fila) => string> = {
  [LISTA]: (d) => (d.cantidad > 1 ? `Tienes ${d.cantidad} tareas listas para desarrollar` : 'Tu tarea está lista para desarrollar'),
  'Salida al aire en riesgo': () => 'Una salida al aire está en riesgo',
  'Nueva tarea asignada': (d) => (d.cantidad > 1 ? `Te asignaron ${d.cantidad} tareas` : 'Te asignaron una tarea'),
  'Entrega para revisión': () => 'Tienes una entrega para revisar',
  'Ajustes solicitados': () => 'Te pidieron ajustes',
  'Tarea aprobada': () => '¡Tu tarea fue aprobada!',
  'Invitación a mesawow': () => 'Te invitaron a mesawow',
  'Resumen': (d) => `Tu resumen de mesawow (${d.cantidad} avisos)`,
};
export const tituloDe = (evento: string, datos: Fila) => (TITULOS[evento] ?? (() => evento))(datos);

const contenido = (env: Env, fila: Fila, datos: Fila) => {
  const titulo = tituloDe(fila.event, datos);
  const enlace = fila.task_id ? `${env.APP_URL}/encargos?tarea=${fila.task_id}` : env.APP_URL;
  if (fila.event === 'Invitación a mesawow') {
    return { titulo, ...plantillaCorreo({ titulo, lineas: [`${datos.invitador ?? 'La administración'} te invitó a mesawow, la plataforma de trabajo del equipo.`, `Entrarás con este correo: ${datos.para}. La invitación vence en 7 días.`], boton: { texto: 'Entrar a mesawow', url: datos.enlace } }) };
  }
  if (fila.event === 'Resumen') {
    return { titulo, ...plantillaCorreo({ titulo, lineas: (datos.lineas as string[]).slice(0, 25), boton: { texto: 'Abrir mesawow', url: env.APP_URL } }) };
  }
  const tareas = (datos.tareas as { titulo: string }[] | undefined)?.map((t) => t.titulo).filter(Boolean) ?? [];
  const lineas = [
    ...(tareas.length ? [tareas.length > 1 ? `Tareas: ${tareas.slice(0, 5).join(' · ')}${tareas.length > 5 ? ' y más' : ''}` : `Tarea: ${tareas[0]}`] : []),
    ...(datos.mensaje ? [String(datos.mensaje)] : []), ...(datos.motivo ? [`Motivo: ${datos.motivo}`] : []),
  ];
  return { titulo, ...plantillaCorreo({ titulo, lineas, boton: { texto: 'Ver en mesawow', url: enlace } }) };
};

/** Consumidor de la cola: envía un mensaje y deja su estado. Reintenta con espera creciente (hasta 5 intentos). */
export const enviarMensaje = async (env: Env, id: string, f: typeof fetch = fetch): Promise<'ok' | 'reintentar' | 'fallido'> => {
  const db = env.DB;
  const fila = await db.prepare(`SELECT o.*, p.name, p.email, p.phone FROM outbox o LEFT JOIN people p ON p.id = o.person_id WHERE o.id = ?1`).bind(id).first<Fila>();
  if (!fila || ['enviado', 'entregado', 'cancelado', 'rebotado'].includes(fila.status)) return 'ok';
  const datos = JSON.parse(fila.payload || '{}') as Fila;
  // El enlace de una invitación lleva su token: no se conserva después de enviarse (o de fallar).
  const limpiar = fila.event === 'Invitación a mesawow';
  const actualizar = (estado: string, proveedor: string | null, error: string | null) =>
    db.prepare(`UPDATE outbox SET status = ?2, provider_id = ?3, error = ?4, attempts = attempts + 1, sent_at = CASE WHEN ?2 = 'enviado' THEN ?5 ELSE sent_at END,
                payload = CASE WHEN ?6 = 1 AND ?2 IN ('enviado','fallido') THEN json_object('para', json_extract(payload, '$.para')) ELSE payload END WHERE id = ?1`)
      .bind(id, estado, proveedor, error, new Date().toISOString(), limpiar ? 1 : 0).run();
  try {
    const c = contenido(env, fila, datos);
    if (fila.channel === 'email') {
      const para = fila.email ?? datos.para;
      if (!para) throw new ErrorCanal('Sin correo de destino.', false);
      await actualizar('enviado', await enviarCorreo(env, { para, nombre: fila.name ?? undefined, asunto: `[mesawow] ${c.titulo}`, html: c.html, texto: c.texto, etiqueta: fila.event }, f), null);
    } else if (fila.channel === 'whatsapp') {
      if (!fila.phone) throw new ErrorCanal('La persona no tiene WhatsApp registrado.', false);
      const tareas = (datos.tareas as { titulo: string }[] | undefined) ?? [];
      await actualizar('enviado', await enviarWhatsapp(env, fila.phone, {
        NOMBRE: String(fila.name ?? '').split(' ')[0] ?? '', TAREA: tareas[0]?.titulo ?? '', CANTIDAD: String(datos.cantidad ?? 1),
        ENLACE: fila.task_id ? `${env.APP_URL}/encargos?tarea=${fila.task_id}` : env.APP_URL,
      }, f), null);
    } else if (fila.channel === 'push') {
      const { results: subs } = await db.prepare('SELECT id, endpoint FROM push_subscriptions WHERE person_id = ?1').bind(fila.person_id).all<{ id: string; endpoint: string }>();
      let alguna = false;
      for (const s of subs) {
        if ((await enviarPush(env, s.endpoint, f)) === 'vencida') await db.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(s.id).run();
        else alguna = true;
      }
      await actualizar(alguna ? 'enviado' : 'cancelado', null, alguna ? null : 'Sin dispositivos suscritos');
    }
    return 'ok';
  } catch (e) {
    const reintentar = e instanceof ErrorCanal ? e.reintentar : true;
    const ultimo = (fila.attempts ?? 0) + 1 >= 5;
    await actualizar(reintentar && !ultimo ? 'encolado' : 'fallido', null, (e as Error).message.slice(0, 300));
    return reintentar && !ultimo ? 'reintentar' : 'fallido';
  }
};

/** Resúmenes por correo (A8): diario, o semanal los lunes, según preferencias. Uno por persona y período. */
export const enviarResumenes = async (env: Env, ahora = new Date()) => {
  const db = env.DB;
  const hoy = hoySantiago(ahora);
  const lunes = new Date(`${hoy}T12:00:00Z`).getUTCDay() === 1;
  const { results: gente } = await db.prepare(`SELECT p.id, p.email, coalesce(pr.summary, 'Semanal') AS resumen FROM people p LEFT JOIN preferences pr ON pr.person_id = p.id
      WHERE p.active = 1 AND p.email NOT LIKE '%.invalid' AND coalesce(pr.summary, 'Semanal') <> 'Sin resumen externo'`).all<Fila>();
  let enviados = 0;
  for (const g of gente) {
    if (g.resumen === 'Semanal' && !lunes) continue;
    const periodo = `${g.resumen === 'Diario' ? 'D' : 'S'}${hoy}`;
    const desde = new Date(ahora.getTime() - (g.resumen === 'Diario' ? 1 : 7) * 86_400_000).toISOString();
    const { results: avisos } = await db.prepare(`SELECT o.event, o.created_at, t.title FROM outbox o LEFT JOIN tasks t ON t.id = o.task_id
        WHERE o.person_id = ?1 AND o.channel = 'app' AND o.created_at >= ?2 ORDER BY o.created_at DESC LIMIT 40`).bind(g.id, desde).all<Fila>();
    if (!avisos.length) continue;
    const r = await db.prepare('INSERT INTO digest_runs (person_id, periodo, avisos) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING').bind(g.id, periodo, avisos.length).run();
    if (!r.meta.changes) continue; // ya se envió este período
    const lineas = avisos.map((a) => `${utcASantiago(a.created_at).replace('T', ' ')} · ${a.event}${a.title ? `: ${a.title}` : ''}`);
    await db.prepare(`INSERT INTO outbox (id, dedupe_key, person_id, channel, event, payload) VALUES (?1, ?2, ?3, 'email', 'Resumen', ?4) ON CONFLICT(dedupe_key) DO NOTHING`)
      .bind(nuevoId(), `resumen:${g.id}:${periodo}`, g.id, JSON.stringify({ cantidad: avisos.length, lineas })).run();
    enviados++;
  }
  return enviados;
};

/** Webhook de Brevo: estados reales de entrega. */
export const registrarEventoBrevo = async (db: D1Database, ev: Fila) => {
  const mensaje = String(ev['message-id'] ?? ev.messageId ?? '');
  const tipo = String(ev.event ?? '');
  const estado = tipo === 'delivered' ? 'entregado' : ['hard_bounce', 'soft_bounce', 'blocked', 'invalid_email', 'error'].includes(tipo) ? 'rebotado' : null;
  await db.batch([
    db.prepare('INSERT INTO email_events (id, provider_id, event, email, payload) VALUES (?1, ?2, ?3, ?4, ?5)').bind(nuevoId(), mensaje || null, tipo, ev.email ?? null, JSON.stringify(ev).slice(0, 4000)),
    ...(estado && mensaje ? [db.prepare("UPDATE outbox SET status = ?2, error = CASE WHEN ?2 = 'rebotado' THEN ?3 ELSE error END WHERE provider_id = ?1").bind(mensaje, estado, `Brevo: ${tipo}`)] : []),
  ]);
};
