// mesawow · Worker: API REST /api/v1 (la app estática la sirve Workers Assets).
import { Hono } from 'hono';
import { agenda, recalcularAgenda, sincronizarFeriados } from './agenda';
import { aire, procesarAire } from './aire';
import { calendario } from './calendario';
import { campanas } from './campanas';
import { equipo, invitacionPropia } from './equipo';
import { estrategia, publico } from './estrategia';
import { google, googleCallback, sincronizarTodos } from './google';
import { ical, icalPublico, sincronizarIcalTodos } from './ical';
import { cuerpoError, ErrorApi } from './errores';
import { esLocal, requiereIdentidad, requiereSesion, type Entorno } from './identidad';
import { organizacion } from './organizacion';
import { perfil } from './perfil';
import { planificacion } from './planificacion';
import { sprints } from './sprints';
import { tareas } from './tareas';

const api = new Hono<Entorno>().basePath('/api/v1');

api.onError((err, c) => {
  if (err instanceof ErrorApi) return c.json(cuerpoError(err.code, err.message), err.status);
  console.error(err);
  return c.json(cuerpoError('error_interno', 'Algo falló de nuestro lado. Intenta de nuevo.'), 500);
});

api.notFound((c) => c.json(cuerpoError('no_encontrado', 'Esa ruta no existe.'), 404));

// Respuestas de la API nunca se guardan en cachés compartidos.
api.use('*', async (c, next) => {
  await next();
  c.header('cache-control', c.res.headers.get('cache-control') ?? 'no-store');
});

api.get('/salud', (c) => c.json({ ok: true, entorno: c.env.ENTORNO }));

// Selector "Entrar como" de desarrollo: solo existe en local.
api.get('/dev/personas', async (c) => {
  if (!esLocal(c.env)) throw new ErrorApi(404, 'no_encontrado', 'Esa ruta no existe.');
  const { results } = await c.env.DB
    .prepare(`SELECT p.email, p.name, p.role, m.name AS mesa FROM people p LEFT JOIN mesas m ON m.id = p.mesa_id
               WHERE p.active = 1 ORDER BY p.name`)
    .all();
  return c.json({ personas: results });
});

// Una sola puerta: sin sesión (salud y desarrollo), solo correo verificado (aceptar invitación) o sesión completa.
const SIN_SESION = new Set(['/api/v1/salud', '/api/v1/dev/personas', '/api/v1/publico/mesa', '/api/v1/google/callback']);
const SOLO_IDENTIDAD = new Set(['/api/v1/invitaciones/mia', '/api/v1/invitaciones/aceptar']);
api.use('*', (c, next) => {
  if (SIN_SESION.has(c.req.path) || c.req.path.startsWith('/api/v1/ical/feed/')) return next();
  if (SOLO_IDENTIDAD.has(c.req.path)) return requiereIdentidad(c, next);
  return requiereSesion(c, next);
});

api.route('/', publico);
api.route('/', googleCallback);
api.route('/', icalPublico);
api.route('/', invitacionPropia);
api.route('/', equipo);
api.route('/', perfil);
api.route('/', aire);
api.route('/', calendario);
api.route('/', google);
api.route('/', ical);
api.route('/', tareas);
api.route('/', organizacion);
api.route('/', agenda);
api.route('/', sprints);
api.route('/', planificacion);
api.route('/', campanas);
api.route('/', estrategia);

const conSesion = new Hono<Entorno>();

conSesion.get('/me', (c) => {
  const persona = c.get('persona');
  const actor = c.get('actor');
  return c.json({ persona, actor: actor.id === persona.id ? undefined : actor });
});

// Directorio del equipo (perfiles y "Ver la app como"). Solo para el equipo.
conSesion.get('/personas', async (c) => {
  if (!c.get('actor').permisos.esEquipo) throw new ErrorApi(403, 'sin_permiso', 'Esta sección es solo para el equipo.');
  const { results } = await c.env.DB
    .prepare(`SELECT p.id, p.name, p.role, m.name AS mesa,
                     (SELECT json_group_array(brand_id) FROM person_brands WHERE person_id = p.id) AS marcas
                FROM people p LEFT JOIN mesas m ON m.id = p.mesa_id
               WHERE p.active = 1 ORDER BY p.name`)
    .all<Record<string, unknown>>();
  return c.json({ personas: results.map((p) => ({ ...p, marcas: JSON.parse(p.marcas as string) })) });
});

conSesion.get('/marcas', async (c) => {
  const persona = c.get('persona');
  if (!persona.marcas.length) return c.json({ marcas: [] });
  const marcadores = persona.marcas.map((_, i) => `?${i + 1}`).join(',');
  const { results } = await c.env.DB
    .prepare(`SELECT id, name, color FROM brands WHERE id IN (${marcadores}) ORDER BY name`)
    .bind(...persona.marcas)
    .all();
  return c.json({ marcas: results });
});

api.route('/', conSesion);

export default {
  fetch: api.fetch,
  // Tareas programadas (Cron Triggers):
  //   cada 5 minutos: piezas que salen al aire solas, avisos de riesgo (A4, A5) y Google Calendar (D4);
  //   lunes 10:00 UTC: feriados oficiales del año y el siguiente (D3).
  async scheduled(evento, env, ctx) {
    if (evento.cron === '0 10 * * 1') {
      const anio = new Date().getUTCFullYear();
      ctx.waitUntil((async () => {
        await sincronizarFeriados(env.DB, [anio, anio + 1]);
        await recalcularAgenda(env.DB, 'Feriados oficiales actualizados', null);
      })());
      return;
    }
    ctx.waitUntil(Promise.all([procesarAire(env.DB), sincronizarTodos(env.DB, env), sincronizarIcalTodos(env.DB, env)]).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

export type Api = typeof api;
