// Equipo, permisos e invitaciones (requerimiento §4.22 y §5.10). Todo exige Administrador general,
// salvo ver o aceptar la propia invitación.
import { Hono } from 'hono';
import { z } from 'zod';
import { ROLES, ROLES_INVITABLES, type Rol } from '../shared/roles';
import { ErrorApi } from './errores';
import { exigir, type Entorno } from './identidad';
import { ahoraIso, auditoria, cuerpo, nuevoId, sha256, tokenAleatorio } from './util';

const DIAS_INVITACION = 7;
const TELEFONO = /^\+[1-9][0-9]{7,14}$/;

const marcasValidas = async (db: D1Database, ids: string[]) => {
  if (!ids.length) return [];
  const { results } = await db
    .prepare(`SELECT id FROM brands WHERE archived = 0 AND id IN (${ids.map((_, i) => `?${i + 1}`).join(',')})`)
    .bind(...ids).all<{ id: string }>();
  if (results.length !== new Set(ids).size) throw new ErrorApi(400, 'datos_invalidos', 'Alguna de las marcas elegidas no existe.');
  return results.map((r) => r.id);
};

const mesaValida = async (db: D1Database, id: string | null | undefined) => {
  if (!id) return null;
  const m = await db.prepare('SELECT id FROM mesas WHERE id = ?1 AND active = 1').bind(id).first();
  if (!m) throw new ErrorApi(400, 'datos_invalidos', 'La mesa elegida no existe o está archivada.');
  return id;
};

/** Marca vencidas las invitaciones pendientes cuyo plazo pasó (también lo hará un cron en la Fase 6). */
const vencerInvitaciones = (db: D1Database) =>
  db.prepare("UPDATE invitations SET status = 'Vencida' WHERE status = 'Pendiente' AND expires_at <= ?1").bind(ahoraIso()).run();

// ─────────────────────────────── Rutas que solo verifican el correo (persona aún no existe)

export const invitacionPropia = new Hono<Entorno>();

invitacionPropia.get('/invitaciones/mia', async (c) => {
  await vencerInvitaciones(c.env.DB);
  const inv = await c.env.DB
    .prepare(`SELECT i.id, i.name, i.role, m.name AS mesa, i.expires_at,
                     (SELECT group_concat(b.name, ', ') FROM invitation_brands ib JOIN brands b ON b.id = ib.brand_id WHERE ib.invitation_id = i.id) AS marcas
                FROM invitations i LEFT JOIN mesas m ON m.id = i.mesa_id
               WHERE i.email = ?1 AND i.status = 'Pendiente' ORDER BY i.created_at DESC LIMIT 1`)
    .bind(c.get('correo')).first();
  if (!inv) throw new ErrorApi(404, 'sin_invitacion', 'No hay una invitación vigente para tu correo.');
  return c.json({ invitacion: { ...inv, correo: c.get('correo') } });
});

const esquemaAceptar = z.object({
  nombre: z.string().trim().min(3, 'Escribe tu nombre y apellido.').max(90, 'El nombre es muy largo.'),
  telefono: z.string().trim().regex(TELEFONO, 'El WhatsApp debe tener el formato +56912345678.'),
  token: z.string().optional(),
});

