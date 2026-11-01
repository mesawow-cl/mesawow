import { describe, expect, it } from 'vitest';
import { estadoPieza, horasDeSeries, NOMBRE_POR_CANAL, piezasDeSerie, PLANTILLAS_SERIE, plazoPropuesto, validarSerie } from '../src/shared/dominio/aire';

describe('series al aire', () => {
  it('Mail L-X-V, 4 semanas, 0,5 h: 12 piezas y 6 horas (criterio de aceptación 5)', () => {
    const s = { ...PLANTILLAS_SERIE.mail, from: '2026-11-02' };
    const p = piezasDeSerie(s);
    expect(p).toHaveLength(12);
    expect(p.slice(0, 3)).toEqual([
      { piece: 'Mail 1', at: '2026-11-02T10:00', end: null }, { piece: 'Mail 2', at: '2026-11-04T10:00', end: null }, { piece: 'Mail 3', at: '2026-11-06T10:00', end: null },
    ]);
    expect(horasDeSeries([s])).toBe(6);
  });
  it('anuncios por período: N creatividades activas hasta el fin', () => {
    expect(piezasDeSerie({ ...PLANTILLAS_SERIE.ads, from: '2026-11-09' })).toEqual([
      { piece: 'Anuncio 1', at: '2026-11-09T09:00', end: '2026-12-06' }, { piece: 'Anuncio 2', at: '2026-11-09T09:00', end: '2026-12-06' },
      { piece: 'Anuncio 3', at: '2026-11-09T09:00', end: '2026-12-06' },
    ]);
  });
  it('nombre de pieza según canal y validaciones', () => {
    expect(['Correo (Brevo)', 'LinkedIn', 'TikTok', 'WhatsApp', 'Sitio web', 'Google Ads'].map(NOMBRE_POR_CANAL)).toEqual(['Mail', 'Post', 'Video', 'Mensaje', 'Nota', 'Anuncio']);
    expect(validarSerie({ ...PLANTILLAS_SERIE.mail, days: [], from: '2026-11-02' })).toBe('Elige al menos un día.');
  });
});

describe('estado y plazo', () => {
  const ahora = '2026-11-02T12:00';
  it('primera regla que se cumple', () => {
    expect(estadoPieza({ status: 'Al aire', at: '2026-11-01T10:00' }, { hecha: true, plazo: '2026-10-30' }, ahora)).toBe('Al aire');
    expect(estadoPieza({ status: 'Programada', at: '2026-11-01T10:00' }, { hecha: true, plazo: '2026-10-30' }, ahora)).toBe('Atrasada');
    expect(estadoPieza({ status: 'Programada', at: '2026-11-03T10:00' }, { hecha: true, plazo: '2026-11-01' }, ahora)).toBe('Lista para salir');
    expect(estadoPieza({ status: 'Programada', at: '2026-11-04T10:00' }, { hecha: false, plazo: '2026-11-01' }, ahora)).toBe('En riesgo');
    expect(estadoPieza({ status: 'Programada', at: '2026-11-20T10:00' }, { hecha: false, plazo: '2026-11-18' }, ahora)).toBe('En la mesa');
  });
  it('propone la fecha límite 2 días antes de la primera salida, sin quedar en el pasado', () => {
    expect(plazoPropuesto('2026-11-20T10:00', '2026-11-02')).toBe('2026-11-18');
    expect(plazoPropuesto('2026-11-03T10:00', '2026-11-02')).toBe('2026-11-02');
  });
});
