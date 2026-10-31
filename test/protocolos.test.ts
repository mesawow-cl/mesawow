import { describe, expect, it } from 'vitest';
import { JORNADA_POR_DEFECTO } from '../src/shared/constantes';
import { aMinuto, aPared } from '../src/shared/dominio/agenda';
import { ALCANCE_POR_DEFECTO, diaHabil, fechaCampana, generar360, generarTrabajo, generarWebinar, pasosDelCatalogo, proponerSemanas } from '../src/shared/dominio/protocolos';

describe('fechas de protocolo', () => {
  it('fechaCampana: mismo día del mes, acotado al último día, y luego días corridos', () => {
    expect(fechaCampana('2026-01-31', 1)).toBe('2026-02-28');
    expect(fechaCampana('2026-11-02', 3, -1)).toBe('2027-02-01');
    expect(fechaCampana('2026-11-02', 0, 14)).toBe('2026-11-16');
  });
  it('diaHabil cuenta lunes a viernes', () => {
    expect(diaHabil('2026-11-09', -1)).toBe('2026-11-06');
    expect(diaHabil('2026-11-06', 1)).toBe('2026-11-09');
  });
});

describe('campaña 360', () => {
  const t = generar360({ inicio: '2026-11-02', alcance: ALCANCE_POR_DEFECTO, canales: ['Meta Ads', 'Brevo'], inputsListos: true });

  it('con el alcance por defecto genera exactamente 437 tareas', () => {
    expect(t).toHaveLength(437);
  });
  it('la preparación respeta sus dependencias y el cierre depende de todo', () => {
    const p = (k: string) => t.find((x) => x.clave === k)!;
    expect(p('p5').dependencias).toEqual(['p3']);
    expect(p('p7').dependencias).toEqual(['p4', 'p5', 'p6']);
    expect(p('p32').dependencias).toHaveLength(436);
    expect(p('p0')).toMatchObject({ rol: 'Comercial', inicio: '2026-11-02', plazo: '2026-11-04', horas: 3, herramienta: 'ChatGPT' });
    expect(p('p2').herramienta).toBe('Brevo');
  });
  it('cada unidad mensual es una cadena que parte de la aprobación de la preparación', () => {
    const unidad = t.filter((x) => x.clave.startsWith('m1-email2-'));
    expect(unidad.map((x) => x.titulo)).toEqual([
      'Mes 2 · Mailing o newsletter HTML 3 · Brief y revisión de base', 'Mes 2 · Mailing o newsletter HTML 3 · Segmentación y exclusiones',
      'Mes 2 · Mailing o newsletter HTML 3 · Asunto preheader copy y HTML móvil', 'Mes 2 · Mailing o newsletter HTML 3 · Revisión de HTML y enlaces',
      'Mes 2 · Mailing o newsletter HTML 3 · Configurar y probar envío', 'Mes 2 · Mailing o newsletter HTML 3 · Aprobar y programar',
      'Mes 2 · Mailing o newsletter HTML 3 · Informe de entrega y resultados',
    ]);
    expect(unidad[0]!.dependencias).toEqual(['p7']);
    expect(unidad[0]).toMatchObject({ inicio: '2026-12-02', plazo: '2027-01-01' });
    expect(t.find((x) => x.clave === 'm0-graphic0-0')!.herramienta).toBe('Canva');
  });
  it('el alcance cambia el total', () => {
    expect(generar360({ inicio: '2026-11-02', alcance: { organic: 0, video: 0, email: 1, ads: 0 }, canales: [], inputsListos: false })).toHaveLength(8 + 5 + 6 + 3 * (7 + 3) + 1);
  });
});

describe('webinar', () => {
  const w = generarWebinar({ fechaEvento: '2026-12-10', minutos: 90, plataforma: 'Google Meet', canales: ['Meta Ads'] });
  it('genera 31 tareas, ~84,5 h, de 20 días hábiles antes a 5 después', () => {
    expect(w).toHaveLength(31);
    expect(w.reduce((n, x) => n + x.horas, 0)).toBe(84.5);
    expect(w[0]!.inicio).toBe(diaHabil('2026-12-10', -20));
    expect(w[30]!.inicio).toBe(diaHabil('2026-12-10', 5));
  });
  it('el recordatorio es el día corrido anterior y el evento queda fijo con su duración', () => {
    expect(w[22]!.inicio).toBe('2026-12-09');
    expect(w[24]).toMatchObject({ eventoFijo: true, horas: 1.5, inicio: '2026-12-10' });
    expect(w.every((x) => !x.inputsListos)).toBe(true);
  });
});

