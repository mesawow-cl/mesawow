// Cola de avisos (outbox). En la Fase 3 solo se registran en la app; la Fase 6 agrega
// push, correo (Brevo) y WhatsApp, con resúmenes y preferencias.
import { nuevoId } from './util';

export const encolarAvisos = (db: D1Database, evento: string, tareaId: string | null, destinatarios: Iterable<string>, datos: Record<string, unknown> = {}) => {
  const eventId = nuevoId();
  return [...new Set(destinatarios)].map((personaId) =>
    db.prepare(`INSERT INTO outbox (id, dedupe_key, event_id, person_id, channel, event, task_id, payload)
                VALUES (?1, ?2, ?3, ?4, 'app', ?5, ?6, ?7) ON CONFLICT(dedupe_key) DO NOTHING`)
      .bind(nuevoId(), `${eventId}:${personaId}:app`, eventId, personaId, evento, tareaId, JSON.stringify(datos)));
};
