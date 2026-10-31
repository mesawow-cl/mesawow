import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import migracionDatosBase from '../migrations/0002_datos_base.sql?raw';
import { sqlDatosBase } from '../scripts/datos-base.ts';
import { CATALOGO_SERVICIOS, horasDeServicio } from '../src/shared/catalogo';
import { cargarSemilla, fallasDeClaves } from './utilidades';

const tarea = (extra: Record<string, unknown> = {}) => {
  const fila = { id: 't-prueba', brand_id: 'demo-aurora', title: 'Prueba', start_date: '2026-11-02', due: '2026-11-06', ...extra };
  const cols = Object.keys(fila);
  return env.DB.prepare(`INSERT INTO tasks (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...Object.values(fila)).run();
};

describe('esquema D1', () => {
  it('crea las tablas principales', async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const nombres = results.map((r) => r.name);
    for (const t of ['people', 'brands', 'mesas', 'tasks', 'task_dependencies', 'air_series', 'air_slots', 'sprints', 'work_blocks',
      'meetings', 'holidays', 'campaigns', 'achievements', 'outbox', 'alerts', 'audit_log']) {
      expect(nombres).toContain(t);
    }
  });

  it('la migración de datos base está sincronizada con las constantes del código', () => {
    expect(migracionDatosBase).toBe(sqlDatosBase());
  });

  it('carga 8 mesas, 14 servicios del catálogo y la jornada 09–14 / 15–18', async () => {
    const mesas = await env.DB.prepare('SELECT count(*) AS n FROM mesas').first<{ n: number }>();
    expect(mesas?.n).toBe(8);
    const servicios = await env.DB.prepare('SELECT key, steps_json FROM service_templates WHERE builtin = 1').all<{ key: string; steps_json: string }>();
    expect(servicios.results).toHaveLength(14);
    for (const s of CATALOGO_SERVICIOS) {
      const fila = servicios.results.find((r) => r.key === s[0])!;
      const horas = (JSON.parse(fila.steps_json) as { hours: number }[]).reduce((t, x) => t + x.hours, 0);
      expect(horas).toBe(horasDeServicio(s));
    }
    const jornada = await env.DB.prepare("SELECT value FROM settings WHERE key = 'jornada'").first<{ value: string }>();
    expect(JSON.parse(jornada!.value)).toEqual([{ inicio: 540, fin: 840 }, { inicio: 900, fin: 1080 }]);
  });

  it('los datos de ejemplo cargan sin referencias rotas', async () => {
    await cargarSemilla();
    expect(await fallasDeClaves()).toEqual([]);
    const personas = await env.DB.prepare("SELECT count(*) AS n FROM people WHERE email LIKE '%@mesawow.test'").first<{ n: number }>();
    expect(personas?.n).toBe(9);
  });

  it('rechaza una tarea con inicio posterior al plazo', async () => {
    await cargarSemilla();
    await expect(tarea({ start_date: '2026-11-10', due: '2026-11-06' })).rejects.toThrow(/CHECK/);
  });

  it('rechaza estados de tarea que no existen', async () => {
    await cargarSemilla();
    await expect(tarea({ status: 'Terminada' })).rejects.toThrow(/CHECK/);
  });

  it('una tarea no puede depender de sí misma', async () => {
    await cargarSemilla();
    await tarea({ id: 't-dep' });
    await expect(env.DB.prepare("INSERT INTO task_dependencies VALUES ('t-dep','t-dep')").run()).rejects.toThrow(/CHECK/);
  });

  it('solo puede haber un Administrador general activo', async () => {
    await cargarSemilla();
    await expect(env.DB.prepare("UPDATE people SET role = 'Administrador general' WHERE id = 'demo-bruno'").run()).rejects.toThrow(/UNIQUE/);
  });

  it('una pieza al aire solo puede estar Programada o Al aire', async () => {
    await cargarSemilla();
    await tarea({ id: 't-aire' });
    await expect(env.DB.prepare("INSERT INTO air_slots (id, task_id, channel, at, status) VALUES ('s1','t-aire','Instagram','2026-11-05T10:00','Atrasada')").run()).rejects.toThrow(/CHECK/);
  });

  it('el outbox no acepta dos avisos con la misma clave (idempotencia)', async () => {
    await cargarSemilla();
    const aviso = "INSERT INTO outbox (id, dedupe_key, person_id, channel, event) VALUES (?, 'riesgo:pieza1:2026-11-05T10:00', 'demo-diego', 'email', 'Salida al aire en riesgo')";
    await env.DB.prepare(aviso).bind('a1').run();
    await expect(env.DB.prepare(aviso).bind('a2').run()).rejects.toThrow(/UNIQUE/);
  });
});
