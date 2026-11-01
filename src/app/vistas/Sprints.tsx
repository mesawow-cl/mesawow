// Sprints (§4.13): tablero, backlog, capacidad, avance diario y cierre.
import { useEffect, useState } from 'preact/hooks';
import { useLatido } from '../vivo';
import { hoySantiago } from '../../shared/fechas';
import { ErrorApi, pedir, type Persona } from '../api';
import { Dialogo } from '../componentes/Dialogo';
import { fechaCorta, marcas as cargarMarcas, personas as cargarPersonas, type Marca, type PersonaDirectorio } from '../datos';

type Fila = Record<string, any>;
const valor = (e: Event) => (e.target as HTMLInputElement).value;
const PESTANAS = [['tablero', 'Tablero'], ['backlog', 'Backlog'], ['capacidad', 'Capacidad'], ['diario', 'Avance diario'], ['cierre', 'Revisión y retrospectiva']] as const;
const COLUMNAS: [string, (t: Fila) => boolean][] = [
  ['Por hacer', (t) => t.status === 'Pendiente' || t.status === 'Ajustes solicitados'],
  ['En curso', (t) => t.status === 'En curso'],
  ['En revisión', (t) => t.status === 'Entregada para revisión'],
  ['Terminadas', (t) => t.status === 'Aprobada' || t.status === 'Completada'],
];