invitacionPropia.post('/invitaciones/aceptar', async (c) => {
  const datos = await cuerpo(c, esquemaAceptar);
  const correo = c.get('correo');
  const db = c.env.DB;
  await vencerInvitaciones(db);
  if (await db.prepare('SELECT 1 FROM people WHERE email = ?1').bind(correo).first()) {
    throw new ErrorApi(409, 'ya_existe', 'Tu cuenta ya existe: entra directamente.');
  }
  const inv = await db
    .prepare("SELECT * FROM invitations WHERE email = ?1 AND status = 'Pendiente' ORDER BY created_at DESC LIMIT 1")
    .bind(correo).first<{ id: string; token_hash: string; mesa_id: string | null; role: Rol }>();
  if (!inv) throw new ErrorApi(404, 'sin_invitacion', 'No hay una invitación vigente para tu correo.');
  if (datos.token && (await sha256(datos.token)) !== inv.token_hash) {
    throw new ErrorApi(403, 'token_invalido', 'El enlace de invitación no corresponde a tu correo.');
  }
  if (await db.prepare('SELECT 1 FROM people WHERE name = ?1').bind(datos.nombre).first()) {
    throw new ErrorApi(409, 'nombre_repetido', 'Ya hay alguien con ese nombre en mesawow. Agrega tu segundo apellido.');
  }
  const id = nuevoId();
  const ahora = ahoraIso();
  await db.batch([
    db.prepare('INSERT INTO people (id, name, email, phone, role, mesa_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(id, datos.nombre, correo, datos.telefono, inv.role, inv.mesa_id),
    db.prepare('INSERT INTO person_brands (person_id, brand_id) SELECT ?1, brand_id FROM invitation_brands WHERE invitation_id = ?2').bind(id, inv.id),
    // D2: el aviso por WhatsApp de tareas listas parte activo.
    db.prepare('INSERT INTO preferences (person_id, whatsapp) VALUES (?1, 1)').bind(id),
    db.prepare("UPDATE invitations SET status = 'Aceptada', accepted_at = ?2 WHERE id = ?1").bind(inv.id, ahora),
    auditoria(db, id, `Se unió al equipo ${datos.nombre}`, 'person', id, { invitacion: inv.id }),
  ]);
  return c.json({ ok: true, id }, 201);
});

// ─────────────────────────────── Administración del equipo

export const equipo = new Hono<Entorno>();

equipo.get('/equipo', async (c) => {
  exigir(c, 'esAdmin', 'El equipo lo administra la administración general.');
  const db = c.env.DB;
  await vencerInvitaciones(db);
  const [personas, marcas, invitaciones] = await db.batch([
    db.prepare(`SELECT p.id, p.name, p.email, p.phone, p.role, p.mesa_id, m.name AS mesa, p.active, p.departed, p.departure_note,
                       p.photo_key IS NOT NULL AS tiene_foto
                  FROM people p LEFT JOIN mesas m ON m.id = p.mesa_id ORDER BY p.active DESC, p.name`),
    db.prepare('SELECT person_id, brand_id FROM person_brands'),
    db.prepare(`SELECT i.id, i.email, i.name, i.role, i.mesa_id, m.name AS mesa, i.status, i.expires_at, i.created_at, i.accepted_at,
                       (SELECT json_group_array(brand_id) FROM invitation_brands WHERE invitation_id = i.id) AS marcas
                  FROM invitations i LEFT JOIN mesas m ON m.id = i.mesa_id ORDER BY i.created_at DESC`),
  ]);
  const porPersona = new Map<string, string[]>();
  for (const r of marcas!.results as { person_id: string; brand_id: string }[]) {
    porPersona.set(r.person_id, [...(porPersona.get(r.person_id) ?? []), r.brand_id]);
  }
  return c.json({
    personas: (personas!.results as Record<string, unknown>[]).map((p) => ({ ...p, marcas: porPersona.get(p.id as string) ?? [] })),
    invitaciones: (invitaciones!.results as Record<string, unknown>[]).map((i) => ({ ...i, marcas: JSON.parse(i.marcas as string) })),
  });
});

const esquemaPersona = z.object({
  nombre: z.string().trim().min(3, 'Escribe nombre y apellido.').max(90, 'El nombre es muy largo.'),
  telefono: z.union([z.literal(''), z.string().trim().regex(TELEFONO, 'El WhatsApp debe tener el formato +56912345678.')]),
  rol: z.enum(ROLES, { message: 'Elige un rol válido.' }),
  mesaId: z.string().nullable(),
  activo: z.boolean(),
  marcas: z.array(z.string()),
});

equipo.patch('/personas/:id', async (c) => {
  exigir(c, 'esAdmin', 'Solo la administración general cambia permisos.');
  const datos = await cuerpo(c, esquemaPersona);
  const db = c.env.DB;
  const id = c.req.param('id');
  const actual = await db.prepare('SELECT id, name, role, active FROM people WHERE id = ?1').bind(id).first<{ id: string; name: string; role: Rol; active: number }>();
  if (!actual) throw new ErrorApi(404, 'no_encontrado', 'Esa persona no existe.');
  if (actual.role === 'Administrador general' && (datos.rol !== 'Administrador general' || !datos.activo)) {
    throw new ErrorApi(409, 'transferir_primero', 'Primero transfiere la administración general a otra persona.');
  }
  if (datos.rol === 'Administrador general' && actual.role !== 'Administrador general') {
    throw new ErrorApi(409, 'usar_transferencia', 'Para nombrar a otra persona como Administrador general usa "Transferir administración".');
  }
  const esExterno = ['Mandante', 'Consulta externa', 'Administrador técnico'].includes(datos.rol);
  if (!esExterno && datos.rol !== 'Administrador general' && !datos.marcas.length) {
    throw new ErrorApi(400, 'datos_invalidos', 'Asigna al menos una marca.');
  }
  if (await db.prepare('SELECT 1 FROM people WHERE name = ?1 AND id <> ?2').bind(datos.nombre, id).first()) {
    throw new ErrorApi(409, 'nombre_repetido', 'Ya hay otra persona con ese nombre.');
  }
  const marcas = await marcasValidas(db, datos.marcas);
  const mesa = await mesaValida(db, datos.mesaId);
  await db.batch([
    db.prepare(`UPDATE people SET name = ?2, phone = ?3, role = ?4, mesa_id = ?5, active = ?6,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`)
      .bind(id, datos.nombre, datos.telefono || null, datos.rol, mesa, datos.activo ? 1 : 0),
    db.prepare('DELETE FROM person_brands WHERE person_id = ?1').bind(id),
    ...marcas.map((b) => db.prepare('INSERT INTO person_brands (person_id, brand_id) VALUES (?1, ?2)').bind(id, b)),
    auditoria(db, c.get('actor').id, `Permisos actualizados de ${datos.nombre}`, 'person', id, { rol: datos.rol, activo: datos.activo, marcas }),
  ]);
  return c.json({ ok: true });
});

equipo.post('/personas/:id/transferir-admin', async (c) => {
  exigir(c, 'esAdmin', 'Solo la administración general puede transferirse.');
  const db = c.env.DB;
  const actor = c.get('actor');
  const destino = await db.prepare('SELECT id, name, active, role FROM people WHERE id = ?1').bind(c.req.param('id')).first<{ id: string; name: string; active: number; role: Rol }>();
  if (!destino || !destino.active) throw new ErrorApi(404, 'no_encontrado', 'Esa persona no existe o está inactiva.');
  if (destino.id === actor.id) throw new ErrorApi(400, 'datos_invalidos', 'Ya eres el Administrador general.');
  if (['Mandante', 'Consulta externa', 'Administrador técnico'].includes(destino.role)) {
    throw new ErrorApi(400, 'datos_invalidos', 'La administración general solo puede pasar a alguien del equipo.');
  }
  // El índice único exige degradar primero y promover después, en la misma transacción.
  await db.batch([
    db.prepare("UPDATE people SET role = 'Coordinación de Marketing' WHERE id = ?1").bind(actor.id),
    db.prepare("UPDATE people SET role = 'Administrador general' WHERE id = ?1").bind(destino.id),
    auditoria(db, actor.id, `Administración general transferida a ${destino.name}`, 'person', destino.id),
  ]);
  return c.json({ ok: true });
});

equipo.post('/personas/:id/salida', async (c) => {
  exigir(c, 'esAdmin', 'Solo la administración general registra salidas.');
  const { nota } = await cuerpo(c, z.object({ nota: z.string().trim().min(3, 'Escribe una nota sobre la salida.').max(300) }));
  const db = c.env.DB;
  const p = await db.prepare('SELECT id, name, role, active FROM people WHERE id = ?1').bind(c.req.param('id')).first<{ id: string; name: string; role: Rol; active: number }>();
  if (!p) throw new ErrorApi(404, 'no_encontrado', 'Esa persona no existe.');
  if (p.role === 'Administrador general') throw new ErrorApi(409, 'transferir_primero', 'Primero transfiere la administración general a otra persona.');
  const motivo = `Revisar asignación por salida de ${p.name}.`;
  const participa = `(owner_id = ?1 OR reviewer_id = ?1 OR id IN (SELECT task_id FROM task_people WHERE person_id = ?1))`;
  const [, , tareas] = await db.batch([
    db.prepare(`UPDATE people SET active = 0, departed = 1, departure_note = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`).bind(p.id, nota),
    db.prepare("UPDATE outbox SET status = 'cancelado', error = 'Salida del integrante' WHERE person_id = ?1 AND status IN ('pendiente','encolado')").bind(p.id),
    db.prepare(`UPDATE tasks SET blocked = 1, block_reason = ?2, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 WHERE status NOT IN ('Aprobada','Completada') AND ${participa}`).bind(p.id, motivo),
    auditoria(db, c.get('actor').id, `Salida registrada de ${p.name}`, 'person', p.id, { nota }),
  ]);
  return c.json({ ok: true, tareasBloqueadas: tareas!.meta.changes });
});

const esquemaInvitacion = z.object({
  correo: z.email('Escribe un correo válido.').transform((s) => s.trim().toLowerCase()),
  nombre: z.string().trim().max(90).optional(),
  rol: z.enum(ROLES_INVITABLES as [Rol, ...Rol[]], { message: 'Elige un rol válido para invitar.' }),
  mesaId: z.string().nullable(),
  marcas: z.array(z.string()).min(1, 'Asigna al menos una marca.'),
});

equipo.post('/invitaciones', async (c) => {
  exigir(c, 'esAdmin', 'Solo la administración general invita.');
  const datos = await cuerpo(c, esquemaInvitacion);
  const db = c.env.DB;
  await vencerInvitaciones(db);
  if (await db.prepare('SELECT 1 FROM people WHERE email = ?1').bind(datos.correo).first()) {
    throw new ErrorApi(409, 'ya_existe', 'Ese correo ya pertenece a alguien del equipo.');
  }
  if (await db.prepare("SELECT 1 FROM invitations WHERE email = ?1 AND status = 'Pendiente'").bind(datos.correo).first()) {
    throw new ErrorApi(409, 'invitacion_vigente', 'Ese correo ya tiene una invitación vigente. Revócala para enviar otra.');
  }
  const marcas = await marcasValidas(db, datos.marcas);
  const mesa = await mesaValida(db, datos.mesaId);
  const id = nuevoId();
  const token = tokenAleatorio();
  const vence = new Date(Date.now() + DIAS_INVITACION * 86_400_000).toISOString();
  await db.batch([
    db.prepare('INSERT INTO invitations (id, token_hash, email, name, mesa_id, role, expires_at, inviter_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
      .bind(id, await sha256(token), datos.correo, datos.nombre || null, mesa, datos.rol, vence, c.get('actor').id),
    ...marcas.map((b) => db.prepare('INSERT INTO invitation_brands (invitation_id, brand_id) VALUES (?1, ?2)').bind(id, b)),
    auditoria(db, c.get('actor').id, `Invitación creada para ${datos.correo}`, 'invitation', id, { rol: datos.rol }),
    // El correo de invitación sale por Brevo (si está configurado; si no, queda el enlace para enviarlo a mano).
    db.prepare(`INSERT INTO outbox (id, dedupe_key, channel, event, payload) VALUES (?1, ?2, 'email', 'Invitación a mesawow', ?3)`)
      .bind(nuevoId(), `invitacion:${id}`, JSON.stringify({ para: datos.correo, enlace: `${c.env.APP_URL}/?invitacion=${token}`, invitador: c.get('actor').name })),
  ]);
  // El token solo se entrega ahora: en la base queda su huella (SHA-256).
  return c.json({ id, enlace: `${c.env.APP_URL}/?invitacion=${token}`, vence }, 201);
});

equipo.post('/invitaciones/:id/revocar', async (c) => {
  exigir(c, 'esAdmin', 'Solo la administración general revoca invitaciones.');
  const db = c.env.DB;
  const r = await db.prepare("UPDATE invitations SET status = 'Revocada' WHERE id = ?1 AND status = 'Pendiente'").bind(c.req.param('id')).run();
  if (!r.meta.changes) throw new ErrorApi(409, 'no_pendiente', 'Esa invitación ya no está pendiente.');
  await auditoria(db, c.get('actor').id, 'Invitación revocada', 'invitation', c.req.param('id')).run();
  return c.json({ ok: true });
});
