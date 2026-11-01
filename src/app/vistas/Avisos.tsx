// Avisos (Fase 6): seguimiento con estado por canal, Mis avisos, Correo y WhatsApp, y Plataformas.
import { useEffect, useState } from 'preact/hooks';
import { pedir, type Persona } from '../api';
import { Dialogo } from '../componentes/Dialogo';
import { fechaCorta, personas as cargarPersonas, type PersonaDirectorio } from '../datos';
import { activarPush, desactivarPush, pushEnEsteDispositivo, useInstalar } from '../pwa';
import { useLatido } from '../vivo';

const CANAL: Record<string, string> = { app: 'App', push: 'Push', email: 'Correo', whatsapp: 'WhatsApp' };
const ESTADO: Record<string, { texto: string; tono: string }> = {
  pendiente: { texto: 'Pendiente', tono: 'ambar' },
  encolado: { texto: 'En cola', tono: 'ambar' },
  enviado: { texto: 'Enviado', tono: 'verde' },
  entregado: { texto: 'Entregado', tono: 'verde' },
  rebotado: { texto: 'Rebotó', tono: 'roja' },
  fallido: { texto: 'Falló', tono: 'roja' },
  cancelado: { texto: 'Cancelado', tono: 'gris' },
};
const Estado = ({ estado }: { estado: string }) => {
  const e = ESTADO[estado] ?? { texto: estado, tono: 'gris' };
  return <span class={`insignia ${e.tono}`}>{e.texto}</span>;
};
const fechaHora = (iso: string) => new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`)
  .toLocaleString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const Cabeza = ({ ceja, titulo, texto }: { ceja: string; titulo: string; texto: string }) => (
  <div class="hero">
    <div><p class="ceja">{ceja}</p><h1 id="titulo-vista">{titulo}</h1><p>{texto}</p></div>
  </div>
);

// ─────────────────────────────── Avisos (seguimiento)

interface Aviso {
  id: string; event: string; created_at: string; task_id: string | null; title: string | null; persona: string | null; rol: string | null; titulo: string;
  marca: string | null; campana: string | null; plazo: string | null; instruccion: string | null; entregable: string | null; depende: string | null;
  canales: { canal: string; estado: string; error: string | null }[];
}

export const MisAvisos = ({ persona }: { persona: Persona }) => {
  const [todos, setTodos] = useState(false);
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState<Aviso | null>(null);
  const latido = useLatido();
  useEffect(() => {
    pedir<{ avisos: Aviso[] }>(`/avisos${todos ? '?todos=1' : ''}`).then((r) => setAvisos(r.avisos)).catch((e: Error) => setError(e.message));
  }, [todos, latido]);

  return (
    <section aria-labelledby="titulo-vista">
      <Cabeza ceja="Mi trabajo" titulo="Avisos" texto="Lo que mesawow te avisó y por dónde llegó: app, push, correo o WhatsApp." />
      {persona.permisos.esAdmin && (
        <div class="casillas" style={{ marginBottom: '12px' }}>
          <label class="casilla"><input type="checkbox" checked={todos} onChange={(e) => setTodos((e.target as HTMLInputElement).checked)} /> Ver los avisos de todo el equipo</label>
        </div>
      )}
      {error && <p class="pronto" role="alert">{error}</p>}
      {!avisos ? <p>Cargando avisos…</p> : !avisos.length ? (
        <div class="pronto"><strong>Aún no tienes avisos.</strong><p>Cuando te asignen una tarea o una quede lista para desarrollar, aparecerá aquí.</p></div>
      ) : (
        <div class="tabla-simple tabla-avisos" role="table" aria-label="Avisos">
          <div role="row" class="cabeza">
            <span role="columnheader">Tarea y evento</span>
            {todos && <span role="columnheader">Persona</span>}
            <span role="columnheader">Cuándo</span>
            <span role="columnheader">Canales</span>
            <span role="columnheader"><span class="visualmente-oculto">Acciones</span></span>
          </div>
          {avisos.map((a) => (
            <div role="row" key={a.id} class={todos ? 'con-persona' : ''}>
              <span role="cell"><strong>{a.title ?? a.titulo}</strong><br /><span class="ayuda">{a.event}</span></span>
              {todos && <span role="cell">{a.persona}<br /><span class="ayuda">{a.rol}</span></span>}
              <span role="cell" class="ayuda">{fechaHora(a.created_at)}</span>
              <span role="cell" class="casillas">
                <span class="insignia verde">App</span>
                {a.canales.map((c) => <span key={c.canal} title={c.error ?? undefined}>{CANAL[c.canal]} <Estado estado={c.estado} /></span>)}
              </span>
              <span role="cell"><button type="button" onClick={() => setAbierto(a)}>Ver aviso</button></span>
            </div>
          ))}
        </div>
      )}
      <Dialogo titulo="Vista del aviso" abierto={!!abierto} alCerrar={() => setAbierto(null)}>
        {abierto && (
          <div class="formulario">
            <p class="ceja">{abierto.event}</p>
            <h3>{abierto.title ?? abierto.titulo}</h3>
            {abierto.persona && <p>Para: {abierto.persona}{abierto.rol && ` · ${abierto.rol}`}</p>}
            <p class="ayuda">{fechaHora(abierto.created_at)} · America/Santiago</p>
            {abierto.task_id && (
              <div class="tarjeta">
                <p>Marca: {abierto.marca ?? '—'}<br />Proyecto: {abierto.campana ?? 'Sin proyecto'}<br />Plazo: {abierto.plazo ? fechaCorta(abierto.plazo) : 'Por definir'} · America/Santiago</p>
                <p>Instrucción: {abierto.instruccion || 'Consultar tarea'}</p>
                <p>Entregable: {abierto.entregable || 'Consultar tarea'}</p>
                <p>Depende de: {abierto.depende || 'Sin dependencia'}</p>
              </div>
            )}
            <ul class="lista-limpia">
              <li>App <Estado estado="enviado" /></li>
              {abierto.canales.map((c) => <li key={c.canal}>{CANAL[c.canal]} <Estado estado={c.estado} />{c.error && <span class="ayuda"> · {c.error}</span>}</li>)}
            </ul>
            {abierto.task_id && <div class="acciones"><a class="boton primario" href={`/encargos?tarea=${abierto.task_id}`} onClick={() => setAbierto(null)}>Abrir tarea</a></div>}
          </div>
        )}
      </Dialogo>
    </section>
  );
};

// ─────────────────────────────── Mis avisos (preferencias)

interface Preferencias {
  menciones: boolean; resumen: 'Diario' | 'Semanal' | 'Sin resumen externo'; correo: boolean; whatsapp: boolean; push: boolean;
  telefono: string | null; dispositivos: number; pushDisponible: boolean; clavePush: string | null;
}

export const PreferenciasAvisos = ({ aviso, soloLectura }: { aviso: (m: string) => void; soloLectura: boolean }) => {
  const [p, setP] = useState<Preferencias | null>(null);
  const [error, setError] = useState('');
  const [aqui, setAqui] = useState(false);
  const { estado: instalar, pedirInstalar } = useInstalar();
  const cargar = () => pedir<Preferencias>('/me/preferencias').then(setP).catch((e: Error) => setError(e.message));
  useEffect(() => { cargar(); pushEnEsteDispositivo().then(setAqui); }, []);

  if (error) return <div class="pronto" role="alert"><strong>{error}</strong></div>;
  if (!p) return <p>Cargando tus avisos…</p>;
  const cambiar = (k: keyof Preferencias, v: unknown) => setP({ ...p, [k]: v });
  const guardar = async (e: Event) => {
    e.preventDefault();
    try {
      await pedir('/me/preferencias', { method: 'PUT', json: { menciones: p.menciones, resumen: p.resumen, correo: p.correo, whatsapp: p.whatsapp, push: p.push } });
      aviso('Preferencias guardadas.');
    } catch (err) { aviso((err as Error).message); }
  };
  const alternarPush = async () => {
    try {
      if (aqui) { await desactivarPush(); aviso('Avisos push desactivados en este dispositivo.'); }
      else aviso(await activarPush(p.clavePush!));
      setAqui(await pushEnEsteDispositivo());
      cargar();
    } catch (err) { aviso((err as Error).message); }
  };
  const casilla = (k: 'menciones' | 'whatsapp' | 'push', texto: string, ayuda?: string) => (
    <label class="casilla-linea">
      <input type="checkbox" checked={p[k]} disabled={soloLectura} onChange={(e) => cambiar(k, (e.target as HTMLInputElement).checked)} />
      <span>{texto}{ayuda && <><br /><span class="ayuda">{ayuda}</span></>}</span>
    </label>
  );

  return (
    <section aria-labelledby="titulo-vista">
      <Cabeza ceja="Mi trabajo" titulo="Mis avisos" texto="Tú eliges cómo enterarte. Los logros siempre se publican." />
      <div class="inicio-grilla">
        <section class="tarjeta" aria-labelledby="t-pref">
          <h2 id="t-pref">Cómo te avisamos</h2>
          <p class="nota"><strong>Publicación automática de logros: siempre activa.</strong> No requiere publicar manualmente y no se puede desactivar.</p>
          <form class="formulario" onSubmit={guardar}>
            {casilla('menciones', 'Avisarme de menciones dentro de la plataforma')}
            {casilla('whatsapp', 'WhatsApp cuando una tarea mía queda lista para desarrollar',
              p.telefono ? `Llega a ${p.telefono}.` : 'Aún no tienes número de WhatsApp: pídeselo a coordinación en Equipo.')}
            {casilla('push', 'Avisos push en el teléfono o el computador', 'Tareas nuevas, entregas, ajustes y salidas al aire en riesgo.')}
            <label>Resumen por correo
              <select value={p.resumen} disabled={soloLectura} onChange={(e) => cambiar('resumen', (e.target as HTMLSelectElement).value)}>
                <option>Diario</option><option>Semanal</option><option>Sin resumen externo</option>
              </select>
              <span class="ayuda">Diario: cada mañana con lo del día anterior. Semanal: los lunes.</span>
            </label>
            <p class="ayuda">Los avisos críticos de responsabilidad se rigen por la política de la organización.</p>
            {!soloLectura && <div class="acciones"><button class="primario">Guardar preferencias</button></div>}
          </form>
        </section>
        <div>
          <section class="tarjeta" aria-labelledby="t-disp">
            <h2 id="t-disp">Este dispositivo</h2>
            {!p.pushDisponible ? <p class="ayuda">Los avisos push aún no están habilitados en mesawow.</p> : (
              <>
                <p>{aqui ? 'Recibe avisos push.' : 'No recibe avisos push.'} <span class="ayuda">Tienes {p.dispositivos} {p.dispositivos === 1 ? 'dispositivo' : 'dispositivos'} con avisos.</span></p>
                {!soloLectura && <div class="acciones" style={{ justifyContent: 'flex-start' }}><button type="button" onClick={alternarPush}>{aqui ? 'Desactivar aquí' : 'Activar avisos aquí'}</button></div>}
              </>
            )}
          </section>
          <BotonInstalar estado={instalar} alInstalar={pedirInstalar} />
        </div>
      </div>
    </section>
  );
};

export const BotonInstalar = ({ estado, alInstalar }: { estado: ReturnType<typeof useInstalar>['estado']; alInstalar: () => void }) => {
  if (!estado) return null;
  return (
    <section class="tarjeta" aria-labelledby="t-instalar">
      <h2 id="t-instalar">mesawow en tu teléfono</h2>
      {estado === 'instalada' ? <p>Ya estás usando la app instalada.</p>
        : estado === 'ios' ? <p>En iPhone: toca <strong>Compartir</strong> y luego <strong>Agregar a inicio</strong>. Así también puedes recibir avisos push.</p>
          : <><p>Ábrela como una app, sin buscar la pestaña del navegador.</p><div class="acciones" style={{ justifyContent: 'flex-start' }}><button type="button" class="primario" onClick={alInstalar}>Instalar app</button></div></>}
    </section>
  );
};

// ─────────────────────────────── Correo y WhatsApp (coordinación)

interface Tarjeta { channel: 'Correo' | 'WhatsApp'; provider: string; account: string; owner_id: string | null; template: string }
interface DatosCanales {
  correo: { configurado: boolean; remitente: string | null }; whatsapp: { configurado: boolean; remitente: string | null }; push: { configurado: boolean };
  ultimos30: { channel: string; status: string; n: number }[];
  ultimos: { channel: string; event: string; status: string; error: string | null; created_at: string; persona: string | null }[];
  tarjetas: Tarjeta[];
}

export const CorreoYWhatsapp = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const [d, setD] = useState<DatosCanales | null>(null);
  const [error, setError] = useState('');
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [editar, setEditar] = useState<Tarjeta | null>(null);
  const latido = useLatido();
  const admin = persona.permisos.esAdmin && !persona.permisos.soloLectura;
  const cargar = () => pedir<DatosCanales>('/canales').then(setD).catch((e: Error) => setError(e.message));
  useEffect(() => { cargar(); }, [latido]);
  useEffect(() => { cargarPersonas().then(setGente); }, []);

  if (error) return <div class="pronto" role="alert"><strong>{error}</strong></div>;
  if (!d) return <p>Cargando canales…</p>;
  const nombre = (id: string | null) => gente.find((g) => g.id === id)?.name;
  const cuenta = (canal: string) => d.ultimos30.filter((u) => u.channel === canal);
  const probar = async (canal: string) => {
    try { await pedir('/canales/prueba', { method: 'POST', json: { canal } }); aviso('Prueba en camino. Revisa su estado abajo en unos segundos.'); setTimeout(cargar, 3000); }
    catch (err) { aviso((err as Error).message); }
  };
  const guardar = async (e: Event) => {
    e.preventDefault();
    if (!editar) return;
    try {
      await pedir(`/canales/${editar.channel}`, { method: 'PUT', json: { proveedor: editar.provider, cuenta: editar.account, responsableId: editar.owner_id, plantilla: editar.template } });
      setEditar(null); aviso('Ficha guardada.'); cargar();
    } catch (err) { aviso((err as Error).message); }
  };
  const canales = [
    { titulo: 'Correo', clave: 'email', estado: d.correo, ayuda: 'Invitaciones, resúmenes y salidas al aire en riesgo.' },
    { titulo: 'WhatsApp', clave: 'whatsapp', estado: d.whatsapp, ayuda: 'Tarea recién lista para desarrollar (D2), con plantilla aprobada.' },
  ] as const;

  return (
    <section aria-labelledby="titulo-vista">
      <Cabeza ceja="Al aire" titulo="Correo y WhatsApp" texto="Configuración y trazabilidad de los avisos del equipo." />
      <div class="grilla-2">
        {canales.map((c) => {
          const t = d.tarjetas.find((x) => x.channel === c.titulo);
          return (
            <section class="tarjeta" key={c.clave} aria-labelledby={`t-${c.clave}`}>
              <div class="seccion-cabeza">
                <h2 id={`t-${c.clave}`}>{c.titulo}</h2>
                {c.estado.configurado ? <span class="insignia verde">Conectado</span> : <span class="insignia ambar">Falta configurar</span>}
              </div>
              <p class="ayuda">{c.ayuda}</p>
              <p>{t?.provider || 'Brevo'} · {c.estado.remitente || t?.account || 'Remitente por definir'}</p>
              {t?.template && <p class="ayuda">Plantilla: {t.template}</p>}
              <p class="ayuda">{nombre(t?.owner_id ?? null) ?? 'Responsable por definir'}</p>
              <p class="ayuda">Últimos 30 días: {cuenta(c.clave).map((u) => `${u.n} ${ESTADO[u.status]?.texto.toLowerCase() ?? u.status}`).join(' · ') || 'sin envíos'}</p>
              {admin && (
                <div class="acciones" style={{ justifyContent: 'flex-start' }}>
                  <button type="button" onClick={() => setEditar(t ?? { channel: c.titulo, provider: 'Brevo', account: '', owner_id: null, template: '' })}>Configurar ficha</button>
                  <button type="button" disabled={!c.estado.configurado} onClick={() => probar(c.clave)}>Enviarme una prueba</button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <section class="tarjeta" style={{ marginTop: '16px' }} aria-labelledby="t-push">
        <div class="seccion-cabeza">
          <h2 id="t-push">Push</h2>
          {d.push.configurado ? <span class="insignia verde">Conectado</span> : <span class="insignia ambar">Falta configurar</span>}
        </div>
        <p class="ayuda">Cada persona lo activa en Mis avisos, en cada teléfono o computador.</p>
        {admin && <div class="acciones" style={{ justifyContent: 'flex-start' }}><button type="button" disabled={!d.push.configurado} onClick={() => probar('push')}>Enviarme una prueba</button></div>}
      </section>
      <section class="tarjeta" style={{ marginTop: '16px' }} aria-labelledby="t-ultimos">
        <div class="seccion-cabeza">
          <h2 id="t-ultimos">Últimos envíos</h2>
          <a href="/avisos">Ver seguimiento de avisos</a>
        </div>
        {!d.ultimos.length ? <p class="ayuda">Todavía no hay envíos por correo, WhatsApp o push.</p> : (
          <ul class="lista-limpia">
            {d.ultimos.map((u, i) => (
              <li key={i}>
                <strong>{CANAL[u.channel]}</strong> · {u.event} · {u.persona ?? '—'} · <span class="ayuda">{fechaHora(u.created_at)}</span> <Estado estado={u.status} />
                {u.error && <span class="ayuda"> · {u.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section class="tarjeta" style={{ marginTop: '16px' }} aria-labelledby="t-reglas">
        <h2 id="t-reglas">Cómo funciona</h2>
        <ol>
          <li>Cuenta remitente y dominio de correo autenticado en Brevo.</li>
          <li>Cuenta oficial de WhatsApp Business y plantilla aprobada.</li>
          <li>Solo se avisa a personas del equipo, con enlace a la tarea dentro de mesawow.</li>
          <li>Envío por servidor con estado real por canal y reintentos sin duplicar.</li>
        </ol>
      </section>
      <Dialogo titulo={`Ficha de ${editar?.channel ?? ''}`} abierto={!!editar} alCerrar={() => setEditar(null)}>
        {editar && (
          <form class="formulario" onSubmit={guardar}>
            <label>Proveedor<input value={editar.provider} maxLength={100} onInput={(e) => setEditar({ ...editar, provider: (e.target as HTMLInputElement).value })} /></label>
            <label>Remitente o cuenta<input value={editar.account} maxLength={200} onInput={(e) => setEditar({ ...editar, account: (e.target as HTMLInputElement).value })} /></label>
            <label>Plantilla<input value={editar.template} maxLength={200} onInput={(e) => setEditar({ ...editar, template: (e.target as HTMLInputElement).value })} /></label>
            <label>Responsable
              <select value={editar.owner_id ?? ''} onChange={(e) => setEditar({ ...editar, owner_id: (e.target as HTMLSelectElement).value || null })}>
                <option value="">Por definir</option>
                {gente.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <p class="ayuda">No escribas claves aquí: la clave de Brevo se carga en Cloudflare.</p>
            <div class="acciones"><button type="button" onClick={() => setEditar(null)}>Cancelar</button><button class="primario">Guardar ficha</button></div>
          </form>
        )}
      </Dialogo>
    </section>
  );
};

// ─────────────────────────────── Plataformas (fichas sin claves)

interface Plataforma { name: string; account: string; url: string; owner_id: string | null; responsable: string | null }

export const Plataformas = ({ persona, aviso }: { persona: Persona; aviso: (m: string) => void }) => {
  const [lista, setLista] = useState<Plataforma[] | null>(null);
  const [error, setError] = useState('');
  const [gente, setGente] = useState<PersonaDirectorio[]>([]);
  const [editar, setEditar] = useState<Plataforma | null>(null);
  const puede = persona.permisos.coordina && !persona.permisos.soloLectura;
  const cargar = () => pedir<{ plataformas: Plataforma[]; nombres: string[] }>('/plataformas')
    .then((r) => setLista(r.nombres.map((n) => r.plataformas.find((p) => p.name === n) ?? { name: n, account: '', url: '', owner_id: null, responsable: null })))
    .catch((e: Error) => setError(e.message));
  useEffect(() => { cargar(); cargarPersonas().then(setGente); }, []);

  if (error) return <div class="pronto" role="alert"><strong>{error}</strong></div>;
  if (!lista) return <p>Cargando plataformas…</p>;
  const guardar = async (e: Event) => {
    e.preventDefault();
    if (!editar) return;
    try {
      await pedir(`/plataformas/${encodeURIComponent(editar.name)}`, { method: 'PUT', json: { cuenta: editar.account, url: editar.url, responsableId: editar.owner_id } });
      setEditar(null); aviso('Ficha guardada.'); cargar();
    } catch (err) { aviso((err as Error).message); }
  };

  return (
    <section aria-labelledby="titulo-vista">
      <Cabeza ceja="Al aire" titulo="Plataformas y cuentas" texto="Dónde se configura, programa y mide cada campaña." />
      <section class="tarjeta">
        <ul class="lista-limpia lista-plataformas">
          {lista.map((p) => (
            <li key={p.name}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3>{p.name}</h3>
                <p class="ayuda">{p.account || 'Cuenta por definir'} · {p.responsable || 'Responsable pendiente'}</p>
                {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer">Abrir herramienta ↗</a>}
              </div>
              <span class="insignia gris">{p.name === 'Brevo' ? 'Avisos conectados' : 'Sin conexión API'}</span>
              {puede && <button type="button" onClick={() => setEditar(p)}>Configurar ficha</button>}
            </li>
          ))}
        </ul>
      </section>
      <section class="tarjeta" style={{ marginTop: '16px' }} aria-labelledby="t-contactos">
        <h2 id="t-contactos">Contactos del equipo</h2>
        <p>El correo y el WhatsApp de cada persona se administran en Equipo. Aquí solo van fichas: nunca claves ni contraseñas.</p>
        <p class="nota">Respond.io pertenece a Comercial y Ventas. No se conecta a mesawow.</p>
      </section>
      <Dialogo titulo={`Ficha de ${editar?.name ?? ''}`} abierto={!!editar} alCerrar={() => setEditar(null)}>
        {editar && (
          <form class="formulario" onSubmit={guardar}>
            <label>Cuenta<input value={editar.account} maxLength={200} onInput={(e) => setEditar({ ...editar, account: (e.target as HTMLInputElement).value })} /></label>
            <label>Enlace de la herramienta<input type="url" placeholder="https://" value={editar.url} onInput={(e) => setEditar({ ...editar, url: (e.target as HTMLInputElement).value })} /></label>
            <label>Responsable
              <select value={editar.owner_id ?? ''} onChange={(e) => setEditar({ ...editar, owner_id: (e.target as HTMLSelectElement).value || null })}>
                <option value="">Por definir</option>
                {gente.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <p class="ayuda">No escribas claves ni tokens en las fichas.</p>
            <div class="acciones"><button type="button" onClick={() => setEditar(null)}>Cancelar</button><button class="primario">Guardar ficha</button></div>
          </form>
        )}
      </Dialogo>
    </section>
  );
};