describe('trabajos del catálogo', () => {
  it('una cadena por unidad; los pasos de revisión los hace el revisor', () => {
    const t = generarTrabajo({ titulo: 'Posts de diciembre', pasos: pasosDelCatalogo('organic')!, cantidad: 2, inicio: '2026-12-01', plazo: '2026-12-05', inputsListos: true });
    expect(t).toHaveLength(12);
    expect(t[0]!.titulo).toBe('Posts de diciembre · Unidad 1 · Brief y objetivo');
    expect(t[7]!.dependencias).toEqual(['u1-0']);
    expect(t.filter((x) => x.rol === 'Revisión').map((x) => x.titulo)).toEqual([
      'Posts de diciembre · Unidad 1 · Revisión y ajustes', 'Posts de diciembre · Unidad 1 · Aprobar y programar publicación',
      'Posts de diciembre · Unidad 2 · Revisión y ajustes', 'Posts de diciembre · Unidad 2 · Aprobar y programar publicación',
    ]);
  });
});

describe('propuesta semanal', () => {
  const cfg = { ventanas: JORNADA_POR_DEFECTO, dias: [1, 2, 3, 4, 5], feriados: new Set<string>() };
  const tarea = (id: string, horas: number, extra = {}) => ({ id, titulo: id, responsable: 'p1', responsableTieneMarca: true, horas, plazo: '2030-01-11', prioridad: 'Media', bloqueada: false, inputsListos: true, sprintIniciado: false, dependencias: [] as string[], ...extra });
  const base = { hechas: new Set<string>(), terminos: new Map(), reuniones: new Map(), reservado: new Map(), cfg, desde: '2030-01-07' };

  it('reparte en la semana sin pasar el 80 % y pasa a la siguiente cuando no cabe', () => {
    const r = proponerSemanas({ ...base, tareas: [tarea('a', 20), tarea('b', 20)] });
    expect(r.propuestas.map((x) => [x.id, x.semana])).toEqual([['a', '2030-01-07'], ['b', '2030-01-14']]);
    expect(r.propuestas[1]!.tarde).toBe(true);
  });

  it('una tarea más grande que el 80 % de una semana no cabe', () => {
    expect(proponerSemanas({ ...base, tareas: [tarea('a', 33)] }).problemas).toEqual([{ id: 'a', motivo: 'No cabe en un sprint: dividir el entregable o revisar capacidad.' }]);
  });

  it('respeta dependencias y propaga prioridad a los prerrequisitos', () => {
    const r = proponerSemanas({ ...base, tareas: [tarea('b', 4, { dependencias: ['a'], prioridad: 'Urgente' }), tarea('c', 4, { prioridad: 'Alta' }), tarea('a', 4)] });
    expect(r.propuestas.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(aPared(r.propuestas[1]!.bloques[0]!.inicio)).toBe(aPared(r.propuestas[0]!.fin));
  });

  it('informa inputs sin validar, bloqueos y sprints ya iniciados', () => {
    const r = proponerSemanas({ ...base, tareas: [tarea('a', 2, { inputsListos: false }), tarea('b', 2, { bloqueada: true }), tarea('c', 2, { sprintIniciado: true })] });
    expect(r.problemas.map((x) => x.motivo)).toEqual(['Inputs sin validar.', 'Bloqueo pendiente.', 'Sprint iniciado o cerrado: cambio explícito de alcance requerido.']);
  });

  it('descuenta reuniones de la capacidad neta', () => {
    const reuniones = new Map([['p1', [{ inicio: aMinuto('2030-01-07T09:00'), fin: aMinuto('2030-01-08T18:00') }]]]);
    // Semana con 2 días de reuniones: neta 24 h → tope 19,2 h; 20 h no caben.
    expect(proponerSemanas({ ...base, reuniones, tareas: [tarea('a', 20)] }).propuestas[0]!.semana).toBe('2030-01-14');
  });
});
