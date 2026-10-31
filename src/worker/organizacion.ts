// Mesas (§4.11) y Marcas y mínimos (§4.16).
import { Hono } from 'hono';
import { z } from 'zod';
import { ESTADOS_MINIMO, MINIMOS_DE_MARCA } from '../shared/constantes';
import { ErrorApi } from './errores';
import { exigir, type Ctx, type Entorno } from './identidad';
import { auditoria, cuerpo, nuevoId } from './util';

export const organizacion = new Hono<Entorno>();

// ─────────────────────────────── Mesas

organizacion.get('/mesas', async (c) => {
  const p = c.get('persona');
  const { results } = await c.env.DB.prepare(`
    SELECT m.id, m.name, m.active, m.description, m.owner_id, o.name AS encargado,
           (SELECT count(*) FROM tasks t WHERE t.mesa_id = m.id) AS total,
           (SELECT count(*) FROM tasks t WHERE t.mesa_id = m.id AND t.status IN ('Aprobada','Completada')) AS aceptadas,
           (SELECT count(*) FROM tasks t WHERE t.mesa_id = m.id AND t.status NOT IN ('Aprobada','Completada')) AS abiertas
      FROM mesas m LEFT JOIN people o ON o.id = m.owner_id
     WHERE m.active = 1 OR ?1 = 1 ORDER BY m.active DESC, m.name`).bind(p.permisos.esAdmin ? 1 : 0).all();
  return c.json({ mesas: results });
});

const esquemaMesa = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre de la mesa.').max(70, 'El nombre puede tener hasta 70 caracteres.'),
  descripcion: z.string().trim().max(300, 'La descripción puede tener hasta 300 caracteres.').default(''),
  encargadoId: z.string().nullable().default(null),
});

const validarMesa = async (db: D1Database, d: z.infer<typeof esquemaMesa>, id: string | null) => {
  if (await db.prepare('SELECT 1 FROM mesas WHERE name = ?1 AND id <> ?2').bind(d.nombre, id ?? '').first()) {
    throw new ErrorApi(409, 'nombre_repetido', 'Ya existe una mesa con ese nombre.');
  }
  if (d.encargadoId && !(await db.prepare('SELECT 1 FROM people WHERE id = ?1 AND active = 1').bind(d.encargadoId).first())) {
    throw new ErrorApi(400, 'datos_invalidos', 'La persona encargada no existe o está inactiva.');
  }
};

organizacion.post('/mesas', async (c) => {
  exigir(c, 'esAdmin', 'Solo la administración general crea mesas.');
  const d = await cuerpo(c, esquemaMesa);
  await validarMesa(c.env.DB, d, null);
  const id = nuevoId();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO mesas (id, name, description, owner_id) VALUES (?1, ?2, ?3, ?4)').bind(id, d.nombre, d.descripcion, d.encargadoId),
    auditoria(c.env.DB, c.get('actor').id, `Mesa creada ${d.nombre}`, 'mesa', id),
  ]);
  return c.json({ id }, 201);
});

organizacion.patch('/mesas/:id', async (c) => {
  exigir(c, 'esAdmin', 'Solo la administración general edita mesas.');
  const d = await cuerpo(c, esquemaMesa);
  const id = c.req.param('id');
  await validarMesa(c.env.DB, d, id);
  const r = await c.env.DB.prepare(`UPDATE mesas SET name = ?2, description = ?3, owner_id = ?4, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`)
    .bind(id, d.nombre, d.descripcion, d.encargadoId).run();
  if (!r.meta.changes) throw new ErrorApi(404, 'no_encontrado', 'Esa mesa no existe.');
  await auditoria(c.env.DB, c.get('actor').id, `Mesa editada ${d.nombre}`, 'mesa', id).run();
  return c.json({ ok: true });
});

organizacion.post('/mesas/:id/archivar', async (c) => {
  exigir(c, 'esAdmin', 'Solo la administración general archiva mesas.');
  const { archivar } = await cuerpo(c, z.object({ archivar: z.boolean() }));
  const db = c.env.DB;
  const id = c.req.param('id');
  if (archivar) {
    const { results } = await db.prepare("SELECT id, title FROM tasks WHERE mesa_id = ?1 AND status NOT IN ('Aprobada','Completada') LIMIT 20").bind(id).all();
    if (results.length) {
      return c.json({ error: { code: 'tareas_abiertas', message: 'No se puede archivar: la mesa tiene tareas abiertas.' }, tareas: results }, 409);
    }
  }
  const r = await db.prepare('UPDATE mesas SET active = ?2 WHERE id = ?1').bind(id, archivar ? 0 : 1).run();
  if (!r.meta.changes) throw new ErrorApi(404, 'no_encontrado', 'Esa mesa no existe.');
  await auditoria(db, c.get('actor').id, archivar ? 'Mesa archivada' : 'Mesa restaurada', 'mesa', id).run();
  return c.json({ ok: true });
});

