// Mis encargos (§4.8): lista con filtros y detalle "Tu tarea" con su ciclo de vida.
import { useEffect, useState } from 'preact/hooks';
import { ESTADOS_TAREA } from '../../shared/constantes';
import { abrirArchivo, pedir, subirArchivo, type Persona } from '../api';
import { Dialogo } from '../componentes/Dialogo';
import { fechaCorta, personas as cargarPersonas, TONO_ESTADO, type PersonaDirectorio } from '../datos';
import { FormTarea } from './FormTarea';

interface Fila {
  id: string; title: string; status: string; due: string; complexity: string; priority: string; blocked: number;
  marca: string; color: string; responsable: string | null; mesa: string | null; atrasada: boolean;
}

const Estado = ({ estado }: { estado: string }) => <span class={`insignia ${TONO_ESTADO[estado] ?? ''}`}>{estado}</span>;

const parametro = (k: string) => new URLSearchParams(location.search).get(k);
const fijarParametro = (k: string, v: string | null) => {
  const u = new URL(location.href);
  v ? u.searchParams.set(k, v) : u.searchParams.delete(k);
  history.replaceState(null, '', u.pathname + u.search);
};

export const Tareas = ({ persona, aviso, crear, alCrear }: { persona: Persona; aviso: (m: string) => void; crear: boolean; alCrear: (v: boolean) => void }) => {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const [quien, setQuien] = useState('');
  const [abierta, setAbierta] = useState<string | null>(parametro('tarea'));
  const [editar, setEditar] = useState<string | null>(null);

  const cargar = () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (estado) p.set('estado', estado);
    if (quien) p.set('persona', quien);
    pedir<{ tareas: Fila[] }>(`/tareas?${p}`).then((r) => setFilas(r.tareas)).catch((e: Error) => aviso(e.message));
  };
  useEffect(() => { cargarPersonas().then(setGente).catch(() => setGente([])); }, []);
  useEffect(() => { const t = setTimeout(cargar, q ? 250 : 0); return () => clearTimeout(t); }, [q, estado, quien]);

  const abrir = (id: string | null) => { setAbierta(id); fijarParametro('tarea', id); };

  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div>
          <p class="ceja">Mi trabajo</p>
          <h1 id="titulo-vista">Mis encargos</h1>
          <p>{persona.permisos.coordina ? 'Las tareas de tus marcas y las que tienes a cargo.' : 'Las tareas en que participas: como responsable, revisión, colaboración o aprobación.'}</p>
        </div>
        {persona.permisos.coordina && <button type="button" class="primario" onClick={() => alCrear(true)}>＋ Nueva tarea</button>}
      </div>

      <div class="filtros">
        <label>Buscar<input type="search" placeholder="Título o responsable" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} /></label>
        <label>Estado
          <select value={estado} onChange={(e) => setEstado((e.target as HTMLSelectElement).value)}>
            <option value="">Todos</option>
            {ESTADOS_TAREA.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>Persona
          <select value={quien} onChange={(e) => setQuien((e.target as HTMLSelectElement).value)}>
            <option value="">Todas</option>
            {gente.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      </div>

      {!filas ? <p>Cargando tareas…</p> : !filas.length ? (
        <div class="pronto"><strong>No hay tareas con estos filtros.</strong>{persona.permisos.coordina && <p>Crea la primera con ＋ Nueva tarea.</p>}</div>
      ) : (
        <div class="tabla-tareas" role="table" aria-label="Tareas">
          <div class="fila cabeza" role="row">
            <span role="columnheader">Tarea y marca</span><span role="columnheader">Responsable</span><span role="columnheader">Plazo</span>
            <span role="columnheader">Complejidad</span><span role="columnheader">Estado</span>
          </div>
          {filas.map((t) => (
            <button type="button" class="fila" role="row" key={t.id} onClick={() => abrir(t.id)}>
              <span role="cell" class="tarea-titulo">
                <strong>{t.title}</strong>
                <span class="chip"><i style={{ background: t.color }} />{t.marca}</span>
                {!!t.blocked && <span class="insignia roja">Bloqueada</span>}
              </span>
              <span role="cell">{t.responsable ?? 'Sin responsable'}</span>
              <span role="cell">{fechaCorta(t.due)}{t.atrasada && <span class="insignia roja" style={{ marginLeft: '6px' }}>Atrasada</span>}</span>
              <span role="cell">{t.complexity}</span>
              <span role="cell"><Estado estado={t.status} /></span>
            </button>
          ))}
        </div>
      )}

      {abierta && <DetalleTarea id={abierta} alCerrar={() => abrir(null)} aviso={aviso} alCambiar={cargar} alEditar={(id) => { abrir(null); setEditar(id); }} />}
      {(crear || editar) && (
        <FormTarea tareaId={editar ?? undefined} alCerrar={() => { alCrear(false); setEditar(null); }}
          alGuardar={(id) => { alCrear(false); setEditar(null); aviso(editar ? 'Tarea actualizada.' : 'Tarea creada. Avisamos a las personas asignadas.'); cargar(); abrir(id); }} />
      )}
    </section>
  );
};

