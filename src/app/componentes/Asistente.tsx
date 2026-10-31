// Formulario por pasos (mwWizard del prototipo): chips de pasos, Atrás / Siguiente, "Paso i de n".
// Cada paso se valida al avanzar; al enviar se validan todos.
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';

export interface Paso { titulo: string; contenido: ComponentChildren }

export const Asistente = ({ pasos, alEnviar, textoEnviar, enviando, error, pasoInicial = 0 }: {
  pasos: Paso[];
  alEnviar: () => void;
  textoEnviar: string;
  enviando?: boolean;
  error?: string;
  pasoInicial?: number;
}) => {
  const [actual, setActual] = useState(pasoInicial);
  const ref = useRef<HTMLFormElement>(null);

  /** Valida los campos del paso `i` y muestra el mensaje del primero inválido. */
  const valido = (i: number) => {
    const campos = ref.current?.querySelectorAll<HTMLInputElement>(`[data-paso="${i}"] :is(input, select, textarea)`) ?? [];
    for (const c of campos) if (!c.checkValidity()) { setActual(i); requestAnimationFrame(() => c.reportValidity()); return false; }
    return true;
  };
  const ir = (i: number) => {
    for (let k = actual; k < i; k++) if (!valido(k)) return;
    setActual(i);
  };
  const enviar = (e: Event) => {
    e.preventDefault();
    if (actual < pasos.length - 1) { ir(actual + 1); return; }
    for (let k = 0; k < pasos.length; k++) if (!valido(k)) return;
    alEnviar();
  };

  return (
    <form ref={ref} class="formulario" onSubmit={enviar} noValidate>
      <div class="pasos" role="list">
        {pasos.map((p, i) => (
          <button type="button" role="listitem" key={p.titulo} class={i < actual ? 'hecho' : ''}
            aria-current={i === actual ? 'step' : undefined} onClick={() => (i < actual ? setActual(i) : ir(i))}>
            <span class="n">{i < actual ? '✓' : i + 1}</span><span class="t">{p.titulo}</span>
          </button>
        ))}
      </div>
      {pasos.map((p, i) => (
        <div key={p.titulo} data-paso={i} hidden={i !== actual} class="formulario">{p.contenido}</div>
      ))}
      {error && <p class="error-form" role="alert">{error}</p>}
      <div class="paso-pie">
        <button type="button" onClick={() => setActual(Math.max(0, actual - 1))} disabled={actual === 0}>Atrás</button>
        <span class="apagado">Paso {actual + 1} de {pasos.length}</span>
        {actual < pasos.length - 1
          ? <button type="submit" class="primario">Siguiente</button>
          : <button type="submit" class="primario" disabled={enviando}>{textoEnviar}</button>}
      </div>
    </form>
  );
};
