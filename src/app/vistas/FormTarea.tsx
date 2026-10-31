// Formulario de tarea por pasos (taskForm final del prototipo · línea 1163).
// Paso 3 "Salida al aire" se completa en la Fase 4.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { hoySantiago } from '../../shared/fechas';
import { pedir } from '../api';
import { Asistente } from '../componentes/Asistente';
import { Dialogo } from '../componentes/Dialogo';
import { marcas as cargarMarcas, mesas as cargarMesas, personas as cargarPersonas, type Marca, type Mesa, type PersonaDirectorio } from '../datos';

interface Datos {
  titulo: string; marcaId: string; campanaId: string; mesaId: string; descripcion: string; entregable: string; criterio: string;
  responsableId: string; revisorId: string; colaboradores: string[]; aprobadores: string[];
  inicio: string; plazo: string; horas: string; complejidad: string; prioridad: string; dependencias: string[]; version?: number;
}

const vacio = (): Datos => {
  const hoy = hoySantiago();
  return {
    titulo: '', marcaId: '', campanaId: '', mesaId: '', descripcion: '', entregable: '', criterio: '', responsableId: '', revisorId: '',
    colaboradores: [], aprobadores: [], inicio: hoy, plazo: hoy, horas: '', complejidad: 'Baja', prioridad: 'Media', dependencias: [],
  };
};

const valor = (e: Event) => (e.target as HTMLInputElement).value;

const Elegibles = ({ opciones, elegidas, alCambiar, etiqueta }: {
  opciones: { id: string; texto: string }[]; elegidas: string[]; alCambiar: (ids: string[]) => void; etiqueta: string;
}) => (
  <fieldset>
    <legend>{etiqueta}</legend>
    {!opciones.length ? <span class="ayuda">No hay opciones para esta marca.</span> : (
      <div class="lista-elegible">
        {opciones.map((o) => (
          <label key={o.id}>
            <input type="checkbox" checked={elegidas.includes(o.id)}
              onChange={(e) => alCambiar((e.target as HTMLInputElement).checked ? [...elegidas, o.id] : elegidas.filter((x) => x !== o.id))} />
            {o.texto}
          </label>
        ))}
      </div>
    )}
  </fieldset>
);

