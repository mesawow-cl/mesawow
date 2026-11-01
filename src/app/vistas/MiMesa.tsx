// Mi mesa (§4.6) con vista semanal tipo horario escolar (§4.7 bis, D5) y vista por día.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLatido } from '../vivo';
import { hoySantiago } from '../../shared/fechas';
import { pedir, type Persona } from '../api';
import { Dialogo } from '../componentes/Dialogo';
import { Horario, Leyenda, type PiezaH } from '../componentes/Horario';
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
const hora = (pared: string) => pared.slice(11, 16);
const valor = (e: Event) => (e.target as HTMLInputElement).value;

export const MiMesa = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const hoy = hoySantiago();
  const [modo, setModo] = useState<'semana' | 'dia'>('semana');
  const [fecha, setFecha] = useState(() => new URLSearchParams(location.search).get('fecha') ?? hoy);
  const [quien, setQuien] = useState(persona.id);
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [dialogo, setDialogo] = useState<'reunion' | 'reservar' | 'google' | null>(null);

  const lunes = lunesDe(fecha);
  const dias = useMemo(() => (modo === 'semana' ? [0, 1, 2, 3, 4].map((i) => sumarDias(lunes, i)) : [fecha]), [modo, lunes, fecha]);
  const cargar = () => pedir<Agenda>(`/agenda?persona=${quien}&desde=${dias[0]}&hasta=${dias.at(-1)}`).then(setAgenda).catch((e: Error) => aviso(e.message));
  const latido = useLatido();
  useEffect(() => { cargar(); }, [quien, dias[0], dias.at(-1), latido]);
  useEffect(() => { if (persona.permisos.coordinaODirige) cargarPersonas().then(setGente); }, []);
  // Regreso desde Google Calendar.
  useEffect(() => {
    const g = new URLSearchParams(location.search).get('google');
    if (!g) return;
    aviso(g === 'ok' ? 'Google Calendar conectado. Tus reuniones entran a mesawow y tus bloques de trabajo aparecen en Google.' : 'No se pudo conectar Google Calendar. Intenta de nuevo.');
    history.replaceState(null, '', location.pathname);
  }, []);
  const [piezas, setPiezas] = useState<PiezaH[]>([]);
  useEffect(() => {
    pedir<{ piezas: PiezaH[] }>(`/calendario?persona=${quien}&desde=${dias[0]}&hasta=${dias.at(-1)}`).then((r) => setPiezas(r.piezas)).catch(() => setPiezas([]));
  }, [quien, dias[0], dias.at(-1), latido]);

  const mover = (n: number) => setFecha(sumarDias(fecha, modo === 'semana' ? n * 7 : n));
  const propia = quien === persona.id;
  const puedeEditar = !persona.permisos.soloLectura && (propia || persona.permisos.coordina);
  const alGuardar = (mensaje: string, cambios?: { titulo: string; ahora: string }[]) => {
    setDialogo(null);
    aviso(cambios?.length ? `${mensaje} ${cambios.length} tarea(s) cambiaron de término; avisamos al equipo.` : mensaje);
    cargar();
  };

  const ventanas = agenda?.jornada.ventanas ?? [{ inicio: 540, fin: 840 }, { inicio: 900, fin: 1080 }];

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
            {propia && <button type="button" onClick={() => setDialogo('google')}>Google Calendar</button>}
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
          <Horario dias={dias} ventanas={ventanas} bloques={agenda.bloques} reuniones={agenda.reuniones} feriados={agenda.feriados} piezas={piezas} modo={modo} enfocar={fecha} />
          <Leyenda semana={modo === 'semana'} />

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
      {dialogo === 'google' && <ConexionGoogle alCerrar={() => setDialogo(null)} aviso={aviso} alSincronizar={cargar} />}
      {dialogo === 'reservar' && <FormReservar personaId={quien} fecha={dias[0]!} alCerrar={() => setDialogo(null)} alGuardar={alGuardar} />}
    </section>
  );
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

