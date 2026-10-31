// Mis mesas (§4.11) y Marcas y mínimos (§4.16).
import { useEffect, useState } from 'preact/hooks';
import { ESTADOS_MINIMO } from '../../shared/constantes';
import { ErrorApi, pedir, type Persona } from '../api';
import { Dialogo } from '../componentes/Dialogo';
import { olvidarCatalogos, personas as cargarPersonas, type Mesa, type PersonaDirectorio } from '../datos';

const valor = (e: Event) => (e.target as HTMLInputElement).value;

// ─────────────────────────────── Mis mesas

export const Mesas = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const [mesas, setMesas] = useState<Mesa[] | null>(null);
  const [editar, setEditar] = useState<Mesa | 'nueva' | null>(null);
  const cargar = () => pedir<{ mesas: Mesa[] }>('/mesas').then((r) => setMesas(r.mesas)).catch((e: Error) => aviso(e.message));
  useEffect(() => { cargar(); }, []);

  const archivar = async (m: Mesa, archivar: boolean) => {
    if (archivar && !confirm(`¿Archivar la mesa ${m.name}?`)) return;
    try {
      await pedir(`/mesas/${m.id}/archivar`, { method: 'POST', json: { archivar } });
      olvidarCatalogos();
      aviso(archivar ? 'Mesa archivada.' : 'Mesa restaurada.');
      cargar();
    } catch (e) {
      aviso(e instanceof ErrorApi && e.code === 'tareas_abiertas' ? `${e.message} Ciérralas o muévelas a otra mesa primero.` : (e as Error).message);
    }
  };

  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div><p class="ceja">Mesas</p><h1 id="titulo-vista">Mesas conectadas</h1><p>Cada mesa reúne el trabajo de un área. Las tareas se asignan a una mesa.</p></div>
        {persona.permisos.esAdmin && <button type="button" class="primario" onClick={() => setEditar('nueva')}>＋ Nueva mesa</button>}
      </div>
      {!mesas ? <p>Cargando mesas…</p> : (
        <div class="tarjetas-equipo">
          {mesas.map((m) => (
            <article class={`tarjeta persona-tarjeta${m.active ? '' : ' inactiva'}`} key={m.id}>
              <div>
                <span class={`insignia ${m.active ? 'verde' : 'gris'}`}>{m.active ? 'Activa' : 'Archivada'}</span>
                <h2 style={{ marginTop: '10px' }}>Mesa de {m.name}</h2>
                {m.description && <p class="apagado" style={{ marginTop: '6px' }}>{m.description}</p>}
              </div>
              <p class="contacto">Encargado: {m.encargado ?? 'Sin asignar'}<br />{m.aceptadas} de {m.total} entregas aceptadas · {m.abiertas} abiertas</p>
              <div class="progreso" aria-hidden="true"><i style={{ width: `${m.total ? Math.round((m.aceptadas / m.total) * 100) : 0}%` }} /></div>
              {persona.permisos.esAdmin && (
                <div class="persona-acciones">
                  <button type="button" onClick={() => setEditar(m)}>Editar</button>
                  <button type="button" onClick={() => archivar(m, !!m.active)}>{m.active ? 'Archivar' : 'Restaurar'}</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {editar && <FormMesa mesa={editar === 'nueva' ? null : editar} alCerrar={() => setEditar(null)}
        alGuardar={() => { setEditar(null); olvidarCatalogos(); aviso('Mesa guardada.'); cargar(); }} />}
    </section>
  );
};

const FormMesa = ({ mesa, alCerrar, alGuardar }: { mesa: Mesa | null; alCerrar: () => void; alGuardar: () => void }) => {
  const [nombre, setNombre] = useState(mesa?.name ?? '');
  const [descripcion, setDescripcion] = useState(mesa?.description ?? '');
  const [encargadoId, setEncargadoId] = useState(mesa?.owner_id ?? '');
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { cargarPersonas().then(setGente); }, []);
  const enviar = async (e: Event) => {
    e.preventDefault();
    try {
      const json = { nombre, descripcion, encargadoId: encargadoId || null };
      await (mesa ? pedir(`/mesas/${mesa.id}`, { method: 'PATCH', json }) : pedir('/mesas', { method: 'POST', json }));
      alGuardar();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <Dialogo titulo={mesa ? `Editar mesa ${mesa.name}` : 'Nueva mesa'} abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={enviar}>
        <label>Nombre<input required maxLength={70} value={nombre} onInput={(e) => setNombre(valor(e))} /></label>
        <label>Descripción<textarea rows={3} maxLength={300} value={descripcion} onInput={(e) => setDescripcion(valor(e))} /></label>
        <label>Encargado
          <select value={encargadoId} onChange={(e) => setEncargadoId(valor(e))}>
            <option value="">Sin asignar</option>
            {gente.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        {error && <p class="error-form" role="alert">{error}</p>}
        <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" class="primario">Guardar</button></div>
      </form>
    </Dialogo>
  );
};

// ─────────────────────────────── Marcas y mínimos

interface MarcaDetalle { id: string; name: string; color: string; description: string; director_id: string | null; director: string | null; vigentes: number; abiertas: number }
interface Minimo { idx: number; title: string; state: string; note: string; actualizado_por: string | null }

const iniciales = (n: string) => n.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export const Marcas = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const [datos, setDatos] = useState<{ marcas: MarcaDetalle[]; totalMinimos: number } | null>(null);
  const [minimosDe, setMinimosDe] = useState<MarcaDetalle | null>(null);
  const [editar, setEditar] = useState<MarcaDetalle | 'nueva' | null>(null);
  const cargar = () => pedir<typeof datos>('/marcas/detalle').then(setDatos).catch((e: Error) => aviso(e.message));
  useEffect(() => { cargar(); }, []);

  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div><p class="ceja">Mesas</p><h1 id="titulo-vista">Marcas y mínimos</h1><p>Lo que cada marca necesita tener vigente para operar bien: 21 mínimos.</p></div>
        {persona.permisos.esAdmin && <button type="button" class="primario" onClick={() => setEditar('nueva')}>＋ Nueva marca</button>}
      </div>
      {!datos ? <p>Cargando marcas…</p> : (
        <div class="tarjetas-equipo">
          {datos.marcas.map((m) => {
            const pct = Math.round((m.vigentes / datos.totalMinimos) * 100);
            return (
              <article class="tarjeta persona-tarjeta" key={m.id}>
                <div class="persona-cabeza">
                  <span class="avatar" style={{ background: m.color }}>{iniciales(m.name)}</span>
                  <div><strong>{m.name}</strong><span class="apagado">{m.director ? `Dirige ${m.director}` : 'Sin director asignado'}</span></div>
                </div>
                <p class="contacto">{m.vigentes} de {datos.totalMinimos} mínimos vigentes · {m.abiertas} tareas abiertas</p>
                <div class="progreso" role="img" aria-label={`${pct}% de mínimos vigentes`}><i style={{ width: `${pct}%` }} /></div>
                <div class="persona-acciones">
                  <button type="button" onClick={() => setMinimosDe(m)}>Revisar mínimos →</button>
                  {persona.permisos.esAdmin && <button type="button" onClick={() => setEditar(m)}>Editar</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {minimosDe && <DialogoMinimos marca={minimosDe} puedeEditar={persona.permisos.coordina && !persona.permisos.soloLectura}
        alCerrar={() => setMinimosDe(null)} alGuardar={() => { setMinimosDe(null); aviso('Diagnóstico guardado.'); cargar(); }} />}
      {editar && <FormMarca marca={editar === 'nueva' ? null : editar} alCerrar={() => setEditar(null)}
        alGuardar={() => { setEditar(null); olvidarCatalogos(); aviso('Marca guardada.'); cargar(); }} />}
    </section>
  );
};

const DialogoMinimos = ({ marca, puedeEditar, alCerrar, alGuardar }: { marca: MarcaDetalle; puedeEditar: boolean; alCerrar: () => void; alGuardar: () => void }) => {
  const [minimos, setMinimos] = useState<Minimo[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { pedir<{ minimos: Minimo[] }>(`/marcas/${marca.id}/minimos`).then((r) => setMinimos(r.minimos)); }, [marca.id]);
  const cambiar = (idx: number, c: Partial<Minimo>) => setMinimos((xs) => xs!.map((m) => (m.idx === idx ? { ...m, ...c } : m)));
  const guardar = async (e: Event) => {
    e.preventDefault();
    try {
      await pedir(`/marcas/${marca.id}/minimos`, { method: 'PUT', json: { minimos: minimos!.map((m) => ({ idx: m.idx, estado: m.state, nota: m.note })) } });
      alGuardar();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <Dialogo titulo={`Mínimos de ${marca.name}`} abierto alCerrar={alCerrar}>
      {!minimos ? <p>Cargando…</p> : (
        <form class="formulario" onSubmit={guardar}>
          {minimos.map((m) => (
            <fieldset key={m.idx}>
              <legend>{m.idx + 1}. {m.title}</legend>
              <div class="dos">
                <label class="visualmente-oculto" for={`est-${m.idx}`}>Estado</label>
                <select id={`est-${m.idx}`} disabled={!puedeEditar} value={m.state} onChange={(e) => cambiar(m.idx, { state: valor(e) })}>
                  {ESTADOS_MINIMO.map((s) => <option key={s}>{s}</option>)}
                </select>
                <input aria-label="Evidencia, enlace o brecha identificada" placeholder="Evidencia, enlace o brecha identificada" disabled={!puedeEditar}
                  maxLength={500} value={m.note} onInput={(e) => cambiar(m.idx, { note: valor(e) })} />
              </div>
            </fieldset>
          ))}
          {error && <p class="error-form" role="alert">{error}</p>}
          <div class="acciones">
            <button type="button" onClick={alCerrar}>Cerrar</button>
            {puedeEditar && <button type="submit" class="primario">Guardar diagnóstico</button>}
          </div>
        </form>
      )}
    </Dialogo>
  );
};

const FormMarca = ({ marca, alCerrar, alGuardar }: { marca: MarcaDetalle | null; alCerrar: () => void; alGuardar: () => void }) => {
  const [nombre, setNombre] = useState(marca?.name ?? '');
  const [descripcion, setDescripcion] = useState(marca?.description ?? '');
  const [color, setColor] = useState(marca?.color ?? '#F22E62');
  const [directorId, setDirectorId] = useState(marca?.director_id ?? '');
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { cargarPersonas().then(setGente); }, []);
  const enviar = async (e: Event) => {
    e.preventDefault();
    try {
      const json = { nombre, descripcion, color, directorId: directorId || null };
      await (marca ? pedir(`/marcas/${marca.id}`, { method: 'PATCH', json }) : pedir('/marcas', { method: 'POST', json }));
      alGuardar();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <Dialogo titulo={marca ? `Editar ${marca.name}` : 'Nueva marca'} abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={enviar}>
        <label>Nombre<input required maxLength={80} value={nombre} onInput={(e) => setNombre(valor(e))} /></label>
        <label>Descripción<textarea rows={3} maxLength={500} value={descripcion} onInput={(e) => setDescripcion(valor(e))} /></label>
        <div class="dos">
          <label>Color<input type="color" value={color} onInput={(e) => setColor(valor(e))} /></label>
          <label>Director del equipo
            <select value={directorId} onChange={(e) => setDirectorId(valor(e))}>
              <option value="">Sin asignar</option>
              {gente.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        </div>
        {!marca && <p class="ayuda">La marca nace con sus 21 mínimos en "Pendiente de verificar".</p>}
        {error && <p class="error-form" role="alert">{error}</p>}
        <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" class="primario">Guardar</button></div>
      </form>
    </Dialogo>
  );
};
