// Mi mesa (§4.6) con vista semanal tipo horario escolar (§4.7 bis, D5) y vista por día.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { hoySantiago, utcASantiago } from '../../shared/fechas';
import { pedir, type Persona } from '../api';
import { Dialogo } from '../componentes/Dialogo';
import { fechaCorta, personas as cargarPersonas, type PersonaDirectorio } from '../datos';

interface Bloque { task_id: string | null; starts_at: string; ends_at: string; title: string; due?: string; color?: string; marca?: string }
interface Reunion { id: string; title: string; starts_at: string; ends_at: string; source: string }
interface Agenda {
  persona: string; jornada: { ventanas: { inicio: number; fin: number }[]; dias: number[] };
  bloques: Bloque[]; reuniones: Reunion[]; feriados: { date: string; name: string }[];
  planes: { task_id: string | null; title: string; starts_at: string; hours: number; finish: string | null; due: string; bloques: number }[];
  cambios: { task_id: string | null; title: string; old_finish: string; new_finish: string; delay_minutes: number; cause: string }[];
}

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lunesDe = (f: string) => sumarDias(f, -((new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7));
const minutos = (pared: string) => +pared.slice(11, 13) * 60 + +pared.slice(14, 16);
const hora = (pared: string) => pared.slice(11, 16);
const valor = (e: Event) => (e.target as HTMLInputElement).value;

export const MiMesa = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const hoy = hoySantiago();
  const [modo, setModo] = useState<'semana' | 'dia'>('semana');
  const [fecha, setFecha] = useState(() => new URLSearchParams(location.search).get('fecha') ?? hoy);
  const [quien, setQuien] = useState(persona.id);
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [dialogo, setDialogo] = useState<'reunion' | 'reservar' | null>(null);

  const lunes = lunesDe(fecha);
  const dias = useMemo(() => (modo === 'semana' ? [0, 1, 2, 3, 4].map((i) => sumarDias(lunes, i)) : [fecha]), [modo, lunes, fecha]);
  const cargar = () => pedir<Agenda>(`/agenda?persona=${quien}&desde=${dias[0]}&hasta=${dias.at(-1)}`).then(setAgenda).catch((e: Error) => aviso(e.message));
  useEffect(() => { cargar(); }, [quien, dias[0], dias.at(-1)]);
  useEffect(() => { if (persona.permisos.coordinaODirige) cargarPersonas().then(setGente); }, []);
  // En el teléfono la semana se desliza: se abre en el día elegido.
  useEffect(() => {
    const col = document.querySelector<HTMLElement>(`.horario.semana [data-fecha="${fecha}"]`);
    if (col?.parentElement) col.parentElement.scrollLeft = col.offsetLeft - col.parentElement.offsetLeft;
  }, [agenda, fecha]);

  const mover = (n: number) => setFecha(sumarDias(fecha, modo === 'semana' ? n * 7 : n));
  const propia = quien === persona.id;
  const puedeEditar = !persona.permisos.soloLectura && (propia || persona.permisos.coordina);
  const alGuardar = (mensaje: string, cambios?: { titulo: string; ahora: string }[]) => {
    setDialogo(null);
    aviso(cambios?.length ? `${mensaje} ${cambios.length} tarea(s) cambiaron de término; avisamos al equipo.` : mensaje);
    cargar();
  };

  const ventanas = agenda?.jornada.ventanas ?? [{ inicio: 540, fin: 840 }, { inicio: 900, fin: 1080 }];
  const desde = ventanas[0]!.inicio, hasta = ventanas.at(-1)!.fin;
  const horas = Array.from({ length: (hasta - desde) / 60 }, (_, i) => desde + i * 60);
  const pos = (ini: number, fin: number) => ({ top: `${((ini - desde) / (hasta - desde)) * 100}%`, height: `${((fin - ini) / (hasta - desde)) * 100}%` });

  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div>
          <p class="ceja">Mi trabajo</p>
          <h1 id="titulo-vista">{propia ? 'Mi mesa' : `Mesa de ${gente.find((g) => g.id === quien)?.name ?? ''}`}</h1>
          <p>Tus horas de trabajo y reuniones, de lunes a viernes. Si aparece una reunión, las tareas se corren solas.</p>
        </div>
        {puedeEditar && (
          <div class="persona-acciones">
            <button type="button" onClick={() => setDialogo('reunion')}>＋ Reunión</button>
            <button type="button" class="primario" onClick={() => setDialogo('reservar')}>＋ Reservar trabajo</button>
          </div>
        )}
      </div>

      <div class="barra-agenda">
        <div class="segmentado" role="group" aria-label="Vista">
          <button type="button" aria-pressed={modo === 'semana'} onClick={() => setModo('semana')}>Semana</button>
          <button type="button" aria-pressed={modo === 'dia'} onClick={() => setModo('dia')}>Día</button>
        </div>
        <div class="persona-acciones">
          <button type="button" aria-label={modo === 'semana' ? 'Semana anterior' : 'Día anterior'} onClick={() => mover(-1)}>←</button>
          <button type="button" onClick={() => setFecha(hoy)}>Hoy</button>
          <button type="button" aria-label={modo === 'semana' ? 'Semana siguiente' : 'Día siguiente'} onClick={() => mover(1)}>→</button>
        </div>
        <strong>{modo === 'semana' ? `Semana del ${fechaCorta(dias[0]!)} al ${fechaCorta(dias.at(-1)!)}` : `${DIAS[new Date(`${fecha}T12:00:00Z`).getUTCDay()]} ${fechaCorta(fecha)}`}</strong>
        {persona.permisos.coordinaODirige && (
          <label class="visualmente-oculto" for="quien">Persona</label>
        )}
        {persona.permisos.coordinaODirige && (
          <select id="quien" value={quien} onChange={(e) => setQuien(valor(e))}>
            <option value={persona.id}>Mi mesa</option>
            {gente.filter((g) => g.id !== persona.id).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>

      {!agenda ? <p>Cargando agenda…</p> : (
        <>
          <div class={`horario ${modo}`} style={{ '--filas': horas.length } as never}>
            <div class="horas" aria-hidden="true">
              <span />
              <div class="eje">{horas.map((m) => <span key={m} style={pos(m, m + 60)}>{String(m / 60).padStart(2, '0')}:00</span>)}</div>
            </div>
            <div class="columnas">
              {dias.map((d) => {
                const feriado = agenda.feriados.find((f) => f.date === d);
                const bloquesDia = agenda.bloques.filter((b) => b.starts_at.startsWith(d));
                const reunionesDia = agenda.reuniones.filter((r) => r.starts_at.startsWith(d));
                return (
                  <section data-fecha={d} class={`dia${d === hoy ? ' hoy' : ''}${feriado ? ' feriado' : ''}`} key={d} aria-label={`${DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${fechaCorta(d)}`}>
                    <header><strong>{DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()]}</strong> {fechaCorta(d)}</header>
                    <div class="lienzo">
                      {ventanas.slice(1).map((v, i) => (
                        <div class="colacion" key={i} style={pos(ventanas[i]!.fin, v.inicio)}><span>Colación</span></div>
                      ))}
                      {feriado && <div class="aviso-feriado">{feriado.name}</div>}
                      {bloquesDia.map((b, i) => (
                        <div class="bloque-trabajo" key={`b${i}`} style={{ ...pos(minutos(b.starts_at), minutos(b.ends_at)), borderLeftColor: b.color ?? 'var(--teal)' }}>
                          {b.task_id ? <a href={`/encargos?tarea=${b.task_id}`}>{b.title}</a> : <span>{b.title}</span>}
                          <small>{hora(b.starts_at)}–{hora(b.ends_at)}{b.marca ? ` · ${b.marca}` : ''}</small>
                        </div>
                      ))}
                      {reunionesDia.map((r) => (
                        <div class="bloque-reunion" key={r.id} style={pos(Math.max(minutos(r.starts_at), desde), Math.min(minutos(r.ends_at), hasta))}>
                          <span>{r.title}</span><small>{hora(r.starts_at)}–{hora(r.ends_at)}{r.source === 'google' ? ' · Google' : ''}</small>
                        </div>
                      ))}
                      {d === hoy && <LineaAhora desde={desde} hasta={hasta} />}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
          <p class="leyenda"><i class="l-trabajo" /> Trabajo <i class="l-reunion" /> Reunión <i class="l-colacion" /> Colación
            {modo === 'semana' && <span class="solo-telefono">· Desliza para ver los otros días</span>}</p>

          <div class="inicio-grilla">
            <section class="tarjeta" aria-labelledby="t-planes">
              <h2 id="t-planes" style={{ marginBottom: '12px' }}>Tareas planificadas</h2>
              {!agenda.planes.length ? <p class="apagado">No hay horas reservadas. Las tareas con horas estimadas se reservan solas.</p> : (
                <ul class="lista-invitaciones">
                  {agenda.planes.map((p, i) => (
                    <li key={i}>
                      <div>
                        <strong>{p.task_id ? <a href={`/encargos?tarea=${p.task_id}`}>{p.title}</a> : p.title}</strong><br />
                        <span class="apagado">{p.hours} h · {p.bloques} bloque(s) · termina {p.finish ? `${fechaCorta(p.finish.slice(0, 10))} ${hora(p.finish)}` : '—'}</span>
                      </div>
                      {p.finish && p.finish.slice(0, 10) > p.due
                        ? <span class="insignia roja">Termina después del plazo ({fechaCorta(p.due)})</span>
                        : <span class="insignia verde">A tiempo</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section class="tarjeta" aria-labelledby="t-cambios">
              <h2 id="t-cambios" style={{ marginBottom: '12px' }}>Cambios de término</h2>
              {!agenda.cambios.length ? <p class="apagado">Sin cambios recientes.</p> : (
                <ul class="lista-simple">
                  {agenda.cambios.map((ch, i) => (
                    <li key={i}><strong>{ch.title}</strong><br /><span class="apagado">
                      {fechaCorta(ch.old_finish.slice(0, 10))} {hora(ch.old_finish)} → {fechaCorta(ch.new_finish.slice(0, 10))} {hora(ch.new_finish)} · {ch.cause}</span></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      {dialogo === 'reunion' && <FormReunion personaId={quien} fecha={dias[0]!} alCerrar={() => setDialogo(null)} alGuardar={alGuardar} />}
      {dialogo === 'reservar' && <FormReservar personaId={quien} fecha={dias[0]!} alCerrar={() => setDialogo(null)} alGuardar={alGuardar} />}
    </section>
  );
};

const LineaAhora = ({ desde, hasta }: { desde: number; hasta: number }) => {
  const m = minutos(utcASantiago(new Date().toISOString()));
  if (m < desde || m > hasta) return null;
  return <div class="linea-ahora" style={{ top: `${((m - desde) / (hasta - desde)) * 100}%` }} aria-hidden="true" />;
};

const FormReunion = ({ personaId, fecha, alCerrar, alGuardar }: { personaId: string; fecha: string; alCerrar: () => void; alGuardar: (m: string, c?: any[]) => void }) => {
  const [titulo, setTitulo] = useState('');
  const [dia, setDia] = useState(fecha);
  const [ini, setIni] = useState('10:00');
  const [fin, setFin] = useState('11:00');
  const [error, setError] = useState('');
  const enviar = async (e: Event) => {
    e.preventDefault();
    try {
      const r = await pedir<{ cambios: any[] }>('/reuniones', { method: 'POST', json: { personaId, titulo, inicio: `${dia}T${ini}`, fin: `${dia}T${fin}` } });
      alGuardar('Reunión agendada.', r.cambios);
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <Dialogo titulo="Nueva reunión" abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={enviar}>
        <label>Nombre<input required minLength={2} maxLength={200} value={titulo} onInput={(e) => setTitulo(valor(e))} /></label>
        <div class="dos">
          <label>Día<input type="date" required value={dia} onInput={(e) => setDia(valor(e))} /></label>
          <div class="dos">
            <label>Desde<input type="time" required step={900} value={ini} onInput={(e) => setIni(valor(e))} /></label>
            <label>Hasta<input type="time" required step={900} value={fin} onInput={(e) => setFin(valor(e))} /></label>
          </div>
        </div>
        <p class="ayuda">Las tareas que estaban en ese horario se corren al siguiente espacio libre y avisamos del nuevo término.</p>
        {error && <p class="error-form" role="alert">{error}</p>}
        <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" class="primario">Agendar</button></div>
      </form>
    </Dialogo>
  );
};

const FormReservar = ({ personaId, fecha, alCerrar, alGuardar }: { personaId: string; fecha: string; alCerrar: () => void; alGuardar: (m: string, c?: any[]) => void }) => {
  const [tareas, setTareas] = useState<{ id: string; title: string; owner_id: string; status: string }[] | null>(null);
  const [tarea, setTarea] = useState('');
  const [dia, setDia] = useState(fecha);
  const [ini, setIni] = useState('09:00');
  const [horas, setHoras] = useState('8');
  const [error, setError] = useState('');
  useEffect(() => {
    pedir<{ tareas: any[] }>(`/tareas?persona=${personaId}`).then((r) =>
      setTareas(r.tareas.filter((t) => t.owner_id === personaId && !['Aprobada', 'Completada'].includes(t.status))));
  }, [personaId]);
  const enviar = async (e: Event) => {
    e.preventDefault();
    try {
      const r = await pedir<{ cambios: any[] }>(`/planes/${tarea}`, { method: 'PUT', json: { inicio: `${dia}T${ini}`, horas: Number(horas) } });
      alGuardar('Horas reservadas.', r.cambios);
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <Dialogo titulo="Reservar horas de trabajo" abierto alCerrar={alCerrar}>
      {!tareas ? <p>Cargando…</p> : !tareas.length ? <p>Esta persona no tiene tareas pendientes a su cargo.</p> : (
        <form class="formulario" onSubmit={enviar}>
          <label>Tarea
            <select required value={tarea} onChange={(e) => setTarea(valor(e))}>
              <option value="">Elige una tarea</option>
              {tareas.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
          <div class="dos">
            <label>Desde<span class="dos"><input type="date" required value={dia} onInput={(e) => setDia(valor(e))} /><input type="time" required step={900} value={ini} onInput={(e) => setIni(valor(e))} /></span></label>
            <label>Horas de trabajo<input type="number" required min={0.5} max={320} step={0.5} value={horas} onInput={(e) => setHoras(valor(e))} /></label>
          </div>
          <p class="ayuda">mesawow reparte las horas de lunes a viernes, 09:00–14:00 y 15:00–18:00, saltando reuniones y feriados.</p>
          {error && <p class="error-form" role="alert">{error}</p>}
          <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" class="primario">Calcular y reservar</button></div>
        </form>
      )}
    </Dialogo>
  );
};
