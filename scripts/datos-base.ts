// Construye el SQL de datos base (iguales en local, staging y production).
import { CATALOGO_SERVICIOS, pasosDeServicio } from '../src/shared/catalogo.ts';
import { DIAS_REVISION_AIRE, JORNADA_POR_DEFECTO, MESAS_POR_DEFECTO, PLATAFORMAS, ZONA_HORARIA } from '../src/shared/constantes.ts';
import { insert, slug } from './sql.ts';

export const idMesa = (nombre: string) => `mesa-${slug(nombre)}`;
export const idPlantilla = (clave: string) => `servicio-${clave}`;

export const sqlDatosBase = () => {
  const lineas: string[] = [
    '-- mesawow · datos base (generado por `npm run datos-base`; no editar a mano)',
    '-- Fuente: src/shared/constantes.ts y src/shared/catalogo.ts',
    '',
  ];
  for (const nombre of MESAS_POR_DEFECTO) lineas.push(insert('mesas', { id: idMesa(nombre), name: nombre, active: 1 }));
  lineas.push('');
  for (const s of CATALOGO_SERVICIOS) {
    lineas.push(insert('service_templates', {
      id: idPlantilla(s[0]),
      key: s[0],
      name: s[1],
      version: 1,
      steps_json: JSON.stringify(pasosDeServicio(s)),
      builtin: 1,
    }));
  }
  lineas.push('');
  for (const nombre of PLATAFORMAS) lineas.push(insert('platform_cards', { name: nombre }));
  lineas.push(insert('channel_cards', { channel: 'Correo', provider: 'Brevo' }));
  lineas.push(insert('channel_cards', { channel: 'WhatsApp', provider: 'Brevo · WhatsApp Business' }));
  lineas.push('');
  const ajustes: Record<string, unknown> = {
    zona_horaria: ZONA_HORARIA,
    jornada: JORNADA_POR_DEFECTO,
    dias_laborales: [1, 2, 3, 4, 5],
    dias_revision_aire: DIAS_REVISION_AIRE,
  };
  for (const [key, value] of Object.entries(ajustes)) lineas.push(insert('settings', { key, value: JSON.stringify(value) }));
  return lineas.join('\n') + '\n';
};
