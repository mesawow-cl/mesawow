// Importador del respaldo del prototipo (respaldo_mesa.json) → SQL para D1 + archivos para R2.
// Reglas (docs/requerimiento-mesawow.md §8.4):
//   * Descarta contraseñas (passwordHash, salt) y sesiones.
//   * Convierte nombres de persona en IDs; informa lo que no pudo resolver.
//   * Archivos "data:" (resultados, fotos) y HTML de campañas → R2.
//   * Idempotente: IDs de origen conservados o derivados de forma determinista; UPSERT.
// Es código puro (sin Node ni Workers): lo usan el script de línea de comandos y las pruebas.
import { ESTADOS_MINIMO, ESTADOS_TAREA, MESAS_POR_DEFECTO, MINIMOS_DE_MARCA } from '../shared/constantes.ts';
import { minutoDeParedAIso, santiagoAUtc } from '../shared/fechas.ts';
import { ROLES, type Rol } from '../shared/roles.ts';

type Obj = Record<string, any>;

export interface ArchivoImportado { clave: string; tipo: string; base64?: string; texto?: string }

export interface Informe {
  filas: Record<string, number>;
  advertencias: string[];
  descartado: Record<string, number>;
}

export interface ResultadoImportacion { sql: string[]; archivos: ArchivoImportado[]; informe: Informe }

// ─────────────────────────────── utilidades

const q = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};

export const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const texto = (v: unknown, def = '') => (v === null || v === undefined ? def : String(v));
const num = (v: unknown): number | null => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const bool = (v: unknown) => (v ? 1 : 0);
const lista = <T = any>(v: unknown): T[] => (Array.isArray(v) ? v : []);
const fecha = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const pared = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16) : null);
const instante = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) return santiagoAUtc(v.replace(' ', 'T'));
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const de = <T extends string>(v: unknown, permitidos: readonly T[], def: T): T =>
  (permitidos as readonly string[]).includes(v as string) ? (v as T) : def;

const ALIAS_AREA: Record<string, string> = {
  'comercial': 'Comercial y Ventas',
  'ti y desarrollo': 'TI',
  'operación': 'Operaciones',
  'diseño': 'Marketing',
};

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf', 'text/html': 'html', 'text/plain': 'txt',
};

// ─────────────────────────────── importador

