// Resumen (§4.9), Tiempo de trabajo / Gantt (§4.10) y Mesa de trabajo / mapa metro (§4.12).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { tareaHecha } from '../../shared/constantes';
import { hoySantiago } from '../../shared/fechas';
import { pedir, type Persona } from '../api';
import { fechaCorta, marcas as cargarMarcas, mesas as cargarMesas, TONO_ESTADO, type Marca, type Mesa } from '../datos';
import { hrefDe } from '../rutas';

type Tarea = {
  id: string; title: string; status: string; due: string; start_date: string; blocked: number; brand_id: string; marca: string; color: string;
  responsable: string | null; mesa_id: string | null; atrasada: boolean; dependencias: string[]; campaign_id: string | null;
};
const usarTareas = (sprint?: string | null) => {
  const [t, setT] = useState<Tarea[] | null>(null);
  useEffect(() => { pedir<{ tareas: Tarea[] }>(`/tareas${sprint ? `?sprint=${sprint}` : ''}`).then((r) => setT(r.tareas)).catch(() => setT([])); }, [sprint]);
  return t;
};
const mesActual = () => hoySantiago().slice(0, 7);
const diasDelMes = (mes: string) => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();

// ─────────────────────────────── Resumen

export const Resumen = ({ persona }: { persona: Persona }) => {
  const tareas = usarTareas();
  const [campanas, setCampanas] = useState<Record<string, any>[]>([]);
  const [marcas, setMarcas] = useState<Record<string, any>[]>([]);
  useEffect(() => {
    pedir<{ campanas: any[] }>('/campanas').then((r) => setCampanas(r.campanas));
    pedir<{ marcas: any[] }>('/marcas/detalle').then((r) => setMarcas(r.marcas));
  }, []);
  if (!tareas) return <p>Cargando…</p>;
  const hechas = tareas.filter((t) => tareaHecha(t.status)).length;
  const atencion = tareas.filter((t) => t.atrasada || (t.blocked && !tareaHecha(t.status))).length;
  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div><p class="ceja">Mi trabajo</p><h1 id="titulo-vista">Cada entrega, a la vista.</h1></div>
        <div class="persona-acciones"><a class="casilla" href={hrefDe('reports')}>Ver informe</a>{persona.permisos.coordina && <a class="casilla" href="/encargos">＋ Nueva tarea</a>}</div>
      </div>
      <div class="metricas">
        {[['Marcas en este espacio', persona.marcas.length], ['Campañas', campanas.length], ['Tareas completadas', `${hechas}/${tareas.length}`], ['Requieren atención', atencion]]
          .map(([k, v]) => <div class="tarjeta metrica" key={k}><div><strong>{v}</strong><span>{k}</span></div></div>)}
      </div>
      <div class="inicio-grilla">
        <section class="tarjeta">
          <h2 style={{ marginBottom: '10px' }}>Lo que necesita avanzar</h2>
          <ul class="lista-invitaciones">
            {tareas.filter((t) => !tareaHecha(t.status)).slice(0, 5).map((t) => (
              <li key={t.id}><span><a href={`/encargos?tarea=${t.id}`}>{t.title}</a><br /><span class="apagado">{t.marca} · vence {fechaCorta(t.due)}</span></span>
                <span class={`insignia ${t.atrasada ? 'roja' : TONO_ESTADO[t.status] ?? ''}`}>{t.atrasada ? 'Atrasada' : t.status}</span></li>
            ))}
          </ul>
        </section>
        <section class="tarjeta">
          <h2 style={{ marginBottom: '10px' }}>Campañas en preparación</h2>
          <ul class="lista-simple">
            {campanas.filter((c) => ['Borrador', 'En revisión', 'Ajustes solicitados'].includes(c.status)).slice(0, 6).map((c) => (
              <li key={c.id}><a href={hrefDe('campaigns')}>{c.name}</a> <span class="apagado">· {c.marca} · {c.status}</span></li>
            ))}
          </ul>
          <h2 style={{ margin: '16px 0 10px' }}>Marcas</h2>
          <ul class="lista-simple">
            {marcas.slice(0, 3).map((m) => <li key={m.id}><span class="chip"><i style={{ background: m.color }} />{m.name}</span> {m.vigentes} de 21 mínimos vigentes</li>)}
          </ul>
        </section>
      </div>
    </section>
  );
};

