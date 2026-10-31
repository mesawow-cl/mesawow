import { describe, expect, it } from 'vitest';
import { hoySantiago, minutoDeParedAIso, santiagoAUtc, utcASantiago } from '../src/shared/fechas';

describe('fechas en America/Santiago', () => {
  it('convierte hora de Santiago a UTC en horario de verano (UTC−3) y de invierno (UTC−4)', () => {
    expect(santiagoAUtc('2026-11-02T10:00')).toBe('2026-11-02T13:00:00.000Z');
    expect(santiagoAUtc('2026-07-01T10:00')).toBe('2026-07-01T14:00:00.000Z');
  });

  it('ida y vuelta conserva la hora de pared', () => {
    for (const p of ['2026-01-15T09:00', '2026-06-30T18:00', '2026-12-31T23:59']) expect(utcASantiago(santiagoAUtc(p))).toBe(p);
  });

  it('el día de hoy se calcula en Santiago, no en UTC', () => {
    // 02:00 UTC del 3 de noviembre = 23:00 del 2 de noviembre en Santiago.
    expect(hoySantiago(new Date('2026-11-03T02:00:00Z'))).toBe('2026-11-02');
  });

  it('interpreta los minutos de pared del prototipo', () => {
    expect(minutoDeParedAIso(Date.parse('2026-11-02T09:00Z') / 60000)).toBe('2026-11-02T09:00');
  });
});
