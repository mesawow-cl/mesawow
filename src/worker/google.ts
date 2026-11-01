// Google Calendar (D4): cada persona conecta su calendario con OAuth.
//   Google → mesawow: reuniones (cada 5 min) que recalculan la agenda.
//   mesawow → Google: los bloques de trabajo como eventos marcados como de mesawow.
// El refresh token se guarda cifrado (AES-GCM) con el secreto CLAVE_CIFRADO.
import { Hono } from 'hono';
import { utcASantiago } from '../shared/fechas';
import { recalcularAgenda } from './agenda';
import { ErrorApi } from './errores';
import type { Entorno } from './identidad';
import { auditoria, nuevoId } from './util';

type Fila = Record<string, any>;
const ALCANCE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const ZONA = 'America/Santiago';

export interface ConfigGoogle { clienteId: string; secreto: string; clave: string; redireccion: string }
export const configGoogle = (env: Env): ConfigGoogle | null => {
  const e = env as Env & { GOOGLE_CLIENT_SECRET?: string; CLAVE_CIFRADO?: string };
  if (!env.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET || !e.CLAVE_CIFRADO) return null;
  return { clienteId: env.GOOGLE_CLIENT_ID, secreto: e.GOOGLE_CLIENT_SECRET, clave: e.CLAVE_CIFRADO, redireccion: `${env.APP_URL}/api/v1/google/callback` };
};

// ─────────────────────────────── cifrado y firma

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const desdeB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const claveAes = (clave: string) => crypto.subtle.importKey('raw', desdeB64(clave), 'AES-GCM', false, ['encrypt', 'decrypt']);
const claveHmac = (clave: string) => crypto.subtle.importKey('raw', desdeB64(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export const cifrar = async (texto: string, clave: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await claveAes(clave), new TextEncoder().encode(texto));
  return `${b64(iv)}.${b64(datos)}`;
};
export const descifrar = async (cifrado: string, clave: string) => {
  const [iv, datos] = cifrado.split('.') as [string, string];
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: desdeB64(iv) }, await claveAes(clave), desdeB64(datos)));
};

/** state firmado: identifica a la persona en el regreso desde Google (la redirección no trae la sesión de desarrollo). */
export const firmarEstado = async (personaId: string, clave: string, vence = Date.now() + 10 * 60_000) => {
  const datos = b64(new TextEncoder().encode(JSON.stringify({ p: personaId, v: vence, n: nuevoId() })));
  return `${datos}.${b64(await crypto.subtle.sign('HMAC', await claveHmac(clave), new TextEncoder().encode(datos)))}`;
};
export const verificarEstado = async (estado: string, clave: string) => {
  const [datos, firma] = estado.split('.');
  if (!datos || !firma) return null;
  const ok = await crypto.subtle.verify('HMAC', await claveHmac(clave), desdeB64(firma), new TextEncoder().encode(datos)).catch(() => false);
  if (!ok) return null;
  const x = JSON.parse(new TextDecoder().decode(desdeB64(datos))) as { p: string; v: number };
  return x.v > Date.now() ? x.p : null;
};

// ─────────────────────────────── sincronización

