// Mesa estratégica (§4.17) y vista pública de mandantes (§4.18).
import { useEffect, useState } from 'preact/hooks';
import { pedir, type Persona } from '../api';
import { Dialogo } from '../componentes/Dialogo';
import { fechaCorta, marcas as cargarMarcas, type Marca } from '../datos';
import { logoColor } from '../marca';

type Fila = Record<string, any>;
const valor = (e: Event) => (e.target as HTMLInputElement).value;
const dias = (a: string, b: string) => (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000;

const LineaDeTiempo = ({ inicio, fin, iniciativas }: { inicio: string; fin: string; iniciativas: Fila[] }) => {
  const total = dias(inicio, fin) + 1;
  return (
    <div class="linea-tiempo">
      {iniciativas.map((i, k) => {
        const izq = Math.max(0, dias(inicio, i.start_date) / total) * 100;
        const ancho = Math.max(1, dias(i.start_date, i.end_date) + 1) / total * 100;
        return (
          <div class="lt-fila" key={k}>
            <span class="lt-nombre">{i.name} <span class="apagado">· {i.status}</span></span>
            <div class="lt-pista"><span class="lt-barra" style={{ left: `${izq}%`, width: `${Math.min(100 - izq, ancho)}%` }} title={`${fechaCorta(i.start_date)} → ${fechaCorta(i.end_date)}`} /></div>
            {i.evidence && <a href={i.evidence} target="_blank" rel="noopener noreferrer">Ver resultado aprobado</a>}
          </div>
        );
      })}
    </div>
  );
};

const Metricas = ({ metricas }: { metricas: Fila[] }) => (
  <div class="tarjetas-equipo">
    {metricas.map((m, i) => (
      <div class="tarjeta" key={i}>
        <p class="ceja">{m.kind}</p><strong style={{ fontSize: '18px' }}>{m.name}</strong>
        <p style={{ fontSize: '26px', fontWeight: 800, margin: '6px 0' }}>{m.current || '—'}{m.unit ? ` ${m.unit}` : ''}</p>
        <p class="apagado">Meta {m.target || '—'} · base {m.baseline || '—'} · {m.direction === 'Subir' ? '↑ subir' : '↓ bajar'}{m.as_of ? ` · al ${fechaCorta(m.as_of)}` : ''}</p>
      </div>
    ))}
  </div>
);

export const Estrategia = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const [planes, setPlanes] = useState<Fila[] | null>(null);
  const [elegido, setElegido] = useState('');
  const [dialogo, setDialogo] = useState<'plan' | 'editar' | 'metrica' | 'iniciativa' | { reporte: Fila } | null>(null);
  const admin = persona.permisos.esAdmin;
  const cargar = () => pedir<{ planes: Fila[] }>('/planes').then((r) => { setPlanes(r.planes); setElegido((e) => e || r.planes[0]?.id || ''); }).catch((e: Error) => aviso(e.message));
  useEffect(() => { cargar(); }, []);
  const p = planes?.find((x) => x.id === elegido);
  const hacer = async (ruta: string, json: unknown, mensaje: string) => {
    try { await pedir(ruta, { method: 'POST', json }); aviso(mensaje); setDialogo(null); cargar(); } catch (e) { aviso((e as Error).message); }
  };
  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div><p class="ceja">Mesas</p><h1 id="titulo-vista">La mesa estratégica</h1><p>Planes trimestrales por marca: objetivos, indicadores, iniciativas y lo que ve el mandante.</p></div>
        {admin && <button type="button" class="primario" onClick={() => setDialogo('plan')}>＋ Abrir plan trimestral</button>}
      </div>
      {!planes ? <p>Cargando…</p> : !planes.length ? <div class="pronto"><strong>Aún no hay planes estratégicos.</strong></div> : (
        <>
          <select class="buscador" aria-label="Plan" value={elegido} onChange={(e) => setElegido(valor(e))}>{planes.map((x) => <option key={x.id} value={x.id}>{x.marca} · {x.name}</option>)}</select>
          {p && (
            <>
              <article class="tarjeta" style={{ marginTop: '14px' }}>
                <p class="ceja" style={{ color: p.color }}>{p.marca}</p>
                <h2 style={{ fontSize: '22px' }}>{p.name}</h2>
                <p style={{ marginTop: '6px' }}>{p.objective}</p>
                <p class="apagado">{fechaCorta(p.start_date)} → {fechaCorta(p.end_date)} · {p.publicadoEl ? `Vista de mandantes publicada el ${fechaCorta(p.publicadoEl.slice(0, 10))}` : 'Aún no publicada'}</p>
                <div class="metricas">
                  {[['Trabajo estimado', `${p.avance?.horas ?? 0} h`], ['Entregables aprobados', `${p.avance?.hechas ?? 0}/${p.avance?.total ?? 0}`], ['Vigencia', 'Trimestral']]
                    .map(([k, v]) => <div class="tarjeta metrica" key={k}><div><strong>{v}</strong><span>{k}</span></div></div>)}
                </div>
                {admin && (
                  <div class="persona-acciones" style={{ marginTop: '12px' }}>
                    <button type="button" onClick={() => setDialogo('editar')}>Editar plan</button>
                    <button type="button" onClick={() => setDialogo('metrica')}>＋ KPI o resultado clave</button>
                    <button type="button" onClick={() => setDialogo('iniciativa')}>＋ Iniciativa y vigencia</button>
                    <button type="button" class="primario" onClick={() => confirm('¿Publicar esta versión para los mandantes? Reemplaza la anterior.') && hacer(`/planes/${p.id}/publicar`, {}, 'Vista de mandantes publicada.')}>Aprobar vista de mandantes</button>
                  </div>
                )}
              </article>
              <h2 style={{ margin: '20px 0 10px' }}>Objetivos e indicadores</h2>
              {p.metricas.length ? <Metricas metricas={p.metricas} /> : <p class="apagado">Sin indicadores todavía.</p>}
              <h2 style={{ margin: '20px 0 10px' }}>Vigencias para el mandante</h2>
              {p.iniciativas.length ? <LineaDeTiempo inicio={p.start_date} fin={p.end_date} iniciativas={p.iniciativas} /> : <p class="apagado">Sin iniciativas todavía.</p>}
              <h2 style={{ margin: '20px 0 10px' }}>Seguimiento al cerrar sprints</h2>
              {!p.reportes.length ? <p class="apagado">Los reportes se arman solos al cerrar sprints con trabajo de este plan.</p> : (
                <ul class="lista-invitaciones">
                  {p.reportes.map((r: Fila) => (
                    <li key={r.id}><span><strong>{r.name}</strong><br /><span class="apagado">{r.summary}</span></span>
                      <span class="persona-acciones"><span class={`insignia ${r.approved ? 'verde' : 'ambar'}`}>{r.approved ? 'Aprobado' : 'Borrador'}</span>
                        {admin && <button type="button" onClick={() => setDialogo({ reporte: r })}>Revisar</button>}</span></li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
      {(dialogo === 'plan' || dialogo === 'editar') && <FormPlan plan={dialogo === 'editar' ? p : null} alCerrar={() => setDialogo(null)} alGuardar={(m) => { aviso(m); setDialogo(null); cargar(); }} />}
      {dialogo === 'metrica' && p && <FormMetrica alCerrar={() => setDialogo(null)} alGuardar={(j) => hacer(`/planes/${p.id}/metricas`, j, 'Indicador guardado.')} />}
      {dialogo === 'iniciativa' && p && <FormIniciativa plan={p} alCerrar={() => setDialogo(null)} alGuardar={(j) => hacer(`/planes/${p.id}/iniciativas`, j, 'Iniciativa guardada.')} />}
      {dialogo && typeof dialogo === 'object' && p && <FormReporte r={dialogo.reporte} alCerrar={() => setDialogo(null)} alGuardar={(j) => hacer(`/planes/${p.id}/reportes/${dialogo.reporte.id}`, j, 'Reporte guardado.')} />}
    </section>
  );
};

const FormPlan = ({ plan, alCerrar, alGuardar }: { plan: Fila | null | undefined; alCerrar: () => void; alGuardar: (m: string) => void }) => {
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [d, setD] = useState({ nombre: plan?.name ?? '', marcaId: plan?.brand_id ?? '', inicio: plan?.start_date ?? '', objetivo: plan?.objective ?? '', publico: plan?.audience ?? '', diagnostico: plan?.diagnosis ?? '', notas: plan?.notes ?? '' });
  const [error, setError] = useState('');
  useEffect(() => { cargarMarcas().then(setMarcas); }, []);
  const k = (x: keyof typeof d) => (e: Event) => setD({ ...d, [x]: valor(e) });
  return (
    <Dialogo titulo={plan ? 'Editar plan' : 'Plan trimestral'} abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={async (e) => {
        e.preventDefault();
        try { await pedir(plan ? `/planes/${plan.id}` : '/planes', { method: plan ? 'PATCH' : 'POST', json: d }); alGuardar('Plan guardado.'); } catch (err) { setError((err as Error).message); }
      }}>
        <label>Nombre<input required minLength={3} value={d.nombre} onInput={k('nombre')} /></label>
        <div class="dos"><label>Marca<select required value={d.marcaId} onChange={k('marcaId')}><option value="">Elige</option>{marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label>Inicio del trimestre<input type="date" required value={d.inicio} onInput={k('inicio')} /><span class="ayuda">Termina sola tres meses después.</span></label></div>
        <label>Objetivo<textarea rows={2} value={d.objetivo} onInput={k('objetivo')} /></label>
        <label>Público<input value={d.publico} onInput={k('publico')} /></label>
        <label>Diagnóstico<textarea rows={3} value={d.diagnostico} onInput={k('diagnostico')} /></label>
        {error && <p class="error-form" role="alert">{error}</p>}
        <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" class="primario">Guardar</button></div>
      </form>
    </Dialogo>
  );
};

const FormMetrica = ({ alCerrar, alGuardar }: { alCerrar: () => void; alGuardar: (j: unknown) => void }) => {
  const [d, setD] = useState({ tipo: 'KPI', nombre: '', objetivo: '', base: '', meta: '', actual: '', unidad: '', fuente: '', fecha: '', direccion: 'Subir' });
  const k = (x: keyof typeof d) => (e: Event) => setD({ ...d, [x]: valor(e) });
  return (
    <Dialogo titulo="KPI o resultado clave" abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={(e) => { e.preventDefault(); alGuardar({ ...d, fecha: d.fecha || null }); }}>
        <div class="dos"><label>Tipo<select value={d.tipo} onChange={k('tipo')}><option>KPI</option><option>Resultado clave OKR</option></select></label>
          <label>Dirección<select value={d.direccion} onChange={k('direccion')}><option>Subir</option><option>Bajar</option></select></label></div>
        <label>Nombre<input required minLength={2} value={d.nombre} onInput={k('nombre')} /></label>
        <div class="dos"><label>Base<input value={d.base} onInput={k('base')} /></label><label>Meta<input value={d.meta} onInput={k('meta')} /></label></div>
        <div class="dos"><label>Valor actual<input value={d.actual} onInput={k('actual')} /></label><label>Unidad<input value={d.unidad} onInput={k('unidad')} /></label></div>
        <div class="dos"><label>Fuente<input value={d.fuente} required={!!d.actual} onInput={k('fuente')} /></label><label>Al<input type="date" value={d.fecha} onInput={k('fecha')} /></label></div>
        <p class="ayuda">Las metas no se calculan desde las tareas: se registran con su fuente.</p>
        <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" class="primario">Guardar</button></div>
      </form>
    </Dialogo>
  );
};

const FormIniciativa = ({ plan, alCerrar, alGuardar }: { plan: Fila; alCerrar: () => void; alGuardar: (j: unknown) => void }) => {
  const [d, setD] = useState({ nombre: '', tipo: 'Campaña 360', inicio: plan.start_date, fin: plan.end_date, estado: 'Planificada', evidencia: '' });
  const k = (x: keyof typeof d) => (e: Event) => setD({ ...d, [x]: valor(e) });
  return (
    <Dialogo titulo="Iniciativa y vigencia" abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={(e) => { e.preventDefault(); alGuardar(d); }}>
        <label>Nombre<input required minLength={2} value={d.nombre} onInput={k('nombre')} /></label>
        <div class="dos"><label>Tipo<select value={d.tipo} onChange={k('tipo')}>{['Campaña 360', 'Webinar', 'Contenido continuo', 'Sitio web', 'Plataforma', 'Presentación', 'Otra iniciativa'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Estado<select value={d.estado} onChange={k('estado')}>{['Planificada', 'En preparación', 'Activa', 'Finalizada', 'Pausada'].map((x) => <option key={x}>{x}</option>)}</select></label></div>
        <div class="dos"><label>Desde<input type="date" required min={plan.start_date} max={plan.end_date} value={d.inicio} onInput={k('inicio')} /></label>
          <label>Hasta<input type="date" required min={d.inicio} max={plan.end_date} value={d.fin} onInput={k('fin')} /></label></div>
        <label>Evidencia (enlace)<input type="url" value={d.evidencia} placeholder="https://" onInput={k('evidencia')} /></label>
        <div class="acciones"><button type="button" onClick={alCerrar}>Cancelar</button><button type="submit" class="primario">Guardar</button></div>
      </form>
    </Dialogo>
  );
};

const FormReporte = ({ r, alCerrar, alGuardar }: { r: Fila; alCerrar: () => void; alGuardar: (j: unknown) => void }) => {
  const [resumen, setResumen] = useState(r.summary);
  const [siguiente, setSiguiente] = useState(r.next);
  return (
    <Dialogo titulo={`Reporte: ${r.name}`} abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={(e) => { e.preventDefault(); alGuardar({ resumen, siguiente, aprobar: (e as SubmitEvent).submitter?.getAttribute('value') === 'aprobar' }); }}>
        <p class="apagado">{r.done} de {r.total} entregables aprobados{r.exception ? ` · Excepción: ${r.exception}` : ''}</p>
        <label>Resumen para el mandante<textarea required rows={3} value={resumen} onInput={(e) => setResumen(valor(e))} /></label>
        <label>Siguientes pasos<textarea rows={2} value={siguiente} onInput={(e) => setSiguiente(valor(e))} /></label>
        <div class="acciones"><button type="submit" value="guardar">Guardar borrador</button><button type="submit" value="aprobar" class="primario">Aprobar reporte</button></div>
      </form>
    </Dialogo>
  );
};

/** mesawow.cl: "La mesa de avances". Solo instantáneas publicadas; sin sesión. */
export const MesaPublica = () => {
  const [planes, setPlanes] = useState<Fila[] | null>(null);
  const [filtro, setFiltro] = useState('');
  useEffect(() => { fetch('/api/v1/publico/mesa').then((r) => r.json()).then((r) => setPlanes(r.planes ?? [])).catch(() => setPlanes([])); }, []);
  const entrar = location.hostname.endsWith('mesawow.cl') ? 'https://app.mesawow.cl' : '/';
  const visibles = (planes ?? []).filter((p) => !filtro || p.nombre === filtro);
  return (
    <div class="publica">
      <header class="publica-cabeza"><img src={logoColor} alt="mesawow" width={160} height={44} /><a class="casilla primario" href={entrar}>Entrar a mi mesa</a></header>
      <main class="contenido">
        <p class="ceja">Para mandantes</p><h1>La mesa de avances</h1>
        <p class="apagado" style={{ marginTop: '6px' }}>Objetivos, indicadores e iniciativas aprobados por el equipo.</p>
        {!planes ? <p>Cargando…</p> : !planes.length ? <p class="apagado" style={{ marginTop: '16px' }}>Aún no hay avances publicados.</p> : (
          <>
            {planes.length > 1 && <select class="buscador" style={{ marginTop: '16px' }} aria-label="Plan" value={filtro} onChange={(e) => setFiltro(valor(e))}><option value="">Todos los planes</option>{planes.map((p) => <option key={p.nombre}>{p.nombre}</option>)}</select>}
            {visibles.map((p) => (
              <section class="tarjeta" style={{ marginTop: '18px', borderTop: `6px solid ${p.color}` }} key={p.nombre}>
                <p class="ceja" style={{ color: p.color }}>{p.marca}</p>
                <h2 style={{ fontSize: '22px' }}>{p.nombre}</h2>
                <p style={{ marginTop: '6px' }}>{p.objetivo}</p>
                <p class="apagado">{fechaCorta(p.inicio)} → {fechaCorta(p.fin)} · Actualizado el {fechaCorta(p.publicadoEl.slice(0, 10))}</p>
                <div style={{ marginTop: '14px' }}><Metricas metricas={p.metricas} /></div>
                <div style={{ marginTop: '14px' }}><LineaDeTiempo inicio={p.inicio} fin={p.fin} iniciativas={p.iniciativas} /></div>
                {p.reportes.map((r: Fila, i: number) => <details key={i} style={{ marginTop: '10px' }}><summary>{r.name} · {r.done} de {r.total}</summary><p>{r.summary}</p>{r.next && <p class="apagado">{r.next}</p>}</details>)}
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
};
