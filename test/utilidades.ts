import { env } from 'cloudflare:workers';
import { sqlSemillaDesarrollo } from '../scripts/semilla-desarrollo.ts';

/** Ejecuta sentencias SQL (una por elemento) en una transacción, con claves foráneas diferidas. */
export const ejecutar = (sentencias: string[]) =>
  env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = true'),
    ...sentencias.filter((s) => s.trim() && !s.startsWith('--') && !s.startsWith('PRAGMA')).map((s) => env.DB.prepare(s)),
  ]);

/** Deja la base con los datos de ejemplo, quitando lo que otras pruebas del mismo archivo hayan creado. */
export const cargarSemilla = () => ejecutar([
  'DELETE FROM invitations',
  'DELETE FROM outbox',
  'DELETE FROM audit_log',
  "DELETE FROM people WHERE id NOT LIKE 'demo-%'",
  ...sqlSemillaDesarrollo().split('\n'),
]);

export const fallasDeClaves = async () => (await env.DB.prepare('PRAGMA foreign_key_check').all()).results;
