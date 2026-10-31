// Verificación del JWT que Cloudflare Access agrega a cada petición (cabecera Cf-Access-Jwt-Assertion).
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
// Se valida firma RS256 con las claves públicas del equipo de Zero Trust, emisor, audiencia y vigencia.

export interface ConfigAccess {
  /** Dominio del equipo de Zero Trust, p. ej. "mesawow.cloudflareaccess.com". */
  equipo: string;
  /** Etiqueta AUD de la aplicación de Access. */
  aud: string;
  /** Para pruebas: entrega las claves públicas sin ir a la red. */
  obtenerClaves?: () => Promise<JsonWebKey[]>;
  ahora?: () => number;
}

export class ErrorAccess extends Error {}

const b64url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const json = (s: string) => {
  try {
    return JSON.parse(new TextDecoder().decode(b64url(s)));
  } catch {
    throw new ErrorAccess('JWT ilegible.');
  }
};
const bytes = (s: string) => {
  try {
    return b64url(s);
  } catch {
    throw new ErrorAccess('Firma ilegible.');
  }
};

// Caché de claves por equipo (vive mientras viva el isolate).
const cache = new Map<string, { claves: JsonWebKey[]; hasta: number }>();

const clavesDelEquipo = async (equipo: string): Promise<JsonWebKey[]> => {
  const c = cache.get(equipo);
  if (c && c.hasta > Date.now()) return c.claves;
  const r = await fetch(`https://${equipo}/cdn-cgi/access/certs`);
  if (!r.ok) throw new ErrorAccess('No se pudieron obtener las claves de Cloudflare Access.');
  const { keys } = (await r.json()) as { keys: JsonWebKey[] };
  cache.set(equipo, { claves: keys, hasta: Date.now() + 10 * 60_000 });
  return keys;
};

/** Devuelve el correo verificado del JWT, o lanza ErrorAccess. */
export const verificarAccess = async (token: string, config: ConfigAccess): Promise<string> => {
  const partes = token.split('.');
  if (partes.length !== 3) throw new ErrorAccess('Formato de JWT inválido.');
  const [cabeza, cuerpo, firma] = partes as [string, string, string];
  const h = json(cabeza) as { alg?: string; kid?: string };
  if (h.alg !== 'RS256') throw new ErrorAccess('Algoritmo no permitido.');
  const claves = await (config.obtenerClaves?.() ?? clavesDelEquipo(config.equipo));
  const jwk = claves.find((k) => (k as { kid?: string }).kid === h.kid);
  if (!jwk) throw new ErrorAccess('Clave desconocida.');
  const clave = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valida = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', clave, bytes(firma), new TextEncoder().encode(`${cabeza}.${cuerpo}`));
  if (!valida) throw new ErrorAccess('Firma inválida.');

  const c = json(cuerpo) as { iss?: string; aud?: string | string[]; exp?: number; nbf?: number; email?: string };
  const ahora = Math.floor((config.ahora?.() ?? Date.now()) / 1000);
  if (c.iss !== `https://${config.equipo}`) throw new ErrorAccess('Emisor inválido.');
  const auds = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!auds.includes(config.aud)) throw new ErrorAccess('Audiencia inválida.');
  if (!c.exp || c.exp < ahora - 30) throw new ErrorAccess('Sesión vencida.');
  if (c.nbf && c.nbf > ahora + 30) throw new ErrorAccess('Sesión aún no válida.');
  if (!c.email) throw new ErrorAccess('El JWT no trae correo.');
  return c.email.trim().toLowerCase();
};