// ─────────────────────────────── Marcas y mínimos

organizacion.get('/marcas/detalle', async (c) => {
  const p = c.get('persona');
  if (!p.marcas.length) return c.json({ marcas: [] });
  const { results } = await c.env.DB.prepare(`
    SELECT b.id, b.name, b.color, b.description, b.director_id, d.name AS director,
           (SELECT count(*) FROM brand_minimums m WHERE m.brand_id = b.id AND m.state = 'Vigente') AS vigentes,
           (SELECT count(*) FROM tasks t WHERE t.brand_id = b.id AND t.status NOT IN ('Aprobada','Completada')) AS abiertas
      FROM brands b LEFT JOIN people d ON d.id = b.director_id
     WHERE b.id IN (${p.marcas.map((_, i) => `?${i + 1}`).join(',')}) ORDER BY b.name`).bind(...p.marcas).all();
  return c.json({ marcas: results, totalMinimos: MINIMOS_DE_MARCA.length });
});

const marcaPermitida = (c: Ctx, id: string) => {
  if (!c.get('persona').marcas.includes(id)) throw new ErrorApi(404, 'no_encontrado', 'Esa marca no existe o no la tienes asignada.');
};

organizacion.get('/marcas/:id/minimos', async (c) => {
  const id = c.req.param('id');
  marcaPermitida(c, id);
  const { results } = await c.env.DB.prepare(`SELECT m.idx, m.title, m.state, m.note, m.updated_at, p.name AS actualizado_por
      FROM brand_minimums m LEFT JOIN people p ON p.id = m.updated_by WHERE m.brand_id = ?1 ORDER BY m.idx`).bind(id).all();
  return c.json({ minimos: results });
});

organizacion.put('/marcas/:id/minimos', async (c) => {
  exigir(c, 'coordina', 'El diagnóstico de mínimos lo actualiza coordinación.');
  const id = c.req.param('id');
  marcaPermitida(c, id);
  const { minimos } = await cuerpo(c, z.object({
    minimos: z.array(z.object({ idx: z.number().int().min(0).max(20), estado: z.enum(ESTADOS_MINIMO), nota: z.string().trim().max(500).default('') })),
  }));
  const db = c.env.DB;
  const a = c.get('actor');
  await db.batch([
    ...minimos.map((m) => db.prepare(`UPDATE brand_minimums SET state = ?3, note = ?4, updated_by = ?5, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE brand_id = ?1 AND idx = ?2 AND (state <> ?3 OR note <> ?4)`).bind(id, m.idx, m.estado, m.nota, a.id)),
    auditoria(db, a.id, 'Diagnóstico de mínimos actualizado', 'brand', id),
  ]);
  return c.json({ ok: true });
});

const esquemaMarca = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre de la marca.').max(80, 'El nombre puede tener hasta 80 caracteres.'),
  descripcion: z.string().trim().max(500).default(''),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Elige un color válido.'),
  directorId: z.string().nullable().default(null),
});

organizacion.post('/marcas', async (c) => {
  exigir(c, 'esAdmin', 'Solo la administración general crea marcas.');
  const d = await cuerpo(c, esquemaMarca);
  const db = c.env.DB;
  if (await db.prepare('SELECT 1 FROM brands WHERE name = ?1').bind(d.nombre).first()) throw new ErrorApi(409, 'nombre_repetido', 'Ya existe una marca con ese nombre.');
  const id = nuevoId();
  await db.batch([
    db.prepare('INSERT INTO brands (id, name, description, color, director_id) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, d.nombre, d.descripcion, d.color, d.directorId),
    ...MINIMOS_DE_MARCA.map((t, i) => db.prepare('INSERT INTO brand_minimums (brand_id, idx, title) VALUES (?1, ?2, ?3)').bind(id, i, t)),
    auditoria(db, c.get('actor').id, `Marca creada ${d.nombre}`, 'brand', id),
  ]);
  return c.json({ id }, 201);
});

organizacion.patch('/marcas/:id', async (c) => {
  exigir(c, 'esAdmin', 'Solo la administración general edita marcas.');
  const d = await cuerpo(c, esquemaMarca);
  const db = c.env.DB;
  const id = c.req.param('id');
  if (await db.prepare('SELECT 1 FROM brands WHERE name = ?1 AND id <> ?2').bind(d.nombre, id).first()) throw new ErrorApi(409, 'nombre_repetido', 'Ya existe una marca con ese nombre.');
  const r = await db.prepare(`UPDATE brands SET name = ?2, description = ?3, color = ?4, director_id = ?5, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`)
    .bind(id, d.nombre, d.descripcion, d.color, d.directorId).run();
  if (!r.meta.changes) throw new ErrorApi(404, 'no_encontrado', 'Esa marca no existe.');
  await auditoria(db, c.get('actor').id, `Marca editada ${d.nombre}`, 'brand', id).run();
  return c.json({ ok: true });
});
