import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icono } from './Icono';

/** Diálogo nativo: foco atrapado y Escape del navegador; hoja inferior en el teléfono. */
export const Dialogo = ({ titulo, abierto, alCerrar, children }: {
  titulo: string;
  abierto: boolean;
  alCerrar: () => void;
  children: ComponentChildren;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog ref={ref} aria-labelledby="dialogo-titulo" onClose={alCerrar}
      onClick={(e) => { if (e.target === ref.current) alCerrar(); }}>
      <div class="dialogo-cabeza">
        <h2 id="dialogo-titulo">{titulo}</h2>
        <button type="button" class="icono-btn" aria-label="Cerrar" onClick={alCerrar}><Icono nombre="x" /></button>
      </div>
      <div class="dialogo-cuerpo">{children}</div>
    </dialog>
  );
};
