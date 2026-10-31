// Solo en desarrollo local: elegir con qué persona de ejemplo entrar para probar roles.
// En staging y production este paso lo reemplaza el ingreso con Cloudflare Access (Fase 2).
import { useEffect, useState } from 'preact/hooks';
import { entrarComo, pedir } from '../api';
import { logoColor } from '../marca';

interface Opcion { email: string; name: string; role: string; mesa: string | null }

export const EntrarComo = ({ alEntrar }: { alEntrar: () => void }) => {
  const [personas, setPersonas] = useState<Opcion[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    pedir<{ personas: Opcion[] }>('/dev/personas')
      .then((r) => setPersonas(r.personas))
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <main class="entrar">
      <div class="tarjeta">
        <img src={logoColor} alt="mesawow" width={170} height={46} />
        <h1 style={{ marginTop: '18px', fontSize: '24px' }}>Entrar como…</h1>
        <p class="apagado" style={{ marginTop: '6px' }}>
          Modo desarrollo: personas inventadas para probar cada rol. En la versión publicada entrarás con tu correo.
        </p>
        {error && <p role="alert" class="peligro" style={{ marginTop: '12px' }}>{error}</p>}
        {!personas && !error && <p style={{ marginTop: '12px' }}>Cargando…</p>}
        {personas && (
          <form class="formulario" style={{ marginTop: '16px' }}
            onSubmit={(e) => { e.preventDefault(); const c = new FormData(e.currentTarget as HTMLFormElement).get('correo'); if (c) { entrarComo(String(c).trim().toLowerCase()); alEntrar(); } }}>
            <label>Otro correo (para probar una invitación)
              <span class="enlace-copiable"><input name="correo" type="email" placeholder="nueva@mesawow.test" /><button type="submit">Entrar</button></span>
            </label>
          </form>
        )}
        {personas && (
          <ul>
            {personas.map((p) => (
              <li key={p.email}>
                <button type="button" onClick={() => { entrarComo(p.email); alEntrar(); }}>
                  <span>{p.name}</span><small>{p.role}{p.mesa ? ` · ${p.mesa}` : ''}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
};
