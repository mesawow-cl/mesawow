// Equipo e invitaciones (solo Administrador general). Requerimiento §4.22.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ROLES, ROLES_INVITABLES, type Rol } from '../../shared/roles';
import { pedir } from '../api';
import { Avatar } from '../componentes/Avatar';
import { Dialogo } from '../componentes/Dialogo';
import { hrefDe } from '../rutas';

interface PersonaEquipo {
  id: string; name: string; email: string; phone: string | null; role: Rol; mesa_id: string | null; mesa: string | null;
  active: number; departed: number; departure_note: string | null; tiene_foto: number; marcas: string[];
}
interface Invitacion {
  id: string; email: string; name: string | null; role: Rol; mesa: string | null; status: string; expires_at: string; marcas: string[];
}
interface Marca { id: string; name: string; color: string }
interface Mesa { id: string; name: string }

const fechaCorta = (iso: string) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'America/Santiago' }).format(new Date(iso));
const TONO_INVITACION: Record<string, string> = { Pendiente: 'ambar', Aceptada: 'verde', Revocada: 'gris', Vencida: 'roja' };

const Chips = ({ ids, marcas }: { ids: string[]; marcas: Marca[] }) => (
  <div class="chips">
    {marcas.filter((m) => ids.includes(m.id)).map((m) => <span class="chip" key={m.id}><i style={{ background: m.color }} />{m.name}</span>)}
  </div>
);

const CasillasMarcas = ({ marcas, elegidas, alCambiar }: { marcas: Marca[]; elegidas: string[]; alCambiar: (ids: string[]) => void }) => (
  <fieldset>
    <legend>Marcas</legend>
    <div class="casillas">
      {marcas.map((m) => (
        <label class="casilla" key={m.id}>
          <input type="checkbox" checked={elegidas.includes(m.id)}
            onChange={(e) => alCambiar((e.target as HTMLInputElement).checked ? [...elegidas, m.id] : elegidas.filter((x) => x !== m.id))} />
          {m.name}
        </label>
      ))}
    </div>
  </fieldset>
);

type Dialogos =
  | { tipo: 'invitar' }
  | { tipo: 'enlace'; correo: string; enlace: string }
  | { tipo: 'editar'; persona: PersonaEquipo }
  | { tipo: 'salida'; persona: PersonaEquipo }
  | null;