// ─────────────────────────────── Tiempo de trabajo (Gantt)

export const Gantt = () => {
  const sprint = new URLSearchParams(location.search).get('sprint');
  const tareas = usarTareas(sprint);
  const [mes, setMes] = useState(() => new URLSearchParams(location.search).get('mes') ?? mesActual());
  const n = diasDelMes(mes);
  const desde = `${mes}-01`, hasta = `${mes}-${String(n).padStart(2, '0')}`;
  const visibles = (tareas ?? []).filter((t) => t.start_date <= hasta && t.due >= desde).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const dia = (f: string) => (f < desde ? 1 : f > hasta ? n : +f.slice(8, 10));
  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div><p class="ceja">Mi trabajo</p><h1 id="titulo-vista">Tiempo de trabajo</h1><p>Cada tarea, de su inicio a su fecha límite.</p></div>
        <label>Mes<input type="month" value={mes} onInput={(e) => setMes((e.target as HTMLInputElement).value || mesActual())} /></label>
      </div>
      {!tareas ? <p>Cargando…</p> : !visibles.length ? <p class="apagado">No hay tareas en este mes.</p> : (
        <>
          <div class="gantt" style={{ '--dias': n } as never} role="table" aria-label="Gantt del mes">
            <div class="gantt-fila cabeza" role="row"><span role="columnheader">Tarea</span>
              <div class="gantt-dias">{Array.from({ length: n }, (_, i) => <span key={i}>{i + 1}</span>)}</div></div>
            {visibles.map((t) => (
              <div class="gantt-fila" role="row" key={t.id}>
                <a role="cell" href={`/encargos?tarea=${t.id}`}>{t.title}</a>
                <div class="gantt-pista" role="cell">
                  <span class={`gantt-barra${tareaHecha(t.status) ? ' hecha' : t.blocked ? ' bloqueada' : ''}`} style={{ gridColumn: `${dia(t.start_date)} / ${dia(t.due) + 1}`, background: tareaHecha(t.status) || t.blocked ? undefined : t.color }}>
                    {(t.responsable ?? '').split(' ')[0]} · {t.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <ul class="lista-invitaciones gantt-movil">
            {visibles.map((t) => <li key={t.id}><span><a href={`/encargos?tarea=${t.id}`}>{t.title}</a><br /><span class="apagado">{fechaCorta(t.start_date)} → {fechaCorta(t.due)} · {t.responsable ?? ''}</span></span><span class={`insignia ${TONO_ESTADO[t.status] ?? ''}`}>{t.status}</span></li>)}
          </ul>
        </>
      )}
    </section>
  );
};

// ─────────────────────────────── Mesa de trabajo (mapa metro)

const SIMBOLO: [string, (t: Tarea) => boolean, string][] = [
  ['✓', (t) => tareaHecha(t.status), 'Terminada'], ['!', (t) => !!t.blocked, 'Bloqueada'], ['↗', (t) => t.status === 'Entregada para revisión', 'En revisión'],
  ['◐', (t) => t.status === 'En curso' || t.status === 'Ajustes solicitados', 'En curso'], ['○', () => true, 'Pendiente'],
];
const simbolo = (t: Tarea) => SIMBOLO.find(([, f]) => f(t))!;
const CLAVE_MARCAS = 'mesawow:metro-marcas';

export const MesaDeTrabajo = () => {
  const sprint = new URLSearchParams(location.search).get('sprint');
  const tareas = usarTareas(sprint);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [mes, setMes] = useState(() => new URLSearchParams(location.search).get('mes') ?? mesActual());
  const [mesa, setMesa] = useState(new URLSearchParams(location.search).get('mesa') ?? '');
  const [modo, setModo] = useState('Todas');
  const [verDeps, setVerDeps] = useState(true);
  const [ocultas, setOcultas] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(CLAVE_MARCAS) ?? '[]'); } catch { return []; } });
  const [elegida, setElegida] = useState<string | null>(null);
  useEffect(() => { cargarMarcas().then(setMarcas); cargarMesas().then(setMesas); }, []);
  useEffect(() => { try { localStorage.setItem(CLAVE_MARCAS, JSON.stringify(ocultas)); } catch { /* sin almacenamiento */ } }, [ocultas]);

  const n = diasDelMes(mes);
  const desde = `${mes}-01`, hasta = `${mes}-${String(n).padStart(2, '0')}`;
  const filtradas = useMemo(() => (tareas ?? []).filter((t) => t.due >= desde && t.due <= hasta && !ocultas.includes(t.brand_id) && (!mesa || t.mesa_id === mesa)
    && (modo === 'Todas' || (modo === 'Bloqueadas' && t.blocked) || (modo === 'En revisión' && t.status === 'Entregada para revisión') || (modo === 'Terminadas' && tareaHecha(t.status)))), [tareas, mes, mesa, modo, ocultas]);

  // Cadena relacionada: todo lo anterior (recursivo) y lo inmediatamente posterior.
  const relacionadas = useMemo(() => {
    if (!elegida || !tareas) return null;
    const porId = new Map(tareas.map((t) => [t.id, t]));
    const set = new Set([elegida]);
    const pila = [elegida];
    while (pila.length) for (const d of porId.get(pila.pop()!)?.dependencias ?? []) if (!set.has(d)) { set.add(d); pila.push(d); }
    for (const t of tareas) if (t.dependencias.includes(elegida)) set.add(t.id);
    return set;
  }, [elegida, tareas]);

  const IZQ = 200, ANCHO_DIA = 40, ancho = IZQ + n * ANCHO_DIA + 40;
  const filas = marcas.filter((m) => !ocultas.includes(m.id)).map((m) => {
    const propias = filtradas.filter((t) => t.brand_id === m.id).sort((a, b) => a.due.localeCompare(b.due));
    const carriles: number[] = [];
    const puestos = propias.map((t) => {
      const x = IZQ + (+t.due.slice(8, 10) - 0.5) * ANCHO_DIA;
      let c = carriles.findIndex((ultimo) => x - ultimo >= 120);
      if (c < 0) { c = carriles.length; carriles.push(x); } else carriles[c] = x;
      return { t, x, c };
    });
    return { m, puestos, alto: 70 + Math.max(1, carriles.length) * 54 };
  });
  let y = 30;
  const pos = new Map<string, { x: number; y: number }>();
  const filasPos = filas.map((f) => { const y0 = y; y += f.alto; f.puestos.forEach((p) => pos.set(p.t.id, { x: p.x, y: y0 + 46 + p.c * 54 })); return { ...f, y0 }; });
  const hoy = hoySantiago();
  const xHoy = hoy >= desde && hoy <= hasta ? IZQ + (+hoy.slice(8, 10) - 0.5) * ANCHO_DIA : null;
  const sel = elegida ? tareas?.find((t) => t.id === elegida) : null;

  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado"><div><p class="ceja">Mesas</p><h1 id="titulo-vista">El trabajo tiene un recorrido.</h1><p>Cada marca es una línea; cada tarea, una estación en su fecha límite.</p></div></div>
      <div class="filtros">
        <label>Mes<input type="month" value={mes} onInput={(e) => setMes((e.target as HTMLInputElement).value || mesActual())} /></label>
        <label>Mesa<select value={mesa} onChange={(e) => setMesa((e.target as HTMLSelectElement).value)}><option value="">Todas</option>{mesas.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>Mostrar<select value={modo} onChange={(e) => setModo((e.target as HTMLSelectElement).value)}>{['Todas', 'Bloqueadas', 'En revisión', 'Terminadas'].map((x) => <option key={x}>{x}</option>)}</select></label>
      </div>
      <div class="chips" style={{ marginBottom: '12px' }}>
        <label class="casilla"><input type="checkbox" checked={verDeps} onChange={(e) => setVerDeps((e.target as HTMLInputElement).checked)} /> Dependencias</label>
        <button type="button" class="chip-filtro" onClick={() => setOcultas([])}>Todas</button>
        <button type="button" class="chip-filtro" onClick={() => setOcultas(marcas.map((m) => m.id))}>Ninguna</button>
        {marcas.map((m) => (
          <button type="button" key={m.id} class="chip-filtro" aria-pressed={!ocultas.includes(m.id)} onClick={() => setOcultas(ocultas.includes(m.id) ? ocultas.filter((x) => x !== m.id) : [...ocultas, m.id])}>
            <i class="punto" style={{ background: m.color }} /> {m.name}
          </button>
        ))}
      </div>
      {!tareas ? <p>Cargando…</p> : (
        <>
          <div class="metro" role="img" aria-label={`Mapa de ${filtradas.length} tareas del mes`}>
            <svg width={ancho} height={y + 20} viewBox={`0 0 ${ancho} ${y + 20}`}>
              {Array.from({ length: n }, (_, i) => <text key={i} x={IZQ + (i + 0.5) * ANCHO_DIA} y={18} class="metro-dia">{i + 1}</text>)}
              {xHoy && <><line x1={xHoy} x2={xHoy} y1={24} y2={y} class="metro-hoy" /><text x={xHoy + 4} y={36} class="metro-hoy-t">HOY</text></>}
              {filasPos.map((f) => (
                <g key={f.m.id}>
                  <text x={12} y={f.y0 + 50} class="metro-marca">{f.m.name}</text>
                  <line x1={IZQ} x2={ancho - 20} y1={f.y0 + 46} y2={f.y0 + 46} stroke={f.m.color} stroke-width={6} stroke-linecap="round" opacity={0.35} />
                </g>
              ))}
              {verDeps && filtradas.flatMap((t) => t.dependencias.filter((d) => pos.has(d)).map((d) => {
                const a = pos.get(d)!, b = pos.get(t.id)!;
                const tenue = relacionadas && !(relacionadas.has(d) && relacionadas.has(t.id));
                return <path key={`${d}-${t.id}`} d={`M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`} class="metro-dep" opacity={tenue ? 0.15 : 1} />;
              }))}
              {filasPos.flatMap((f) => f.puestos.map(({ t }) => {
                const p = pos.get(t.id)!;
                const [s] = simbolo(t);
                const tenue = relacionadas && !relacionadas.has(t.id);
                return (
                  <g key={t.id} class="metro-estacion" opacity={tenue ? 0.3 : 1} tabIndex={0} role="button" aria-label={`${t.title}, ${simbolo(t)[2]}, vence ${fechaCorta(t.due)}`}
                    onClick={() => setElegida(elegida === t.id ? null : t.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setElegida(elegida === t.id ? null : t.id); } }}>
                    <circle cx={p.x} cy={p.y} r={13} fill="#fff" stroke={f.m.color} stroke-width={elegida === t.id ? 6 : 4} />
                    <text x={p.x} y={p.y + 4} class="metro-simbolo">{s}</text>
                    <text x={p.x} y={p.y + 30} class="metro-titulo">{t.title.length > 18 ? `${t.title.slice(0, 17)}…` : t.title}</text>
                  </g>
                );
              }))}
            </svg>
          </div>
          <p class="leyenda">○ Pendiente · ◐ En curso · ↗ En revisión · ! Bloqueada · ✓ Terminada</p>
          <ul class="lista-invitaciones metro-movil">
            {filtradas.map((t) => <li key={t.id}><span><span class="chip"><i style={{ background: t.color }} />{t.marca}</span> <a href={`/encargos?tarea=${t.id}`}>{t.title}</a><br /><span class="apagado">{simbolo(t)[0]} {simbolo(t)[2]} · vence {fechaCorta(t.due)}</span></span></li>)}
          </ul>
          {sel && (
            <div class="tarjeta metro-seleccion" role="status">
              <strong>{sel.title}</strong><span class="apagado">{sel.marca} · {sel.responsable ?? 'Sin responsable'} · {simbolo(sel)[2]} · vence {fechaCorta(sel.due)}</span>
              <div class="persona-acciones"><a class="casilla" href={`/encargos?tarea=${sel.id}`}>Abrir tarea</a><button type="button" onClick={() => setElegida(null)}>Ver toda la red</button></div>
            </div>
          )}
        </>
      )}
    </section>
  );
};
