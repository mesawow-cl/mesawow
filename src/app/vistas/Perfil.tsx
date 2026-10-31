// Perfil (requerimiento §4.3). Los logros del perfil llegan con la Comunidad (Fase 7).
import { useEffect, useState } from 'preact/hooks';
import { pedir, subirArchivo } from '../api';
import { Avatar } from '../componentes/Avatar';

interface PerfilDatos {
  id: string; name: string; role: string; mesa: string | null; bio: string; active: number; departed: number;
  foto: string | null; propio: boolean; marcas: { id: string; name: string; color: string }[];
}

const MAX_FOTO = 100 * 1024;

export const Perfil = ({ personaId, soloLectura, aviso }: { personaId: string; soloLectura: boolean; aviso: (m: string) => void }) => {
  const [perfil, setPerfil] = useState<PerfilDatos | null>(null);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(false);
  const [bio, setBio] = useState('');

  const cargar = () => pedir<{ perfil: PerfilDatos }>(`/personas/${personaId}/perfil`)
    .then((r) => { setPerfil(r.perfil); setBio(r.perfil.bio); })
    .catch((e: Error) => setError(e.message));
  useEffect(() => { setPerfil(null); setEditando(false); cargar(); }, [personaId]);

  const guardarBio = async (e: Event) => {
    e.preventDefault();
    try { await pedir('/me/perfil', { method: 'PUT', json: { bio } }); setEditando(false); aviso('Perfil guardado.'); cargar(); } catch (err) { aviso((err as Error).message); }
  };
  const subirFoto = async (archivo: File | undefined) => {
    if (!archivo) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type)) { aviso('La foto debe ser PNG, JPEG o WebP.'); return; }
    if (archivo.size > MAX_FOTO) { aviso('La foto puede pesar hasta 100 KB. Prueba con una más pequeña.'); return; }
    try { await subirArchivo('/me/foto', archivo); aviso('Foto actualizada.'); cargar(); } catch (err) { aviso((err as Error).message); }
  };
  const quitarFoto = async () => {
    try { await pedir('/me/foto', { method: 'DELETE' }); aviso('Foto quitada.'); cargar(); } catch (err) { aviso((err as Error).message); }
  };

  if (error) return <div class="pronto" role="alert"><strong>{error}</strong></div>;
  if (!perfil) return <p>Cargando perfil…</p>;
  const puedeEditar = perfil.propio && !soloLectura;

  return (
    <section aria-labelledby="titulo-vista">
      <div class="hero perfil-hero">
        <Avatar nombre={perfil.name} foto={perfil.foto} grande />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p class="ceja">{perfil.propio ? 'Mi perfil' : 'Perfil'}</p>
          <h1 id="titulo-vista">{perfil.name}</h1>
          <p>{[perfil.role, perfil.mesa].filter(Boolean).join(' · ')}</p>
          {!perfil.active && <span class="insignia gris" style={{ marginTop: '8px' }}>Perfil histórico · Inactivo</span>}
        </div>
      </div>

      <div class="inicio-grilla">
        <div>
          <section class="tarjeta" aria-labelledby="t-bio">
            <div class="seccion-cabeza">
              <h2 id="t-bio">Presentación</h2>
              {puedeEditar && !editando && <button type="button" onClick={() => setEditando(true)}>Editar mi perfil</button>}
            </div>
            {editando ? (
              <form class="formulario" onSubmit={guardarBio}>
                <label>Cuéntale al equipo en qué estás
                  <textarea rows={4} maxLength={300} value={bio} onInput={(e) => setBio((e.target as HTMLTextAreaElement).value)} />
                  <span class="ayuda">{bio.length} de 300 caracteres</span>
                </label>
                <fieldset>
                  <legend>Foto</legend>
                  <span class="ayuda">PNG, JPEG o WebP, hasta 100 KB.</span>
                  <div class="acciones" style={{ justifyContent: 'flex-start' }}>
                    <label class="casilla">
                      Elegir foto
                      <input class="visualmente-oculto" type="file" accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => subirFoto((e.target as HTMLInputElement).files?.[0])} />
                    </label>
                    {perfil.foto && <button type="button" onClick={quitarFoto}>Quitar foto</button>}
                  </div>
                </fieldset>
                <div class="acciones">
                  <button type="button" onClick={() => { setBio(perfil.bio); setEditando(false); }}>Cancelar</button>
                  <button type="submit" class="primario">Guardar</button>
                </div>
              </form>
            ) : (
              <p class={perfil.bio ? '' : 'apagado'}>{perfil.bio || (perfil.propio ? 'Aún no escribes tu presentación.' : 'Sin presentación.')}</p>
            )}
          </section>
          <section class="tarjeta" aria-labelledby="t-logros-perfil">
            <h2 id="t-logros-perfil" style={{ marginBottom: '12px' }}>Logros</h2>
            <p class="apagado">Los últimos logros de {perfil.propio ? 'tu trabajo' : 'esta persona'} aparecerán aquí con la Comunidad (Fase 7).</p>
          </section>
        </div>
        <div>
          <section class="tarjeta" aria-labelledby="t-marcas-perfil">
            <h2 id="t-marcas-perfil" style={{ marginBottom: '12px' }}>Marcas</h2>
            {perfil.marcas.length ? (
              <div class="chips">{perfil.marcas.map((m) => <span class="chip" key={m.id}><i style={{ background: m.color }} />{m.name}</span>)}</div>
            ) : <p class="apagado">Sin marcas en común contigo.</p>}
          </section>
        </div>
      </div>
    </section>
  );
};
