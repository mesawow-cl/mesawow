// Datos de ejemplo INVENTADOS, solo para desarrollo local (seed/desarrollo.sql).
// No representan personas ni empresas reales. Correos en el dominio reservado .test.
import { MINIMOS_DE_MARCA } from '../src/shared/constantes.ts';
import type { Rol } from '../src/shared/roles.ts';
import { idMesa } from './datos-base.ts';
import { insert } from './sql.ts';

interface PersonaSemilla { id: string; name: string; role: Rol; mesa: string; marcas: string[] }

export const MARCAS_DEMO = [
  { id: 'demo-aurora', name: 'Aurora Café', color: '#2463D4' },
  { id: 'demo-boreal', name: 'Boreal Seguros', color: '#00A2AF' },
  { id: 'demo-cumbre', name: 'Cumbre Viajes', color: '#EF842B' },
];

const todas = MARCAS_DEMO.map((m) => m.id);

export const PERSONAS_DEMO: PersonaSemilla[] = [
  { id: 'demo-ana', name: 'Ana Prueba', role: 'Administrador general', mesa: 'Marketing', marcas: todas },
  { id: 'demo-bruno', name: 'Bruno Ejemplo', role: 'Coordinación de Marketing', mesa: 'Marketing', marcas: todas },
  { id: 'demo-carla', name: 'Carla Muestra', role: 'Responsable de marca o área', mesa: 'Comercial y Ventas', marcas: ['demo-aurora', 'demo-boreal'] },
  { id: 'demo-diego', name: 'Diego Ensayo', role: 'Ejecutor', mesa: 'Marketing', marcas: todas },
  { id: 'demo-elena', name: 'Elena Simulada', role: 'Ejecutor', mesa: 'Operaciones', marcas: ['demo-aurora'] },
  { id: 'demo-fabian', name: 'Fabián Ficticio', role: 'Revisor o aprobador', mesa: 'Marketing', marcas: todas },
  { id: 'demo-gloria', name: 'Gloria Directiva', role: 'Ejecutor', mesa: 'Dirección', marcas: todas },
  { id: 'demo-hugo', name: 'Hugo Consulta', role: 'Consulta', mesa: 'Finanzas', marcas: ['demo-boreal'] },
  { id: 'demo-ines', name: 'Inés Mandante', role: 'Mandante', mesa: 'Dirección', marcas: ['demo-cumbre'] },
];

export const correoDemo = (id: string) => `${id.replace('demo-', '')}@mesawow.test`;

export const sqlSemillaDesarrollo = () => {
  const l: string[] = [
    '-- mesawow · datos de ejemplo INVENTADOS para desarrollo local (no usar en staging ni production)',
    '-- Generado por `npm run datos-base`.',
    'PRAGMA defer_foreign_keys = true;',
    '',
  ];
  for (const p of PERSONAS_DEMO) {
    l.push(insert('people', { id: p.id, name: p.name, email: correoDemo(p.id), role: p.role, mesa_id: idMesa(p.mesa), phone: null }, 'INSERT OR REPLACE'));
    l.push(insert('preferences', { person_id: p.id }, 'INSERT OR IGNORE'));
  }
  l.push('');
  for (const m of MARCAS_DEMO) {
    l.push(insert('brands', { id: m.id, name: m.name, color: m.color, description: 'Marca de ejemplo', director_id: 'demo-gloria' }, 'INSERT OR REPLACE'));
    MINIMOS_DE_MARCA.forEach((title, idx) =>
      l.push(insert('brand_minimums', { brand_id: m.id, idx, title, state: idx % 4 === 0 ? 'Vigente' : 'Pendiente de verificar' }, 'INSERT OR REPLACE')));
  }
  l.push('');
  for (const p of PERSONAS_DEMO) for (const b of p.marcas) l.push(insert('person_brands', { person_id: p.id, brand_id: b }, 'INSERT OR IGNORE'));
  l.push('');
  l.push(`UPDATE mesas SET owner_id = 'demo-bruno' WHERE id = '${idMesa('Marketing')}';`);
  l.push('');
  const tareas = [
    { id: 'demo-t1', brand_id: 'demo-aurora', title: 'Definir oferta de temporada', owner_id: 'demo-carla', reviewer_id: 'demo-bruno', status: 'Aprobada', estimated_hours: 3, mesa: 'Comercial y Ventas' },
    { id: 'demo-t2', brand_id: 'demo-aurora', title: 'Diseñar mailing de lanzamiento', owner_id: 'demo-diego', reviewer_id: 'demo-fabian', status: 'En curso', estimated_hours: 6, mesa: 'Marketing' },
    { id: 'demo-t3', brand_id: 'demo-boreal', title: 'Publicaciones de la semana', owner_id: 'demo-diego', reviewer_id: 'demo-fabian', status: 'Pendiente', estimated_hours: 4, mesa: 'Marketing' },
    { id: 'demo-t4', brand_id: 'demo-cumbre', title: 'Informe mensual de resultados', owner_id: 'demo-elena', reviewer_id: 'demo-bruno', status: 'Entregada para revisión', estimated_hours: 2, mesa: 'Operaciones' },
  ];
  for (const t of tareas) {
    const { mesa, ...fila } = t;
    l.push(insert('tasks', {
      ...fila,
      mesa_id: idMesa(mesa),
      description: 'Tarea de ejemplo para desarrollo.',
      deliverable: 'Entregable de ejemplo',
      acceptance: 'Revisión aprobada y evidencia accesible.',
      start_date: '2026-11-02',
      due: '2026-11-06',
      created_by: 'demo-bruno',
    }, 'INSERT OR REPLACE'));
  }
  l.push(insert('task_dependencies', { task_id: 'demo-t2', depends_on_id: 'demo-t1' }, 'INSERT OR IGNORE'));
  return l.join('\n') + '\n';
};
