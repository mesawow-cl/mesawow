-- mesawow · esquema inicial (Fase 1)
-- Referencia: docs/requerimiento-mesawow.md §8.
-- Convenciones:
--   * IDs TEXT (UUID, o el ID original al importar desde el prototipo).
--   * Fechas 'YYYY-MM-DD'; horas de pared en America/Santiago 'YYYY-MM-DDTHH:MM';
--     marcas de tiempo en UTC ISO 8601 (created_at, updated_at, *_at).
--   * Booleanos INTEGER 0/1.

-- ─────────────────────────────── Organización y personas

CREATE TABLE mesas (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(name) BETWEEN 1 AND 70),
  active      INTEGER NOT NULL DEFAULT 1,
  owner_id    TEXT REFERENCES people(id),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE people (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(name) BETWEEN 1 AND 90),
  email          TEXT NOT NULL COLLATE NOCASE UNIQUE,
  phone          TEXT CHECK (phone IS NULL OR phone GLOB '+[1-9]*'),
  role           TEXT NOT NULL DEFAULT 'Ejecutor' CHECK (role IN (
                   'Administrador general','Administración','Coordinación de Marketing',
                   'Responsable de marca o área','Ejecutor','Revisor o aprobador','Consulta',
                   'Mandante','Consulta externa','Administrador técnico')),
  mesa_id        TEXT REFERENCES mesas(id),
  active         INTEGER NOT NULL DEFAULT 1,
  departed       INTEGER NOT NULL DEFAULT 0,
  departure_note TEXT,
  bio            TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 300),
  photo_key      TEXT,
  last_seen_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Un solo Administrador general activo a la vez.
CREATE UNIQUE INDEX people_un_admin ON people(role) WHERE role = 'Administrador general' AND active = 1;

CREATE TABLE brands (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(name) BETWEEN 1 AND 80),
  color       TEXT NOT NULL DEFAULT '#F22E62',
  description TEXT NOT NULL DEFAULT '',
  director_id TEXT REFERENCES people(id),
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE brand_minimums (
  brand_id   TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL CHECK (idx BETWEEN 0 AND 20),
  title      TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'Pendiente de verificar' CHECK (state IN (
               'Pendiente de verificar','Vigente','Incompleto','Desactualizado','Faltante')),
  note       TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES people(id),
  updated_at TEXT,
  PRIMARY KEY (brand_id, idx)
);

CREATE TABLE brand_team_roles (
  brand_id  TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  role_key  TEXT NOT NULL,
  person_id TEXT REFERENCES people(id),
  label     TEXT,
  PRIMARY KEY (brand_id, role_key)
);

CREATE TABLE person_brands (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  brand_id  TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, brand_id)
);

