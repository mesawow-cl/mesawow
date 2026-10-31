// Perfil (requerimiento §4.3): bio ≤ 300 y foto PNG/JPEG/WebP ≤ 100 KB en R2.
import { Hono } from 'hono';
import { z } from 'zod';
import { ErrorApi } from './errores';
import { exigir, type Entorno } from './identidad';
import { auditoria, cuerpo, nuevoId } from './util';

const TIPOS_FOTO: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_FOTO = 100 * 1024;

export const perfil = new Hono<Entorno>();

perfil.get('/personas/:id/perfil', async (c) => {
  exigir(c, 'esEquipo', 'Los perfiles son solo para el equipo.');
  const db = c.env.DB;
  const p = await db
    .prepare(`SELECT p.id, p.name, p.role, m.name AS mesa, p.bio, p.active, p.departed, p.photo_key IS NOT NULL AS tiene_foto, p.updated_at
                FROM people p LEFT JOIN mesas m ON m.id = p.mesa_id WHERE p.id = ?1`)
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!p) throw new ErrorApi(404, 'no_encontrado', 'Ese perfil no existe.');
  // Solo se muestran las marcas que quien mira también tiene.
  const visibles = c.get('persona').marcas;
  const { results } = await db
    .prepare(`SELECT b.id, b.name, b.color FROM person_brands pb JOIN brands b ON b.id = pb.brand_id
               WHERE pb.person_id = ?1 AND b.archived = 0 ORDER BY b.name`)
    .bind(p.id).all<{ id: string; name: string; color: string }>();
  return c.json({
    perfil: {
      ...p,
      foto: p.tiene_foto ? `/api/v1/fotos/${p.id}?v=${encodeURIComponent(String(p.updated_at))}` : null,
      marcas: results.filter((b) => visibles.includes(b.id)),
      propio: p.id === c.get('actor').id,
    },
  });
});

perfil.put('/me/perfil', async (c) => {
  const { bio } = await cuerpo(c, z.object({ bio: z.string().trim().max(300, 'La presentación puede tener hasta 300 caracteres.') }));
  const id = c.get('actor').id;
  await c.env.DB.prepare(`UPDATE people SET bio = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`).bind(id, bio).run();
  return c.json({ ok: true });
});

perfil.put('/me/foto', async (c) => {
  const tipo = (c.req.header('content-type') ?? '').split(';')[0]!.trim();
  const ext = TIPOS_FOTO[tipo];
  if (!ext) throw new ErrorApi(415, 'formato_no_admitido', 'La foto debe ser PNG, JPEG o WebP.');
  const datos = await c.req.arrayBuffer();
  if (!datos.byteLength) throw new ErrorApi(400, 'datos_invalidos', 'La foto está vacía.');
  if (datos.byteLength > MAX_FOTO) throw new ErrorApi(413, 'muy_grande', 'La foto puede pesar hasta 100 KB.');
  const db = c.env.DB;
  const id = c.get('actor').id;
  const anterior = await db.prepare('SELECT photo_key FROM people WHERE id = ?1').bind(id).first<{ photo_key: string | null }>();
  const clave = `fotos/${id}/${nuevoId()}.${ext}`;
  await c.env.ARCHIVOS.put(clave, datos, { httpMetadata: { contentType: tipo } });
  await db.batch([
    db.prepare(`UPDATE people SET photo_key = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`).bind(id, clave),
    auditoria(db, id, 'Foto de perfil actualizada', 'person', id),
  ]);
  if (anterior?.photo_key) await c.env.ARCHIVOS.delete(anterior.photo_key);
  return c.json({ ok: true });
});

perfil.delete('/me/foto', async (c) => {
  const db = c.env.DB;
  const id = c.get('actor').id;
  const anterior = await db.prepare('SELECT photo_key FROM people WHERE id = ?1').bind(id).first<{ photo_key: string | null }>();
  await db.prepare(`UPDATE people SET photo_key = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1`).bind(id).run();
  if (anterior?.photo_key) await c.env.ARCHIVOS.delete(anterior.photo_key);
  return c.json({ ok: true });
});

perfil.get('/fotos/:id', async (c) => {
  exigir(c, 'esEquipo', 'Las fotos del equipo son solo para el equipo.');
  const p = await c.env.DB.prepare('SELECT photo_key FROM people WHERE id = ?1').bind(c.req.param('id')).first<{ photo_key: string | null }>();
  const obj = p?.photo_key ? await c.env.ARCHIVOS.get(p.photo_key) : null;
  if (!obj) throw new ErrorApi(404, 'no_encontrado', 'Sin foto.');
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
});
