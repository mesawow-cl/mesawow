// Informes (§4.23): instantánea de tareas con fecha de corte; imprimir/PDF, compartir y descargar JSON.
import { useEffect, useState } from 'preact/hooks';
import { pedir } from '../api';
import { Dialogo } from '../componentes/Dialogo';
import { fechaCorta, marcas as cargarMarcas, personas as cargarPersonas, type Marca, type PersonaDirectorio } from '../datos';

interface Informe {
  corte: string; total: number; completadas: number; atrasadas: number; bloqueadas: number;
  tareas: { id: string; title: string; due: string; status: string; blocked: boolean; marca: string; responsable: string | null; dependencia: string | null }[];
}
const ESTADOS = ['Pendiente', 'En curso', 'Entregada para revisión', 'Ajustes solicitados', 'Aprobada', 'Completada'];
const corteTexto = (iso: string) => new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago' });

export const Informes = () => {
  const [persona, setPersona] = useState('');
  const [estado, setEstado] = useState('');
  const [marca, setMarca] = useState('');
  const [r, setR] = useState<Informe | null>(null);
  const [error, setError] = useState('');
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [listaMarcas, setMarcas] = useState<Marca[]>([]);
  const [compartir, setCompartir] = useState(false);
  const [correo, setCorreo] = useState('');
  const [texto, setTexto] = useState('');
  useEffect(() => { cargarPersonas().then(setGente); cargarMarcas().then(setMarcas); }, []);
  useEffect(() => {
    const q = new URLSearchParams();
    if (persona) q.set('persona', persona);
    if (estado) q.set('estado', estado);
    if (marca) q.set('marca', marca);
    pedir<Informe>(`/informes?${q}`).then(setR).catch((e: Error) => setError(e.message));
  }, [persona, estado, marca]);
  const nombreMarca = listaMarcas.find((m) => m.id === marca)?.name ?? 'Todas las marcas';
  const nombrePersona = gente.find((g) => g.id === persona)?.name ?? 'Todos';
  const resumen = !r ? '' : `Informe de tareas · ${nombreMarca}\nCorte: ${corteTexto(r.corte)}\nTotal: ${r.total} · Completadas: ${r.completadas} · Atrasadas: ${r.atrasadas} · Bloqueadas: ${r.bloqueadas}\n\n`
    + r.tareas.map((t) => `${t.marca} | ${t.title} | ${t.responsable ?? '—'} | ${t.due} | ${t.status}`).join('\n');
  useEffect(() => { setTexto(resumen.slice(0, 6000)); }, [resumen]);
  if (error) return <div class="pronto" role="alert"><strong>{error}</strong></div>;
  const descargar = () => {
    if (!r) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ marca: nombreMarca, persona: nombrePersona, estado: estado || 'Todos', ...r }, null, 2)], { type: 'application/json' }));
    a.download = `informe-mesawow-${r.corte.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <section aria-labelledby="titulo-vista" class="informe">
      <div class="hero no-imprimir">
        <div><p class="ceja">Equipo</p><h1 id="titulo-vista">Informe del estado actual</h1><p>Una instantánea de las tareas con fecha de corte.</p></div>
        <div class="acciones" style={{ justifyContent: 'flex-start' }}>
          <button type="button" onClick={() => print()}>Imprimir / Guardar PDF</button>
          <button type="button" class="primario" disabled={!r} onClick={() => setCompartir(true)}>Compartir informe</button>
        </div>
      </div>
      <div class="filtros-comunidad no-imprimir" style={{ marginTop: '22px' }}>
        <select aria-label="Responsable" value={persona} onChange={(e) => setPersona((e.target as HTMLSelectElement).value)}>
          <option value="">Todos</option>{gente.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select aria-label="Estado" value={estado} onChange={(e) => setEstado((e.target as HTMLSelectElement).value)}>
          <option value="">Todos los estados</option>{ESTADOS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select aria-label="Marca" value={marca} onChange={(e) => setMarca((e.target as HTMLSelectElement).value)}>
          <option value="">Todas las marcas</option>{listaMarcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button type="button" disabled={!r} onClick={descargar}>Descargar JSON</button>
      </div>
      {!r ? <p>Cargando informe…</p> : (
        <article class="tarjeta" style={{ marginTop: '16px' }}>
          <p class="ceja">Informe de tareas · {nombreMarca}</p>
          <h2>Estado de trabajo</h2>
          <p class="ayuda">Fecha de corte: {corteTexto(r.corte)} · America/Santiago<br />Responsable: {nombrePersona} · Estado: {estado || 'Todos'}</p>
          <div class="metricas">
            {[['Tareas', r.total], ['Completadas', r.completadas], ['Atrasadas', r.atrasadas], ['Bloqueadas', r.bloqueadas]].map(([l, n]) => (
              <div class="tarjeta metrica" key={l}><div><strong>{n}</strong><span>{l}</span></div></div>
            ))}
          </div>
          <div class="tabla-simple tabla-informe" role="table" aria-label="Tareas del informe">
            <div role="row" class="cabeza"><span role="columnheader">Tarea y marca</span><span role="columnheader">Responsable</span><span role="columnheader">Plazo</span><span role="columnheader">Estado y dependencia</span></div>
            {r.tareas.map((t) => (
              <div role="row" key={t.id}>
                <span role="cell"><strong>{t.title}</strong><br /><span class="ayuda">{t.marca}</span></span>
                <span role="cell">{t.responsable ?? '—'}</span>
                <span role="cell">{fechaCorta(t.due)}</span>
                <span role="cell">{t.status}{t.blocked ? ' · Bloqueada' : ''}<br /><span class="ayuda">{t.dependencia ?? '—'}</span></span>
              </div>
            ))}
            {!r.tareas.length && <p class="ayuda">Sin tareas con estos filtros.</p>}
          </div>
          <p class="ayuda" style={{ marginTop: '14px' }}>El PDF conserva esta fecha de corte; no se actualiza automáticamente.</p>
        </article>
      )}
      <Dialogo titulo="Compartir informe" abierto={compartir} alCerrar={() => setCompartir(false)}>
        <div class="formulario">
          <label>Correo destinatario<input type="email" value={correo} onInput={(e) => setCorreo((e.target as HTMLInputElement).value)} /></label>
          <label>Resumen editable<textarea rows={10} value={texto} onInput={(e) => setTexto((e.target as HTMLTextAreaElement).value)} /></label>
          <p class="nota">Se abre tu aplicación de correo o WhatsApp y tú confirmas el envío.</p>
          <div class="acciones">
            <a class="boton" href={`mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(`Informe de tareas · ${nombreMarca}`)}&body=${encodeURIComponent(texto)}`}>Abrir correo</a>
            <a class="boton primario" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(texto)}`}>Abrir WhatsApp</a>
          </div>
        </div>
      </Dialogo>
    </section>
  );
};
