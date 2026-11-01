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
  'DELETE FROM sprints',
  'DELETE FROM strategic_plans',
  'DELETE FROM campaigns',
  'DELETE FROM jobs',
  "DELETE FROM service_templates WHERE builtin = 0",
  'DELETE FROM contact_bases',
  'DELETE FROM segments',
  'DELETE FROM task_events',
  'DELETE FROM air_slots',
  'DELETE FROM air_series',
  'DELETE FROM work_plans',
  'DELETE FROM meetings',
  'DELETE FROM calendar_links',
  'DELETE FROM holidays',
  'DELETE FROM plan_changes',
  "DELETE FROM tasks WHERE id NOT LIKE 'demo-%'",
  'DELETE FROM task_comments',
  'DELETE FROM task_results',
  'DELETE FROM task_people',
  "DELETE FROM brands WHERE id NOT LIKE 'demo-%'",
  "DELETE FROM mesas WHERE id NOT LIKE 'mesa-%'",
  'UPDATE mesas SET active = 1',
  'DELETE FROM invitations',
  'DELETE FROM outbox',
  'DELETE FROM audit_log',
  "DELETE FROM people WHERE id NOT LIKE 'demo-%'",
  ...sqlSemillaDesarrollo().split('\n'),
]);

export const fallasDeClaves = async () => (await env.DB.prepare('PRAGMA foreign_key_check').all()).results;