export const Equipo = ({ actorId, aviso }: { actorId: string; aviso: (m: string) => void }) => {
  const [datos, setDatos] = useState<{ personas: PersonaEquipo[]; invitaciones: Invitacion[] } | null>(null);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [dialogo, setDialogo] = useState<Dialogos>(null);

  const cargar = () => pedir<typeof datos>('/equipo').then(setDatos).catch((e: Error) => setError(e.message));
  useEffect(() => {
    cargar();
    pedir<{ marcas: Marca[] }>('/marcas').then((r) => setMarcas(r.marcas));
    pedir<{ mesas: (Mesa & { active: number })[] }>('/mesas').then((r) => setMesas(r.mesas.filter((m) => m.active)));
  }, []);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (datos?.personas ?? []).filter((p) => !q || `${p.name} ${p.email} ${p.mesa ?? ''} ${p.role}`.toLowerCase().includes(q));
  }, [datos, busqueda]);

  const transferir = async (p: PersonaEquipo) => {
    if (!confirm(`¿Transferir la administración general a ${p.name}? Tú pasarás a Coordinación de Marketing y dejarás de administrar el equipo.`)) return;
    try {
      await pedir(`/personas/${p.id}/transferir-admin`, { method: 'POST' });
      location.assign('/');
    } catch (e) { aviso((e as Error).message); }
  };

  const revocar = async (i: Invitacion) => {
    if (!confirm(`¿Revocar la invitación de ${i.email}?`)) return;
    try { await pedir(`/invitaciones/${i.id}/revocar`, { method: 'POST' }); aviso('Invitación revocada.'); cargar(); } catch (e) { aviso((e as Error).message); }
  };

  if (error) return <div class="pronto" role="alert"><strong>{error}</strong></div>;

  return (
    <section aria-labelledby="titulo-vista">
      <div class="encabezado">
        <div>
          <p class="ceja">Equipo</p>
          <h1 id="titulo-vista">Tu equipo comienza con una invitación.</h1>
          <p>Invita a cada integrante con su correo. Entrará con ese correo y verá solo las marcas que le asignes.</p>
        </div>
        <button type="button" class="primario" onClick={() => setDialogo({ tipo: 'invitar' })}>＋ Invitar integrante</button>
      </div>

      <label class="visualmente-oculto" for="buscar-equipo">Buscar en el equipo</label>
      <input id="buscar-equipo" class="buscador" type="search" placeholder="Buscar por nombre, correo, mesa o rol"
        value={busqueda} onInput={(e) => setBusqueda((e.target as HTMLInputElement).value)} />

      {!datos ? <p style={{ marginTop: '16px' }}>Cargando equipo…</p> : (
        <div class="tarjetas-equipo" style={{ marginTop: '16px' }}>
          {visibles.map((p) => (
            <article class={`tarjeta persona-tarjeta${p.active ? '' : ' inactiva'}`} key={p.id}>
              <div class="persona-cabeza">
                <Avatar nombre={p.name} foto={p.tiene_foto ? `/api/v1/fotos/${p.id}` : null} />
                <div>
                  <strong>{p.name}</strong>
                  <span class="apagado">{[p.mesa, p.role].filter(Boolean).join(' · ')}</span>
                </div>
              </div>
              <div>
                {p.departed ? <span class="insignia gris">Salió del equipo</span> : p.active ? <span class="insignia verde">Activa</span> : <span class="insignia gris">Inactiva</span>}
                {p.role === 'Administrador general' && <span class="insignia" style={{ marginLeft: '6px' }}>Administración general</span>}
              </div>
              <p class="contacto">{p.email}<br />{p.phone ?? 'WhatsApp por completar'}</p>
              {p.departure_note && <p class="contacto">Salida: {p.departure_note}</p>}
              <Chips ids={p.marcas} marcas={marcas} />
              <div class="persona-acciones">
                <button type="button" onClick={() => setDialogo({ tipo: 'editar', persona: p })}>Editar permisos</button>
                <a href={`${hrefDe('profile')}?id=${p.id}`} style={{ alignSelf: 'center' }}>Ver perfil</a>
              </div>
            </article>
          ))}
        </div>
      )}

      {datos && (
        <section class="tarjeta" style={{ marginTop: '24px' }} aria-labelledby="t-invitaciones">
          <h2 id="t-invitaciones" style={{ marginBottom: '12px' }}>Invitaciones</h2>
          {!datos.invitaciones.length ? <p class="apagado">Todavía no hay invitaciones.</p> : (
            <ul class="lista-invitaciones">
              {datos.invitaciones.map((i) => (
                <li key={i.id}>
                  <div>
                    <strong style={{ overflowWrap: 'anywhere' }}>{i.name ? `${i.name} · ` : ''}{i.email}</strong><br />
                    <span class="apagado">{[i.mesa, i.role].filter(Boolean).join(' · ')}{i.status === 'Pendiente' ? ` · vence el ${fechaCorta(i.expires_at)}` : ''}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span class={`insignia ${TONO_INVITACION[i.status] ?? ''}`}>{i.status}</span>
                    {i.status === 'Pendiente' && <button type="button" onClick={() => revocar(i)}>Revocar</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {dialogo?.tipo === 'invitar' && (
        <FormInvitar marcas={marcas} mesas={mesas} alCerrar={() => setDialogo(null)}
          alCrear={(correo, enlace) => { setDialogo({ tipo: 'enlace', correo, enlace }); cargar(); }} />
      )}
      {dialogo?.tipo === 'enlace' && <EnlaceInvitacion correo={dialogo.correo} enlace={dialogo.enlace} alCerrar={() => setDialogo(null)} aviso={aviso} />}
      {dialogo?.tipo === 'editar' && (
        <FormEditar persona={dialogo.persona} marcas={marcas} mesas={mesas} alCerrar={() => setDialogo(null)}
          alGuardar={() => { setDialogo(null); aviso('Permisos guardados.'); cargar(); }}
          delicadas={!!dialogo.persona.active && dialogo.persona.id !== actorId && dialogo.persona.role !== 'Administrador general'}
          alTransferir={() => transferir(dialogo.persona)}
          alSalida={() => setDialogo({ tipo: 'salida', persona: dialogo.persona })} />
      )}
      {dialogo?.tipo === 'salida' && (
        <FormSalida persona={dialogo.persona} alCerrar={() => setDialogo(null)}
          alGuardar={(n) => { setDialogo(null); aviso(`Salida registrada. ${n} tarea(s) quedaron bloqueadas para reasignar.`); cargar(); }} />
      )}
    </section>
  );
};

const FormInvitar = ({ marcas, mesas, alCerrar, alCrear }: {
  marcas: Marca[]; mesas: Mesa[]; alCerrar: () => void; alCrear: (correo: string, enlace: string) => void;
}) => {
  const [correo, setCorreo] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<Rol>('Ejecutor');
  const [mesaId, setMesaId] = useState(mesas.find((m) => m.name === 'Marketing')?.id ?? '');
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: Event) => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const r = await pedir<{ enlace: string }>('/invitaciones', { method: 'POST', json: { correo, nombre, rol, mesaId: mesaId || null, marcas: elegidas } });
      alCrear(correo.trim().toLowerCase(), r.enlace);
    } catch (err) { setError((err as Error).message); } finally { setEnviando(false); }
  };
  return (
    <Dialogo titulo="Invitar integrante" abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={enviar}>
        <label>Correo<input type="email" required autoComplete="off" value={correo} onInput={(e) => setCorreo((e.target as HTMLInputElement).value)} />
          <span class="ayuda">Con este correo entrará a mesawow.</span></label>
        <label>Nombre (opcional)<input value={nombre} maxLength={90} onInput={(e) => setNombre((e.target as HTMLInputElement).value)} /></label>
        <div class="dos">
          <label>Rol
            <select value={rol} onChange={(e) => setRol((e.target as HTMLSelectElement).value as Rol)}>
              {ROLES_INVITABLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label>Mesa
            <select value={mesaId} onChange={(e) => setMesaId((e.target as HTMLSelectElement).value)}>
              <option value="">Sin mesa</option>
              {mesas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        </div>
        <CasillasMarcas marcas={marcas} elegidas={elegidas} alCambiar={setElegidas} />
        {error && <p class="error-form" role="alert">{error}</p>}
        <div class="acciones">
          <button type="button" onClick={alCerrar}>Cancelar</button>
          <button type="submit" class="primario" disabled={enviando}>Crear invitación</button>
        </div>
      </form>
    </Dialogo>
  );
};

const EnlaceInvitacion = ({ correo, enlace, alCerrar, aviso }: { correo: string; enlace: string; alCerrar: () => void; aviso: (m: string) => void }) => {
  const mensaje = `Hola, te invito a mesawow, nuestra plataforma de trabajo. Entra con tu correo ${correo} aquí: ${enlace}`;
  return (
    <Dialogo titulo="Invitación lista" abierto alCerrar={alCerrar}>
      <div class="formulario">
        <p>Envíale este enlace a <strong>{correo}</strong>. Vence en 7 días y solo sirve para ese correo.</p>
        <div class="enlace-copiable">
          <label class="visualmente-oculto" for="enlace-inv">Enlace de invitación</label>
          <input id="enlace-inv" readOnly value={enlace} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <button type="button" onClick={() => navigator.clipboard.writeText(enlace).then(() => aviso('Enlace copiado.'), () => aviso('Copia el enlace manualmente.'))}>Copiar</button>
        </div>
        <p class="apagado">Guárdalo ahora: por seguridad no se vuelve a mostrar. Desde la Fase 6 mesawow enviará la invitación por correo.</p>
        <div class="acciones">
          <a class="casilla" href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noopener">Enviar por WhatsApp</a>
          <a class="casilla" href={`mailto:${correo}?subject=${encodeURIComponent('Tu invitación a mesawow')}&body=${encodeURIComponent(mensaje)}`}>Enviar por correo</a>
          <button type="button" class="primario" onClick={alCerrar}>Listo</button>
        </div>
      </div>
    </Dialogo>
  );
};

const FormEditar = ({ persona, marcas, mesas, alCerrar, alGuardar, delicadas, alTransferir, alSalida }: {
  persona: PersonaEquipo; marcas: Marca[]; mesas: Mesa[]; alCerrar: () => void; alGuardar: () => void;
  delicadas: boolean; alTransferir: () => void; alSalida: () => void;
}) => {
  const esAdmin = persona.role === 'Administrador general';
  const [nombre, setNombre] = useState(persona.name);
  const [telefono, setTelefono] = useState(persona.phone ?? '');
  const [rol, setRol] = useState<Rol>(persona.role);
  const [mesaId, setMesaId] = useState(persona.mesa_id ?? '');
  const [activo, setActivo] = useState(!!persona.active);
  const [elegidas, setElegidas] = useState(persona.marcas);
  const [error, setError] = useState('');
  const enviar = async (e: Event) => {
    e.preventDefault();
    setError('');
    try {
      await pedir(`/personas/${persona.id}`, { method: 'PATCH', json: { nombre, telefono, rol, mesaId: mesaId || null, activo, marcas: elegidas } });
      alGuardar();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <Dialogo titulo={`Permisos de ${persona.name}`} abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={enviar}>
        <p class="apagado" style={{ overflowWrap: 'anywhere' }}>Correo de ingreso: {persona.email}</p>
        <label>Nombre y apellido<input required maxLength={90} value={nombre} onInput={(e) => setNombre((e.target as HTMLInputElement).value)} /></label>
        <label>WhatsApp<input type="tel" placeholder="+56912345678" value={telefono} onInput={(e) => setTelefono((e.target as HTMLInputElement).value)} />
          <span class="ayuda">Para avisarle cuando una tarea queda lista para desarrollar.</span></label>
        <div class="dos">
          <label>Rol
            <select value={rol} disabled={esAdmin} onChange={(e) => setRol((e.target as HTMLSelectElement).value as Rol)}>
              {ROLES.filter((r) => esAdmin || r !== 'Administrador general').map((r) => <option key={r}>{r}</option>)}
            </select>
            {esAdmin && <span class="ayuda">Para cambiarlo, transfiere la administración general.</span>}
          </label>
          <label>Mesa
            <select value={mesaId} onChange={(e) => setMesaId((e.target as HTMLSelectElement).value)}>
              <option value="">Sin mesa</option>
              {mesas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        </div>
        {!esAdmin && (
          <label class="casilla" style={{ justifySelf: 'start' }}>
            <input type="checkbox" checked={activo} onChange={(e) => setActivo((e.target as HTMLInputElement).checked)} /> Cuenta activa
          </label>
        )}
        {!esAdmin && <CasillasMarcas marcas={marcas} elegidas={elegidas} alCambiar={setElegidas} />}
        {error && <p class="error-form" role="alert">{error}</p>}
        <div class="acciones">
          <button type="button" onClick={alCerrar}>Cancelar</button>
          <button type="submit" class="primario">Guardar permisos</button>
        </div>
        {delicadas && (
          <fieldset>
            <legend>Acciones delicadas</legend>
            <div class="acciones" style={{ justifyContent: 'flex-start' }}>
              <button type="button" onClick={alTransferir}>Transferir administración</button>
              <button type="button" class="peligro" onClick={alSalida}>Registrar salida</button>
            </div>
          </fieldset>
        )}
      </form>
    </Dialogo>
  );
};

const FormSalida = ({ persona, alCerrar, alGuardar }: { persona: PersonaEquipo; alCerrar: () => void; alGuardar: (tareas: number) => void }) => {
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const enviar = async (e: Event) => {
    e.preventDefault();
    try {
      const r = await pedir<{ tareasBloqueadas: number }>(`/personas/${persona.id}/salida`, { method: 'POST', json: { nota } });
      alGuardar(r.tareasBloqueadas);
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <Dialogo titulo={`Salida de ${persona.name}`} abierto alCerrar={alCerrar}>
      <form class="formulario" onSubmit={enviar}>
        <p>La cuenta quedará inactiva, se cancelan sus avisos pendientes y sus tareas abiertas quedan bloqueadas con
          “Revisar asignación por salida de {persona.name}” para que coordinación las reasigne. Su historial se conserva.</p>
        <label>Nota<textarea required minLength={3} maxLength={300} rows={3} value={nota} onInput={(e) => setNota((e.target as HTMLTextAreaElement).value)} /></label>
        {error && <p class="error-form" role="alert">{error}</p>}
        <div class="acciones">
          <button type="button" onClick={alCerrar}>Cancelar</button>
          <button type="submit" class="primario">Registrar salida</button>
        </div>
      </form>
    </Dialogo>
  );
};
