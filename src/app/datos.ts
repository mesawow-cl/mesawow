// Catálogos compartidos por varias pantallas (se piden una vez por sesión).
import { pedir } from './api';

export interface Marca { id: string; name: string; color: string }
export interface Mesa { id: string; name: string; active: number; description: string; owner_id: string | null; encargado: string | null; total: number; aceptadas: number; abiertas: number }
export interface PersonaDirectorio { id: string; name: string; role: string; mesa: string | null; marcas: string[] }

const cache = new Map<string, Promise<unknown>>();
const una = <T>(clave: string, f: () => Promise<T>) => {
  if (!cache.has(clave)) cache.set(clave, f().catch((e) => { cache.delete(clave); throw e; }));
  return cache.get(clave) as Promise<T>;
};
export const olvidarCatalogos = () => cache.clear();

export const marcas = () => una('marcas', () => pedir<{ marcas: Marca[] }>('/marcas').then((r) => r.marcas));
export const mesas = () => una('mesas', () => pedir<{ mesas: Mesa[] }>('/mesas').then((r) => r.mesas));
export const personas = () => una('personas', () => pedir<{ personas: PersonaDirectorio[] }>('/personas').then((r) => r.personas));

export const fechaCorta = (d: string) =>
  new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

export const TONO_ESTADO: Record<string, string> = {
  'Pendiente': 'gris', 'En curso': '', 'Entregada para revisión': 'ambar', 'Ajustes solicitados': 'roja', 'Aprobada': 'verde', 'Completada': 'verde',
};
