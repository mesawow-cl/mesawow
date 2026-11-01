// ＋ "¿Qué quieres crear?", menú de cuenta y campana de alertas.
import { OPCIONES_CREAR, type OpcionCrear } from '../../shared/navegacion';
import type { Persona } from '../api';
import { sonrisa } from '../marca';
import { ir } from '../rutas';
import { Dialogo } from './Dialogo';
import { iniciales } from './Estructura';
import { Icono, type NombreIcono } from './Icono';

const ICONO_CREAR: Record<OpcionCrear['id'], NombreIcono> = {
  tarea: 'check', aire: 'rocket', catalogo: 'layers', compromiso: 'sparkle',
};

export const MenuCrear = ({ abierto, alCerrar, persona, alElegir }: {
  abierto: boolean; alCerrar: () => void; persona: Persona; alElegir: (id: OpcionCrear['id']) => void;
}) => (
  <Dialogo titulo="¿Qué quieres crear?" abierto={abierto} alCerrar={alCerrar}>
    <ul class="crear-lista">
      {OPCIONES_CREAR.filter((o) => o.visible(persona.permisos)).map((o) => (
        <li key={o.id}>
          <button type="button" onClick={() => alElegir(o.id)}>
            <span class="ic"><Icono nombre={ICONO_CREAR[o.id]} /></span>
            <span>{o.titulo}<small>{o.detalle}</small></span>
          </button>
        </li>
      ))}
    </ul>
  </Dialogo>
);

export interface PersonaVisible { id: string; name: string }

export const MenuCuenta = ({ abierto, alCerrar, persona, personas, viendoComo, alVerComo, alSalir }: {
  abierto: boolean;
  alCerrar: () => void;
  persona: Persona;
  personas: PersonaVisible[];
  viendoComo: string;
  alVerComo: (id: string) => void;
  alSalir: () => void;
}) => {
  const navegar = (destino: Parameters<typeof ir>[0]) => { alCerrar(); ir(destino); };
  return (
    <Dialogo titulo="Tu cuenta" abierto={abierto} alCerrar={alCerrar}>
      <div class="cuenta-cabeza">
        <span class="avatar-btn" aria-hidden="true">{iniciales(persona.name)}</span>
        <div><strong>{persona.name}</strong><br /><span class="apagado">{persona.role}{persona.mesa ? ` · ${persona.mesa}` : ''}</span></div>
      </div>
      <div class="cuenta-acciones">
        {persona.permisos.esAdmin && (
          <label>
            Ver la app como
            <select value={viendoComo} onChange={(e) => alVerComo((e.target as HTMLSelectElement).value)}>
              <option value="">Coordinación · Todas las tareas</option>
              {personas.filter((p) => p.id !== persona.id).map((p) => (
                <option key={p.id} value={p.id}>Mi espacio · {p.name}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={() => navegar('profile')}>Mi perfil</button>
        <button type="button" onClick={() => navegar('preferences')}>Mis avisos</button>
        <button type="button" onClick={() => { alCerrar(); open(location.hostname.endsWith('mesawow.cl') ? 'https://mesawow.cl' : '/mandantes', '_blank', 'noopener'); }}>Ver la mesa de mandantes ↗</button>
        <button type="button" class="peligro" onClick={alSalir}>Cerrar sesión</button>
      </div>
    </Dialogo>
  );
};

export interface Alerta { clave: string; tono: string; titulo: string; detalle: string; tareaId: string | null; destino: string | null; en: string; leida: boolean }

const ICONO_TONO: Record<string, NombreIcono> = { roja: 'bell', ambar: 'bell', violeta: 'check', teal: 'layers', verde: 'rocket', rosa: 'smile' };

export const Campana = ({ abierto, alCerrar, alertas, alLeer }: {
  abierto: boolean; alCerrar: () => void; alertas: Alerta[]; alLeer: (claves: string[]) => void;
}) => {
  const sinLeer = alertas.filter((a) => !a.leida);
  const abrir = (a: Alerta) => {
    if (!a.leida) alLeer([a.clave]);
    alCerrar();
    if (a.destino) ir(a.destino === '/comunidad' ? 'plaza' : 'muro');
    else if (a.tareaId) { history.pushState(null, '', `/encargos?tarea=${a.tareaId}`); dispatchEvent(new PopStateEvent('popstate')); }
  };
  return (
    <Dialogo titulo="Alertas" abierto={abierto} alCerrar={alCerrar}>
      {!alertas.length ? (
        <div class="campana-vacia">
          <img src={sonrisa} alt="" width={80} height={56} />
          <strong>No tienes alertas por ahora.</strong>
          <p>Aquí verás tus tareas atrasadas, entregas por revisar, piezas en riesgo y menciones.</p>
        </div>
      ) : (
        <div class="formulario">
          {sinLeer.length > 0 && <button type="button" class="mas-opciones" onClick={() => alLeer(sinLeer.map((a) => a.clave))}>Marcar todo como leído</button>}
          <ul class="lista-alertas">
            {alertas.map((a) => (
              <li key={a.clave}>
                <button type="button" class={a.leida ? '' : 'sin-leer'} onClick={() => abrir(a)}>
                  <span class={`ic-alerta ${a.tono}`}><Icono nombre={ICONO_TONO[a.tono] ?? 'bell'} tam={18} /></span>
                  <span><strong>{a.titulo}</strong><small>{a.detalle}</small></span>
                </button>
              </li>
            ))}
          </ul>
          <a href="/avisos" onClick={alCerrar}>Ver mis avisos</a>
        </div>
      )}
    </Dialogo>
  );
};