export const FormTarea = ({ tareaId, alCerrar, alGuardar }: { tareaId?: string; alCerrar: () => void; alGuardar: (id: string) => void }) => {
  const [d, setD] = useState<Datos>(vacio);
  const [listo, setListo] = useState(!tareaId);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [campanas, setCampanas] = useState<{ id: string; name: string; brand_id: string }[]>([]);
  const [tareasMarca, setTareasMarca] = useState<{ id: string; title: string; status: string }[]>([]);
  const [masEquipo, setMasEquipo] = useState(false);
  const [masPlazos, setMasPlazos] = useState(false);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const cambiar = (c: Partial<Datos>) => setD((x) => ({ ...x, ...c }));

  useEffect(() => {
    cargarMarcas().then((m) => { setMarcas(m); if (!tareaId && m.length === 1) cambiar({ marcaId: m[0]!.id }); });
    cargarMesas().then((m) => setMesas(m.filter((x) => x.active)));
    cargarPersonas().then(setGente);
    pedir<{ campanas: { id: string; name: string; brand_id: string }[] }>('/campanas').then((r) => setCampanas(r.campanas)).catch(() => setCampanas([]));
    if (tareaId) {
      pedir<{ tarea: any }>(`/tareas/${tareaId}`).then(({ tarea: t }) => {
        setD({
          titulo: t.title, marcaId: t.brand_id, campanaId: t.campaign_id ?? '', mesaId: t.mesa_id ?? '', descripcion: t.description, entregable: t.deliverable, criterio: t.acceptance,
          responsableId: t.owner_id ?? '', revisorId: t.reviewer_id ?? '', colaboradores: t.colaboradores.map((x: any) => x.id),
          aprobadores: t.aprobadores.map((x: any) => x.id), inicio: t.start_date, plazo: t.due, horas: t.estimated_hours ? String(t.estimated_hours) : '',
          complejidad: t.complexity, prioridad: t.priority, dependencias: t.necesita.map((x: any) => x.id), version: t.version,
        });
        setMasEquipo(t.colaboradores.length > 0 || t.aprobadores.length > 0);
        setMasPlazos(t.necesita.length > 0 || !!t.estimated_hours);
        setListo(true);
      }).catch((e: Error) => setError(e.message));
    }
  }, [tareaId]);

  useEffect(() => {
    if (!d.marcaId) { setTareasMarca([]); return; }
    pedir<{ tareas: { id: string; title: string; status: string }[] }>(`/tareas?marca=${encodeURIComponent(d.marcaId)}`)
      .then((r) => setTareasMarca(r.tareas.filter((t) => t.id !== tareaId)));
  }, [d.marcaId]);

  // Solo se ofrecen personas que tienen la marca (o la administración general).
  const conMarca = useMemo(() => gente.filter((p) => p.role === 'Administrador general' || p.marcas.includes(d.marcaId)), [gente, d.marcaId]);
  const opcionesPersonas = conMarca.map((p) => ({ id: p.id, texto: `${p.name}${p.mesa ? ` · ${p.mesa}` : ''}` }));

  const guardar = async () => {
    setError('');
    setEnviando(true);
    const cuerpo = {
      titulo: d.titulo, marcaId: d.marcaId, campanaId: d.campanaId || null, mesaId: d.mesaId || null, descripcion: d.descripcion, entregable: d.entregable, criterio: d.criterio,
      responsableId: d.responsableId, revisorId: d.revisorId || null, colaboradores: d.colaboradores, aprobadores: d.aprobadores,
      inicio: d.inicio, plazo: d.plazo, horas: d.horas ? Number(d.horas) : undefined, complejidad: d.complejidad, prioridad: d.prioridad,
      dependencias: d.dependencias, version: d.version,
    };
    try {
      const r = tareaId
        ? (await pedir(`/tareas/${tareaId}`, { method: 'PATCH', json: cuerpo }), { id: tareaId })
        : await pedir<{ id: string }>('/tareas', { method: 'POST', json: cuerpo });
      alGuardar(r.id);
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  };

  const pasos = [
    {
      titulo: 'Qué hacer',
      contenido: (
        <>
          <label>Título<input required minLength={3} maxLength={200} value={d.titulo} onInput={(e) => cambiar({ titulo: valor(e) })} /></label>
          <div class="dos">
            <label>Marca
              <select required value={d.marcaId} onChange={(e) => cambiar({ marcaId: valor(e), campanaId: '', responsableId: '', revisorId: '', colaboradores: [], aprobadores: [], dependencias: [] })}>
                <option value="">Elige una marca</option>
                {marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label>Mesa
              <select value={d.mesaId} onChange={(e) => cambiar({ mesaId: valor(e) })}>
                <option value="">Sin mesa</option>
                {mesas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </div>
          <label>Campaña
            <select value={d.campanaId} onChange={(e) => cambiar({ campanaId: valor(e) })}>
              <option value="">Sin campaña</option>
              {campanas.filter((x) => x.brand_id === d.marcaId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label>Qué hay que hacer<textarea required rows={4} maxLength={5000} value={d.descripcion} onInput={(e) => cambiar({ descripcion: valor(e) })} /></label>
          <label>Entregable<input required maxLength={1000} placeholder="Ej.: correo HTML aprobado, PDF de 10 láminas" value={d.entregable} onInput={(e) => cambiar({ entregable: valor(e) })} /></label>
        </>
      ),
    },
    {
      titulo: 'Equipo',
      contenido: (
        <>
          {!d.marcaId && <p class="ayuda">Elige primero la marca en el paso 1.</p>}
          <div class="dos">
            <label>Responsable
              <select required value={d.responsableId} onChange={(e) => cambiar({ responsableId: valor(e) })}>
                <option value="">Elige a la persona responsable</option>
                {opcionesPersonas.map((o) => <option key={o.id} value={o.id}>{o.texto}</option>)}
              </select>
            </label>
            <label>Revisión
              <select value={d.revisorId} onChange={(e) => cambiar({ revisorId: valor(e) })}>
                <option value="">Sin revisión</option>
                {opcionesPersonas.map((o) => <option key={o.id} value={o.id}>{o.texto}</option>)}
              </select>
              <span class="ayuda">Si nadie revisa ni aprueba, la tarea queda completada al entregarse.</span>
            </label>
          </div>
          <button type="button" class="mas-opciones" aria-expanded={masEquipo} onClick={() => setMasEquipo(!masEquipo)}>{masEquipo ? '－ Menos opciones' : '＋ Más opciones'}</button>
          {masEquipo && (
            <>
              <Elegibles etiqueta="Colaboradores" opciones={opcionesPersonas.filter((o) => o.id !== d.responsableId)} elegidas={d.colaboradores} alCambiar={(x) => cambiar({ colaboradores: x })} />
              <Elegibles etiqueta="Aprobadores" opciones={opcionesPersonas} elegidas={d.aprobadores} alCambiar={(x) => cambiar({ aprobadores: x })} />
            </>
          )}
        </>
      ),
    },
    {
      titulo: 'Salida al aire',
      contenido: (
        <div class="pronto">
          <strong>Programar salidas al aire llega en la Fase 4.</strong>
          <p>Aquí podrás indicar series de publicaciones o anuncios por canal, y mesawow propondrá la fecha límite de trabajo con 2 días de revisión.</p>
        </div>
      ),
    },
    {
      titulo: 'Plazos',
      contenido: (
        <>
          <div class="dos">
            <label>Inicio<input type="date" required value={d.inicio} onInput={(e) => cambiar({ inicio: valor(e) })} /></label>
            <label>Fecha límite<input type="date" required min={d.inicio} value={d.plazo} onInput={(e) => cambiar({ plazo: valor(e) })} /></label>
          </div>
          <label>Criterio de aceptación<textarea required rows={3} maxLength={2000} placeholder="¿Cómo sabremos que está lista?" value={d.criterio} onInput={(e) => cambiar({ criterio: valor(e) })} /></label>
          <button type="button" class="mas-opciones" aria-expanded={masPlazos} onClick={() => setMasPlazos(!masPlazos)}>{masPlazos ? '－ Menos opciones' : '＋ Más opciones'}</button>
          {masPlazos && (
            <>
              <div class="dos">
                <label>Horas estimadas<input type="number" min={0.5} max={320} step={0.5} value={d.horas} onInput={(e) => cambiar({ horas: valor(e) })} />
                  <span class="ayuda">Se reservan en la agenda de la persona responsable.</span></label>
                <label>Prioridad
                  <select value={d.prioridad} onChange={(e) => cambiar({ prioridad: valor(e) })}>{['Urgente', 'Alta', 'Media', 'Baja'].map((x) => <option key={x}>{x}</option>)}</select>
                </label>
              </div>
              <label>Complejidad
                <select value={d.complejidad} onChange={(e) => cambiar({ complejidad: valor(e) })}>{['Baja', 'Media', 'Alta'].map((x) => <option key={x}>{x}</option>)}</select>
              </label>
              <Elegibles etiqueta="Depende de (debe estar aprobada antes)" elegidas={d.dependencias} alCambiar={(x) => cambiar({ dependencias: x })}
                opciones={tareasMarca.map((t) => ({ id: t.id, texto: `${t.title} · ${t.status}` }))} />
            </>
          )}
        </>
      ),
    },
  ];

  return (
    <Dialogo titulo={tareaId ? 'Editar tarea' : 'Nueva tarea'} abierto alCerrar={alCerrar}>
      {!listo ? <p>{error || 'Cargando…'}</p> : (
        <Asistente pasos={pasos} alEnviar={guardar} textoEnviar={tareaId ? 'Guardar cambios' : 'Crear tarea'} enviando={enviando} error={error} />
      )}
    </Dialogo>
  );
};