const ConexionGoogle = ({ alCerrar, aviso, alSincronizar }: { alCerrar: () => void; aviso: (m: string) => void; alSincronizar: () => void }) => {
  const [e, setE] = useState<{ disponible: boolean; fuente: boolean; enlace: boolean; estado: string; ultimaSincronizacion: string | null } | null>(null);
  const [url, setUrl] = useState('');
  const [enlace, setEnlace] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const cargar = () => pedir<typeof e>('/ical/estado').then(setE);
  useEffect(() => { cargar(); }, []);
  const hacer = async (f: () => Promise<unknown>, m: string) => {
    setOcupado(true);
    try { await f(); aviso(m); await cargar(); alSincronizar(); } catch (err) { aviso((err as Error).message); } finally { setOcupado(false); }
  };
  const crearEnlace = async () => {
    if (e?.enlace && !confirm('Se creará un enlace nuevo y el anterior dejará de funcionar. ¿Seguir?')) return;
    try { setEnlace((await pedir<{ url: string }>('/ical/enlace', { method: 'POST' })).url); cargar(); } catch (err) { aviso((err as Error).message); }
  };
  return (
    <Dialogo titulo="Google Calendar" abierto alCerrar={alCerrar}>
      {!e ? <p>Cargando…</p> : (
        <div class="formulario">
          <p><strong>Estado:</strong> {e.estado}{e.ultimaSincronizacion ? ` · última lectura ${new Date(e.ultimaSincronizacion).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}` : ''}</p>
          <fieldset>
            <legend>1. Tus reuniones de Google → mesawow</legend>
            <ol class="pasos-guia">
              <li>Abre <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noopener noreferrer">la configuración de Google Calendar</a>.</li>
              <li>A la izquierda, en <strong>Configuración de mis calendarios</strong>, elige tu calendario.</li>
              <li>Baja hasta <strong>Integrar el calendario</strong> y copia la <strong>Dirección secreta en formato iCal</strong>.</li>
              <li>Pégala aquí. mesawow lee tus reuniones cada 5 minutos y corre tus tareas si aparece una nueva.</li>
            </ol>
            {e.fuente ? (
              <div class="acciones" style={{ justifyContent: 'flex-start' }}>
                <span class="insignia verde">Conectado</span>
                <button type="button" disabled={ocupado} onClick={() => hacer(() => pedir('/ical/sincronizar', { method: 'POST' }), 'Reuniones actualizadas.')}>Leer ahora</button>
                <button type="button" disabled={ocupado} onClick={() => hacer(() => pedir('/ical/fuente', { method: 'DELETE' }), 'Desconectado.')}>Desconectar</button>
              </div>
            ) : (
              <form class="enlace-copiable" onSubmit={(ev) => { ev.preventDefault(); hacer(() => pedir('/ical/fuente', { method: 'PUT', json: { url } }), 'Google Calendar conectado: tus reuniones ya están en Mi mesa.'); }}>
                <label class="visualmente-oculto" for="ical-url">Dirección secreta en formato iCal</label>
                <input id="ical-url" type="url" required placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics" value={url} onInput={(ev) => setUrl((ev.target as HTMLInputElement).value)} />
                <button type="submit" class="primario" disabled={ocupado || !e.disponible}>Conectar</button>
              </form>
            )}
            <span class="ayuda">Esa dirección es privada: mesawow la guarda cifrada. No la compartas con nadie más.</span>
          </fieldset>
          <fieldset>
            <legend>2. Tus bloques de trabajo → Google</legend>
            <ol class="pasos-guia">
              <li>Crea tu enlace privado y cópialo.</li>
              <li>En Google Calendar, a la izquierda, junto a <strong>Otros calendarios</strong>, toca <strong>＋</strong> → <strong>Desde URL</strong>.</li>
              <li>Pega el enlace y toca <strong>Agregar calendario</strong>. Tus bloques aparecen con 🛠; Google los actualiza cada algunas horas.</li>
            </ol>
            {enlace ? (
              <div class="enlace-copiable">
                <input readOnly value={enlace} aria-label="Tu enlace privado" onFocus={(ev) => (ev.target as HTMLInputElement).select()} />
                <button type="button" onClick={() => navigator.clipboard.writeText(enlace).then(() => aviso('Enlace copiado.'), () => aviso('Copia el enlace manualmente.'))}>Copiar</button>
              </div>
            ) : (
              <div class="acciones" style={{ justifyContent: 'flex-start' }}>
                {e.enlace && <span class="insignia verde">Enlace creado</span>}
                <button type="button" onClick={crearEnlace}>{e.enlace ? 'Crear un enlace nuevo' : 'Crear mi enlace'}</button>
              </div>
            )}
            {enlace.includes('localhost') && <span class="aviso-bloqueo">Estás en tu computador: Google no puede leer un enlace de localhost. Este paso funciona cuando mesawow esté publicado.</span>}
            {e.enlace && !enlace && <span class="ayuda">Por seguridad el enlace solo se muestra al crearlo. Si lo perdiste, crea uno nuevo y reemplázalo en Google.</span>}
          </fieldset>
        </div>
      )}
    </Dialogo>
  );
};
