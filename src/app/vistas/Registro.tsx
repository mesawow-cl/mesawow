// Primer ingreso de una persona invitada: confirma su nombre y su WhatsApp.
import { useEffect, useState } from 'preact/hooks';
import { cerrarSesion, pedir } from '../api';
import { logoColor } from '../marca';

interface Invitacion { name: string | null; role: string; mesa: string | null; marcas: string | null; correo: string }

const CLAVE_TOKEN = 'mesawow:invitacion';
export const guardarTokenDeInvitacion = () => {
  const url = new URL(location.href);
  const token = url.searchParams.get('invitacion');
  if (!token) return;
  try { sessionStorage.setItem(CLAVE_TOKEN, token); } catch { /* sin almacenamiento */ }
  url.searchParams.delete('invitacion');
  history.replaceState(null, '', url.pathname + url.search);
};
const leerToken = () => { try { return sessionStorage.getItem(CLAVE_TOKEN) ?? undefined; } catch { return undefined; } };

export const Registro = ({ alEntrar }: { alEntrar: () => void }) => {
  const [inv, setInv] = useState<Invitacion | null>(null);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('+569');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    pedir<{ invitacion: Invitacion }>('/invitaciones/mia')
      .then((r) => { setInv(r.invitacion); setNombre(r.invitacion.name ?? ''); })
      .catch((e: Error) => setError(e.message));
  }, []);

  const enviar = async (e: Event) => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await pedir('/invitaciones/aceptar', { method: 'POST', json: { nombre, telefono, token: leerToken() } });
      try { sessionStorage.removeItem(CLAVE_TOKEN); } catch { /* sin almacenamiento */ }
      history.replaceState(null, '', '/');
      alEntrar();
    } catch (err) { setError((err as Error).message); } finally { setEnviando(false); }
  };

  return (
    <main class="entrar">
      <div class="tarjeta">
        <img src={logoColor} alt="mesawow" width={170} height={46} />
        <h1 style={{ marginTop: '18px', fontSize: '26px' }}>Te invitaron a mesawow</h1>
        {inv && (
          <p class="apagado" style={{ marginTop: '6px' }}>
            Entrarás con <strong>{inv.correo}</strong> como {inv.role}{inv.mesa ? ` en la mesa ${inv.mesa}` : ''}
            {inv.marcas ? `, para ${inv.marcas}` : ''}.
          </p>
        )}
        {!inv && !error && <p style={{ marginTop: '12px' }}>Buscando tu invitación…</p>}
        {inv && (
          <form class="formulario" style={{ marginTop: '18px' }} onSubmit={enviar}>
            <label>Nombre y apellido<input required minLength={3} maxLength={90} autoComplete="name" value={nombre}
              onInput={(e) => setNombre((e.target as HTMLInputElement).value)} /></label>
            <label>WhatsApp<input required type="tel" autoComplete="tel" value={telefono} placeholder="+56912345678"
              onInput={(e) => setTelefono((e.target as HTMLInputElement).value)} />
              <span class="ayuda">Te avisaremos por WhatsApp cuando una tarea quede lista para que la desarrolles.</span></label>
            {error && <p class="error-form" role="alert">{error}</p>}
            <div class="acciones"><button type="submit" class="primario" disabled={enviando}>Entrar a mesawow</button></div>
          </form>
        )}
        {!inv && error && (
          <>
            <p role="alert" class="error-form" style={{ marginTop: '12px' }}>{error}</p>
            <p class="apagado" style={{ marginTop: '8px' }}>Si crees que es un error, pide una nueva invitación a la administración.</p>
            <div class="acciones"><button type="button" onClick={cerrarSesion}>Salir</button></div>
          </>
        )}
      </div>
    </main>
  );
};
