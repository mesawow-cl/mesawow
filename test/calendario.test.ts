import { beforeEach, describe, expect, it } from 'vitest';
import { llamar } from './cliente';
import { cargarSemilla } from './utilidades';

const COORD = 'bruno@mesawow.test', DIEGO = 'diego@mesawow.test', GLORIA = 'gloria@mesawow.test';

describe('dos calendarios y semana del equipo', () => {
  beforeEach(cargarSemilla);
  const preparar = async () => {
    const { cuerpo } = await llamar('/tareas', { como: COORD, metodo: 'POST', cuerpo: {
      titulo: 'Mails', marcaId: 'demo-aurora', descripcion: 'Mails', entregable: 'HTML', criterio: 'Ok', responsableId: 'demo-diego', inicio: '2030-01-07', plazo: '2030-01-11', horas: 12,
    } });
    await llamar(`/tareas/${cuerpo.id}/aire`, { como: COORD, metodo: 'PUT', cuerpo: { activo: true, sueltas: [{ channel: 'Instagram', at: '2030-01-14T12:00' }] } });
    return cuerpo.id as string;
  };

  it('el calendario trae trabajo y salidas; cada persona ve el suyo y dirección el del equipo', async () => {
    await preparar();
    const propio = await llamar('/calendario?desde=2030-01-01&hasta=2030-01-31', { como: DIEGO });
    expect(propio.cuerpo.bloques.length).toBeGreaterThan(0);
    expect(propio.cuerpo.piezas).toHaveLength(1);
    expect((await llamar('/calendario?desde=2030-01-01&hasta=2030-01-31&persona=demo-carla', { como: DIEGO })).status).toBe(403);
    const equipo = await llamar('/calendario?desde=2030-01-01&hasta=2030-01-31', { como: GLORIA });
    expect(equipo.cuerpo.persona).toBeNull();
    expect((await llamar('/calendario?desde=2030-01-01&hasta=2030-06-30', { como: GLORIA })).status).toBe(400);
  });

  it('la Semana del equipo muestra horas sobre 40 y lo que sale al aire', async () => {
    await preparar();
    expect((await llamar('/semana-equipo?semana=2030-01-07', { como: DIEGO })).status).toBe(403);
    const r = await llamar('/semana-equipo?semana=2030-01-07', { como: GLORIA });
    expect(r.cuerpo.personas[0]).toMatchObject({ nombre: 'Diego Ensayo', horas: 12, capacidad: 40 });
    const s2 = await llamar('/semana-equipo?semana=2030-01-14', { como: COORD });
    expect(s2.cuerpo.alAire).toHaveLength(1);
  });
});
