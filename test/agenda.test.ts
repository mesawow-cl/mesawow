import { describe, expect, it } from 'vitest';
import { aMinuto, aPared, asignar, CicloDePlanificacion, recalcular, SinDisponibilidad, type ConfigJornada } from '../src/shared/dominio/agenda';
import { JORNADA_POR_DEFECTO } from '../src/shared/constantes';

const cfg: ConfigJornada = { ventanas: JORNADA_POR_DEFECTO, dias: [1, 2, 3, 4, 5], feriados: new Set(['2026-12-08']) };
const bloques = (r: { bloques: { inicio: number; fin: number }[] }) => r.bloques.map((b) => `${aPared(b.inicio)}–${aPared(b.fin).slice(11)}`);
const h = (horas: number) => horas * 60;

// 2026-11-02 es lunes.
describe('asignar horas en la jornada 09–14 / 15–18', () => {
  it('8 horas desde el lunes 09:00 terminan el lunes a las 18:00, con colación', () => {
    const r = asignar(aMinuto('2026-11-02T09:00'), h(8), [], cfg);
    expect(bloques(r)).toEqual(['2026-11-02T09:00–14:00', '2026-11-02T15:00–18:00']);
    expect(aPared(r.fin)).toBe('2026-11-02T18:00');
  });

  it('una reunión empuja el trabajo y el término', () => {
    const reunion = { inicio: aMinuto('2026-11-02T10:00'), fin: aMinuto('2026-11-02T11:00') };
    const r = asignar(aMinuto('2026-11-02T09:00'), h(8), [reunion], cfg);
    expect(bloques(r)).toEqual(['2026-11-02T09:00–10:00', '2026-11-02T11:00–14:00', '2026-11-02T15:00–18:00', '2026-11-03T09:00–10:00']);
  });

  it('si se pide empezar en la colación o fuera de horario, parte en la siguiente ventana', () => {
    expect(bloques(asignar(aMinuto('2026-11-02T14:30'), h(1), [], cfg))).toEqual(['2026-11-02T15:00–16:00']);
    expect(bloques(asignar(aMinuto('2026-11-02T19:00'), h(1), [], cfg))).toEqual(['2026-11-03T09:00–10:00']);
    expect(bloques(asignar(aMinuto('2026-11-02T07:00'), h(1), [], cfg))).toEqual(['2026-11-02T09:00–10:00']);
  });

  it('salta el fin de semana', () => {
    // 2026-11-06 es viernes.
    expect(bloques(asignar(aMinuto('2026-11-06T16:00'), h(3), [], cfg))).toEqual(['2026-11-06T16:00–18:00', '2026-11-09T09:00–10:00']);
  });

  it('salta los feriados (8 de diciembre de 2026, martes)', () => {
    expect(bloques(asignar(aMinuto('2026-12-07T17:00'), h(2), [], cfg))).toEqual(['2026-12-07T17:00–18:00', '2026-12-09T09:00–10:00']);
  });

  it('si no hay días laborales, avisa que no hay disponibilidad', () => {
    expect(() => asignar(aMinuto('2026-11-02T09:00'), 60, [], { ...cfg, dias: [] })).toThrow(SinDisponibilidad);
  });
});

describe('recalcular planes', () => {
  const plan = (tarea: string, persona: string, inicio: string, horas: number, finAnterior?: string) =>
    ({ tarea, persona, inicio: aMinuto(inicio), minutos: h(horas), finAnterior: finAnterior ? aMinuto(finAnterior) : null });

  it('una tarea empieza cuando termina la que necesita', () => {
    const r = recalcular([plan('A', 'p1', '2026-11-02T09:00', 6), plan('B', 'p2', '2026-11-02T09:00', 2)], new Map([['B', ['A']]]), new Map(), cfg);
    expect(aPared(r.get('A')!.fin)).toBe('2026-11-02T16:00');
    expect(bloques(r.get('B')!)).toEqual(['2026-11-02T16:00–18:00']);
  });

  it('las tareas de una misma persona no se superponen', () => {
    const r = recalcular([plan('A', 'p1', '2026-11-02T09:00', 3), plan('B', 'p1', '2026-11-02T09:00', 3)], new Map(), new Map(), cfg);
    expect(bloques(r.get('A')!)).toEqual(['2026-11-02T09:00–12:00']);
    expect(bloques(r.get('B')!)).toEqual(['2026-11-02T12:00–14:00', '2026-11-02T15:00–16:00']);
  });

  it('una reunión inesperada corre las tareas afectadas y queda el término anterior para avisar', () => {
    const reuniones = new Map([['p1', [{ inicio: aMinuto('2026-11-02T09:00'), fin: aMinuto('2026-11-02T12:00') }]]]);
    const r = recalcular([plan('A', 'p1', '2026-11-02T09:00', 2, '2026-11-02T11:00')], new Map(), reuniones, cfg);
    expect(aPared(r.get('A')!.fin)).toBe('2026-11-02T14:00');
    expect(aPared(r.get('A')!.finAnterior!)).toBe('2026-11-02T11:00');
  });

  it('detecta dependencias circulares', () => {
    const p = [plan('A', 'p1', '2026-11-02T09:00', 1), plan('B', 'p1', '2026-11-02T09:00', 1)];
    expect(() => recalcular(p, new Map([['A', ['B']], ['B', ['A']]]), new Map(), cfg)).toThrow(CicloDePlanificacion);
  });
});

describe('lo ya trabajado no se mueve', () => {
  it('solo reubica lo que falta, desde ahora', () => {
    // 8 h pedidas; ya se trabajaron 2 h el lunes; "ahora" es el martes 09:00 y hay reunión 09–11.
    const fijos = [{ inicio: aMinuto('2026-11-02T09:00'), fin: aMinuto('2026-11-02T11:00') }];
    const reuniones = new Map([['p1', [{ inicio: aMinuto('2026-11-03T09:00'), fin: aMinuto('2026-11-03T11:00') }]]]);
    const r = recalcular([{ tarea: 'A', persona: 'p1', inicio: aMinuto('2026-11-03T09:00'), minutos: h(8), fijos }], new Map(), reuniones, cfg);
    expect(bloques(r.get('A')!)).toEqual(['2026-11-02T09:00–11:00', '2026-11-03T11:00–14:00', '2026-11-03T15:00–18:00']);
  });
});
