// Grilla semanal tipo horario escolar (§4.7 bis): días en columnas, horas en filas, colación marcada,
// bloques de trabajo de su alto real, reuniones y salidas al aire como marcadores.
import { useEffect } from 'preact/hooks';
import { utcASantiago } from '../../shared/fechas';
import { fechaCorta } from '../datos';

export interface BloqueH { task_id: string | null; starts_at: string; ends_at: string; title: string; color?: string; marca?: string; persona?: string }
export interface ReunionH { id: string; title: string; starts_at: string; ends_at: string; source: string }
export interface PiezaH { id: string; task_id: string; channel: string; piece: string; at: string; end_date: string | null; title: string; estado: string }

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const minutos = (pared: string) => +pared.slice(11, 13) * 60 + +pared.slice(14, 16);
const hora = (pared: string) => pared.slice(11, 16);

export const Horario = ({ dias, ventanas, bloques, reuniones = [], feriados = [], piezas = [], modo, enfocar }: {
  dias: string[]; ventanas: { inicio: number; fin: number }[]; bloques: BloqueH[]; reuniones?: ReunionH[]; feriados?: { date: string; name: string }[];
  piezas?: PiezaH[]; modo: 'semana' | 'dia'; enfocar?: string;
}) => {
  const hoy = utcASantiago(new Date().toISOString()).slice(0, 10);
  const desde = ventanas[0]?.inicio ?? 540, hasta = ventanas.at(-1)?.fin ?? 1080;
  const horas = Array.from({ length: Math.ceil((hasta - desde) / 60) }, (_, i) => desde + i * 60);
  const pos = (ini: number, fin: number) => ({ top: `${((ini - desde) / (hasta - desde)) * 100}%`, height: `${((fin - ini) / (hasta - desde)) * 100}%` });
  // En el teléfono la semana se desliza: se abre en el día pedido.
  useEffect(() => {
    const col = document.querySelector<HTMLElement>(`.horario.semana [data-fecha="${enfocar ?? hoy}"]`);
    if (col?.parentElement) col.parentElement.scrollLeft = col.offsetLeft - col.parentElement.offsetLeft;
  }, [dias[0], enfocar]);
  return (
    <div class={`horario ${modo}`} style={{ '--filas': horas.length } as never}>
      <div class="horas" aria-hidden="true">
        <span />
        <div class="eje">{horas.map((m) => <span key={m} style={pos(m, m + 60)}>{String(m / 60).padStart(2, '0')}:00</span>)}</div>
      </div>
      <div class="columnas">
        {dias.map((d) => {
          const feriado = feriados.find((f) => f.date === d);
          const nombre = DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()];
          const activos = piezas.filter((p) => p.end_date && p.at.slice(0, 10) <= d && p.end_date >= d);
          const puntuales = piezas.filter((p) => !p.end_date && p.at.startsWith(d));
          return (
            <section data-fecha={d} class={`dia${d === hoy ? ' hoy' : ''}${feriado ? ' feriado' : ''}`} key={d} aria-label={`${nombre} ${fechaCorta(d)}`}>
              <header><strong>{nombre}</strong> {fechaCorta(d)}</header>
              <div class="lienzo">
                {ventanas.slice(1).map((v, i) => <div class="colacion" key={i} style={pos(ventanas[i]!.fin, v.inicio)}><span>Colación</span></div>)}
                {feriado && <div class="aviso-feriado">{feriado.name}</div>}
                {activos.length > 0 && <div class="franja-anuncios" title={activos.map((p) => `${p.piece} · ${p.channel}`).join(', ')}>▸ {activos.length} anuncio(s) activo(s)</div>}
                {bloques.filter((b) => b.starts_at.startsWith(d)).map((b, i) => (
                  <div class="bloque-trabajo" key={`b${i}`} style={{ ...pos(minutos(b.starts_at), minutos(b.ends_at)), borderLeftColor: b.color ?? 'var(--teal)' }}>
                    {b.task_id ? <a href={`/encargos?tarea=${b.task_id}`}>{b.title}</a> : <span>{b.title}</span>}
                    <small>{hora(b.starts_at)}–{hora(b.ends_at)}{b.persona ? ` · ${b.persona}` : b.marca ? ` · ${b.marca}` : ''}</small>
                  </div>
                ))}
                {reuniones.filter((r) => r.starts_at.startsWith(d)).map((r) => (
                  <div class="bloque-reunion" key={r.id} style={pos(Math.max(minutos(r.starts_at), desde), Math.min(minutos(r.ends_at), hasta))}>
                    <span>{r.title}</span><small>{hora(r.starts_at)}–{hora(r.ends_at)}{r.source === 'google' ? ' · Google' : ''}</small>
                  </div>
                ))}
                {puntuales.map((p) => {
                  const m = Math.min(Math.max(minutos(p.at), desde), hasta - 20);
                  return <a class="marca-aire" key={p.id} href={`/encargos?tarea=${p.task_id}`} style={{ top: `${((m - desde) / (hasta - desde)) * 100}%` }}
                    title={`${hora(p.at)} · ${p.piece || p.title} · ${p.channel} · ${p.estado}`}>{hora(p.at)} · {p.piece || p.title} · {p.channel}</a>;
                })}
                {d === hoy && <LineaAhora desde={desde} hasta={hasta} />}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

const LineaAhora = ({ desde, hasta }: { desde: number; hasta: number }) => {
  const m = minutos(utcASantiago(new Date().toISOString()));
  if (m < desde || m > hasta) return null;
  return <div class="linea-ahora" style={{ top: `${((m - desde) / (hasta - desde)) * 100}%` }} aria-hidden="true" />;
};

export const Leyenda = ({ semana }: { semana: boolean }) => (
  <p class="leyenda"><i class="l-trabajo" /> Trabajo <i class="l-reunion" /> Reunión <i class="l-aire" /> Sale al aire <i class="l-colacion" /> Colación
    {semana && <span class="solo-telefono">· Desliza para ver los otros días</span>}</p>
);
