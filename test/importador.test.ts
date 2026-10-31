import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { importarRespaldo } from '../src/importador/importar';
import respaldo from './fixtures/respaldo-ficticio.json';
import { ejecutar, fallasDeClaves } from './utilidades';

const AHORA = '2026-11-20T15:00:00.000Z';
const importar = () => importarRespaldo(structuredClone(respaldo), { ahora: AHORA });
const uno = async <T>(sql: string) => (await env.DB.prepare(sql).first<T>())!;
const todos = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;

describe('importador del prototipo', () => {
  it('nunca copia contraseñas ni tokens de invitación', () => {
    const { sql, informe } = importar();
    const todo = sql.join('\n');
    expect(todo).not.toMatch(/deadbeef|passwordHash|"salt"|secreto/);
    expect(informe.descartado['contraseñas y sesiones locales']).toBe(1);
    expect(informe.descartado['invitaciones locales (deben enviarse de nuevo)']).toBe(1);
    expect(informe.descartado['avisos preparados del prototipo (no se enviaron)']).toBe(2);
  });

  it('rechaza archivos que no son respaldos de mesawow', () => {
    expect(() => importarRespaldo({ hola: 1 }, { ahora: AHORA })).toThrow(/no parece de mesawow/);
  });

  it('carga en D1 sin referencias rotas y es idempotente', async () => {
    const { sql } = importar();
    await ejecutar(sql);
    expect(await fallasDeClaves()).toEqual([]);
    const contar = () => uno<Record<string, number>>(`SELECT
      (SELECT count(*) FROM people) p, (SELECT count(*) FROM tasks) t, (SELECT count(*) FROM air_slots) s,
      (SELECT count(*) FROM task_people) tp, (SELECT count(*) FROM achievements) a, (SELECT count(*) FROM mesas) m`);
    const primera = await contar();
    await ejecutar(importar().sql);
    expect(await contar()).toEqual(primera);
    expect(primera).toEqual({ p: 4, t: 2, s: 2, tp: 2, a: 1, m: 9 });
  });

  it('convierte nombres de persona en IDs e informa los desconocidos', async () => {
    const { sql, informe } = importar();
    await ejecutar(sql);
    const t1 = await uno<{ owner_id: string; reviewer_id: string; mesa_id: string }>("SELECT owner_id, reviewer_id, mesa_id FROM tasks WHERE id = 't1'");
    expect(t1).toEqual({ owner_id: 'p-mar', reviewer_id: 'p-luz', mesa_id: 'mesa-comercial-y-ventas' });
    const equipo = await todos<{ person_id: string; role: string }>("SELECT person_id, role FROM task_people WHERE task_id = 't1' ORDER BY role, person_id");
    expect(equipo).toEqual([{ person_id: 'p-luz', role: 'approver' }, { person_id: 'p-sol', role: 'collaborator' }]);
    expect(informe.advertencias).toContain('Persona no encontrada "Nadie Conocido" (colaborador de "Tarea uno").');
  });

  it('mantiene un solo Administrador general y corrige datos inválidos', async () => {
    const { sql, informe } = importar();
    await ejecutar(sql);
    const personas = await todos<{ id: string; email: string; role: string; phone: string | null; active: number; mesa_id: string | null }>(
      'SELECT id, email, role, phone, active, mesa_id FROM people ORDER BY id');
    expect(personas).toEqual([
      { id: 'p-luz', email: 'luz@ficticio.test', role: 'Administrador general', phone: '+56900000001', active: 1, mesa_id: 'mesa-marketing' },
      { id: 'p-mar', email: 'mar@ficticio.test', role: 'Coordinación de Marketing', phone: null, active: 1, mesa_id: 'mesa-comercial-y-ventas' },
      { id: 'p-rio', email: 'rio@ficticio.test', role: 'Ejecutor', phone: null, active: 0, mesa_id: null },
      { id: 'p-sol', email: 'sin-correo+p-sol@importado.invalid', role: 'Ejecutor', phone: null, active: 1, mesa_id: 'mesa-marketing' },
    ]);
    expect(informe.advertencias.some((a) => a.includes('Rol desconocido "Jefe Supremo"'))).toBe(true);
    // Solo las marcas existentes se asignan.
    expect(await todos("SELECT brand_id FROM person_brands WHERE person_id = 'p-sol'")).toEqual([{ brand_id: 'b0' }]);
  });

  it('no importa tareas de marcas inexistentes y corrige fechas, dependencias y estados', async () => {
    const { sql, informe } = importar();
    await ejecutar(sql);
    const t2 = await uno<Record<string, unknown>>("SELECT start_date, due, status, priority FROM tasks WHERE id = 't2'");
    expect(t2).toEqual({ start_date: '2026-11-05', due: '2026-11-05', status: 'Pendiente', priority: 'Urgente' });
    expect(await todos("SELECT depends_on_id FROM task_dependencies WHERE task_id = 't2'")).toEqual([{ depends_on_id: 't1' }]);
    expect(await uno("SELECT count(*) AS n FROM tasks WHERE id = 't3'")).toEqual({ n: 0 });
    expect(informe.advertencias).toContain('Dependencia inexistente en "Tarea dos": t-fantasma.');
  });

  it('migra la serie antigua y normaliza las piezas al aire', async () => {
    const { sql } = importar();
    await ejecutar(sql);
    const serie = await uno<Record<string, unknown>>("SELECT id, mode, days, from_date, weeks, hours FROM air_series WHERE task_id = 't1'");
    expect(serie).toEqual({ id: 't1-serie0', mode: 'dias', days: '1,3,5', from_date: '2026-11-09', weeks: 1, hours: 0.5 });
    const piezas = await todos<Record<string, unknown>>("SELECT id, series_id, status, published_at, risk_notified_at FROM air_slots ORDER BY id");
    expect(piezas).toEqual([
      // "2026-11-09 10:00" en Santiago (horario de verano, UTC−3) → 13:00 UTC
      { id: 's1', series_id: 't1-serie0', status: 'Al aire', published_at: '2026-11-09T13:00:00.000Z', risk_notified_at: null },
      { id: 's2', series_id: null, status: 'Programada', published_at: null, risk_notified_at: AHORA },
    ]);
  });

  it('extrae archivos y HTML a R2 y deja la clave en D1', async () => {
    const { sql, archivos } = importar();
    await ejecutar(sql);
    expect(archivos.map((a) => [a.clave, a.tipo])).toEqual([
      ['importado/fotos/p-luz.webp', 'image/webp'],
      ['importado/campanas/c1.html', 'text/html'],
      ['importado/resultados/t1.png', 'image/png'],
    ]);
    expect(await uno("SELECT photo_key FROM people WHERE id = 'p-luz'")).toEqual({ photo_key: 'importado/fotos/p-luz.webp' });
    expect(await todos("SELECT type, text, file_key FROM task_results WHERE task_id = 't1' ORDER BY id")).toEqual([
      { type: 'image', text: null, file_key: 'importado/resultados/t1.png' },
      { type: 'text', text: 'Listo', file_key: null },
    ]);
  });

  it('importa sprints, agenda y comunidad', async () => {
    const { sql } = importar();
    await ejecutar(sql);
    expect(await todos('SELECT person_id, daily_hours FROM sprint_members ORDER BY person_id')).toEqual([
      { person_id: 'p-luz', daily_hours: 8 }, { person_id: 'p-mar', daily_hours: 6 },
    ]);
    expect(await todos('SELECT date, source FROM holidays')).toEqual([{ date: '2026-12-08', source: 'manual' }]);
    // Minutos de pared del prototipo → hora de Santiago.
    expect(await todos('SELECT starts_at, ends_at FROM work_blocks')).toEqual([{ starts_at: '2026-11-02T09:00', ends_at: '2026-11-02T11:00' }]);
    expect(await uno("SELECT count(*) AS n FROM reactions WHERE achievement_id = 'a1'")).toEqual({ n: 1 });
    expect(await uno("SELECT mentions, summary, email FROM preferences WHERE person_id = 'p-mar'")).toEqual({ mentions: 0, summary: 'Diario', email: 1 });
    expect(await uno("SELECT url FROM platform_cards WHERE name = 'Brevo'")).toEqual({ url: '' });
    // El reporte del logro descartado no se importa.
    expect(await uno('SELECT count(*) AS n FROM achievement_reports')).toEqual({ n: 0 });
  });
});
