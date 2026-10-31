import type { z } from 'zod';
import { ErrorApi } from './errores';
import type { Ctx } from './identidad';

export const nuevoId = () => crypto.randomUUID();
export const ahoraIso = () => new Date().toISOString();

export const tokenAleatorio = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const sha256 = async (texto: string) => {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
};

/** Lee y valida el cuerpo JSON; el primer error de validación se muestra tal cual. */
export const cuerpo = async <T extends z.ZodType>(c: Ctx, esquema: T): Promise<z.infer<T>> => {
  const datos = await c.req.json().catch(() => {
    throw new ErrorApi(400, 'json_invalido', 'La petición no trae datos válidos.');
  });
  const r = esquema.safeParse(datos);
  if (!r.success) throw new ErrorApi(400, 'datos_invalidos', r.error.issues[0]?.message ?? 'Datos inválidos.');
  return r.data;
};

/** Registro de auditoría (alimenta la actividad del Inicio y el historial). */
export const auditoria = (db: D1Database, actorId: string | null, accion: string, entidad: string, entidadId: string, detalles?: unknown) =>
  db.prepare('INSERT INTO audit_log (id, actor_id, action, entity, entity_id, details) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(nuevoId(), actorId, accion, entidad, entidadId, detalles === undefined ? null : JSON.stringify(detalles));
