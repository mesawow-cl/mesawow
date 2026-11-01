-- Fase 6: avisos por canal.
-- WhatsApp (D2) avisa cuando una tarea queda lista para desarrollar: activo por defecto.
UPDATE preferences SET whatsapp = 1;
-- Resúmenes por correo (A8): uno por persona y período, aunque el cron corra dos veces.
CREATE TABLE digest_runs (
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  periodo    TEXT NOT NULL,
  avisos     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (person_id, periodo)
);
-- Los avisos de la app ya procesados por el despachador.
CREATE INDEX outbox_canal_estado ON outbox(channel, status);
