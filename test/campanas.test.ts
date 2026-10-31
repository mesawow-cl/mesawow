import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { analizarContactos, celdaCSV, parsearCSV } from '../src/shared/dominio/contactos';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const COORD = 'bruno@mesawow.test', DIEGO = 'diego@mesawow.test';
const fila = <T = any>(sql: string, ...p: unknown[]) => env.DB.prepare(sql).bind(...p).first<T>();
const pedir = (ruta: string, metodo: string, cuerpo?: unknown, como = COORD) => llamar(ruta, { como, metodo, cuerpo });

const CSV = 'email;nombre;comuna;interes;autorizado;baja\n' +
  'ana@x.cl;Ana;Providencia;Inversión;si;\n' +
  'ANA@x.cl;Ana 2;Providencia;Inversión;si;\n' +
  'malo;Malo;Ñuñoa;;si;\n' +
  'beto@x.cl;Beto;Las Condes;Inversión;no;\n' +
  'caro@x.cl;Caro;Providencia;Propiedades;si;\n' +
  'dani@x.cl;Dani;Providencia;Inversión;si;\n' +
  'dani@x.cl;Dani;Providencia;Inversión;si;si\n';

describe('contactos (reglas puras)', () => {
  it('clasifica inválidos, duplicados, sin respaldo y bajas (la baja anula el mismo correo)', () => {
    const a = analizarContactos(parsearCSV(CSV));
    expect(a.filas.map((f) => f.status)).toEqual(['Habilitado', 'Duplicado', 'Inválido', 'Pendiente de respaldo', 'Habilitado', 'Baja', 'Baja']);
    expect(a.stats).toEqual({ total: 7, invalid: 1, duplicates: 1, excluded: 2, pending: 1, eligible: 2 });
  });

  it('lee comillas con separador coma y avisa si faltan columnas', () => {
    expect(parsearCSV('email,nombre\n"a@x.cl","Pérez, ""Pepe"""')).toEqual([['email', 'nombre'], ['a@x.cl', 'Pérez, "Pepe"']]);
    expect(() => analizarContactos([['nombre'], ['x']])).toThrow(/columna de correo/);
    expect(() => parsearCSV('email\n"a@x.cl')).toThrow(/comillas/);
  });

  it('la exportación neutraliza fórmulas', () => {
    expect(celdaCSV('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(celdaCSV('Ana')).toBe('"Ana"');
  });
});

describe('bases, segmentos y campañas', () => {
  beforeEach(cargarSemilla);

  const cargarBase = () => llamar('/bases?marca=demo-aurora&nombre=clientes.csv', { como: COORD, metodo: 'POST', cuerpo: new TextEncoder().encode(CSV) });

  it('solo coordinación carga bases; el segmento cuenta habilitados sin bajas de la marca', async () => {
    expect((await llamar('/bases?marca=demo-aurora', { como: DIEGO, metodo: 'POST', cuerpo: new TextEncoder().encode(CSV) })).status).toBe(403);
    const b = await cargarBase();
    expect(b.cuerpo.stats.eligible).toBe(2);
    const s = await pedir('/segmentos', 'POST', { baseId: b.cuerpo.id, nombre: 'Inversión Providencia', ubicacion: 'provi', interes: 'invers' });
    expect(s.cuerpo.contactos).toBe(1); // ana (dani es baja)
    expect((await pedir('/segmentos', 'POST', { baseId: b.cuerpo.id, nombre: 'Nadie', ubicacion: 'Arica' })).cuerpo.error.code).toBe('vacio');
    const csv = await llamar(`/segmentos/${s.cuerpo.id}/exportar`, { como: COORD });
    expect(new TextDecoder().decode(csv.cuerpo)).toBe('nombre,email,ubicacion,interes\r\n"Ana","ana@x.cl","Providencia","Inversión"');
  });

  it('una baja en otra base de la marca suprime el contacto', async () => {
    const b = await cargarBase();
    await llamar('/bases?marca=demo-aurora', { como: COORD, metodo: 'POST', cuerpo: new TextEncoder().encode('email;baja\nana@x.cl;si\n') });
    expect((await pedir('/segmentos', 'POST', { baseId: b.cuerpo.id, nombre: 'Todos' })).cuerpo.contactos).toBe(1); // solo caro
  });

  it('editar crea una versión nueva en borrador; aprobar exige el checklist; programar exige la versión aprobada', async () => {
    const { cuerpo: { id } } = await pedir('/campanas', 'POST', { nombre: 'Conversaciones que construyen confianza', marcaId: 'demo-aurora' });
    const intento = await pedir(`/campanas/${id}/aprobar`, 'POST');
    expect(intento.cuerpo.error.message).toMatch(/objetivo, indicador y meta/);
    const b = await cargarBase();
    const s = await pedir('/segmentos', 'POST', { baseId: b.cuerpo.id, nombre: 'Interesados', interes: 'invers' });
    await pedir(`/campanas/${id}/brief`, 'PATCH', { nombre: 'Conversaciones', objetivo: 'Agendamientos', indicador: 'Reuniones', meta: '40', inicio: '2030-01-07', fin: '2030-01-31' });
    await pedir(`/campanas/${id}/segmento`, 'PATCH', { segmentoId: s.cuerpo.id });
    await pedir(`/campanas/${id}/contenido`, 'PATCH', { asunto: 'Tu próximo paso', url: 'https://x.test', html: '<p>Hola</p>' });
    await pedir(`/campanas/${id}/configuracion`, 'PATCH', { remitente: 'equipo@aurora.test', respuesta: 'hola@aurora.test' });
    expect(await fila('SELECT version, status FROM campaigns WHERE id = ?1', id)).toEqual({ version: 5, status: 'Borrador' });
    expect((await pedir(`/campanas/${id}/aprobar`, 'POST', undefined, DIEGO)).status).toBe(403);
    expect((await pedir(`/campanas/${id}/aprobar`, 'POST')).status).toBe(200);
    expect(await fila('SELECT approved_version, status FROM campaigns WHERE id = ?1', id)).toEqual({ approved_version: 5, status: 'Aprobada' });
    // Un cambio posterior anula la aprobación.
    await pedir(`/campanas/${id}/configuracion`, 'PATCH', { remitente: 'otro@aurora.test', respuesta: 'hola@aurora.test' });
    expect((await pedir(`/campanas/${id}/programar`, 'POST', { fecha: '2030-01-10', hora: '10:00' })).cuerpo.error.code).toBe('sin_aprobar');
    await pedir(`/campanas/${id}/aprobar`, 'POST');
    expect((await pedir(`/campanas/${id}/programar`, 'POST', { fecha: '2030-01-10', hora: '10:00', externa: true })).status).toBe(400);
    expect((await pedir(`/campanas/${id}/programar`, 'POST', { fecha: '2030-01-10', hora: '10:00' })).status).toBe(200);
    const det = await llamar(`/campanas/${id}`, { como: COORD });
    expect(det.cuerpo.campana).toMatchObject({ status: 'Calendarizada', html: '<p>Hola</p>' });
  });

  it('el lanzamiento real exige fecha pasada o de hoy y un enlace de evidencia', async () => {
    const { cuerpo: { id } } = await pedir('/campanas', 'POST', { nombre: 'Lanzamiento', marcaId: 'demo-aurora' });
    expect((await pedir(`/campanas/${id}/lanzamiento`, 'POST', { fecha: '2099-01-01', evidencia: 'https://x.test' })).status).toBe(400);
    expect((await pedir(`/campanas/${id}/lanzamiento`, 'POST', { fecha: '2026-01-01', evidencia: 'javascript:alert(1)' })).status).toBe(400);
    expect((await pedir(`/campanas/${id}/lanzamiento`, 'POST', { fecha: '2026-01-01', evidencia: 'https://instagram.com/p/1' })).status).toBe(200);
  });
});
