// Quién hace la petición.
//   * Local: identidad de desarrollo (cabecera x-mesawow-dev), elegida con "Entrar como".
//   * Staging y production: correo verificado por Cloudflare Access (JWT). Sin configuración → 503.
// Cloudflare Access solo prueba que el correo es de quien dice ser; mesawow decide quién entra
// (personas activas e invitaciones pendientes).
import type { Context, MiddlewareHandler } from 'hono';
import { permisosDe, type Permisos, type Rol } from '../shared/roles';
import { ErrorAccess, verificarAccess } from './access';
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

export type Variables = {
  /** Correo verificado (puede no corresponder aún a una persona: invitación pendiente). */
  correo: string;
  /** Persona efectiva para mostrar datos (la vista "Ver la app como" la cambia). */
  persona: Persona;
  /** Quien realmente está conectado. Las acciones se autorizan y auditan con el actor. */
  actor: Persona;
};
export type Entorno = { Bindings: Env; Variables: Variables };
export type Ctx = Context<Entorno>;

export const CABECERA_DEV = 'x-mesawow-dev';
export const CABECERA_VER_COMO = 'x-mesawow-ver-como';

export const esLocal = (env: Env) => env.ENTORNO === 'local';

// Solo para pruebas: claves públicas de Access sin ir a la red.
let clavesDePrueba: (() => Promise<JsonWebKey[]>) | undefined;
export const usarClavesDeAccessParaPruebas = (f: typeof clavesDePrueba) => { clavesDePrueba = f; };

const correoDeLaPeticion = async (c: Ctx): Promise<string> => {
  if (esLocal(c.env)) {
    // El navegador no puede poner cabeceras en un WebSocket: en local, la conexión en vivo trae la persona por parámetro.
    const valor = (c.req.header(CABECERA_DEV) ?? (c.req.path === '/api/v1/vivo' ? c.req.query('como') : undefined))?.trim().toLowerCase();
    if (!valor) throw new ErrorApi(401, 'sin_sesion', 'Elige con quién entrar.');
    return valor;
  }
  if (!c.env.ACCESS_EQUIPO || !c.env.ACCESS_AUD) {
    throw new ErrorApi(503, 'acceso_sin_configurar', 'El ingreso con Cloudflare Access aún no está configurado en este entorno.');
  }
  const jwt = c.req.header('cf-access-jwt-assertion');
  if (!jwt) throw new ErrorApi(401, 'sin_sesion', 'Inicia sesión con tu correo para entrar a mesawow.');
  try {
    return await verificarAccess(jwt, { equipo: c.env.ACCESS_EQUIPO, aud: c.env.ACCESS_AUD, obtenerClaves: clavesDePrueba });
  } catch (e) {
    if (e instanceof ErrorAccess) throw new ErrorApi(401, 'sesion_invalida', 'Tu sesión no es válida. Vuelve a iniciar sesión.');
    throw e;
  }
};

const consultaPersona = `SELECT p.id, p.name, p.email, p.role, p.active, p.mesa_id, m.name AS mesa
                           FROM people p LEFT JOIN mesas m ON m.id = p.mesa_id`;
type FilaPersona = { id: string; name: string; email: string; role: Rol; active: number; mesa_id: string | null; mesa: string | null };

const armarPersona = async (db: D1Database, fila: FilaPersona | null): Promise<Persona | null> => {
  if (!fila || !fila.active) return null;
  const permisos = permisosDe({ role: fila.role, mesa: fila.mesa });
  const marcas = permisos.esAdmin
    ? await db.prepare('SELECT id FROM brands WHERE archived = 0 ORDER BY name').all<{ id: string }>()
    : await db
        .prepare('SELECT b.id FROM person_brands pb JOIN brands b ON b.id = pb.brand_id WHERE pb.person_id = ?1 AND b.archived = 0 ORDER BY b.name')
        .bind(fila.id)
        .all<{ id: string }>();
  return {
    id: fila.id, name: fila.name, email: fila.email, role: fila.role, mesa: fila.mesa, mesaId: fila.mesa_id,
    marcas: marcas.results.map((r) => r.id), permisos,
  };
};

export const cargarPersona = async (db: D1Database, correo: string) =>
  armarPersona(db, await db.prepare(`${consultaPersona} WHERE p.email = ?1`).bind(correo).first<FilaPersona>());

const cargarPersonaPorId = async (db: D1Database, id: string) =>
  armarPersona(db, await db.prepare(`${consultaPersona} WHERE p.id = ?1`).bind(id).first<FilaPersona>());

/** Solo verifica el correo (para aceptar una invitación antes de existir como persona). */
export const requiereIdentidad: MiddlewareHandler<Entorno> = async (c, next) => {
  c.set('correo', await correoDeLaPeticion(c));
  await next();
};

const LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

export const requiereSesion: MiddlewareHandler<Entorno> = async (c, next) => {
  const correo = await correoDeLaPeticion(c);
  c.set('correo', correo);
  const actor = await cargarPersona(c.env.DB, correo);
  if (!actor) {
    const invitacion = await c.env.DB
      .prepare("SELECT id FROM invitations WHERE email = ?1 AND status = 'Pendiente' AND expires_at > ?2")
      .bind(correo, new Date().toISOString())
      .first();
    if (invitacion) throw new ErrorApi(403, 'invitacion_pendiente', 'Tienes una invitación a mesawow: completa tus datos para entrar.');
    throw new ErrorApi(403, 'sin_acceso', 'Tu cuenta no está habilitada en mesawow. Pide una invitación a la administración.');
  }
  c.set('actor', actor);
  let persona = actor;

  const verComo = c.req.header(CABECERA_VER_COMO)?.trim();
  if (verComo && verComo !== actor.id) {
    if (!actor.permisos.esAdmin) throw new ErrorApi(403, 'sin_permiso', 'Solo la administración general puede ver la app como otra persona.');
    if (!LECTURA.has(c.req.method)) throw new ErrorApi(403, 'solo_lectura', 'Mientras ves la app como otra persona no puedes hacer cambios.');
    const otra = await cargarPersonaPorId(c.env.DB, verComo);
    if (!otra) throw new ErrorApi(404, 'no_encontrado', 'Esa persona no existe o está inactiva.');
    persona = otra;
  }
  c.set('persona', persona);

  // Consulta: solo lectura, salvo su propio perfil y preferencias.
  if (actor.permisos.soloLectura && !LECTURA.has(c.req.method) && !c.req.path.startsWith('/api/v1/me/')) {
    throw new ErrorApi(403, 'solo_lectura', 'Tu rol es de consulta: puedes ver, pero no hacer cambios.');
  }
  await next();
};

/** Corta con 403 si el actor no cumple el permiso. */
export const exigir = (c: Ctx, permiso: keyof Permisos, mensaje = 'No tienes permiso para hacer esto.') => {
  if (!c.get('actor').permisos[permiso]) throw new ErrorApi(403, 'sin_permiso', mensaje);
};
