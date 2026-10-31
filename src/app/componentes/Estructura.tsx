// Menú lateral, barra superior, pestañas y barra inferior (render final del prototipo, líneas 1279–1330).
import { ESPACIOS, espacioDe, pestanasVisibles, type EspacioId, type Vista } from '../../shared/navegacion';
import type { Permisos } from '../../shared/roles';
import { isotipo, logoNegativo } from '../marca';
import { hrefDe } from '../rutas';
import { Icono } from './Icono';

export const iniciales = (nombre: string) =>
  nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

/** Espacio activo: el de la vista, respetando desde dónde se entró a "Dos calendarios". */
export const espacioActivo = (vista: Vista, desde?: EspacioId) => espacioDe(vista, desde);

const primeraPestana = (id: EspacioId, permisos: Permisos) => {
  const e = ESPACIOS.find((x) => x.id === id)!;
  return pestanasVisibles(e, permisos)[0]?.vista ?? 'profile';
};

export const MenuLateral = ({ vista, desde, permisos }: { vista: Vista; desde?: EspacioId; permisos: Permisos }) => {
  const activo = espacioActivo(vista, desde);
  return (
    <aside class="lateral">
      <a class="lateral-logo" href="/" aria-label="mesawow, ir al Inicio">
        <img src={logoNegativo} alt="mesawow" width={150} height={40} />
      </a>
      <nav aria-label="Espacios">
        {ESPACIOS.map((e) => {
          const pestanas = pestanasVisibles(e, permisos);
          const esActivo = e.id === activo;
          return (
            <div key={e.id}>
              <a class="espacio-btn" href={hrefDe(primeraPestana(e.id, permisos), e.id)} aria-current={esActivo}
                style={{ textDecoration: 'none' }}>
                <Icono nombre={e.icono} />{e.etiqueta}
              </a>
              {esActivo && pestanas.length > 1 && (
                <div class="subnav">
                  {pestanas.map((t) => (
                    <a key={t.vista} href={hrefDe(t.vista, e.id)} aria-current={t.vista === vista ? 'page' : undefined}>{t.etiqueta}</a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <p class="lateral-pie">La plataforma donde el trabajo se vive, se comparte y se celebra.</p>
    </aside>
  );
};

export const BarraSuperior = ({ nombre, alertas, alAbrirCampana, alAbrirCuenta }: {
  nombre: string;
  alertas: number;
  alAbrirCampana: () => void;
  alAbrirCuenta: () => void;
}) => (
  <header class="superior">
    <div class="superior-izq">
      <a class="superior-logo" href="/" aria-label="mesawow, ir al Inicio"><img src={isotipo} alt="" width={34} height={34} /></a>
      <span class="superior-lema">Planificar. Construir. Entregar.</span>
    </div>
    <div class="superior-der">
      <button type="button" class="icono-btn" onClick={alAbrirCampana}
        aria-label={alertas ? `Alertas, ${alertas} sin leer` : 'Alertas'}>
        <Icono nombre="bell" />
        {alertas > 0 && <span class="contador" aria-hidden="true">{alertas > 9 ? '9+' : alertas}</span>}
      </button>
      <button type="button" class="avatar-btn" onClick={alAbrirCuenta} aria-label={`Tu cuenta: ${nombre}`}>
        {iniciales(nombre)}
      </button>
    </div>
  </header>
);

/** Pestañas tipo píldora sobre el contenido (solo teléfono; en escritorio están en el menú lateral). */
export const Pestanas = ({ vista, desde, permisos }: { vista: Vista; desde?: EspacioId; permisos: Permisos }) => {
  const id = espacioActivo(vista, desde);
  if (!id) return null;
  const pestanas = pestanasVisibles(ESPACIOS.find((e) => e.id === id)!, permisos);
  if (pestanas.length < 2) return null;
  return (
    <nav class="pestanas" aria-label="Secciones del espacio">
      {pestanas.map((t) => (
        <a key={t.vista} href={hrefDe(t.vista, id)} aria-current={t.vista === vista ? 'page' : undefined}>{t.etiqueta}</a>
      ))}
    </nav>
  );
};

/** Barra inferior del teléfono: Inicio · Mi trabajo · ＋ · Mesas · Más. */
export const BarraInferior = ({ vista, desde, permisos, alCrear }: {
  vista: Vista; desde?: EspacioId; permisos: Permisos; alCrear: () => void;
}) => {
  const activo = vista === 'more' ? 'more' : espacioActivo(vista, desde);
  const enMas = activo === 'more' || activo === 'aire' || activo === 'equipo';
  const item = (id: 'inicio' | 'trabajo' | 'mesas', etiqueta: string, icono: 'home' | 'check' | 'layers') => (
    <a href={hrefDe(primeraPestana(id, permisos), id)} aria-current={activo === id ? 'page' : undefined}>
      <span class="ic"><Icono nombre={icono} /></span>{etiqueta}
    </a>
  );
  return (
    <nav class="inferior" aria-label="Navegación principal">
      {item('inicio', 'Inicio', 'home')}
      {item('trabajo', 'Mi trabajo', 'check')}
      <button type="button" class="crear" onClick={alCrear} aria-label="Crear"><Icono nombre="plus" tam={26} /></button>
      {item('mesas', 'Mesas', 'layers')}
      <a href={hrefDe('more')} aria-current={enMas ? 'page' : undefined}>
        <span class="ic"><Icono nombre="grid" /></span>Más
      </a>
    </nav>
  );
};
