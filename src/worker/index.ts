// mesawow · Worker: API REST /api/v1 (la app estática la sirve Workers Assets).
import { Hono } from 'hono';
import { cuerpoError, ErrorApi } from './errores';
import { esLocal, requiereSesion, type Variables } from './identidad';

const api = new Hono<{ Bindings: Env; Variables: Variables }>().basePath('/api/v1');

api.onError((err, c) => {
  if (err instanceof ErrorApi) return c.json(cuerpoError(err.code, err.message), err.status);
  console.error(err);
  return c.json(cuerpoError('error_interno', 'Algo falló de nuestro lado. Intenta de nuevo.'), 500);
});

api.notFound((c) => c.json(cuerpoError('no_encontrado', 'Esa ruta no existe.'), 404));

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

api.use('*', requiereSesion);

api.get('/me', (c) => c.json({ persona: c.get('persona') }));

// Directorio del equipo (perfiles y "Ver la app como"). Solo para el equipo.
api.get('/personas', async (c) => {
  if (!c.get('persona').permisos.esEquipo) throw new ErrorApi(403, 'sin_permiso', 'Esta sección es solo para el equipo.');
  const { results } = await c.env.DB
    .prepare(`SELECT p.id, p.name, p.role, m.name AS mesa FROM people p LEFT JOIN mesas m ON m.id = p.mesa_id
               WHERE p.active = 1 ORDER BY p.name`)
    .all();
  return c.json({ personas: results });
});

api.get('/marcas', async (c) => {
  const persona = c.get('persona');
  if (!persona.marcas.length) return c.json({ marcas: [] });
  const marcadores = persona.marcas.map((_, i) => `?${i + 1}`).join(',');
  const { results } = await c.env.DB
    .prepare(`SELECT id, name, color FROM brands WHERE id IN (${marcadores}) ORDER BY name`)
    .bind(...persona.marcas)
    .all();
  return c.json({ marcas: results });
});

export default {
  fetch: api.fetch,
} satisfies ExportedHandler<Env>;

export type Api = typeof api;
