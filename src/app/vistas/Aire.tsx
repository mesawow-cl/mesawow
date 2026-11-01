// Mesa al aire (§4.19).
import { useEffect, useState } from 'preact/hooks';
import { useLatido } from '../vivo';
import { CANALES_AL_AIRE } from '../../shared/constantes';
import { hoySantiago, utcASantiago } from '../../shared/fechas';
import { pedir, type Persona } from '../api';
import { Dialogo } from '../componentes/Dialogo';
import { fechaCorta } from '../datos';
import { FormTarea } from './FormTarea';

type Fila = Record<string, any>;
export const TONO_PIEZA: Record<string, string> = { 'Al aire': 'verde', 'Lista para salir': '', 'En la mesa': 'gris', 'En riesgo': 'ambar', 'Atrasada': 'roja' };
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const MesaAlAire = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const [datos, setDatos] = useState<{ piezas: Fila[]; campanas: Fila[]; stats: Fila } | null>(null);
  const [canal, setCanal] = useState('');
  const [rango, setRango] = useState<'proximas' | 'pasadas'>('proximas');
  const [elegir, setElegir] = useState(new URLSearchParams(location.search).get('programar') === '1');
  const [form, setForm] = useState<{ tareaId?: string } | null>(null);
  const coordina = persona.permisos.coordina && !persona.permisos.soloLectura;
  const cargar = () => pedir<typeof datos>(`/aire${canal ? `?canal=${encodeURIComponent(canal)}` : ''}`).then(setDatos).catch((e: Error) => aviso(e.message));
  const latido = useLatido();
  useEffect(() => { cargar(); }, [canal, latido]);

  const ahora = utcASantiago(new Date().toISOString());
  const hoy = hoySantiago();
  const visibles = (datos?.piezas ?? []).filter((p) => (rango === 'proximas' ? p.estado !== 'Al aire' || p.at.slice(0, 10) >= hoy : p.estado === 'Al aire' || p.at < ahora));
  if (rango === 'pasadas') visibles.reverse();
  const porDia = new Map<string, Fila[]>();
  for (const p of visibles) porDia.set(p.at.slice(0, 10), [...(porDia.get(p.at.slice(0, 10)) ?? []), p]);

  const publicar = async (p: Fila) => {
    const url = prompt('Enlace de la publicación (opcional, verifica el lanzamiento de la campaña):', '');
    if (url === null) return;
    try { await pedir(`/aire/${p.id}/publicar`, { method: 'POST', json: { url: url.trim() } }); aviso('¡Salió al aire! 🎉'); cargar(); } catch (e) { aviso((e as Error).message); }
  };

  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div><p class="ceja">Al aire</p><h1 id="titulo-vista">Mesa al aire</h1><p>Lo que sale publicado, por canal y fecha. La fecha de salida manda el trabajo.</p></div>
        <div class="persona-acciones">
          <a class="casilla" href="/calendarios?desde=aire">Ver los dos calendarios</a>
          {coordina && <button type="button" class="primario" onClick={() => setElegir(true)}>＋ Programar una salida</button>}
        </div>
      </div>
      <ol class="flujo-aire">
        <li><strong>1. Sale al aire</strong><span>La fecha que manda</span></li>
        <li><strong>2. Revisión</strong><span>2 días antes</span></li>
        <li><strong>3. Mesa de trabajo</strong><span>Las horas se reservan solas</span></li>
      </ol>
      {!datos ? <p>Cargando…</p> : (
        <>
          <div class="metricas">
            {[['Salen esta semana', datos.stats.estaSemana], ['Listas para salir', datos.stats.listas], ['En riesgo o atrasadas', datos.stats.riesgo], ['Ya salieron al aire', datos.stats.alAire]]
              .map(([k, v]) => <div class="tarjeta metrica" key={k}><div><strong>{v}</strong><span>{k}</span></div></div>)}
          </div>
          {datos.campanas.length > 0 && (
            <section class="tarjeta" style={{ marginTop: '16px' }}>
              <h2 style={{ marginBottom: '10px' }}>Campañas y eventos en el aire</h2>
              <ul class="lista-simple">{datos.campanas.map((c) => (
                <li key={c.id}><span class="chip"><i style={{ background: c.color }} />{c.marca}</span> <strong>{c.name}</strong>
                  <span class="apagado"> · {c.event_date ? `evento el ${fechaCorta(c.event_date)} a las ${c.event_time}` : `${fechaCorta(c.live_start)} → ${fechaCorta(c.live_end)}`}</span></li>
              ))}</ul>
            </section>
          )}
          <div class="barra-agenda" style={{ marginTop: '18px' }}>
            <label class="visualmente-oculto" for="canal">Canal</label>
            <select id="canal" value={canal} onChange={(e) => setCanal((e.target as HTMLSelectElement).value)}><option value="">Todos los canales</option>{CANALES_AL_AIRE.map((c) => <option key={c}>{c}</option>)}</select>
            <div class="segmentado" role="group" aria-label="Rango">
              <button type="button" aria-pressed={rango === 'proximas'} onClick={() => setRango('proximas')}>Próximas</button>
              <button type="button" aria-pressed={rango === 'pasadas'} onClick={() => setRango('pasadas')}>Ya publicadas y pasadas</button>
            </div>
          </div>
          {!visibles.length ? <div class="pronto"><strong>No hay salidas {rango === 'proximas' ? 'próximas' : 'pasadas'}.</strong>{coordina && <p>Programa una con ＋ Programar una salida.</p>}</div> : (
            [...porDia].map(([dia, piezas]) => (
              <section key={dia} class="dia-aire">
                <h3>{DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()]} {fechaCorta(dia)}{dia === hoy ? ' · Hoy' : ''}</h3>
                <ul class="lista-invitaciones">
                  {piezas.map((p) => (
                    <li key={p.id}>
                      <div style={{ minWidth: 0 }}>
                        <span class="hora-aire">{p.end_date ? 'Activo' : p.at.slice(11)}</span> <span class="insignia gris">{p.channel}</span> <span class={`insignia ${TONO_PIEZA[p.estado]}`}>{p.estado}</span><br />
                        <a href={`/encargos?tarea=${p.task_id}`}><strong>{p.piece ? `${p.piece} · ` : ''}{p.title}</strong></a><br />
                        <span class="apagado">{p.marca} · {p.mesa ?? 'Marketing'} · {p.responsable ?? 'Sin responsable'}{p.end_date ? ` · activo hasta el ${fechaCorta(p.end_date)}` : ''} · trabajo hasta el {fechaCorta(p.due)} ({p.estado_tarea})</span>
                        {p.url && <><br /><a href={p.url} target="_blank" rel="noopener noreferrer">Ver publicación</a></>}
                      </div>
                      <div class="persona-acciones">
                        {p.estado !== 'Al aire' && (coordina || p.owner_id === persona.id) && <button type="button" onClick={() => publicar(p)}>Marcar al aire</button>}
                        {coordina && p.estado !== 'Al aire' && <button type="button" onClick={() => setForm({ tareaId: p.task_id })}>Cambiar fecha</button>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
      {elegir && <ElegirTarea alCerrar={() => setElegir(false)} alElegir={(id) => { setElegir(false); setForm({ tareaId: id }); }} />}
      {form && <FormTarea tareaId={form.tareaId} pasoInicial={2} conAire alCerrar={() => setForm(null)}
        alGuardar={(_, avisos) => { setForm(null); aviso(['Salida al aire programada.', ...(avisos ?? [])].join(' ')); cargar(); }} />}
    </section>
  );
};

const ElegirTarea = ({ alCerrar, alElegir }: { alCerrar: () => void; alElegir: (id?: string) => void }) => {
  const [tareas, setTareas] = useState<Fila[] | null>(null);
  const [id, setId] = useState('');
  useEffect(() => { pedir<{ tareas: Fila[] }>('/tareas').then((r) => setTareas(r.tareas.filter((t) => !['Aprobada', 'Completada'].includes(t.status)))); }, []);
  return (
    <Dialogo titulo="Programar una salida al aire" abierto alCerrar={alCerrar}>
      <div class="formulario">
        <p>Elige la tarea cuyo trabajo sale al aire, o crea una nueva.</p>
        <label>Tarea<select value={id} onChange={(e) => setId((e.target as HTMLSelectElement).value)}><option value="">Elige una tarea</option>
          {tareas?.map((t) => <option key={t.id} value={t.id}>{t.marca} · {t.title}</option>)}</select></label>
        <div class="acciones">
          <button type="button" onClick={() => alElegir(undefined)}>Crear tarea nueva</button>
          <button type="button" class="primario" disabled={!id} onClick={() => alElegir(id)}>Programar esta tarea</button>
        </div>
      </div>
    </Dialogo>
  );
};

/** Recuadro "Sale al aire" del detalle de la tarea. */
export const SaleAlAire = ({ tareaId }: { tareaId: string }) => {
  const [piezas, setPiezas] = useState<Fila[] | null>(null);
  useEffect(() => { pedir<{ piezas: Fila[] }>(`/tareas/${tareaId}/aire`).then((r) => setPiezas(r.piezas)).catch(() => setPiezas([])); }, [tareaId]);
  if (!piezas?.length) return null;
  return (
    <section class="bloque caja-aire">
      <h4>Sale al aire</h4>
      <ul class="lista-simple">
        {piezas.slice(0, 8).map((p) => <li key={p.id}>{p.channel} · {fechaCorta(p.at.slice(0, 10))} {p.at.slice(11)}{p.piece ? ` · ${p.piece}` : ''} <span class={`insignia ${TONO_PIEZA[p.estado]}`}>{p.estado}</span></li>)}
      </ul>
      {piezas.length > 8 && <p class="apagado">y {piezas.length - 8} más.</p>}
      <a class="casilla" href="/al-aire">Ver en Mesa al aire</a>
    </section>
  );
};
