// Dos calendarios (§4.7): trabajo (horas) y al aire (piezas), por mes o semana, y Semana del equipo.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { hoySantiago } from '../../shared/fechas';
import { pedir, type Persona } from '../api';
import { Horario, Leyenda, type BloqueH, type PiezaH, type ReunionH } from '../componentes/Horario';
import { fechaCorta, personas as cargarPersonas, type PersonaDirectorio } from '../datos';
import { TONO_PIEZA } from './Aire';

type Modo = 'ambos' | 'trabajo' | 'aire';
interface Datos { jornada: { ventanas: { inicio: number; fin: number }[] }; bloques: (BloqueH & { person_id: string })[]; piezas: PiezaH[]; reuniones: ReunionH[]; feriados: { date: string; name: string }[] }

const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lunesDe = (f: string) => sumarDias(f, -((new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7));
const horasDe = (b: BloqueH) => (Date.parse(`${b.ends_at}:00Z`) - Date.parse(`${b.starts_at}:00Z`)) / 3_600_000;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const Calendarios = ({ persona }: { persona: Persona }) => {
  const hoy = hoySantiago();
  const dirige = persona.permisos.coordinaODirige;
  const [modo, setModo] = useState<Modo>('ambos');
  const [vista, setVista] = useState<'mes' | 'semana'>('mes');
  const inicial = new URLSearchParams(location.search).get('fecha') ?? hoy;
  const [fecha, setFecha] = useState(inicial);
  const [quien, setQuien] = useState(dirige ? '' : persona.id);
  const [dia, setDia] = useState(inicial);
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [datos, setDatos] = useState<Datos | null>(null);
  useEffect(() => { if (dirige) cargarPersonas().then(setGente); }, []);

  const mes = fecha.slice(0, 7);
  const primero = `${mes}-01`;
  const inicioGrilla = lunesDe(primero);
  const semanas = useMemo(() => {
    const filas = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => sumarDias(inicioGrilla, w * 7 + d)));
    return filas.at(-1)![0]!.slice(0, 7) !== mes ? filas.slice(0, 5) : filas;
  }, [mes]);
  const rango = vista === 'mes' ? [semanas[0]![0]!, semanas.at(-1)![6]!] : [lunesDe(fecha), sumarDias(lunesDe(fecha), 4)];
  useEffect(() => {
    setDatos(null);
    pedir<Datos>(`/calendario?desde=${rango[0]}&hasta=${rango[1]}${quien ? `&persona=${quien}` : ''}`).then(setDatos).catch(() => setDatos(null));
  }, [rango[0], rango[1], quien]);

  const bloques = modo === 'aire' ? [] : datos?.bloques ?? [];
  const piezas = modo === 'trabajo' ? [] : datos?.piezas ?? [];
  const delDia = (d: string) => ({
    bloques: bloques.filter((b) => b.starts_at.startsWith(d)),
    piezas: piezas.filter((p) => p.at.startsWith(d) || (p.end_date && p.at.slice(0, 10) < d && p.end_date >= d)),
  });
  const totalHoras = bloques.filter((b) => b.starts_at.startsWith(mes)).reduce((n, b) => n + horasDe(b), 0);
  const totalAire = piezas.filter((p) => p.at.startsWith(mes)).length;
  const mover = (n: number) => setFecha(vista === 'mes' ? `${new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7)}-01` : sumarDias(fecha, n * 7));
  const sel = delDia(dia);

  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado"><div><p class="ceja">Calendarios</p><h1 id="titulo-vista">Dos calendarios</h1></div></div>
      <div class="explica-calendarios">
        <p><i class="l-trabajo" /> <strong>Calendario de trabajo:</strong> las horas que cada tarea ocupa en Mi mesa.</p>
        <p><i class="l-aire" /> <strong>Calendario al aire:</strong> lo que se publica, desde la Mesa al aire.</p>
      </div>
      <div class="barra-agenda">
        <div class="segmentado" role="group" aria-label="Qué mostrar">
          {(['ambos', 'trabajo', 'aire'] as Modo[]).map((m) => <button type="button" key={m} aria-pressed={modo === m} onClick={() => setModo(m)}>{m === 'ambos' ? 'Ambos' : m === 'trabajo' ? 'Trabajo' : 'Al aire'}</button>)}
        </div>
        <div class="segmentado" role="group" aria-label="Vista">
          <button type="button" aria-pressed={vista === 'mes'} onClick={() => setVista('mes')}>Mes</button>
          <button type="button" aria-pressed={vista === 'semana'} onClick={() => setVista('semana')}>Semana</button>
        </div>
        <div class="persona-acciones">
          <button type="button" aria-label="Anterior" onClick={() => mover(-1)}>←</button>
          <button type="button" onClick={() => { setFecha(hoy); setDia(hoy); }}>Hoy</button>
          <button type="button" aria-label="Siguiente" onClick={() => mover(1)}>→</button>
        </div>
        <strong>{vista === 'mes' ? `${MESES[+mes.slice(5, 7) - 1]} ${mes.slice(0, 4)}` : `Semana del ${fechaCorta(rango[0]!)}`}</strong>
        {dirige && (
          <select aria-label="Persona" value={quien} onChange={(e) => setQuien((e.target as HTMLSelectElement).value)}>
            <option value="">Todo el equipo</option>
            {gente.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>

      {!datos ? <p>Cargando…</p> : vista === 'semana' ? (
        <>
          <Horario dias={[0, 1, 2, 3, 4].map((i) => sumarDias(rango[0]!, i))} ventanas={datos.jornada.ventanas} feriados={datos.feriados}
            bloques={bloques} reuniones={modo === 'aire' ? [] : datos.reuniones} piezas={piezas} modo="semana" enfocar={fecha} />
          <Leyenda semana />
        </>
      ) : (
        <>
          <p class="apagado">{modo !== 'aire' && `${Math.round(totalHoras * 10) / 10} h de trabajo`}{modo === 'ambos' && ' · '}{modo !== 'trabajo' && `${totalAire} pieza(s) al aire`} este mes</p>
          <div class="mes" role="grid" aria-label="Calendario del mes">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => <span class="mes-dia-semana" key={d} role="columnheader">{d}</span>)}
            {semanas.flat().map((d) => {
              const x = delDia(d);
              const h = x.bloques.reduce((n, b) => n + horasDe(b), 0);
              const chips = [
                ...x.bloques.map((b) => ({ c: 'w', t: `${Math.round(horasDe(b) * 10) / 10} h · ${b.title}` })),
                ...x.piezas.filter((p) => !p.end_date || p.at.startsWith(d)).map((p) => ({ c: 'a', t: `${p.at.slice(11)} ${p.piece || p.title}` })),
              ];
              const activos = x.piezas.filter((p) => p.end_date && !p.at.startsWith(d)).length;
              const feriado = datos.feriados.find((f) => f.date === d);
              return (
                <button type="button" role="gridcell" key={d} class={`mes-celda${d.slice(0, 7) !== mes ? ' fuera' : ''}${d === hoy ? ' hoy' : ''}${d === dia ? ' elegido' : ''}`}
                  aria-label={`${fechaCorta(d)}: ${Math.round(h * 10) / 10} horas, ${x.piezas.length} piezas al aire`} onClick={() => setDia(d)}>
                  <span class="mes-n">{+d.slice(8, 10)}</span>
                  {feriado && <span class="mes-feriado">{feriado.name}</span>}
                  <span class="mes-chips">
                    {chips.slice(0, 3).map((c, i) => <span key={i} class={`mes-chip ${c.c}`}>{c.t}</span>)}
                    {activos > 0 && <span class="mes-chip a act">▸ {activos} anuncio(s) activo(s)</span>}
                    {chips.length > 3 && <span class="mes-mas">+{chips.length - 3} más</span>}
                  </span>
                  <span class="mes-puntos" aria-hidden="true">
                    {h > 0 && <i class="w">{Math.round(h)}h</i>}{x.piezas.length > 0 && <i class="a">{x.piezas.length}</i>}
                  </span>
                </button>
              );
            })}
          </div>
          <section class="tarjeta" style={{ marginTop: '16px' }} aria-live="polite">
            <h2 style={{ marginBottom: '10px' }}>{fechaCorta(dia)}</h2>
            {!sel.bloques.length && !sel.piezas.length ? <p class="apagado">Nada este día.</p> : (
              <ul class="lista-simple">
                {sel.bloques.map((b, i) => <li key={`b${i}`}><i class="l-trabajo" /> {b.starts_at.slice(11)}–{b.ends_at.slice(11)} · <a href={`/encargos?tarea=${b.task_id}`}>{b.title}</a>{b.persona ? ` · ${b.persona}` : ''}</li>)}
                {sel.piezas.map((p) => <li key={p.id}><i class="l-aire" /> {p.end_date && !p.at.startsWith(dia) ? 'Activo' : p.at.slice(11)} · <a href={`/encargos?tarea=${p.task_id}`}>{p.piece || p.title}</a> · {p.channel}{p.end_date ? ` hasta el ${fechaCorta(p.end_date)}` : ''} <span class={`insignia ${TONO_PIEZA[p.estado]}`}>{p.estado}</span></li>)}
              </ul>
            )}
          </section>
        </>
      )}
      {dirige && !quien && <SemanaDelEquipo semanaInicial={lunesDe(fecha)} />}
    </section>
  );
};