const tokenDeAcceso = async (cfg: ConfigGoogle, refresh: string, f: typeof fetch) => {
  const r = await f('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clienteId, client_secret: cfg.secreto, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  if (!r.ok) throw new Error('google_token');
  return ((await r.json()) as { access_token: string }).access_token;
};

interface EventoGoogle {
  id: string; status?: string; summary?: string; transparency?: string;
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Sincroniza a una persona en ambos sentidos. Devuelve cuántas reuniones cambiaron. */
export const sincronizarPersona = async (db: D1Database, cfg: ConfigGoogle, personaId: string, f: typeof fetch = fetch, ahora = new Date()) => {
  const link = await db.prepare('SELECT token_ref FROM calendar_links WHERE person_id = ?1 AND token_ref IS NOT NULL').bind(personaId).first<{ token_ref: string }>();
  if (!link) return { cambios: 0 };
  let token: string;
  try { token = await tokenDeAcceso(cfg, await descifrar(link.token_ref, cfg.clave), f); } catch {
    await db.prepare("UPDATE calendar_links SET status = 'Reconectar Google Calendar' WHERE person_id = ?1").bind(personaId).run();
    return { cambios: 0, error: 'Hay que volver a conectar Google Calendar.' };
  }
  const auth = { authorization: `Bearer ${token}` };
  const hoy = utcASantiago(ahora.toISOString()).slice(0, 10);
  const desde = new Date(Date.parse(`${hoy}T00:00:00Z`) - 86_400_000).toISOString(), hasta = new Date(Date.parse(`${sumarDias(hoy, 60)}T00:00:00Z`)).toISOString();

  // Google → mesawow: reuniones con hora (se ignoran todo el día, "disponible", canceladas y las creadas por mesawow).
  const eventos: EventoGoogle[] = [];
  let pagina: string | undefined;
  do {
    const q = new URLSearchParams({ timeMin: desde, timeMax: hasta, singleEvents: 'true', maxResults: '250', ...(pagina ? { pageToken: pagina } : {}) });
    const r = await f(`${API}?${q}`, { headers: auth });
    if (!r.ok) throw new ErrorApi(502, 'google', 'Google Calendar no respondió. Intenta más tarde.');
    const j = (await r.json()) as { items?: EventoGoogle[]; nextPageToken?: string };
    eventos.push(...(j.items ?? []));
    pagina = j.nextPageToken;
  } while (pagina);
  const reuniones = eventos.filter((e) => e.status !== 'cancelled' && e.start?.dateTime && e.end?.dateTime && e.transparency !== 'transparent' && !e.extendedProperties?.private?.mesawow)
    .map((e) => ({ id: e.id, titulo: e.summary || 'Reunión', inicio: utcASantiago(new Date(e.start!.dateTime!).toISOString()), fin: utcASantiago(new Date(e.end!.dateTime!).toISOString()) }))
    .filter((e) => e.fin > e.inicio);
  const { results: previas } = await db.prepare("SELECT id, external_id, title, starts_at, ends_at FROM meetings WHERE person_id = ?1 AND source = 'google'").bind(personaId).all<Fila>();
  const sentencias: D1PreparedStatement[] = [];
  let cambios = 0;
  for (const e of reuniones) {
    const p = previas.find((x) => x.external_id === e.id);
    if (p && p.title === e.titulo && p.starts_at === e.inicio && p.ends_at === e.fin) continue;
    cambios++;
    sentencias.push(db.prepare(`INSERT INTO meetings (id, person_id, title, starts_at, ends_at, source, external_id) VALUES (?1, ?2, ?3, ?4, ?5, 'google', ?6)
        ON CONFLICT(person_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at`)
      .bind(p?.id ?? nuevoId(), personaId, e.titulo, e.inicio, e.fin, e.id));
  }
  const vigentes = new Set(reuniones.map((e) => e.id));
  for (const p of previas) if (!vigentes.has(p.external_id) && p.ends_at >= `${hoy}T00:00`) { cambios++; sentencias.push(db.prepare('DELETE FROM meetings WHERE id = ?1').bind(p.id)); }
  if (sentencias.length) await db.batch(sentencias);
  if (cambios) await recalcularAgenda(db, 'Cambio en Google Calendar', null, ahora);

  // mesawow → Google: los bloques futuros como eventos de mesawow (se borran los que ya no corresponden).
  const { results: bloques } = await db.prepare(`SELECT w.task_id, w.starts_at, w.ends_at, t.title FROM work_blocks w JOIN tasks t ON t.id = w.task_id
      WHERE w.person_id = ?1 AND w.ends_at >= ?2 AND w.starts_at <= ?3`).bind(personaId, utcASantiago(ahora.toISOString()), `${sumarDias(hoy, 60)}T23:59`).all<Fila>();
  const deseados = new Map(bloques.map((b) => [`${b.task_id}|${b.starts_at}|${b.ends_at}`, b]));
  const propios = eventos.filter((e) => e.status !== 'cancelled' && e.extendedProperties?.private?.mesawow);
  for (const e of propios) {
    const k = e.extendedProperties!.private!.bloque ?? '';
    if (deseados.has(k)) deseados.delete(k);
    else await f(`${API}/${encodeURIComponent(e.id)}`, { method: 'DELETE', headers: auth });
  }
  for (const [k, b] of deseados) {
    await f(API, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: `🛠 ${b.title}`, description: 'Bloque de trabajo reservado por mesawow.', transparency: 'opaque',
        start: { dateTime: `${b.starts_at}:00`, timeZone: ZONA }, end: { dateTime: `${b.ends_at}:00`, timeZone: ZONA },
        extendedProperties: { private: { mesawow: '1', bloque: k } }, reminders: { useDefault: false },
      }),
    });
  }
  await db.prepare("UPDATE calendar_links SET status = 'Conectado', sync_cursor = ?2, updated_at = ?2 WHERE person_id = ?1").bind(personaId, ahora.toISOString()).run();
  return { cambios };
};

