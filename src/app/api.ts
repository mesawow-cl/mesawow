// Cliente de la API /api/v1.
import type { Permisos, Rol } from '../shared/roles';

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

export class ErrorApi extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

// Solo en desarrollo local: correo elegido en "Entrar como". En staging y production
// la identidad la entrega Cloudflare Access.
const CLAVE_DEV = 'mesawow:entrar-como';
const leerDev = () => { try { return localStorage.getItem(CLAVE_DEV); } catch { return null; } };
export const entrarComo = (correo: string | null) => {
  try { correo ? localStorage.setItem(CLAVE_DEV, correo) : localStorage.removeItem(CLAVE_DEV); } catch { /* sin almacenamiento */ }
};
export const hayEntrarComo = () => !!leerDev();

// "Ver la app como" (solo administración general; el servidor lo limita a lectura).
let verComo = '';
export const fijarVerComo = (id: string) => { verComo = id; };

const cabecerasBase = (init: RequestInit) => {
  const h = new Headers(init.headers);
  const dev = leerDev();
  if (dev) h.set('x-mesawow-dev', dev);
  if (verComo) h.set('x-mesawow-ver-como', verComo);
  return h;
};

const responder = async <T>(r: Response): Promise<T> => {
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) throw new ErrorApi(r.status, cuerpo?.error?.code ?? 'error', cuerpo?.error?.message ?? 'No pudimos conectar con mesawow.');
  return cuerpo as T;
};

export const pedir = async <T>(ruta: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => {
  const { json, ...resto } = init;
  const h = cabecerasBase(resto);
  if (json !== undefined) h.set('content-type', 'application/json');
  return responder<T>(await fetch(`/api/v1${ruta}`, { ...resto, headers: h, body: json !== undefined ? JSON.stringify(json) : resto.body }));
};

export const subirArchivo = async <T>(ruta: string, archivo: File) => {
  const h = cabecerasBase({});
  h.set('content-type', archivo.type);
  return responder<T>(await fetch(`/api/v1${ruta}`, { method: 'PUT', headers: h, body: archivo }));
};

/** Las fotos necesitan la identidad de desarrollo en local: se piden con fetch y se muestran como blob. */
export const urlDeFoto = async (ruta: string) => {
  const r = await fetch(ruta, { headers: cabecerasBase({}) });
  if (!r.ok) return null;
  return URL.createObjectURL(await r.blob());
};

export const cerrarSesion = () => {
  if (hayEntrarComo()) { entrarComo(null); location.assign('/'); return; }
  // Cierra la sesión de Cloudflare Access.
  location.assign('/cdn-cgi/access/logout');
};