const SemanaDelEquipo = ({ semanaInicial }: { semanaInicial: string }) => {
  const [semana, setSemana] = useState(semanaInicial);
  const [d, setD] = useState<{ personas: Record<string, any>[]; alAire: Record<string, any>[] } | null>(null);
  useEffect(() => { setSemana(semanaInicial); }, [semanaInicial]);
  useEffect(() => { pedir<typeof d>(`/semana-equipo?semana=${semana}`).then(setD).catch(() => setD(null)); }, [semana]);
  return (
    <section class="tarjeta" style={{ marginTop: '20px' }} aria-labelledby="t-semana-equipo">
      <div class="seccion-cabeza">
        <h2 id="t-semana-equipo">Semana del equipo · {fechaCorta(semana)}</h2>
        <div class="persona-acciones">
          <button type="button" aria-label="Semana anterior" onClick={() => setSemana(sumarDias(semana, -7))}>←</button>
          <button type="button" aria-label="Semana siguiente" onClick={() => setSemana(sumarDias(semana, 7))}>→</button>
        </div>
      </div>
      {!d ? <p>Cargando…</p> : (
        <div class="inicio-grilla" style={{ marginTop: 0 }}>
          <div>
            <h3 style={{ marginBottom: '8px' }}>En qué estamos ocupados</h3>
            <ul class="lista-simple">
              {d.personas.map((p) => {
                const pct = Math.min(100, (p.horas / p.capacidad) * 100);
                return (
                  <li key={p.id} class="carga">
                    <div class="carga-cabeza"><strong>{p.nombre}</strong><span>{p.horas} de {p.capacidad} h</span></div>
                    <div class="carga-barra"><i class={p.horas > 36 ? 'full' : p.horas > 24 ? 'mid' : ''} style={{ width: `${pct}%` }} /></div>
                    <span class="apagado">{p.abiertas} abierta(s){p.atrasadas ? ` · ${p.atrasadas} atrasada(s)` : ''}{p.bloqueadas ? ` · ${p.bloqueadas} bloqueada(s)` : ''}</span>
                    {p.horas === 0 ? <span class="apagado"> · Sin horas reservadas esta semana</span>
                      : <span class="apagado"> · {p.tareas.map((t: any) => t.title).join(', ')}{p.abiertas > 3 ? ` y ${p.abiertas - 3} más` : ''}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h3 style={{ marginBottom: '8px' }}>Qué sale al aire ({d.alAire.length})</h3>
            {!d.alAire.length ? <p class="apagado">Nada sale al aire esta semana.</p> : (
              <ul class="lista-simple">
                {d.alAire.slice(0, 12).map((p) => <li key={p.id}>{fechaCorta(p.at.slice(0, 10))} {p.at.slice(11)} · {p.piece || p.title} · {p.channel}</li>)}
                {d.alAire.length > 12 && <li class="apagado">y {d.alAire.length - 12} más en el calendario.</li>}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
