import { useEffect, useState } from 'preact/hooks';
import { urlDeFoto } from '../api';
import { iniciales } from './Estructura';

/** Foto de la persona o sus iniciales. */
export const Avatar = ({ nombre, foto, grande }: { nombre: string; foto?: string | null; grande?: boolean }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    let creada: string | null = null;
    setUrl(null);
    if (foto) urlDeFoto(foto).then((u) => { creada = u; if (vivo) setUrl(u); });
    return () => { vivo = false; if (creada) URL.revokeObjectURL(creada); };
  }, [foto]);
  return (
    <span class={`avatar${grande ? ' grande' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" /> : iniciales(nombre)}
    </span>
  );
};