export const importarRespaldo = (respaldo: unknown, opciones: { ahora: string }): ResultadoImportacion => {
  if (!respaldo || typeof respaldo !== 'object') throw new Error('El archivo no es un respaldo de mesawow.');
  const s = respaldo as Obj;
  if (!Array.isArray(s.tasks) || !Array.isArray(s.brands)) throw new Error('El respaldo no tiene tareas ni marcas: no parece de mesawow.');

  const sql: string[] = ['PRAGMA defer_foreign_keys = true;'];
  const archivos: ArchivoImportado[] = [];
  const informe: Informe = { filas: {}, advertencias: [], descartado: {} };
  const avisar = (m: string) => informe.advertencias.push(m);
  const descartar = (k: string, n: number) => { if (n) informe.descartado[k] = (informe.descartado[k] ?? 0) + n; };

  const upsert = (tabla: string, fila: Obj, clave: string[] = ['id']) => {
    const cols = Object.keys(fila);
    const set = cols.filter((c) => !clave.includes(c)).map((c) => `${c} = excluded.${c}`);
    sql.push(`INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map((c) => q(fila[c])).join(', ')})`
      + (set.length ? ` ON CONFLICT(${clave.join(', ')}) DO UPDATE SET ${set.join(', ')};` : ' ON CONFLICT DO NOTHING;'));
    informe.filas[tabla] = (informe.filas[tabla] ?? 0) + 1;
  };

  const guardarDataUrl = (dataUrl: string, base: string): string | null => {
    const m = /^data:([\w/+.-]+)(;base64)?,(.*)$/s.exec(dataUrl);
    if (!m) return null;
    const tipo = m[1]!;
    const clave = `importado/${base}.${EXT[tipo] ?? 'bin'}`;
    archivos.push(m[2] ? { clave, tipo, base64: m[3]! } : { clave, tipo, texto: decodeURIComponent(m[3]!) });
    return clave;
  };
  const guardarTexto = (contenido: string, base: string, tipo: string) => {
    const clave = `importado/${base}.${EXT[tipo] ?? 'txt'}`;
    archivos.push({ clave, tipo, texto: contenido });
    return clave;
  };

  // ── Mesas: las del prototipo se unen por nombre con las mesas base.
  const mesaPorNombre = new Map<string, string>();
  const idMesa = (nombre: string) => `mesa-${slug(nombre)}`;
  for (const n of MESAS_POR_DEFECTO) mesaPorNombre.set(n.toLowerCase(), idMesa(n));
  const mesaProtoAId = new Map<string, string>();
  for (const m of lista(s.mesas)) {
    const nombre = texto(m.name).trim();
    if (!nombre) continue;
    const id = mesaPorNombre.get(nombre.toLowerCase()) ?? idMesa(nombre);
    mesaPorNombre.set(nombre.toLowerCase(), id);
    if (m.id) mesaProtoAId.set(String(m.id), id);
  }
  const resolverMesa = (area: unknown): string | null => {
    if (!area) return null;
    const a = String(area).trim();
    const n = (ALIAS_AREA[a.toLowerCase()] ?? a).toLowerCase();
    if (mesaPorNombre.has(n)) return mesaPorNombre.get(n)!;
    if (mesaProtoAId.has(a)) return mesaProtoAId.get(a)!;
    avisar(`Área sin mesa equivalente: "${a}" (queda sin mesa).`);
    return null;
  };

  // ── Personas (activas y archivadas). Nombres → IDs.
  const personas = [...lista(s.people), ...lista(s.archivedPeople)];
  const porNombre = new Map<string, string>();
  const porId = new Set<string>();
  const nombresUsados = new Set<string>();
  const correosUsados = new Set<string>();
  const filasPersona: Obj[] = [];
  const personaMarca: [string, string][] = [];
  let adminAsignado = false;
  let contrasenas = 0;
  for (const p of personas) {
    const id = texto(p.id) || `imp-p-${slug(texto(p.name, 'persona'))}`;
    if (porId.has(id)) continue;
    if (p.passwordHash || p.salt) contrasenas++;
    let nombre = texto(p.name).trim() || 'Sin nombre';
    if (nombresUsados.has(nombre.toLowerCase())) { avisar(`Nombre repetido "${nombre}": se agrega el ID para distinguirlo.`); nombre = `${nombre} (${id})`; }
    let correo = texto(p.email).trim().toLowerCase();
    if (!correo || correosUsados.has(correo)) {
      if (correo) avisar(`Correo repetido ${correo} en "${nombre}".`);
      else avisar(`"${nombre}" no tiene correo: se asigna uno provisorio que debe corregirse antes de dar acceso.`);
      correo = `sin-correo+${slug(id)}@importado.invalid`;
    }
    let rol = de<Rol>(p.role, ROLES, 'Ejecutor');
    if (p.role && rol !== p.role) avisar(`Rol desconocido "${p.role}" en "${nombre}": queda como Ejecutor.`);
    const activo = p.active !== false && !p.referenceOnly && !p.departed;
    if (rol === 'Administrador general') {
      const esElAdmin = activo && !adminAsignado && (!s.generalAdminId || s.generalAdminId === id);
      if (esElAdmin) adminAsignado = true;
      else { rol = 'Coordinación de Marketing'; avisar(`"${nombre}" figuraba como Administrador general; queda en Coordinación de Marketing (solo puede haber uno activo).`); }
    }
    const telefono = /^\+[1-9][0-9]{7,14}$/.test(texto(p.phone)) ? texto(p.phone) : null;
    const perfil = s.social?.profiles?.[id] ?? {};
    const foto = typeof perfil.photo === 'string' && perfil.photo.startsWith('data:') ? guardarDataUrl(perfil.photo, `fotos/${slug(id)}`) : null;
    nombresUsados.add(nombre.toLowerCase());
    correosUsados.add(correo);
    porId.add(id);
    porNombre.set(texto(p.name).trim().toLowerCase(), id);
    filasPersona.push({
      id, name: nombre, email: correo, phone: telefono, role: rol, mesa_id: resolverMesa(p.area),
      active: bool(activo), departed: bool(p.departed), departure_note: p.departureNote ?? null,
      bio: texto(perfil.bio).slice(0, 300), photo_key: foto,
    });
    for (const b of lista<string>(p.brands)) personaMarca.push([id, b]);
  }
  descartar('contraseñas y sesiones locales', contrasenas);

  /** Persona por ID o por nombre (el prototipo usa ambos). */
  const persona = (v: unknown, contexto: string): string | null => {
    if (v === null || v === undefined || v === '') return null;
    const k = String(v).trim();
    if (porId.has(k)) return k;
    const id = porNombre.get(k.toLowerCase());
    if (id) return id;
    avisar(`Persona no encontrada "${k}" (${contexto}).`);
    return null;
  };

  for (const f of filasPersona) upsert('people', f);
  for (const m of lista(s.mesas)) {
    const nombre = texto(m.name).trim();
    if (!nombre) continue;
    upsert('mesas', {
      id: mesaPorNombre.get(nombre.toLowerCase()), name: nombre.slice(0, 70), active: bool(m.active !== false),
      owner_id: persona(m.owner, `encargado de la mesa ${nombre}`), description: texto(m.description).slice(0, 300),
    });
  }

  // ── Marcas, mínimos y roles de equipo.
  const marcas = new Set<string>();
  for (const b of lista(s.brands)) {
    if (!b.id) continue;
    marcas.add(b.id);
    upsert('brands', {
      id: b.id, name: texto(b.name).slice(0, 80), color: /^#[0-9a-f]{6}$/i.test(texto(b.color)) ? b.color : '#F22E62',
      description: texto(b.description), director_id: persona(b.director, `director de ${b.name}`), archived: bool(b.archived),
    });
    lista(b.minimums).forEach((m: Obj, i: number) => {
      const idx = MINIMOS_DE_MARCA.indexOf(m.title);
      upsert('brand_minimums', {
        brand_id: b.id, idx: idx >= 0 ? idx : i, title: texto(m.title), state: de(m.state, ESTADOS_MINIMO, 'Pendiente de verificar'), note: texto(m.note),
      }, ['brand_id', 'idx']);
    });
    for (const [clave, nombre] of Object.entries<any>(b.teamRoles ?? {})) {
      upsert('brand_team_roles', { brand_id: b.id, role_key: clave, person_id: porNombre.get(String(nombre).toLowerCase()) ?? null, label: String(nombre) }, ['brand_id', 'role_key']);
    }
  }
  for (const [p, b] of personaMarca) {
    if (marcas.has(b)) upsert('person_brands', { person_id: p, brand_id: b }, ['person_id', 'brand_id']);
  }

  // ── Bases y segmentos (antes que campañas: campaigns.segment_id).
  const basesImportadas = new Set<string>();
  for (const base of lista(s.bases)) {
    if (!base.id || !marcas.has(base.brand)) continue;
    basesImportadas.add(base.id);
    upsert('contact_bases', { id: base.id, brand_id: base.brand, filename: texto(base.name, 'base.csv'), stats_json: JSON.stringify(base.stats ?? {}), created_at: instante(base.created) ?? opciones.ahora });
    lista(base.rows).forEach((r: Obj, i: number) => upsert('contact_rows', {
      id: `${base.id}-r${i}`, base_id: base.id, email: texto(r.email), name: texto(r.name), location: texto(r.location), interest: texto(r.interest),
      status: de(r.status, ['Inválido', 'Baja', 'Duplicado', 'Pendiente de respaldo', 'Habilitado'] as const, 'Pendiente de respaldo'),
    }));
  }
  const segmentos = new Set<string>();
  for (const g of lista(s.segments)) {
    if (!g.id || !marcas.has(g.brand) || !basesImportadas.has(g.base)) continue;
    segmentos.add(g.id);
    upsert('segments', { id: g.id, brand_id: g.brand, base_id: g.base, name: texto(g.name), location: texto(g.location), interest: texto(g.interest), created_at: instante(g.created) ?? opciones.ahora });
  }

  // ── Planes estratégicos (antes que campañas y tareas).
  const planes = new Set<string>();
  for (const p of lista(s.strategicPlans)) {
    if (!p.id || !marcas.has(p.brand)) continue;
    if (!fecha(p.start) || !fecha(p.end)) { avisar(`Plan "${p.name}" sin fechas: no se importa.`); continue; }
    planes.add(p.id);
    upsert('strategic_plans', {
      id: p.id, brand_id: p.brand, name: texto(p.name), start_date: fecha(p.start), end_date: fecha(p.end),
      objective: texto(p.objective), audience: texto(p.audience), budget: num(p.budget), diagnosis: texto(p.diagnosis), notes: texto(p.notes),
    });
  }

  // ── Campañas.
  const campanas = new Set<string>();
  for (const c of lista(s.campaigns)) {
    if (!c.id || !marcas.has(c.brand)) continue;
    campanas.add(c.id);
    upsert('campaigns', {
      id: c.id, brand_id: c.brand, type: de(c.type, ['email', '360', 'webinar', 'otra'] as const, 'email'), name: texto(c.name),
      objective: texto(c.objective), metric: texto(c.metric), target: texto(c.target), budget: num(c.budget), audience: texto(c.audience),
      platform: texto(c.platform), segment_text: texto(c.segment), segment_id: segmentos.has(c.segmentId) ? c.segmentId : null,
      subject: texto(c.subject), preheader: texto(c.preheader), sender: texto(c.sender), reply_to: texto(c.reply), cta: texto(c.cta), url: texto(c.url),
      html_key: c.html ? guardarTexto(String(c.html), `campanas/${slug(c.id)}`, 'text/html') : null,
      account: texto(c.account), utm_source: texto(c.utmSource), utm_campaign: texto(c.utmCampaign),
      start_date: fecha(c.start), end_date: fecha(c.end), live_start: fecha(c.liveStart), live_end: fecha(c.liveEnd),
      sched_date: fecha(c.date), sched_time: texto(c.time, '10:00'),
      status: de(c.status, ['Borrador', 'En revisión', 'Ajustes solicitados', 'Aprobada', 'Calendarizada', 'Programada en el canal'] as const, 'Borrador'),
      version: num(c.version) ?? 1, approved_version: num(c.approvedVersion), approved_at: instante(c.approvedAt), review_comment: texto(c.reviewComment),
      external_id: texto(c.externalId ?? c.external), evidence: texto(c.evidence), launched_at: fecha(c.launchedAt), launch_evidence: c.launchEvidence ?? null,
      protocol_version: c.protocolVersion ?? null, protocol_reviewer_id: persona(c.protocolReviewer, `revisor de la campaña ${c.name}`),
      scope_json: c.scope ? JSON.stringify(c.scope) : null, event_date: fecha(c.eventDate), event_time: c.eventTime ?? null,
      event_minutes: num(c.eventMinutes), event_platform: c.eventPlatform ?? null, speakers: c.speakers ?? null, planning_note: c.planningNote ?? null,
      estimated_hours: num(c.estimatedHours) ?? 0, notes: texto(c.notes),
    });
    for (const canal of new Set(lista<string>(c.channels))) upsert('campaign_channels', { campaign_id: c.id, channel: canal }, ['campaign_id', 'channel']);
  }
  for (const p of lista(s.strategicPlans)) {
    if (!planes.has(p.id)) continue;
    for (const cid of lista<string>(p.campaignIds)) if (campanas.has(cid)) sql.push(`UPDATE campaigns SET plan_id = ${q(p.id)} WHERE id = ${q(cid)};`);
  }

  // ── Plantillas personalizadas y trabajos.
  const plantillas = new Set<string>();
  for (const t of lista(s.customTemplates)) {
    if (!t.id) continue;
    plantillas.add(t.id);
    upsert('service_templates', { id: t.id, key: 'personalizado', name: texto(t.name), version: num(t.version) ?? 1, steps_json: JSON.stringify(lista(t.steps)), builtin: 0, archived: bool(t.archived) });
  }
  const trabajos = new Set<string>();
  for (const j of lista(s.jobs)) {
    if (!j.id || !marcas.has(j.brand)) continue;
    trabajos.add(j.id);
    const plantilla = plantillas.has(j.service) ? j.service : j.service && j.service !== 'custom' ? `servicio-${j.service}` : null;
    upsert('jobs', { id: j.id, title: texto(j.title), brand_id: j.brand, template_id: plantilla, template_version: num(j.protocolVersion), steps_snapshot_json: j.protocolSnapshot ? JSON.stringify(j.protocolSnapshot) : null, created_at: instante(j.created) ?? opciones.ahora });
  }

  // ── Sprints.
  const sprints = new Set<string>();
  for (const sp of lista(s.scrum?.sprints)) {
    if (!sp.id || !marcas.has(sp.brand) || !fecha(sp.start) || !fecha(sp.end)) continue;
    sprints.add(sp.id);
    upsert('sprints', {
      id: sp.id, brand_id: sp.brand, mesa_id: resolverMesa(sp.mesa), name: texto(sp.name), goal: texto(sp.goal), start_date: fecha(sp.start), end_date: fecha(sp.end),
      facilitator_id: persona(sp.facilitator, `facilitador del sprint ${sp.name}`),
      status: de(sp.status, ['Planificado', 'Activo', 'En revisión', 'Cerrado'] as const, 'Planificado'), weekly: bool(sp.weekly),
      goal_result: sp.goalResult ? de(sp.goalResult, ['Alcanzado', 'Parcialmente alcanzado', 'No alcanzado'] as const, 'Parcialmente alcanzado') : null,
      goal_evidence: sp.goalEvidence ?? null, review: sp.review ?? null, retro: sp.retro ?? null, improvement: sp.improvement ?? null,
      improvement_owner_id: persona(sp.improvementOwner, 'responsable de la mejora'), improvement_date: fecha(sp.improvementDate),
      close_exception_json: sp.closeException ? JSON.stringify(sp.closeException) : sp.weeklyException ? JSON.stringify({ cause: sp.weeklyException }) : null,
      baseline_json: sp.baseline ? JSON.stringify(sp.baseline) : null, closed_at: instante(sp.closedAt),
    });
    for (const nombre of new Set(lista<string>(sp.members))) {
      const pid = persona(nombre, `miembro del sprint ${sp.name}`);
      if (pid) upsert('sprint_members', { sprint_id: sp.id, person_id: pid, daily_hours: Math.min(8, Math.max(0, num(sp.dailyHours?.[nombre]) ?? 8)) }, ['sprint_id', 'person_id']);
    }
    lista(sp.changes).forEach((ch: Obj, i: number) => upsert('sprint_changes', {
      id: `${sp.id}-c${i}`, sprint_id: sp.id, action: texto(ch.action), reason: texto(ch.reason), actor_id: persona(ch.by, 'cambio de sprint'), created_at: instante(ch.at) ?? opciones.ahora,
    }));
  }

  // ── Tareas.
  const tareas = new Map<string, Obj>();
  for (const t of lista(s.tasks)) if (t.id && marcas.has(t.brand)) tareas.set(t.id, t);
  for (const t of lista(s.tasks)) if (t.id && !marcas.has(t.brand)) avisar(`Tarea "${t.title}" sin marca válida: no se importa.`);
  let sinCriterio = 0;
  for (const t of tareas.values()) {
    let inicio = fecha(t.start) ?? fecha(t.due) ?? opciones.ahora.slice(0, 10);
    const plazo = fecha(t.due) ?? inicio;
    if (inicio > plazo) { avisar(`Tarea "${t.title}": inicio después del plazo; se iguala al plazo.`); inicio = plazo; }
    if (!texto(t.acceptance).trim()) sinCriterio++;
    upsert('tasks', {
      id: t.id, brand_id: t.brand, campaign_id: campanas.has(t.campaign) ? t.campaign : null, job_id: trabajos.has(t.job) ? t.job : null,
      plan_id: planes.has(t.planId) ? t.planId : null, mesa_id: resolverMesa(t.area),
      title: texto(t.title), description: texto(t.description), deliverable: texto(t.deliverable), acceptance: texto(t.acceptance),
      owner_id: persona(t.owner, `responsable de "${t.title}"`), reviewer_id: persona(t.reviewer, `revisor de "${t.title}"`),
      start_date: inicio, due: plazo,
      complexity: de(t.complexity, ['Baja', 'Media', 'Alta'] as const, 'Media'), priority: de(t.priority, ['Urgente', 'Alta', 'Media', 'Baja'] as const, 'Media'),
      status: de(t.status, ESTADOS_TAREA, 'Pendiente'), blocked: bool(t.blocked), block_reason: texto(t.reason),
      block_resolver_id: persona(t.blockResolver, 'quien resuelve el bloqueo'), block_due: fecha(t.blockDue),
      estimated_hours: Math.max(0, num(t.estimatedHours) ?? 0), remaining_hours: num(t.remainingHours), planned_finish: pared(t.plannedFinish),
      inputs_ready: bool(t.inputsReady !== false), tool: texto(t.tool), sprint_id: sprints.has(t.sprintId) ? t.sprintId : null,
      backlog_rank: num(t.backlogRank), planning_risk: texto(t.planningRisk), confidential: bool(t.confidential),
      approved_by: persona(t.approvedBy, 'aprobación'), approved_at: instante(t.approvedAt), reopened_at: instante(t.reopenedAt),
      execution_cycle: num(t.executionCycle) ?? 1, exchange_evidence: t.exchangeEvidence ?? null, exchange_accepted_at: instante(t.exchangeAcceptedAt),
      protocol_version: t.protocolVersion ?? null, protocol_step: num(t.protocolStep ?? t.webinarStep), fixed_event: bool(t.fixedEvent),
      air_book: bool(t.airBook !== false),
    });
  }
  if (sinCriterio) avisar(`${sinCriterio} tarea(s) sin criterio de aceptación: deberán completarlo antes de aprobarse.`);

  for (const t of tareas.values()) {
    for (const [campo, rol] of [['collaborators', 'collaborator'], ['approvers', 'approver']] as const) {
      for (const n of new Set(lista(t[campo]))) {
        const pid = persona(n, `${rol === 'approver' ? 'aprobador' : 'colaborador'} de "${t.title}"`);
        if (pid) upsert('task_people', { task_id: t.id, person_id: pid, role: rol }, ['task_id', 'person_id', 'role']);
      }
    }
    const deps = new Set<string>([...lista<string>(t.dependencies), ...(t.depends ? [t.depends] : [])]);
    for (const d of deps) {
      if (d === t.id) continue;
      if (tareas.has(d)) upsert('task_dependencies', { task_id: t.id, depends_on_id: d }, ['task_id', 'depends_on_id']);
      else avisar(`Dependencia inexistente en "${t.title}": ${d}.`);
    }
    // Resultado: texto y/o contenido adjunto.
    if (texto(t.result).trim()) upsert('task_results', { id: `${t.id}-resultado`, task_id: t.id, type: 'text', text: texto(t.result) });
    if (t.resultContent) {
      const tipo = de(t.resultType, ['text', 'html', 'image', 'pdf'] as const, 'text');
      const contenido = String(t.resultContent);
      const clave = contenido.startsWith('data:')
        ? guardarDataUrl(contenido, `resultados/${slug(t.id)}`)
        : tipo === 'html' ? guardarTexto(contenido, `resultados/${slug(t.id)}`, 'text/html') : null;
      upsert('task_results', {
        id: `${t.id}-adjunto`, task_id: t.id, type: tipo, text: clave ? null : contenido, file_key: clave, filename: t.resultFilename ?? null,
      });
    }
    lista(t.comments).forEach((c: Obj, i: number) => upsert('task_comments', {
      id: texto(c.id) || `${t.id}-com${i}`, task_id: t.id, author_id: persona(c.author, `comentario en "${t.title}"`), text: texto(c.text), created_at: instante(c.at) ?? opciones.ahora,
    }));
    lista(t.sprintHistory).forEach((h: Obj, i: number) => upsert('task_events', {
      id: `${t.id}-ev${i}`, task_id: t.id, event: texto(h.event), sprint_id: sprints.has(h.sprint) ? h.sprint : null,
      reason: h.reason ?? null, status: h.status ?? null, actor_id: persona(h.by ?? h.user, 'historial de sprint'), created_at: instante(h.at) ?? opciones.ahora,
    }));
    // Al aire: series (objeto antiguo → lista) y piezas.
    const series = Array.isArray(t.airSeries) ? t.airSeries : t.airSeries ? [{ ...t.airSeries, mode: 'dias' }] : [];
    const seriesImportadas: Obj[] = [];
    series.forEach((se: Obj, i: number) => {
      const id = texto(se.id) || `${t.id}-serie${i}`;
      const desde = fecha(se.from);
      if (!desde) { avisar(`Serie sin fecha de inicio en "${t.title}": no se importa.`); return; }
      const fila = {
        id, task_id: t.id, name: texto(se.name) || 'Pieza', channel: texto(se.channel), mode: de(se.mode, ['dias', 'periodo'] as const, 'dias'),
        days: lista(se.days).join(','), time: texto(se.time, '10:00'), from_date: desde, weeks: Math.min(52, Math.max(1, num(se.weeks) ?? 1)),
        count: se.mode === 'periodo' ? Math.min(50, Math.max(1, num(se.count) ?? 3)) : null, hours: Math.max(0, num(se.hours) ?? 0),
      };
      seriesImportadas.push(fila);
      upsert('air_series', fila);
    });
    lista(t.air).forEach((a: Obj, i: number) => {
      const at = pared(a.at);
      if (!at) { avisar(`Pieza sin fecha en "${t.title}": no se importa.`); return; }
      // Una pieza de serie se asocia a la serie del mismo canal cuyo nombre es prefijo de la pieza.
      const serie = a.series ? seriesImportadas.find((x) => x.channel === a.channel && texto(a.piece).startsWith(x.name)) : undefined;
      upsert('air_slots', {
        id: texto(a.id) || `${t.id}-pieza${i}`, task_id: t.id, series_id: serie?.id ?? null, channel: texto(a.channel), piece: texto(a.piece), at,
        end_date: fecha(a.end), status: a.status === 'Al aire' ? 'Al aire' : 'Programada', published_at: instante(a.publishedAt), url: a.url ?? null,
        published_by: persona(a.by, 'publicación al aire'), auto: bool(a.auto), risk_notified_at: a.riskNotified ? opciones.ahora : null,
      });
    });
  }

  // Detalle de sprints que depende de tareas.
  for (const sp of lista(s.scrum?.sprints)) {
    if (!sprints.has(sp.id)) continue;
    lista(sp.daily).forEach((d: Obj, i: number) => upsert('sprint_daily', {
      id: `${sp.id}-d${i}`, sprint_id: sp.id, task_id: tareas.has(d.dailyTask) ? d.dailyTask : null, person_id: persona(d.person, 'avance diario'),
      day: fecha(d.dailyDate ?? d.day) ?? fecha(sp.start), progress: texto(d.progress), next: texto(d.next), block: texto(d.block),
      resolver_id: persona(d.resolver, 'avance diario'), required_date: fecha(d.requiredDate), created_at: instante(d.at) ?? opciones.ahora,
    }));
    for (const r of lista(sp.closedRecords)) {
      if (tareas.has(r.id)) upsert('sprint_closed_records', { sprint_id: sp.id, task_id: r.id, title: texto(r.title), status: texto(r.status), approved: bool(r.approved), evidence: r.evidence ?? null }, ['sprint_id', 'task_id']);
    }
  }

  // ── Días no laborables manuales.
  for (const d of new Set(lista<string>(s.scrum?.holidays))) if (fecha(d)) upsert('holidays', { date: fecha(d), name: 'Día no laborable', source: 'manual' }, ['date']);

  // ── Agenda.
  for (const m of lista(s.calendar?.meetings)) {
    const pid = persona(m.person, 'reunión');
    const ini = pared(m.start), fin = pared(m.end);
    if (!pid || !ini || !fin || ini >= fin) continue;
    upsert('meetings', { id: texto(m.id) || `reunion-${slug(pid)}-${slug(ini)}`, person_id: pid, title: texto(m.title, 'Reunión'), starts_at: ini, ends_at: fin, campaign_id: campanas.has(m.campaign) ? m.campaign : null });
  }
  for (const p of lista(s.calendar?.plans)) {
    const pid = persona(p.person, 'plan de trabajo');
    if (!pid || !tareas.has(p.task) || !(num(p.hours)! > 0) || !pared(p.start)) continue;
    upsert('work_plans', {
      task_id: p.task, person_id: pid, starts_at: pared(p.start), hours: num(p.hours), week: fecha(p.week), weekly: bool(p.weekly), late: bool(p.late),
      finish: typeof p.finish === 'number' ? minutoDeParedAIso(p.finish) : pared(p.finish),
    }, ['task_id']);
    lista(p.blocks).forEach((b: Obj, i: number) => {
      if (typeof b.start === 'number' && typeof b.end === 'number' && b.end > b.start) {
        upsert('work_blocks', { id: `${p.task}-b${i}`, task_id: p.task, person_id: pid, starts_at: minutoDeParedAIso(b.start), ends_at: minutoDeParedAIso(b.end) });
      }
    });
  }
  for (const ch of lista(s.calendar?.changes)) {
    if (!tareas.has(ch.task)) continue;
    const comoTexto = (v: unknown) => (typeof v === 'number' ? minutoDeParedAIso(v) : v == null ? null : String(v));
    upsert('plan_changes', { id: texto(ch.id) || `${ch.task}-cambio-${slug(texto(ch.at))}`, task_id: ch.task, old_finish: comoTexto(ch.old), new_finish: comoTexto(ch.new), delay_minutes: num(ch.delay), cause: texto(ch.cause), created_at: instante(ch.at) ?? opciones.ahora });
  }
  for (const [pid, conf] of Object.entries<any>(s.calendar?.settings ?? {})) {
    if (porId.has(pid)) upsert('calendar_links', { person_id: pid, calendar_id: conf?.calendarId ?? null }, ['person_id']);
  }

  // ── Estrategia: métricas, iniciativas, reportes e instantáneas públicas.
  for (const p of lista(s.strategicPlans)) {
    if (!planes.has(p.id)) continue;
    for (const m of lista(p.metrics)) {
      const fuente = texto(m.source) || (texto(m.current) ? 'Sin fuente (importado)' : '');
      upsert('plan_metrics', {
        id: m.id, plan_id: p.id, kind: de(m.kind, ['KPI', 'Resultado clave OKR'] as const, 'KPI'), objective: texto(m.objective), name: texto(m.name),
        baseline: texto(m.baseline), target: texto(m.target), current: texto(m.current), unit: texto(m.unit), source: fuente, as_of: fecha(m.asOf),
        direction: de(m.direction, ['Subir', 'Bajar'] as const, 'Subir'),
      });
    }
    for (const i of lista(p.initiatives)) {
      if (!fecha(i.start) || !fecha(i.end)) continue;
      upsert('plan_initiatives', {
        id: i.id, plan_id: p.id, name: texto(i.name),
        type: de(i.type, ['Campaña 360', 'Webinar', 'Contenido continuo', 'Sitio web', 'Plataforma', 'Presentación', 'Otra iniciativa'] as const, 'Otra iniciativa'),
        campaign_id: campanas.has(i.campaign) ? i.campaign : null, start_date: fecha(i.start), end_date: fecha(i.end),
        status: de(i.status, ['Planificada', 'En preparación', 'Activa', 'Finalizada', 'Pausada'] as const, 'Planificada'), evidence: i.evidence ?? null,
      });
    }
    for (const r of lista(p.reports)) {
      if (!sprints.has(r.sprint)) continue;
      upsert('plan_reports', {
        id: r.id, plan_id: p.id, sprint_id: r.sprint, name: texto(r.name), start_date: fecha(r.start), end_date: fecha(r.end), total: num(r.total) ?? 0, done: num(r.done) ?? 0,
        summary: texto(r.summary), next: texto(r.next), exception: r.exception ?? null, metrics_snapshot: r.metrics ? JSON.stringify(r.metrics) : null, approved: bool(r.approved),
      });
    }
  }
  for (const snap of lista(s.publicSnapshots)) {
    if (planes.has(snap.id)) upsert('public_snapshots', { plan_id: snap.id, payload_json: JSON.stringify(snap), published_at: instante(snap.publishedAt) ?? opciones.ahora }, ['plan_id']);
  }

  // ── Comunidad.
  const social = s.social ?? {};
  const TIPOS_LOGRO = ['Tarea aceptada', 'Día cumplido', 'Sprint completo', 'Objetivo del sprint alcanzado', 'Lanzamiento verificado', 'Entrega entre áreas'] as const;
  const FUENTES_LOGRO = ['task', 'day', 'sprint', 'campaign', 'exchange'] as const;
  const logros = new Set<string>();
  for (const a of lista(social.achievements)) {
    if (!a.id || !a.key) continue;
    if (!(TIPOS_LOGRO as readonly string[]).includes(a.type) || !(FUENTES_LOGRO as readonly string[]).includes(a.source)) {
      avisar(`Logro con tipo desconocido "${a.type}": no se importa.`);
      continue;
    }
    logros.add(a.id);
    upsert('achievements', {
      id: a.id, key: a.key, type: a.type, source: a.source, source_id: a.sourceId ?? null, title: texto(a.title),
      brand_id: marcas.has(a.brand) ? a.brand : null, mesa_id: a.mesa ? resolverMesa(a.mesa) : null, sprint_id: sprints.has(a.sprint) ? a.sprint : null,
      grp: a.group ?? null, day: fecha(a.day), valid: bool(a.valid !== false), restricted: bool(a.restricted),
      created_at: instante(a.created) ?? opciones.ahora, updated_at: instante(a.updated) ?? instante(a.created) ?? opciones.ahora,
    });
    for (const p of new Set(lista(a.people))) { const pid = persona(p, 'logro'); if (pid) upsert('achievement_people', { achievement_id: a.id, person_id: pid }, ['achievement_id', 'person_id']); }
    for (const tid of new Set(lista<string>(a.taskIds))) if (tareas.has(tid)) upsert('achievement_tasks', { achievement_id: a.id, task_id: tid }, ['achievement_id', 'task_id']);
    for (const r of lista(a.reactions)) { const pid = persona(r.person, 'felicitación'); if (pid) upsert('reactions', { achievement_id: a.id, person_id: pid, created_at: instante(r.at) ?? opciones.ahora }, ['achievement_id', 'person_id']); }
    lista(a.comments).forEach((c: Obj, i: number) => upsert('achievement_comments', {
      id: texto(c.id) || `${a.id}-com${i}`, achievement_id: a.id, person_id: persona(c.person, 'comentario de logro'), text: texto(c.text).slice(0, 1000),
      mention_id: c.mention ? persona(c.mention, 'mención') : null, removed: bool(c.removed), created_at: instante(c.at) ?? opciones.ahora,
    }));
  }
  for (const r of lista(social.reports)) {
    if (!logros.has(r.achievement)) continue;
    upsert('achievement_reports', { id: r.id, achievement_id: r.achievement, by_id: persona(r.by, 'reporte'), reason: texto(r.reason), status: r.status === 'Resuelto' ? 'Resuelto' : 'Pendiente', resolution: r.resolution ?? null, resolved_at: instante(r.resolvedAt), created_at: instante(r.at) ?? opciones.ahora });
  }
  for (const m of lista(social.inbox)) {
    const pid = persona(m.person, 'mención');
    if (pid) upsert('mentions', { id: m.id, person_id: pid, achievement_id: logros.has(m.achievement) ? m.achievement : null, from_id: persona(m.from, 'mención'), read_at: m.read ? opciones.ahora : null, created_at: instante(m.at) ?? opciones.ahora });
  }
  for (const c of lista(social.commitments)) {
    const pid = persona(c.person, 'compromiso del día');
    if (!pid || !fecha(c.day)) continue;
    const id = texto(c.id) || `compromiso-${slug(pid)}-${c.day}`;
    upsert('commitments', { id, person_id: pid, day: fecha(c.day), end_time: texto(c.end, '18:00') }, ['id']);
    const base = new Set(lista<string>(c.baseline));
    for (const tid of new Set(lista<string>(c.tasks))) if (tareas.has(tid)) upsert('commitment_tasks', { commitment_id: id, task_id: tid, baseline: bool(base.has(tid)) }, ['commitment_id', 'task_id']);
    lista(c.changes).forEach((ch: Obj, i: number) => upsert('commitment_changes', { id: `${id}-c${i}`, commitment_id: id, tasks_json: JSON.stringify(lista(ch.tasks)), reason: texto(ch.reason), by_id: persona(ch.by, 'cambio de compromiso'), created_at: instante(ch.at) ?? opciones.ahora }));
  }
  for (const [pid, pref] of Object.entries<any>(social.preferences ?? {})) {
    if (!porId.has(pid)) continue;
    upsert('preferences', {
      person_id: pid, mentions: bool(pref?.mentions !== false), summary: de(pref?.summary, ['Diario', 'Semanal', 'Sin resumen externo'] as const, 'Semanal'),
      email: bool(pref?.email), whatsapp: bool(pref?.whatsapp),
    }, ['person_id']);
  }

  // ── Fichas de plataformas y canales (sin claves).
  for (const p of lista(s.settings)) {
    if (p?.name) upsert('platform_cards', { name: texto(p.name), account: texto(p.account), url: /^https?:\/\//.test(texto(p.url)) ? texto(p.url) : '', owner_id: persona(p.owner, `responsable de ${p.name}`) }, ['name']);
  }
  for (const canal of ['Correo', 'WhatsApp'] as const) {
    const c = s.integrationCards?.[canal];
    if (c) upsert('channel_cards', { channel: canal, provider: texto(c.provider), account: texto(c.account), owner_id: persona(c.owner, `responsable de ${canal}`), template: texto(c.template) }, ['channel']);
  }

  // ── Auditoría (historial del prototipo).
  lista(s.history).forEach((h: Obj, i: number) => {
    const at = instante(h.at);
    if (!at || !h.action) return;
    upsert('audit_log', {
      id: `importado-${slug(at)}-${i}`, at, actor_id: h.user && h.user !== 'mesawow' ? persona(h.user, 'historial') : null, action: texto(h.action), details: h.details ? texto(h.details) : null,
    });
  });

  // ── Lo que no se importa (se regenera en la versión real).
  descartar('avisos preparados del prototipo (no se enviaron)', lista(s.notifications).length);
  descartar('borradores de correo', lista(s.emailDrafts).length);
  descartar('invitaciones locales (deben enviarse de nuevo)', lista(s.invitations).length);

  upsert('import_runs', { id: `importacion-${slug(opciones.ahora)}`, source: 'respaldo_mesa.json', summary: JSON.stringify({ filas: informe.filas, descartado: informe.descartado, advertencias: informe.advertencias.length }), created_at: opciones.ahora });
  // Las advertencias sobre la misma persona se repiten por tarea: se dejan únicas.
  informe.advertencias = [...new Set(informe.advertencias)];
  return { sql, archivos, informe };
};