export const sincronizarTodos = async (db: D1Database, env: Env) => {
  const cfg = configGoogle(env);
  if (!cfg) return;
  const { results } = await db.prepare("SELECT person_id FROM calendar_links WHERE token_ref IS NOT NULL").all<{ person_id: string }>();
  for (const r of results) await sincronizarPersona(db, cfg, r.person_id).catch((e) => console.error('google', r.person_id, e));
};

// ─────────────────────────────── rutas

export const google = new Hono<Entorno>();

google.get('/google/estado', async (c) => {
  const r = await c.env.DB.prepare('SELECT status, sync_cursor, token_ref IS NOT NULL AS conectado FROM calendar_links WHERE person_id = ?1').bind(c.get('actor').id).first<Fila>();
  return c.json({ configurado: !!configGoogle(c.env), conectado: !!r?.conectado, estado: r?.status ?? 'Sin conexión Google', ultimaSincronizacion: r?.sync_cursor ?? null });
});

google.get('/google/conectar', async (c) => {
  const cfg = configGoogle(c.env);
  if (!cfg) throw new ErrorApi(503, 'google_sin_configurar', 'Google Calendar aún no está configurado en este entorno.');
  const q = new URLSearchParams({
    client_id: cfg.clienteId, redirect_uri: cfg.redireccion, response_type: 'code', scope: ALCANCE, access_type: 'offline', prompt: 'consent',
    include_granted_scopes: 'true', login_hint: c.get('actor').email, state: await firmarEstado(c.get('actor').id, cfg.clave),
  });
  return c.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
});

/** Regreso desde Google: se identifica a la persona por el state firmado (sin sesión). */
export const googleCallback = new Hono<Entorno>();
googleCallback.get('/google/callback', async (c) => {
  const cfg = configGoogle(c.env);
  const volver = (r: string) => c.redirect(`${c.env.APP_URL}/mi-mesa?google=${r}`, 302);
  if (!cfg) return volver('sin_configurar');
  const personaId = await verificarEstado(c.req.query('state') ?? '', cfg.clave);
  const codigo = c.req.query('code');
  if (!personaId || !codigo) return volver('error');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: codigo, client_id: cfg.clienteId, client_secret: cfg.secreto, redirect_uri: cfg.redireccion, grant_type: 'authorization_code' }),
  });
  const j = (await r.json().catch(() => ({}))) as { refresh_token?: string };
  if (!r.ok || !j.refresh_token) return volver('error');
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO calendar_links (person_id, calendar_id, status, token_ref) VALUES (?1, 'primary', 'Conectado', ?2)
        ON CONFLICT(person_id) DO UPDATE SET calendar_id = 'primary', status = 'Conectado', token_ref = excluded.token_ref, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
      .bind(personaId, await cifrar(j.refresh_token, cfg.clave)),
    auditoria(c.env.DB, personaId, 'Google Calendar conectado', 'person', personaId),
  ]);
  c.executionCtx.waitUntil(sincronizarPersona(c.env.DB, cfg, personaId).catch(() => undefined));
  return volver('ok');
});

google.post('/google/sincronizar', async (c) => {
  const cfg = configGoogle(c.env);
  if (!cfg) throw new ErrorApi(503, 'google_sin_configurar', 'Google Calendar aún no está configurado en este entorno.');
  return c.json(await sincronizarPersona(c.env.DB, cfg, c.get('actor').id));
});

google.post('/google/desconectar', async (c) => {
  const db = c.env.DB;
  const id = c.get('actor').id;
  await db.batch([
    db.prepare("UPDATE calendar_links SET token_ref = NULL, status = 'Sin conexión Google' WHERE person_id = ?1").bind(id),
    db.prepare("DELETE FROM meetings WHERE person_id = ?1 AND source = 'google'").bind(id),
  ]);
  await recalcularAgenda(db, 'Google Calendar desconectado', id);
  return c.json({ ok: true });
});
