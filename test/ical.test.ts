import { describe, expect, it } from 'vitest';
import { generarIcal, leerIcal } from '../src/shared/dominio/ical';

const cal = (...eventos: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...eventos, 'END:VCALENDAR'].join('\r\n');
const ev = (...l: string[]) => ['BEGIN:VEVENT', ...l, 'END:VEVENT'].join('\r\n');
const leer = (c: string) => leerIcal(c, '2030-01-01T00:00', '2030-01-31T23:59').map((r) => `${r.inicio}–${r.fin.slice(11)} ${r.titulo}`);

describe('lector iCal', () => {
  it('convierte UTC y otras zonas a hora de Santiago (verano: UTC−3)', () => {
    expect(leer(cal(
      ev('UID:a', 'SUMMARY:Cliente', 'DTSTART:20300107T130000Z', 'DTEND:20300107T140000Z'),
      ev('UID:b', 'SUMMARY:Madrid', 'DTSTART;TZID=Europe/Madrid:20300108T150000', 'DTEND;TZID=Europe/Madrid:20300108T160000'),
      ev('UID:c', 'SUMMARY:Local', 'DTSTART;TZID=America/Santiago:20300109T100000', 'DURATION:PT1H30M'),
    ))).toEqual(['2030-01-07T10:00–11:00 Cliente', '2030-01-08T11:00–12:00 Madrid', '2030-01-09T10:00–11:30 Local']);
  });

  it('ignora todo el día, disponibles y cancelados; une líneas dobladas y textos escapados', () => {
    expect(leer(cal(
      ev('UID:d', 'SUMMARY:Feriado', 'DTSTART;VALUE=DATE:20300110', 'DTEND;VALUE=DATE:20300111'),
      ev('UID:e', 'SUMMARY:Libre', 'TRANSP:TRANSPARENT', 'DTSTART:20300110T130000Z', 'DTEND:20300110T140000Z'),
      ev('UID:f', 'SUMMARY:Anulada', 'STATUS:CANCELLED', 'DTSTART:20300110T130000Z', 'DTEND:20300110T140000Z'),
      ev('UID:g', 'SUMMARY:Revisión\\, sem', ' anal', 'DTSTART:20300110T150000Z', 'DTEND:20300110T160000Z'),
    ))).toEqual(['2030-01-10T12:00–13:00 Revisión, semanal']);
  });

  it('expande reuniones semanales con excepciones, fechas excluidas y fin', () => {
    expect(leer(cal(
      ev('UID:w', 'SUMMARY:Comité', 'DTSTART;TZID=America/Santiago:20300107T090000', 'DTEND;TZID=America/Santiago:20300107T100000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20300120T000000Z', 'EXDATE;TZID=America/Santiago:20300109T090000'),
      ev('UID:w', 'RECURRENCE-ID;TZID=America/Santiago:20300114T090000', 'SUMMARY:Comité movido', 'DTSTART;TZID=America/Santiago:20300114T150000', 'DTEND;TZID=America/Santiago:20300114T160000'),
    ))).toEqual(['2030-01-07T09:00–10:00 Comité', '2030-01-14T15:00–16:00 Comité movido', '2030-01-16T09:00–10:00 Comité']);
  });

  it('expande diarias con COUNT y mensuales por día de la semana', () => {
    expect(leer(cal(ev('UID:d', 'SUMMARY:Daily', 'DTSTART:20300107T120000Z', 'DTEND:20300107T121500Z', 'RRULE:FREQ=DAILY;COUNT=3')))).toHaveLength(3);
    expect(leer(cal(ev('UID:m', 'SUMMARY:Mensual', 'DTSTART:20291203T130000Z', 'DTEND:20291203T140000Z', 'RRULE:FREQ=MONTHLY;BYDAY=1MO'))))
      .toEqual(['2030-01-07T10:00–11:00 Mensual']);
  });

  it('genera el calendario de bloques para Google', () => {
    const ics = generarIcal('Diego', [{ id: 'b1', titulo: 'Landing, verano', inicio: '2030-01-07T09:00', fin: '2030-01-07T14:00', enlace: 'https://app.mesawow.cl/encargos?tarea=t1' }], '2030-01-01T00:00:00.000Z');
    expect(ics).toContain('DTSTART;TZID=America/Santiago:20300107T090000');
    expect(ics).toContain('SUMMARY:🛠 Landing\\, verano');
    expect(leerIcal(ics, '2030-01-01T00:00', '2030-01-31T23:59')).toEqual([{ id: 'b1@mesawow.cl@2030-01-07T09:00', titulo: '🛠 Landing, verano', inicio: '2030-01-07T09:00', fin: '2030-01-07T14:00' }]);
  });
});
