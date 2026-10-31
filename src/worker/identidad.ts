// Quién hace la petición.
// Fase 1: solo existe la identidad de desarrollo (ENTORNO=local), elegida en la app con el
// selector "Entrar como". Fuera de local se rechaza todo hasta que la Fase 2 valide el JWT
// de Cloudflare Access (fail closed).
import type { Context, MiddlewareHandler } from 'hono';
import { permisosDe, type Permisos, type Rol } from '../shared/roles';
import { ErrorApi } from './errores';

export interface Persona {
  id: string;
  name: string;
  email: string;
  role: Rol;
  mesa: string | null;
  mesaId: string | null;
  marcas: string[];
  permisos: Permisos;
}

export type Variables = { persona: Persona };
export type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

export const CABECERA_DEV = 'x-mesawow-dev';

export const esLocal = (env: Env) => env.ENTORNO === 'local';

const correoDeLaPeticion = (c: Ctx): string | null => {
  if (esLocal(c.env)) {
    const valor = c.req.header(CABECERA_DEV)?.trim().toLowerCase();
    return valor || null;
  }
  return null;
};

export const cargarPersona = async (db: D1Database, correo: string): Promise<Persona | null> => {
  const fila = await db
    .prepare(
      `SELECT p.id, p.name, p.email, p.role, p.active, p.mesa_id, m.name AS mesa
         FROM people p LEFT JOIN mesas m ON m.id = p.mesa_id
        WHERE p.email = ?1`,
    )
    .bind(correo)
    .first<{ id: string; name: string; email: string; role: Rol; active: number; mesa_id: string | null; mesa: string | null }>();
  if (!fila || !fila.active) return null;
  const base = { role: fila.role, mesa: fila.mesa };
  const permisos = permisosDe(base);
  const marcas = permisos.esAdmin
    ? await db.prepare('SELECT id FROM brands WHERE archived = 0 ORDER BY name').all<{ id: string }>()
    : await db
        .prepare('SELECT b.id FROM person_brands pb JOIN brands b ON b.id = pb.brand_id WHERE pb.person_id = ?1 AND b.archived = 0 ORDER BY b.name')
        .bind(fila.id)
        .all<{ id: string }>();
  return {
    id: fila.id,
    name: fila.name,
    email: fila.email,
    role: fila.role,
    mesa: fila.mesa,
    mesaId: fila.mesa_id,
    marcas: marcas.results.map((r) => r.id),
    permisos,
  };
};

export const requiereSesion: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const correo = correoDeLaPeticion(c);
  if (!correo) {
    throw new ErrorApi(401, esLocal(c.env) ? 'sin_sesion' : 'acceso_pendiente',
      esLocal(c.env) ? 'Elige con quién entrar.' : 'El ingreso con Cloudflare Access se habilita en la Fase 2.');
  }
  const persona = await cargarPersona(c.env.DB, correo);
  if (!persona) throw new ErrorApi(403, 'sin_acceso', 'Tu cuenta no está habilitada en mesawow.');
  c.set('persona', persona);
  await next();
};
