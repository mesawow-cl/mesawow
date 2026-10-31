// Cliente de la API /api/v1.
import type { Permisos, Rol } from '../shared/roles';

export interface Persona {
  id: string;
  name: string;
  email: string;
  role: Rol;
  mesa: string | null;
  marcas: string[];
  permisos: Permisos;
}

export class ErrorApi extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

// Solo en desarrollo local: correo elegido en "Entrar como". En staging y production
// la identidad la entrega Cloudflare Access (Fase 2).
const CLAVE_DEV = 'mesawow:entrar-como';
const leerDev = () => { try { return localStorage.getItem(CLAVE_DEV); } catch { return null; } };
export const entrarComo = (correo: string | null) => {
  try { correo ? localStorage.setItem(CLAVE_DEV, correo) : localStorage.removeItem(CLAVE_DEV); } catch { /* sin almacenamiento */ }
};

export const pedir = async <T>(ruta: string, init: RequestInit = {}): Promise<T> => {
  const cabeceras = new Headers(init.headers);
  const dev = leerDev();
  if (dev) cabeceras.set('x-mesawow-dev', dev);
  if (init.body && !cabeceras.has('content-type')) cabeceras.set('content-type', 'application/json');
  const r = await fetch(`/api/v1${ruta}`, { ...init, headers: cabeceras });
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) throw new ErrorApi(r.status, cuerpo?.error?.code ?? 'error', cuerpo?.error?.message ?? 'No pudimos conectar con mesawow.');
  return cuerpo as T;
};
