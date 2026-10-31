import { describe, expect, it } from 'vitest';
import { ESPACIOS, espacioDe, OPCIONES_CREAR, pestanasVisibles, vistaPermitida, type Vista } from '../src/shared/navegacion';
import { permisosDe, type Rol } from '../src/shared/roles';

const p = (role: Rol, mesa = 'Marketing') => permisosDe({ role, mesa });
const vistas = (role: Rol, mesa?: string) =>
  ESPACIOS.flatMap((e) => pestanasVisibles(e, p(role, mesa)).map((t) => t.vista));

describe('permisos derivados', () => {
  it('solo el Administrador general es admin', () => {
    expect(p('Administrador general').esAdmin).toBe(true);
    for (const r of ['Administración', 'Coordinación de Marketing', 'Ejecutor'] as Rol[]) expect(p(r).esAdmin).toBe(false);
  });

  it('coordinan admin, Administración, Coordinación de Marketing y Responsable de marca o área', () => {
    const coordinan = (['Administrador general', 'Administración', 'Coordinación de Marketing', 'Responsable de marca o área'] as Rol[]);
    for (const r of coordinan) expect(p(r).coordina).toBe(true);
    for (const r of ['Ejecutor', 'Revisor o aprobador', 'Consulta', 'Mandante'] as Rol[]) expect(p(r).coordina).toBe(false);
  });

  it('quien pertenece a la mesa Dirección "dirige" aunque no coordine', () => {
    const d = p('Ejecutor', 'Dirección');
    expect(d.coordina).toBe(false);
    expect(d.coordinaODirige).toBe(true);
  });

  it('los roles externos no son equipo y Consulta es solo lectura', () => {
    for (const r of ['Mandante', 'Consulta externa', 'Administrador técnico'] as Rol[]) expect(p(r).esEquipo).toBe(false);
    expect(p('Consulta').esEquipo).toBe(true);
    expect(p('Consulta').soloLectura).toBe(true);
  });
});

describe('navegación de 5 espacios', () => {
  it('tiene los espacios Inicio, Mi trabajo, Mesas, Al aire y Equipo', () => {
    expect(ESPACIOS.map((e) => e.etiqueta)).toEqual(['Inicio', 'Mi trabajo', 'Mesas', 'Al aire', 'Equipo']);
  });

  it('un Ejecutor no ve herramientas de coordinación ni administración', () => {
    const v = vistas('Ejecutor');
    for (const oculta of ['recognition', 'strategy', 'bases', 'connections', 'settings', 'team', 'reports', 'coverage', 'moderation'] as Vista[]) {
      expect(v).not.toContain(oculta);
    }
    for (const visible of ['muro', 'plaza', 'agenda', 'calendario', 'tasks', 'aire', 'profile'] as Vista[]) expect(v).toContain(visible);
  });

  it('coordinación ve bases, plataformas y alcance, pero no Equipo ni Moderación', () => {
    const v = vistas('Coordinación de Marketing');
    expect(v).toEqual(expect.arrayContaining(['bases', 'connections', 'settings', 'coverage', 'strategy', 'reports', 'recognition']));
    expect(v).not.toContain('team');
    expect(v).not.toContain('moderation');
  });

  it('el administrador ve todas las pestañas', () => {
    const todas = new Set(ESPACIOS.flatMap((e) => e.pestanas.map((t) => t.vista)));
    expect(new Set(vistas('Administrador general'))).toEqual(todas);
  });

  it('Dos calendarios respeta el espacio desde el que se entró', () => {
    expect(espacioDe('calendario')).toBe('trabajo');
    expect(espacioDe('calendario', 'aire')).toBe('aire');
    expect(espacioDe('calendario', 'mesas')).toBe('trabajo');
  });

  it('la vista "Más" siempre está permitida y una vista oculta no', () => {
    expect(vistaPermitida('more', p('Ejecutor'))).toBe(true);
    expect(vistaPermitida('moderation', p('Ejecutor'))).toBe(false);
  });

  it('el botón ＋ ofrece tarea y salida al aire solo a coordinación', () => {
    const opciones = (r: Rol) => OPCIONES_CREAR.filter((o) => o.visible(p(r))).map((o) => o.id);
    expect(opciones('Coordinación de Marketing')).toEqual(['tarea', 'aire', 'catalogo', 'compromiso']);
    expect(opciones('Ejecutor')).toEqual(['catalogo', 'compromiso']);
    expect(opciones('Mandante')).toEqual(['catalogo']);
  });
});
