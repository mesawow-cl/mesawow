-- Fase 7: Comunidad y logros.
-- Línea base por tarea: un logro de tarea solo nace cuando la tarea CAMBIA a aceptable (§5.9),
-- nunca por tareas que ya estaban hechas cuando se evaluó por primera vez.
CREATE TABLE achievement_baseline (
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  cycle     INTEGER NOT NULL,
  aceptable INTEGER NOT NULL,
  PRIMARY KEY (task_id, cycle)
);
CREATE INDEX achievement_people_person ON achievement_people(person_id);
CREATE INDEX achievement_reports_status ON achievement_reports(status, created_at);