export const Sprints = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const [lista, setLista] = useState<Fila[] | null>(null);
  const [elegido, setElegido] = useState<string>('');
  const [det, setDet] = useState<Fila | null>(null);
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number][0]>('tablero');
  const [dialogo, setDialogo] = useState<'nuevo' | 'editar' | 'feriados' | { preparar: Fila } | null>(null);
  const coordina = persona.permisos.coordina && !persona.permisos.soloLectura;

  const cargarLista = () => pedir<{ sprints: Fila[] }>('/sprints').then((r) => {
    setLista(r.sprints);
    setElegido((e) => e || r.sprints[0]?.id || '');
  }).catch((e: Error) => aviso(e.message));
  const cargar = () => elegido ? pedir<Fila>(`/sprints/${elegido}`).then(setDet).catch((e: Error) => aviso(e.message)) : setDet(null);
  useEffect(() => { cargarLista(); }, []);
  const latido = useLatido();
  useEffect(() => { cargar(); }, [elegido, latido]);

  const accion = async (ruta: string, cuerpo: unknown, mensaje: string) => {
    try { await pedir(ruta, { method: 'POST', json: cuerpo }); aviso(mensaje); cargar(); cargarLista(); return true; }
    catch (e) { aviso((e as Error).message); return e as ErrorApi; }
  };
  const iniciar = async () => {
    const r = await accion(`/sprints/${elegido}/iniciar`, {}, 'Sprint iniciado. Avisamos al equipo.');
    if (r instanceof ErrorApi && r.code === 'requiere_excepcion') {
      const excepcion = prompt(`${r.message}\n\nMotivo y autorización:`);
      if (excepcion?.trim()) accion(`/sprints/${elegido}/iniciar`, { excepcion }, 'Sprint iniciado con excepción autorizada.');
    }
  };
  const retirar = (t: Fila) => {
    const motivo = prompt(`¿Por qué se retira "${t.title}" del sprint?`);
    if (motivo?.trim()) accion(`/sprints/${elegido}/retirar`, { tareaId: t.id, motivo }, 'Tarea retirada del sprint.');
  };
  const agregar = (t: Fila) => {
    const motivo = det!.sprint.status === 'Planificado' ? undefined : prompt('El sprint ya empezó: ¿por qué cambia el alcance?') ?? '';
    if (motivo === '') return;
    accion(`/sprints/${elegido}/tareas`, { tareaId: t.id, motivo }, 'Tarea agregada al sprint.');
  };
  const mover = async (i: number, d: -1 | 1) => {
    const orden = det!.backlog.map((t: Fila) => t.id);
    [orden[i], orden[i + d]] = [orden[i + d], orden[i]];
    await accion('/backlog/orden', { marcaId: det!.sprint.brand_id, orden }, 'Orden actualizado.');
  };

  const s = det?.sprint;
  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div><p class="ceja">Mesas</p><h1 id="titulo-vista">Cinco días. Un objetivo compartido.</h1>
          <p>Sprints de lunes a viernes: lo que el equipo se compromete a terminar y aprobar antes del viernes.</p></div>
        {coordina && (
          <div class="persona-acciones">
            <button type="button" onClick={() => setDialogo('feriados')}>Días no laborables</button>
            <button type="button" class="primario" onClick={() => setDialogo('nuevo')}>＋ Crear sprint</button>
          </div>
        )}
      </div>

      {!lista ? <p>Cargando sprints…</p> : !lista.length ? (
        <div class="pronto"><strong>Crea un sprint con su objetivo y equipo.</strong><p>Las tareas con horas en esa semana entrarán solas mientras esté planificado.</p></div>
      ) : (
        <>
          <label class="visualmente-oculto" for="sprint-sel">Sprint</label>
          <select id="sprint-sel" class="buscador" style={{ width: "min(640px, 100%)" }} value={elegido} onChange={(e) => { setElegido(valor(e)); setPestana('tablero'); }}>
            {lista.map((x) => <option key={x.id} value={x.id}>{x.marca} · {x.name} · {x.status}</option>)}
          </select>

          {s && (
            <>
              <article class="tarjeta" style={{ marginTop: '16px' }}>
                <p class="ceja">{lista.find((x) => x.id === s.id)?.marca} · {s.status}</p>
                <h2 style={{ fontSize: '22px', marginTop: '4px' }}>{s.name}</h2>
                <p style={{ marginTop: '6px' }}>{s.goal}</p>
                <p class="apagado" style={{ marginTop: '6px' }}>{fechaCorta(s.start_date)} → {fechaCorta(s.end_date)} · 5 días hábiles · {det!.tareas.length} tarea(s)</p>
                <div class="persona-acciones" style={{ marginTop: '12px' }}>
                  {coordina && s.status === 'Planificado' && <button type="button" class="primario" onClick={iniciar}>Iniciar sprint</button>}
                  {coordina && s.status === 'Activo' && <button type="button" class="primario" onClick={() => accion(`/sprints/${s.id}/revision`, {}, 'Sprint en revisión.')}>Pasar a revisión</button>}
                  {coordina && s.status === 'Planificado' && <button type="button" onClick={() => setDialogo('editar')}>Editar planificación</button>}
                  <a class="casilla" href={`/encargos?sprint=${s.id}`}>Ver en Mis encargos</a>
                </div>
              </article>

              <nav class="pestanas-vista" aria-label="Secciones del sprint">
                {PESTANAS.filter(([k]) => k !== 'backlog' || coordina).map(([k, t]) => (
                  <button type="button" key={k} aria-pressed={pestana === k} onClick={() => setPestana(k)}>{t}</button>
                ))}
              </nav>

              {pestana === 'tablero' && (
                <>
                  <div class="metricas">
                    {[['Tareas del sprint', det!.tareas.length], ['Terminadas', det!.tareas.filter(COLUMNAS[3]![1]).length],
                      ['En revisión', det!.tareas.filter(COLUMNAS[2]![1]).length], ['Bloqueadas', det!.tareas.filter((t: Fila) => t.blocked).length]]
                      .map(([k, v]) => <div class="tarjeta metrica" key={k}><div><strong>{v}</strong><span>{k}</span></div></div>)}
                  </div>
                  <div class="tablero">
                    {COLUMNAS.map(([titulo, filtro]) => (
                      <section class="columna-tablero" key={titulo} aria-label={titulo}>
                        <h3>{titulo} <span class="apagado">{det!.tareas.filter(filtro).length}</span></h3>
                        {det!.tareas.filter(filtro).map((t: Fila) => (
                          <article class="tarjeta-tarea" key={t.id}>
                            <span class="apagado">{t.mesa ?? 'Sin mesa'} · {t.estimated_hours} h</span>
                            <a href={`/encargos?tarea=${t.id}`}><strong>{t.title}</strong></a>
                            <span class="apagado">{t.responsable ?? 'Sin responsable'}</span>
                            <div class="chips">
                              {!!t.blocked && <span class="insignia roja">Bloqueada</span>}
                              {t.dependencias > 0 && <span class="insignia gris">{t.dependencias} dependencia(s)</span>}
                            </div>
                            {coordina && s.status !== 'Cerrado' && <button type="button" class="enlace" onClick={() => retirar(t)}>Retirar del sprint</button>}
                          </article>
                        ))}
                      </section>
                    ))}
                  </div>
                </>
              )}

              {pestana === 'backlog' && coordina && (
                !det!.backlog.length ? <p class="apagado">No hay tareas pendientes sin sprint en esta marca.</p> : (
                  <ul class="lista-invitaciones">
                    {det!.backlog.map((t: Fila, i: number) => (
                      <li key={t.id}>
                        <div style={{ minWidth: 0 }}>
                          <strong><a href={`/encargos?tarea=${t.id}`}>{t.title}</a></strong><br />
                          <span class="apagado">{t.responsable ?? 'Sin responsable'} · {t.priority} · {t.estimated_hours} h · vence {fechaCorta(t.due)}</span><br />
                          {t.faltas.length ? <span class="insignia ambar">Falta: {t.faltas.join(', ')}</span> : <span class="insignia verde">Lista</span>}
                        </div>
                        <div class="persona-acciones">
                          <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
                          <button type="button" aria-label="Bajar" disabled={i === det!.backlog.length - 1} onClick={() => mover(i, 1)}>↓</button>
                          <button type="button" onClick={() => setDialogo({ preparar: t })}>Preparar</button>
                          {s.status !== 'Cerrado' && <button type="button" class="primario" onClick={() => agregar(t)}>Agregar al sprint</button>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              )}

              {pestana === 'capacidad' && (
                <div class="tabla-simple" role="table" aria-label="Capacidad del equipo">
                  <div role="row" class="cabeza"><span>Miembro</span><span>Jornada diaria</span><span>Ocupado</span><span>Disponible</span><span>Comprometido</span><span>Balance</span></div>
                  {det!.miembros.map((m: Fila) => (
                    <div role="row" key={m.personaId}>
                      <span><strong>{m.nombre}</strong></span><span>{m.horasDiarias} h × {m.dias} días</span><span>{m.ocupado} h</span>
                      <span>{m.disponible} h</span><span>{m.comprometido} h</span>
                      <span>{m.sobrecarga ? <span class="insignia roja">Sobrecarga</span> : m.sobreTope ? <span class="insignia ambar">Sobre el 80 %</span> : <span class="insignia verde">Con capacidad</span>}</span>
                    </div>
                  ))}
                </div>
              )}

              {pestana === 'diario' && <Diario det={det!} persona={persona} alGuardar={() => { aviso('Avance registrado.'); cargar(); }} aviso={aviso} />}
              {pestana === 'cierre' && <Cierre det={det!} coordina={coordina} alCerrar={(n) => { aviso(n ? `Sprint cerrado. ${n} tarea(s) volvieron al backlog.` : 'Sprint cerrado.'); cargar(); cargarLista(); }} aviso={aviso} />}
            </>
          )}
        </>
      )}

      {(dialogo === 'nuevo' || dialogo === 'editar') && (
        <FormSprint sprint={dialogo === 'editar' ? det : null} alCerrar={() => setDialogo(null)}
          alGuardar={(id) => { setDialogo(null); aviso('Sprint guardado.'); setElegido(id); cargarLista(); cargar(); }} />
      )}
      {dialogo === 'feriados' && <DiasNoLaborables alCerrar={() => setDialogo(null)} aviso={aviso} />}
      {dialogo && typeof dialogo === 'object' && <FormPreparar tarea={dialogo.preparar} alCerrar={() => setDialogo(null)} alGuardar={() => { setDialogo(null); aviso('Tarea preparada.'); cargar(); }} />}
    </section>
  );
};

const Diario = ({ det, persona, alGuardar, aviso }: { det: Fila; persona: Persona; alGuardar: () => void; aviso: (m: string) => void }) => {
  const mias = det.tareas.filter((t: Fila) => persona.permisos.coordina || t.owner_id === persona.id);
  const hoy = hoySantiago();
  const [d, setD] = useState({ tareaId: '', dia: hoy >= det.sprint.start_date && hoy <= det.sprint.end_date ? hoy : det.sprint.start_date, avance: '', siguiente: '', bloqueo: '', resuelveId: '', fechaRequerida: '' });
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  useEffect(() => { cargarPersonas().then(setGente); }, []);
  const enviar = async (e: Event) => {
    e.preventDefault();
    try {
      await pedir(`/sprints/${det.sprint.id}/diario`, { method: 'POST', json: { ...d, resuelveId: d.resuelveId || null, fechaRequerida: d.fechaRequerida || null } });
      setD({ ...d, avance: '', siguiente: '', bloqueo: '', resuelveId: '', fechaRequerida: '' });
      alGuardar();
    } catch (err) { aviso((err as Error).message); }
  };
  return (
    <div class="inicio-grilla">
      <section class="tarjeta">
        <h2 style={{ marginBottom: '12px' }}>Registros</h2>
        {!det.diario.length ? <p class="apagado">Aún no hay avances registrados.</p> : (
          <ul class="lista-simple">
            {det.diario.map((r: Fila) => (
              <li key={r.id}><strong>{fechaCorta(r.day)} · {r.persona}</strong> en {r.title}<br />{r.progress}
                {r.next && <><br /><span class="apagado">Sigue: {r.next}</span></>}
                {r.block && <><br /><span class="insignia roja">Bloqueo: {r.block} → {r.resuelve} ({fechaCorta(r.required_date)})</span></>}</li>
            ))}
          </ul>
        )}
      </section>
      {det.sprint.status === 'Activo' && mias.length > 0 && (
        <section class="tarjeta">
          <h2 style={{ marginBottom: '12px' }}>Registrar avance</h2>
          <form class="formulario" onSubmit={enviar}>
            <label>Tarea<select required value={d.tareaId} onChange={(e) => setD({ ...d, tareaId: valor(e) })}>
              <option value="">Elige una tarea</option>{mias.map((t: Fila) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
            <label>Día<input type="date" required min={det.sprint.start_date} max={det.sprint.end_date} value={d.dia} onInput={(e) => setD({ ...d, dia: valor(e) })} /></label>
            <label>Qué avancé<textarea required rows={2} value={d.avance} onInput={(e) => setD({ ...d, avance: valor(e) })} /></label>
            <label>Qué sigue<textarea rows={2} value={d.siguiente} onInput={(e) => setD({ ...d, siguiente: valor(e) })} /></label>
            <label>¿Algo te bloquea?<input value={d.bloqueo} onInput={(e) => setD({ ...d, bloqueo: valor(e) })} /></label>
            {d.bloqueo && (
              <div class="dos">
                <label>Quién lo resuelve<select required value={d.resuelveId} onChange={(e) => setD({ ...d, resuelveId: valor(e) })}>
                  <option value="">Elige</option>{gente.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
                <label>Para cuándo<input type="date" required value={d.fechaRequerida} onInput={(e) => setD({ ...d, fechaRequerida: valor(e) })} /></label>
              </div>
            )}
            <div class="acciones"><button type="submit" class="primario">Registrar avance</button></div>
          </form>
        </section>
      )}
    </div>
  );
};

const Cierre = ({ det, coordina, alCerrar, aviso }: { det: Fila; coordina: boolean; alCerrar: (n: number) => void; aviso: (m: string) => void }) => {
  const s = det.sprint;
  const pendientes = det.tareas.filter((t: Fila) => !['Aprobada', 'Completada'].includes(t.status));
  const [d, setD] = useState({ resultado: 'Parcialmente alcanzado', evidenciaObjetivo: '', revision: '', retro: '', mejora: '', mejoraResponsableId: '', mejoraFecha: '', causa: '', excResponsableId: '', excFecha: '' });
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  useEffect(() => { cargarPersonas().then(setGente); }, []);
  const cambiar = (k: keyof typeof d) => (e: Event) => setD({ ...d, [k]: valor(e) });
  const enviar = async (e: Event) => {
    e.preventDefault();
    try {
      const r = await pedir<{ alBacklog: number }>(`/sprints/${s.id}/cerrar`, { method: 'POST', json: {
        resultado: d.resultado, evidenciaObjetivo: d.evidenciaObjetivo, revision: d.revision, retro: d.retro, mejora: d.mejora,
        mejoraResponsableId: d.mejoraResponsableId || null, mejoraFecha: d.mejoraFecha || null,
        excepcion: pendientes.length ? { causa: d.causa, responsableId: d.excResponsableId, fecha: d.excFecha } : null,
      } });
      alCerrar(r.alBacklog);
    } catch (err) { aviso((err as Error).message); }
  };
  const opcionesGente = gente.map((g) => <option key={g.id} value={g.id}>{g.name}</option>);
  return (
    <div class="inicio-grilla">
      <section class="tarjeta">
        {s.status === 'Cerrado' ? (
          <>
            <h2>Sprint cerrado · {s.goal_result}</h2>
            <p style={{ marginTop: '8px' }}><strong>Revisión:</strong> {s.review}</p>
            <p style={{ marginTop: '6px' }}><strong>Retrospectiva:</strong> {s.retro}</p>
            {s.improvement && <p style={{ marginTop: '6px' }}><strong>Mejora:</strong> {s.improvement}</p>}
          </>
        ) : s.status !== 'En revisión' ? <p class="apagado">El cierre se registra cuando el sprint pasa a revisión.</p> : !coordina ? <p class="apagado">El cierre lo registra coordinación.</p> : (
          <form class="formulario" onSubmit={enviar}>
            <label>Resultado del objetivo<select value={d.resultado} onChange={cambiar('resultado')}>{['Alcanzado', 'Parcialmente alcanzado', 'No alcanzado'].map((x) => <option key={x}>{x}</option>)}</select></label>
            {d.resultado === 'Alcanzado' && <label>Evidencia del objetivo<textarea required rows={2} value={d.evidenciaObjetivo} onInput={cambiar('evidenciaObjetivo')} /></label>}
            <label>Revisión del sprint<textarea required rows={3} value={d.revision} onInput={cambiar('revision')} /></label>
            <label>Retrospectiva<textarea required rows={3} value={d.retro} onInput={cambiar('retro')} /></label>
            <label>Mejora para el próximo sprint (opcional)<input value={d.mejora} onInput={cambiar('mejora')} /></label>
            {d.mejora && <div class="dos"><label>Responsable<select required value={d.mejoraResponsableId} onChange={cambiar('mejoraResponsableId')}><option value="">Elige</option>{opcionesGente}</select></label>
              <label>Fecha<input type="date" required value={d.mejoraFecha} onInput={cambiar('mejoraFecha')} /></label></div>}
            {pendientes.length > 0 && (
              <fieldset>
                <legend>Excepción de cierre ({pendientes.length} pendiente(s))</legend>
                <span class="ayuda">Lo pendiente vuelve al backlog y requiere nueva planificación explícita.</span>
                <label>Causa<input required value={d.causa} onInput={cambiar('causa')} /></label>
                <div class="dos"><label>Responsable<select required value={d.excResponsableId} onChange={cambiar('excResponsableId')}><option value="">Elige</option>{opcionesGente}</select></label>
                  <label>Resolver antes del<input type="date" required min={hoySantiago()} value={d.excFecha} onInput={cambiar('excFecha')} /></label></div>
              </fieldset>
            )}
            <div class="acciones"><button type="submit" class="primario">Cerrar sprint</button></div>
          </form>
        )}
      </section>
      <section class="tarjeta">
        <h2 style={{ marginBottom: '12px' }}>Historial de alcance</h2>
        <ul class="lista-simple">{det.cambios.map((x: Fila, i: number) => <li key={i}><strong>{x.action}</strong> · {x.reason}<br /><span class="apagado">{x.autor ?? 'mesawow'}</span></li>)}</ul>
      </section>
    </div>
  );
};

const lunesProximo = () => {
  const h = hoySantiago();
  const dow = new Date(`${h}T12:00:00Z`).getUTCDay();
  return new Date(Date.parse(`${h}T12:00:00Z`) + ((8 - dow) % 7 || 7) * 86_400_000).toISOString().slice(0, 10);
};

const FormSprint = ({ sprint, alCerrar, alGuardar }: { sprint: Fila | null; alCerrar: () => void; alGuardar: (id: string) => void }) => {
  const s = sprint?.sprint;
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [d, setD] = useState({ marcaId: s?.brand_id ?? '', nombre: s?.name ?? '', objetivo: s?.goal ?? '', inicio: s?.start_date ?? lunesProximo(), facilitadorId: s?.facilitator_id ?? '', motivo: '' });
  const [miembros, setMiembros] = useState<Record<string, number>>(Object.fromEntries((sprint?.miembros ?? []).map((m: Fila) => [m.personaId, m.horasDiarias])));
  const [error, setError] = useState('');
  useEffect(() => { cargarMarcas().then(setMarcas); cargarPersonas().then(setGente); }, []);
  const conMarca = gente.filter((g) => g.role === 'Administrador general' || g.marcas.includes(d.marcaId));
  const enviar = async (e: Event) => {
    e.preventDefault();
    const json = { ...d, facilitadorId: d.facilitadorId || null, motivo: d.motivo || undefined, miembros: Object.entries(miembros).map(([personaId, horasDiarias]) => ({ personaId, horasDiarias })) };
    try {
      const r = s ? (await pedir(`/sprints/${s.id}`, { method: 'PATCH', json }), { id: s.id }) : await pedir<{ id: string }>('/sprints', { method: 'POST', json });
      alGuardar(r.id);
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <Dialogo titulo={s ? 'Editar planificación' : 'Crear sprint'} abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={enviar}>
        <div class="dos">
          <label>Marca<select required disabled={!!s} value={d.marcaId} onChange={(e) => { setD({ ...d, marcaId: valor(e) }); setMiembros({}); }}>
            <option value="">Elige</option>{marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label>Inicio (lunes)<input type="date" required value={d.inicio} onInput={(e) => setD({ ...d, inicio: valor(e) })} /></label>
        </div>
        <label>Nombre<input required minLength={3} value={d.nombre} placeholder="Ej.: Semana del lanzamiento" onInput={(e) => setD({ ...d, nombre: valor(e) })} /></label>
        <label>Objetivo<textarea required rows={2} value={d.objetivo} onInput={(e) => setD({ ...d, objetivo: valor(e) })} /></label>
        <label>Facilitación<select value={d.facilitadorId} onChange={(e) => setD({ ...d, facilitadorId: valor(e) })}><option value="">Yo</option>{conMarca.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <fieldset>
          <legend>Miembros y horas diarias</legend>
          {!d.marcaId ? <span class="ayuda">Elige la marca primero.</span> : (
            <div class="lista-elegible">
              {conMarca.map((g) => (
                <label key={g.id}>
                  <input type="checkbox" checked={g.id in miembros} onChange={(e) => {
                    const m = { ...miembros };
                    if ((e.target as HTMLInputElement).checked) m[g.id] = 8; else delete m[g.id];
                    setMiembros(m);
                  }} />
                  <span style={{ flex: 1 }}>{g.name}</span>
                  {g.id in miembros && <input type="number" aria-label={`Horas diarias de ${g.name}`} style={{ width: '80px' }} min={0} max={8} step={0.5}
                    value={miembros[g.id]} onInput={(e) => setMiembros({ ...miembros, [g.id]: Number(valor(e)) })} />}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {s && <label>Motivo del cambio<input required value={d.motivo} onInput={(e) => setD({ ...d, motivo: valor(e) })} /></label>}
        {error && <p class="error-form" role="alert">{error}</p>}
        <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" class="primario">Guardar</button></div>
      </form>
    </Dialogo>
  );
};

const FormPreparar = ({ tarea, alCerrar, alGuardar }: { tarea: Fila; alCerrar: () => void; alGuardar: () => void }) => {
  const [d, setD] = useState({ horas: String(tarea.estimated_hours || ''), criterio: tarea.acceptance ?? '', instruccion: tarea.description ?? '', inputsListos: !!tarea.inputs_ready });
  const [error, setError] = useState('');
  const enviar = async (e: Event) => {
    e.preventDefault();
    try { await pedir(`/tareas/${tarea.id}/preparar`, { method: 'POST', json: { ...d, horas: Number(d.horas) } }); alGuardar(); } catch (err) { setError((err as Error).message); }
  };
  return (
    <Dialogo titulo={`Preparar: ${tarea.title}`} abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={enviar}>
        <label>Horas estimadas<input type="number" required min={0.5} max={320} step={0.5} value={d.horas} onInput={(e) => setD({ ...d, horas: valor(e) })} /></label>
        <label>Instrucción<textarea required rows={3} value={d.instruccion} onInput={(e) => setD({ ...d, instruccion: valor(e) })} /></label>
        <label>Criterio de aceptación<textarea required rows={2} value={d.criterio} onInput={(e) => setD({ ...d, criterio: valor(e) })} /></label>
        <label class="casilla" style={{ justifySelf: 'start' }}><input type="checkbox" checked={d.inputsListos} onChange={(e) => setD({ ...d, inputsListos: (e.target as HTMLInputElement).checked })} /> Inputs disponibles y validados</label>
        {error && <p class="error-form" role="alert">{error}</p>}
        <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" class="primario">Guardar</button></div>
      </form>
    </Dialogo>
  );
};

const DiasNoLaborables = ({ alCerrar, aviso }: { alCerrar: () => void; aviso: (m: string) => void }) => {
  const anio = Number(hoySantiago().slice(0, 4));
  const [lista, setLista] = useState<Fila[]>([]);
  const [fecha, setFecha] = useState('');
  const [nombre, setNombre] = useState('');
  const cargar = () => Promise.all([anio, anio + 1].map((a) => pedir<{ feriados: Fila[] }>(`/feriados?anio=${a}`))).then((r) => setLista(r.flatMap((x) => x.feriados)));
  useEffect(() => { cargar(); }, []);
  const hacer = async (f: () => Promise<unknown>, m: string) => { try { await f(); aviso(m); cargar(); } catch (e) { aviso((e as Error).message); } };
  return (
    <Dialogo titulo="Días no laborables" abierto alCerrar={alCerrar}>
      <div class="formulario">
        <p>Los feriados oficiales de Chile se cargan solos cada semana. Agrega aquí días no laborables propios del equipo.</p>
        <form class="dos" onSubmit={(e) => { e.preventDefault(); hacer(() => pedir('/feriados', { method: 'POST', json: { fecha, nombre } }), 'Día agregado. Las agendas se recalcularon.'); }}>
          <label>Fecha<input type="date" required value={fecha} onInput={(e) => setFecha(valor(e))} /></label>
          <label>Motivo<span class="enlace-copiable"><input required minLength={2} value={nombre} onInput={(e) => setNombre(valor(e))} /><button type="submit">Agregar</button></span></label>
        </form>
        <button type="button" class="mas-opciones" onClick={() => hacer(() => pedir('/feriados/sincronizar', { method: 'POST' }), 'Feriados oficiales actualizados.')}>Actualizar feriados oficiales ahora</button>
        <ul class="lista-invitaciones">
          {lista.map((f) => (
            <li key={f.date}><span><strong>{fechaCorta(f.date)}</strong> {f.date.slice(0, 4)} · {f.name}</span>
              {f.source === 'manual' ? <button type="button" onClick={() => hacer(() => pedir(`/feriados/${f.date}`, { method: 'DELETE' }), 'Día quitado.')}>Quitar</button>
                : <span class="insignia gris">Oficial</span>}</li>
          ))}
        </ul>
      </div>
    </Dialogo>
  );
};