export const DetalleTarea = ({ id, alCerrar, aviso, alCambiar, alEditar }: {
  id: string; alCerrar: () => void; aviso: (m: string) => void; alCambiar: () => void; alEditar: (id: string) => void;
}) => {
  const [t, setT] = useState<any>(null);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState('');
  const [comentario, setComentario] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = () => pedir<{ tarea: any }>(`/tareas/${id}`).then((r) => setT(r.tarea)).catch((e: Error) => setError(e.message));
  useEffect(() => { cargar(); }, [id]);

  const hacer = async (ruta: string, cuerpo: unknown, mensaje: string) => {
    setOcupado(true);
    try {
      await pedir(`/tareas/${id}/${ruta}`, { method: 'POST', json: cuerpo });
      aviso(mensaje);
      setResultado('');
      setComentario('');
      await cargar();
      alCambiar();
    } catch (e) { aviso((e as Error).message); } finally { setOcupado(false); }
  };
  const conMotivo = (ruta: string, pregunta: string, mensaje: string) => {
    const motivo = prompt(pregunta);
    if (motivo?.trim()) hacer(ruta, { motivo }, mensaje);
  };
  const adjuntar = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 700 * 1024) { aviso('El archivo puede pesar hasta 700 KB.'); return; }
    setOcupado(true);
    try {
      const tipo = f.type || (f.name.endsWith('.html') ? 'text/html' : 'text/plain');
      await subirArchivo(`/tareas/${id}/archivo`, new File([f], f.name, { type: tipo }));
      aviso('Resultado adjuntado.');
      await cargar();
      alCambiar();
    } catch (e) { aviso((e as Error).message); } finally { setOcupado(false); }
  };

  const a = t?.acciones ?? {};
  return (
    <Dialogo titulo="Tu tarea" abierto alCerrar={alCerrar}>
      {error ? <p class="error-form" role="alert">{error}</p> : !t ? <p>Cargando…</p> : (
        <div class="detalle-tarea">
          <p class="ceja">{t.campana ? `${t.campana.name}` : 'Tarea'}</p>
          <h3 style={{ fontSize: '20px' }}>{t.title}</h3>
          <div class="chips" style={{ marginTop: '8px' }}>
            <Estado estado={t.status} />
            <span class="insignia gris">Complejidad {t.complexity}</span>
            <span class={`insignia ${t.priority === 'Urgente' || t.priority === 'Alta' ? 'ambar' : 'gris'}`}>Prioridad {t.priority}</span>
            {t.atrasada && <span class="insignia roja">Atrasada</span>}
            {!!t.confidential && <span class="insignia gris">Confidencial</span>}
          </div>
          {!!t.blocked && <p class="aviso-bloqueo" role="status"><strong>Bloqueada:</strong> {t.block_reason}</p>}
          <p style={{ marginTop: '12px', whiteSpace: 'pre-wrap' }}>{t.description}</p>

          <dl class="ficha">
            <div><dt>Entregable</dt><dd>{t.deliverable}</dd></div>
            <div><dt>Responsable</dt><dd>{t.responsable?.nombre ?? '—'}</dd></div>
            <div><dt>Revisión</dt><dd>{t.revisor?.nombre ?? 'Sin revisión'}</dd></div>
            <div><dt>Plazo</dt><dd>{fechaCorta(t.start_date)} → {fechaCorta(t.due)}</dd></div>
            {!!t.colaboradores.length && <div><dt>Colaboran</dt><dd>{t.colaboradores.map((x: any) => x.nombre).join(', ')}</dd></div>}
            {!!t.aprobadores.length && <div><dt>Aprueban</dt><dd>{t.aprobadores.map((x: any) => x.nombre).join(', ')}</dd></div>}
            {!!t.estimated_hours && <div><dt>Horas estimadas</dt><dd>{t.estimated_hours} h</dd></div>}
            <div class="ancho"><dt>Criterio de aceptación</dt><dd>{t.acceptance || <em>Falta definirlo antes de aprobar.</em>}</dd></div>
          </dl>

          {(t.necesita.length > 0 || t.despues.length > 0) && (
            <section class="bloque">
              <h4>Entregas conectadas</h4>
              {t.necesita.length > 0 && <p class="apagado">ESTA TAREA NECESITA</p>}
              <ul class="lista-simple">{t.necesita.map((x: any) => <li key={x.id}>{x.title} · <Estado estado={x.status} /></li>)}</ul>
              {t.despues.length > 0 && <p class="apagado">DESPUÉS DE ESTA ENTREGA</p>}
              <ul class="lista-simple">{t.despues.map((x: any) => <li key={x.id}>{x.title} · <Estado estado={x.status} /></li>)}</ul>
            </section>
          )}

          <section class="bloque">
            <h4>Resultado</h4>
            {!t.resultados.length && <p class="apagado">Aún no hay resultado.</p>}
            <ul class="lista-simple">
              {t.resultados.map((r: any) => (
                <li key={r.id}>
                  {r.archivo ? <button type="button" class="enlace" onClick={() => abrirArchivo(`/api/v1/tareas/${id}/resultados/${r.id}`, r.filename ?? undefined)}>{r.filename ?? 'Archivo'}</button>
                    : <span style={{ whiteSpace: 'pre-wrap' }}>{r.text}</span>}
                  <span class="apagado"> · {r.autor ?? ''}</span>
                </li>
              ))}
            </ul>
            {a.entregar && (
              <label class="formulario" style={{ marginTop: '10px' }}>Resultado o información para revisión
                <textarea rows={3} value={resultado} onInput={(e) => setResultado((e.target as HTMLTextAreaElement).value)} />
              </label>
            )}
            {a.adjuntar && (
              <label class="casilla" style={{ marginTop: '10px' }}>
                Adjuntar archivo (HTML, texto, PDF o imagen, hasta 700 KB)
                <input class="visualmente-oculto" type="file" accept=".html,.htm,.txt,.pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => adjuntar((e.target as HTMLInputElement).files?.[0])} />
              </label>
            )}
          </section>

          <section class="bloque">
            <h4>Comentarios</h4>
            <ul class="lista-simple">
              {t.comentarios.map((k: any) => <li key={k.id}><strong>{k.autor ?? 'mesawow'}:</strong> {k.text}</li>)}
            </ul>
            {a.comentar && (
              <div class="enlace-copiable" style={{ marginTop: '8px' }}>
                <label class="visualmente-oculto" for="comentario">Comentario</label>
                <input id="comentario" placeholder="Escribe un comentario" value={comentario} onInput={(e) => setComentario((e.target as HTMLInputElement).value)} />
                <button type="button" disabled={!comentario.trim() || ocupado} onClick={() => hacer('comentarios', { texto: comentario }, 'Comentario publicado.')}>Comentar</button>
              </div>
            )}
          </section>

          {t.impedimento && (a.empezar || a.entregar) && <p class="apagado" role="note">{t.impedimento}</p>}
          <div class="acciones">
            {a.editar && <button type="button" onClick={() => alEditar(id)}>Editar asignaciones</button>}
            {a.bloquear && <button type="button" onClick={() => conMotivo('bloquear', '¿Qué falta para avanzar?', 'Bloqueo registrado. Avisamos al equipo.')}>Necesito ayuda</button>}
            {a.desbloquear && <button type="button" onClick={() => hacer('desbloquear', {}, 'Bloqueo resuelto.')}>Resolver bloqueo</button>}
            {a.confidencial && <button type="button" onClick={() => hacer('confidencial', { valor: !t.confidential }, t.confidential ? 'Ya no es confidencial.' : 'Detalle restringido a participantes.')}>{t.confidential ? 'Quitar confidencialidad' : 'Hacer confidencial'}</button>}
            {a.reabrir && <button type="button" onClick={() => conMotivo('reabrir', '¿Por qué se reabre?', 'Tarea reabierta.')}>Reabrir con motivo</button>}
            {a.pedirAjustes && <button type="button" onClick={() => conMotivo('pedir-ajustes', '¿Qué ajustes se necesitan?', 'Ajustes solicitados. Avisamos a la persona responsable.')}>Pedir ajustes</button>}
            {a.empezar && <button type="button" class="primario" disabled={ocupado} onClick={() => hacer('empezar', {}, '¡A trabajar!')}>Empezar</button>}
            {a.entregar && <button type="button" class="primario" disabled={ocupado} onClick={() => hacer('entregar', { resultado }, 'Entregada. Avisamos a revisión.')}>Entregar tarea</button>}
            {a.aprobar && <button type="button" class="primario" disabled={ocupado} onClick={() => hacer('aprobar', {}, '¡Tarea aprobada!')}>Aprobar</button>}
          </div>
        </div>
      )}
    </Dialogo>
  );
};