CREATE TABLE invitations (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL COLLATE NOCASE,
  name        TEXT,
  mesa_id     TEXT REFERENCES mesas(id),
  role        TEXT NOT NULL CHECK (role IN (
                'Coordinación de Marketing','Responsable de marca o área','Ejecutor',
                'Revisor o aprobador','Consulta')),
  status      TEXT NOT NULL DEFAULT 'Pendiente' CHECK (status IN ('Pendiente','Aceptada','Revocada','Vencida')),
  expires_at  TEXT NOT NULL,
  inviter_id  TEXT REFERENCES people(id),
  accepted_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE invitation_brands (
  invitation_id TEXT NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  brand_id      TEXT NOT NULL REFERENCES brands(id),
  PRIMARY KEY (invitation_id, brand_id)
);

CREATE TABLE preferences (
  person_id    TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  mentions     INTEGER NOT NULL DEFAULT 1,
  summary      TEXT NOT NULL DEFAULT 'Semanal' CHECK (summary IN ('Diario','Semanal','Sin resumen externo')),
  email        INTEGER NOT NULL DEFAULT 0,
  whatsapp     INTEGER NOT NULL DEFAULT 0,
  push         INTEGER NOT NULL DEFAULT 1,
  metro_brands TEXT NOT NULL DEFAULT '{}'
);

-- ─────────────────────────────── Configuración general

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE holidays (
  date   TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','oficial'))
);

-- ─────────────────────────────── Estrategia (se declara antes de tareas)

CREATE TABLE strategic_plans (
  id         TEXT PRIMARY KEY,
  brand_id   TEXT NOT NULL REFERENCES brands(id),
  name       TEXT NOT NULL,
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  objective  TEXT NOT NULL DEFAULT '',
  audience   TEXT NOT NULL DEFAULT '',
  budget     REAL,
  diagnosis  TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (start_date <= end_date)
);

-- ─────────────────────────────── Campañas, catálogo y trabajos

CREATE TABLE campaigns (
  id                   TEXT PRIMARY KEY,
  brand_id             TEXT NOT NULL REFERENCES brands(id),
  plan_id              TEXT REFERENCES strategic_plans(id),
  type                 TEXT NOT NULL DEFAULT 'email' CHECK (type IN ('email','360','webinar','otra')),
  name                 TEXT NOT NULL,
  objective            TEXT NOT NULL DEFAULT '',
  metric               TEXT NOT NULL DEFAULT '',
  target               TEXT NOT NULL DEFAULT '',
  budget               REAL,
  audience             TEXT NOT NULL DEFAULT '',
  platform             TEXT NOT NULL DEFAULT '',
  segment_text         TEXT NOT NULL DEFAULT '',
  segment_id           TEXT REFERENCES segments(id),
  subject              TEXT NOT NULL DEFAULT '',
  preheader            TEXT NOT NULL DEFAULT '',
  sender               TEXT NOT NULL DEFAULT '',
  reply_to             TEXT NOT NULL DEFAULT '',
  cta                  TEXT NOT NULL DEFAULT '',
  url                  TEXT NOT NULL DEFAULT '',
  html_key             TEXT,
  account              TEXT NOT NULL DEFAULT '',
  utm_source           TEXT NOT NULL DEFAULT '',
  utm_campaign         TEXT NOT NULL DEFAULT '',
  start_date                TEXT,
  end_date                  TEXT,
  live_start           TEXT,
  live_end             TEXT,
  sched_date           TEXT,
  sched_time           TEXT NOT NULL DEFAULT '10:00',
  status               TEXT NOT NULL DEFAULT 'Borrador' CHECK (status IN (
                         'Borrador','En revisión','Ajustes solicitados','Aprobada','Calendarizada','Programada en el canal')),
  version              INTEGER NOT NULL DEFAULT 1,
  approved_version     INTEGER,
  approved_at          TEXT,
  approved_by          TEXT REFERENCES people(id),
  review_comment       TEXT NOT NULL DEFAULT '',
  external_id          TEXT NOT NULL DEFAULT '',
  evidence             TEXT NOT NULL DEFAULT '',
  launched_at          TEXT,
  launch_evidence      TEXT,
  protocol_version     TEXT,
  protocol_reviewer_id TEXT REFERENCES people(id),
  scope_json           TEXT,
  event_date           TEXT,
  event_time           TEXT,
  event_minutes        INTEGER,
  event_platform       TEXT,
  speakers             TEXT,
  planning_note        TEXT,
  estimated_hours      REAL NOT NULL DEFAULT 0,
  notes                TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX campaigns_brand ON campaigns(brand_id);

CREATE TABLE campaign_channels (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,
  PRIMARY KEY (campaign_id, channel)
);

CREATE TABLE service_templates (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  steps_json TEXT NOT NULL,
  builtin    INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE jobs (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  brand_id            TEXT NOT NULL REFERENCES brands(id),
  template_id         TEXT REFERENCES service_templates(id),
  template_version    INTEGER,
  steps_snapshot_json TEXT,
  created_by          TEXT REFERENCES people(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ─────────────────────────────── Sprints

CREATE TABLE sprints (
  id                   TEXT PRIMARY KEY,
  brand_id             TEXT NOT NULL REFERENCES brands(id),
  mesa_id              TEXT REFERENCES mesas(id),
  name                 TEXT NOT NULL,
  goal                 TEXT NOT NULL DEFAULT '',
  start_date                TEXT NOT NULL,
  end_date                  TEXT NOT NULL,
  facilitator_id       TEXT REFERENCES people(id),
  status               TEXT NOT NULL DEFAULT 'Planificado' CHECK (status IN ('Planificado','Activo','En revisión','Cerrado')),
  weekly               INTEGER NOT NULL DEFAULT 0,
  goal_result          TEXT CHECK (goal_result IS NULL OR goal_result IN ('Alcanzado','Parcialmente alcanzado','No alcanzado')),
  goal_evidence        TEXT,
  review               TEXT,
  retro                TEXT,
  improvement          TEXT,
  improvement_owner_id TEXT REFERENCES people(id),
  improvement_date     TEXT,
  close_exception_json TEXT,
  baseline_json        TEXT,
  closed_at            TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (start_date <= end_date)
);
CREATE INDEX sprints_brand_status ON sprints(brand_id, status);

CREATE TABLE sprint_members (
  sprint_id   TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES people(id),
  daily_hours REAL NOT NULL DEFAULT 8 CHECK (daily_hours BETWEEN 0 AND 8),
  PRIMARY KEY (sprint_id, person_id)
);

-- ─────────────────────────────── Tareas

CREATE TABLE tasks (
  id                   TEXT PRIMARY KEY,
  brand_id             TEXT NOT NULL REFERENCES brands(id),
  campaign_id          TEXT REFERENCES campaigns(id),
  job_id               TEXT REFERENCES jobs(id),
  plan_id              TEXT REFERENCES strategic_plans(id),
  mesa_id              TEXT REFERENCES mesas(id),
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  deliverable          TEXT NOT NULL DEFAULT '',
  acceptance           TEXT NOT NULL DEFAULT '',
  owner_id             TEXT REFERENCES people(id),
  reviewer_id          TEXT REFERENCES people(id),
  start_date                TEXT NOT NULL,
  due                  TEXT NOT NULL,
  complexity           TEXT NOT NULL DEFAULT 'Media' CHECK (complexity IN ('Baja','Media','Alta')),
  priority             TEXT NOT NULL DEFAULT 'Media' CHECK (priority IN ('Urgente','Alta','Media','Baja')),
  status               TEXT NOT NULL DEFAULT 'Pendiente' CHECK (status IN (
                         'Pendiente','En curso','Entregada para revisión','Ajustes solicitados','Aprobada','Completada')),
  blocked              INTEGER NOT NULL DEFAULT 0,
  block_reason         TEXT NOT NULL DEFAULT '',
  block_resolver_id    TEXT REFERENCES people(id),
  block_due            TEXT,
  estimated_hours      REAL NOT NULL DEFAULT 0 CHECK (estimated_hours >= 0),
  remaining_hours      REAL,
  planned_finish       TEXT,
  inputs_ready         INTEGER NOT NULL DEFAULT 1,
  tool                 TEXT NOT NULL DEFAULT '',
  sprint_id            TEXT REFERENCES sprints(id),
  backlog_rank         INTEGER,
  planning_risk        TEXT NOT NULL DEFAULT '',
  confidential         INTEGER NOT NULL DEFAULT 0,
  approved_by          TEXT REFERENCES people(id),
  approved_at          TEXT,
  reopened_at          TEXT,
  execution_cycle      INTEGER NOT NULL DEFAULT 1,
  exchange_mesa_id     TEXT REFERENCES mesas(id),
  exchange_person_id   TEXT REFERENCES people(id),
  exchange_evidence    TEXT,
  exchange_accepted_at TEXT,
  protocol_version     TEXT,
  protocol_step        INTEGER,
  fixed_event          INTEGER NOT NULL DEFAULT 0,
  air_book             INTEGER NOT NULL DEFAULT 1,
  created_by           TEXT REFERENCES people(id),
  version              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (start_date <= due)
);
CREATE INDEX tasks_brand ON tasks(brand_id);
CREATE INDEX tasks_owner ON tasks(owner_id, status);
CREATE INDEX tasks_reviewer ON tasks(reviewer_id);
CREATE INDEX tasks_campaign ON tasks(campaign_id);
CREATE INDEX tasks_sprint ON tasks(sprint_id);
CREATE INDEX tasks_due ON tasks(due);

CREATE TABLE task_people (
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  role      TEXT NOT NULL CHECK (role IN ('collaborator','approver')),
  PRIMARY KEY (task_id, person_id, role)
);
CREATE INDEX task_people_person ON task_people(person_id);

CREATE TABLE task_dependencies (
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);
CREATE INDEX task_dependencies_rev ON task_dependencies(depends_on_id);

CREATE TABLE task_results (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('text','html','image','pdf')),
  text       TEXT,
  file_key   TEXT,
  filename   TEXT,
  created_by TEXT REFERENCES people(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX task_results_task ON task_results(task_id, created_at);

CREATE TABLE task_comments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES people(id),
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX task_comments_task ON task_comments(task_id, created_at);

-- Eventos de la tarea, incluido el historial de sprint ("Agregada", "Retirada con motivo", ...).
CREATE TABLE task_events (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,
  sprint_id  TEXT REFERENCES sprints(id),
  reason     TEXT,
  status     TEXT,
  actor_id   TEXT REFERENCES people(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX task_events_task ON task_events(task_id, created_at);

-- ─────────────────────────────── Mesa al aire

CREATE TABLE air_series (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name      TEXT NOT NULL DEFAULT 'Pieza',
  channel   TEXT NOT NULL,
  mode      TEXT NOT NULL CHECK (mode IN ('dias','periodo')),
  days      TEXT NOT NULL DEFAULT '',
  time      TEXT NOT NULL DEFAULT '10:00',
  from_date TEXT NOT NULL,
  weeks     INTEGER NOT NULL CHECK (weeks BETWEEN 1 AND 52),
  count     INTEGER CHECK (count IS NULL OR count BETWEEN 1 AND 50),
  hours     REAL NOT NULL DEFAULT 0 CHECK (hours >= 0)
);

CREATE TABLE air_slots (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  series_id         TEXT REFERENCES air_series(id) ON DELETE SET NULL,
  channel           TEXT NOT NULL,
  piece             TEXT NOT NULL DEFAULT '',
  at                TEXT NOT NULL,
  end_date          TEXT,
  status            TEXT NOT NULL DEFAULT 'Programada' CHECK (status IN ('Programada','Al aire')),
  published_at      TEXT,
  url               TEXT,
  published_by      TEXT REFERENCES people(id),
  auto              INTEGER NOT NULL DEFAULT 0,
  risk_notified_at  TEXT,
  brevo_campaign_id TEXT
);
CREATE INDEX air_slots_at ON air_slots(status, at);
CREATE INDEX air_slots_task ON air_slots(task_id);

-- ─────────────────────────────── Agenda

CREATE TABLE meetings (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people(id),
  title       TEXT NOT NULL,
  starts_at       TEXT NOT NULL,
  ends_at         TEXT NOT NULL,
  campaign_id TEXT REFERENCES campaigns(id),
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','google')),
  external_id TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (starts_at < ends_at)
);
CREATE INDEX meetings_person ON meetings(person_id, starts_at);
CREATE UNIQUE INDEX meetings_external ON meetings(person_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE work_plans (
  task_id   TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  starts_at     TEXT NOT NULL,
  hours     REAL NOT NULL CHECK (hours > 0),
  week      TEXT,
  weekly    INTEGER NOT NULL DEFAULT 0,
  late      INTEGER NOT NULL DEFAULT 0,
  finish    TEXT
);
CREATE INDEX work_plans_person ON work_plans(person_id);

CREATE TABLE work_blocks (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL REFERENCES work_plans(task_id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  starts_at     TEXT NOT NULL,
  ends_at       TEXT NOT NULL,
  CHECK (starts_at < ends_at)
);
CREATE INDEX work_blocks_person ON work_blocks(person_id, starts_at);

CREATE TABLE plan_changes (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  old_finish    TEXT,
  new_finish    TEXT,
  delay_minutes INTEGER,
  cause         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE calendar_links (
  person_id    TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  calendar_id  TEXT,
  status       TEXT NOT NULL DEFAULT 'Sin conexión Google',
  token_ref    TEXT,
  sync_cursor  TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ─────────────────────────────── Sprints: detalle

CREATE TABLE sprint_daily (
  id            TEXT PRIMARY KEY,
  sprint_id     TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  task_id       TEXT REFERENCES tasks(id),
  person_id     TEXT REFERENCES people(id),
  day           TEXT NOT NULL,
  progress      TEXT NOT NULL DEFAULT '',
  next          TEXT NOT NULL DEFAULT '',
  block         TEXT NOT NULL DEFAULT '',
  resolver_id   TEXT REFERENCES people(id),
  required_date TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sprint_changes (
  id         TEXT PRIMARY KEY,
  sprint_id  TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  actor_id   TEXT REFERENCES people(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sprint_closed_records (
  sprint_id TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  task_id   TEXT NOT NULL REFERENCES tasks(id),
  title     TEXT NOT NULL,
  status    TEXT NOT NULL,
  approved  INTEGER NOT NULL DEFAULT 0,
  evidence  TEXT,
  PRIMARY KEY (sprint_id, task_id)
);

-- ─────────────────────────────── Estrategia: detalle y mandantes

CREATE TABLE plan_metrics (
  id        TEXT PRIMARY KEY,
  plan_id   TEXT NOT NULL REFERENCES strategic_plans(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL CHECK (kind IN ('KPI','Resultado clave OKR')),
  objective TEXT NOT NULL DEFAULT '',
  name      TEXT NOT NULL,
  baseline  TEXT NOT NULL DEFAULT '',
  target    TEXT NOT NULL DEFAULT '',
  current   TEXT NOT NULL DEFAULT '',
  unit      TEXT NOT NULL DEFAULT '',
  source    TEXT NOT NULL DEFAULT '',
  as_of     TEXT,
  direction TEXT NOT NULL DEFAULT 'Subir' CHECK (direction IN ('Subir','Bajar')),
  CHECK (current = '' OR source <> '')
);

CREATE TABLE plan_initiatives (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES strategic_plans(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN (
                'Campaña 360','Webinar','Contenido continuo','Sitio web','Plataforma','Presentación','Otra iniciativa')),
  campaign_id TEXT REFERENCES campaigns(id),
  start_date       TEXT NOT NULL,
  end_date         TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'Planificada' CHECK (status IN (
                'Planificada','En preparación','Activa','Finalizada','Pausada')),
  evidence    TEXT,
  CHECK (start_date <= end_date)
);

CREATE TABLE plan_reports (
  id                TEXT PRIMARY KEY,
  plan_id           TEXT NOT NULL REFERENCES strategic_plans(id) ON DELETE CASCADE,
  sprint_id         TEXT NOT NULL REFERENCES sprints(id),
  name              TEXT NOT NULL,
  start_date             TEXT,
  end_date               TEXT,
  total             INTEGER NOT NULL DEFAULT 0,
  done              INTEGER NOT NULL DEFAULT 0,
  summary           TEXT NOT NULL DEFAULT '',
  next              TEXT NOT NULL DEFAULT '',
  exception         TEXT,
  metrics_snapshot  TEXT,
  approved          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (plan_id, sprint_id)
);

CREATE TABLE public_snapshots (
  plan_id      TEXT PRIMARY KEY REFERENCES strategic_plans(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  published_by TEXT REFERENCES people(id)
);

-- ─────────────────────────────── Comunidad

CREATE TABLE achievements (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL CHECK (type IN (
               'Tarea aceptada','Día cumplido','Sprint completo','Objetivo del sprint alcanzado',
               'Lanzamiento verificado','Entrega entre áreas')),
  source     TEXT NOT NULL CHECK (source IN ('task','day','sprint','campaign','exchange')),
  source_id  TEXT,
  title      TEXT NOT NULL,
  brand_id   TEXT REFERENCES brands(id),
  mesa_id    TEXT REFERENCES mesas(id),
  sprint_id  TEXT REFERENCES sprints(id),
  grp        TEXT,
  day        TEXT,
  valid      INTEGER NOT NULL DEFAULT 1,
  restricted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX achievements_created ON achievements(created_at);

CREATE TABLE achievement_people (
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  person_id      TEXT NOT NULL REFERENCES people(id),
  PRIMARY KEY (achievement_id, person_id)
);

CREATE TABLE achievement_tasks (
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (achievement_id, task_id)
);

CREATE TABLE achievement_history (
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  at             TEXT NOT NULL,
  valid          INTEGER NOT NULL
);

CREATE TABLE reactions (
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  person_id      TEXT NOT NULL REFERENCES people(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (achievement_id, person_id)
);

CREATE TABLE achievement_comments (
  id             TEXT PRIMARY KEY,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  person_id      TEXT REFERENCES people(id),
  text           TEXT NOT NULL CHECK (length(text) <= 1000),
  mention_id     TEXT REFERENCES people(id),
  removed        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE achievement_reports (
  id             TEXT PRIMARY KEY,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  by_id          TEXT REFERENCES people(id),
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'Pendiente' CHECK (status IN ('Pendiente','Resuelto')),
  resolution     TEXT,
  resolved_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE mentions (
  id             TEXT PRIMARY KEY,
  person_id      TEXT NOT NULL REFERENCES people(id),
  achievement_id TEXT REFERENCES achievements(id) ON DELETE CASCADE,
  from_id        TEXT REFERENCES people(id),
  read_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX mentions_person ON mentions(person_id, read_at);

CREATE TABLE commitments (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id),
  day        TEXT NOT NULL,
  end_time   TEXT NOT NULL DEFAULT '18:00',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (person_id, day)
);

CREATE TABLE commitment_tasks (
  commitment_id TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  baseline      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (commitment_id, task_id)
);

CREATE TABLE commitment_changes (
  id            TEXT PRIMARY KEY,
  commitment_id TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  tasks_json    TEXT NOT NULL,
  reason        TEXT NOT NULL,
  by_id         TEXT REFERENCES people(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Confeti del Momento WOW: una vez por persona y hito.
CREATE TABLE wow_seen (
  person_id      TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  seen_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (person_id, achievement_id)
);

-- ─────────────────────────────── Bases y segmentos (datos personales de contactos)

CREATE TABLE contact_bases (
  id         TEXT PRIMARY KEY,
  brand_id   TEXT NOT NULL REFERENCES brands(id),
  filename   TEXT NOT NULL,
  stats_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT REFERENCES people(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE contact_rows (
  id       TEXT PRIMARY KEY,
  base_id  TEXT NOT NULL REFERENCES contact_bases(id) ON DELETE CASCADE,
  email    TEXT NOT NULL COLLATE NOCASE,
  name     TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  interest TEXT NOT NULL DEFAULT '',
  status   TEXT NOT NULL CHECK (status IN ('Inválido','Baja','Duplicado','Pendiente de respaldo','Habilitado'))
);
CREATE INDEX contact_rows_base ON contact_rows(base_id, status);
CREATE INDEX contact_rows_email ON contact_rows(email);

CREATE TABLE segments (
  id         TEXT PRIMARY KEY,
  brand_id   TEXT NOT NULL REFERENCES brands(id),
  base_id    TEXT NOT NULL REFERENCES contact_bases(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  location   TEXT NOT NULL DEFAULT '',
  interest   TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Supresiones adicionales (bajas informadas por Brevo).
CREATE TABLE suppressions (
  brand_id   TEXT NOT NULL REFERENCES brands(id),
  email      TEXT NOT NULL COLLATE NOCASE,
  source     TEXT NOT NULL DEFAULT 'csv',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (brand_id, email)
);

-- ─────────────────────────────── Avisos e integraciones

CREATE TABLE outbox (
  id          TEXT PRIMARY KEY,
  dedupe_key  TEXT NOT NULL UNIQUE,
  event_id    TEXT,
  person_id   TEXT REFERENCES people(id),
  channel     TEXT NOT NULL CHECK (channel IN ('app','push','email','whatsapp')),
  event       TEXT NOT NULL,
  task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN (
                'pendiente','encolado','enviado','entregado','rebotado','fallido','cancelado')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at     TEXT
);
CREATE INDEX outbox_status ON outbox(status, created_at);
CREATE INDEX outbox_person ON outbox(person_id, created_at);

CREATE TABLE alerts (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  type       TEXT NOT NULL,
  tone       TEXT NOT NULL DEFAULT 'purple',
  task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  target     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at    TEXT,
  UNIQUE (person_id, key)
);
CREATE INDEX alerts_unread ON alerts(person_id, read_at, created_at);

CREATE TABLE email_events (
  id          TEXT PRIMARY KEY,
  provider_id TEXT,
  event       TEXT NOT NULL,
  email       TEXT,
  payload     TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  keys_json  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE platform_cards (
  name     TEXT PRIMARY KEY,
  account  TEXT NOT NULL DEFAULT '',
  url      TEXT NOT NULL DEFAULT '',
  owner_id TEXT REFERENCES people(id)
);

CREATE TABLE channel_cards (
  channel  TEXT PRIMARY KEY CHECK (channel IN ('Correo','WhatsApp')),
  provider TEXT NOT NULL DEFAULT '',
  account  TEXT NOT NULL DEFAULT '',
  owner_id TEXT REFERENCES people(id),
  template TEXT NOT NULL DEFAULT ''
);

-- Auditoría: reemplaza `history` del prototipo y alimenta la actividad del Inicio.
CREATE TABLE audit_log (
  id        TEXT PRIMARY KEY,
  at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_id  TEXT REFERENCES people(id),
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  details   TEXT
);
CREATE INDEX audit_log_at ON audit_log(at);
CREATE INDEX audit_log_entity ON audit_log(entity, entity_id);

CREATE TABLE import_runs (
  id         TEXT PRIMARY KEY,
  source     TEXT NOT NULL,
  summary    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
