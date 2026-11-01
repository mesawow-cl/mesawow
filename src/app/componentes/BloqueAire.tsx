// Paso "Salida al aire" del formulario de tarea (mwAirInject del prototipo).
import { CANALES_AL_AIRE, esCanalDeAnuncios } from '../../shared/constantes';
import { horasDeSeries, NOMBRE_POR_CANAL, piezasDeSerie, PLANTILLAS_SERIE, plazoPropuesto, type Serie } from '../../shared/dominio/aire';
import { hoySantiago } from '../../shared/fechas';
import { fechaCorta } from '../datos';

export interface EstadoAire { activo: boolean; reservar: boolean; series: Serie[]; sueltas: { id?: string; channel: string; at: string }[] }
export const aireVacio = (): EstadoAire => ({ activo: false, reservar: true, series: [], sueltas: [] });

const DIAS = [['1', 'L'], ['2', 'M'], ['3', 'X'], ['4', 'J'], ['5', 'V'], ['6', 'S'], ['0', 'D']] as const;
const valor = (e: Event) => (e.target as HTMLInputElement).value;
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const primeraSalida = (a: EstadoAire) =>
  a.activo ? [...a.series.flatMap((s) => piezasDeSerie(s).map((p) => p.at)), ...a.sueltas.map((s) => s.at)].filter(Boolean).sort()[0] ?? null : null;

export const BloqueAire = ({ aire, alCambiar, plazo }: { aire: EstadoAire; alCambiar: (a: EstadoAire) => void; plazo: string }) => {
  const cambiarSerie = (i: number, c: Partial<Serie>) => alCambiar({ ...aire, series: aire.series.map((s, j) => (j === i ? { ...s, ...c } : s)) });
  const agregar = (k: keyof typeof PLANTILLAS_SERIE) =>
    alCambiar({ ...aire, series: [...aire.series, { ...PLANTILLAS_SERIE[k], from: aire.series.at(-1)?.from ?? sumarDias(hoySantiago(), 7) }] });
  const piezas = aire.series.reduce((n, s) => n + piezasDeSerie(s).length, 0) + aire.sueltas.length;
  const horas = horasDeSeries(aire.series);
  const primera = primeraSalida(aire);
  const propuesto = primera ? plazoPropuesto(primera, hoySantiago()) : null;
  return (
    <>
      <label class="casilla" style={{ justifySelf: 'start' }}>
        <input type="checkbox" checked={aire.activo} onChange={(e) => alCambiar({ ...aire, activo: (e.target as HTMLInputElement).checked })} /> Esta tarea sale al aire
      </label>
      {!aire.activo ? <p class="ayuda">Márcalo si el trabajo termina en publicaciones, mails o anuncios con fecha. La fecha de salida manda: mesawow propone la fecha límite con 2 días de revisión.</p> : (
        <>
          <div class="persona-acciones">
            <span class="ayuda">Agregar serie:</span>
            <button type="button" onClick={() => agregar('mail')}>＋ Mails</button>
            <button type="button" onClick={() => agregar('organico')}>＋ Orgánico</button>
            <button type="button" onClick={() => agregar('ads')}>＋ Anuncios</button>
          </div>
          {aire.series.map((s, i) => {
            const n = piezasDeSerie(s).length;
            return (
              <fieldset key={i} class="serie">
                <legend>Serie {i + 1} · {n} pieza(s) · {n * s.hours} h</legend>
                <div class="dos">
                  <label>Canal<select value={s.channel} onChange={(e) => {
                    const canal = valor(e);
                    const ads = esCanalDeAnuncios(canal);
                    cambiarSerie(i, { channel: canal, mode: ads ? 'periodo' : 'dias', name: s.name === NOMBRE_POR_CANAL(s.channel) ? NOMBRE_POR_CANAL(canal) : s.name, count: s.count ?? 3 });
                  }}>{CANALES_AL_AIRE.map((c) => <option key={c}>{c}</option>)}</select></label>
                  <label>Nombre de la pieza<input value={s.name} maxLength={60} onInput={(e) => cambiarSerie(i, { name: valor(e) })} /></label>
                </div>
                {s.mode === 'dias' ? (
                  <>
                    <div class="dias-serie" role="group" aria-label="Días de publicación">
                      {DIAS.map(([v, t]) => (
                        <label key={v}><input type="checkbox" checked={s.days.includes(v)} aria-label={['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][+v]}
                          onChange={(e) => cambiarSerie(i, { days: (e.target as HTMLInputElement).checked ? [...s.days, v] : s.days.filter((x) => x !== v) })} /><span>{t}</span></label>
                      ))}
                    </div>
                    <div class="dos">
                      <label>Hora<input type="time" required value={s.time} onInput={(e) => cambiarSerie(i, { time: valor(e) })} /></label>
                      <label>Desde<input type="date" required value={s.from} onInput={(e) => cambiarSerie(i, { from: valor(e) })} /></label>
                    </div>
                  </>
                ) : (
                  <div class="dos">
                    <label>Fecha de activación<input type="date" required value={s.from} onInput={(e) => cambiarSerie(i, { from: valor(e) })} /></label>
                    <label>Creatividades<input type="number" min={1} max={50} required value={s.count ?? 3} onInput={(e) => cambiarSerie(i, { count: Number(valor(e)) })} /></label>
                  </div>
                )}
                <div class="dos">
                  <label>Semanas<input type="number" min={1} max={52} required value={s.weeks} onInput={(e) => cambiarSerie(i, { weeks: Number(valor(e)) })} /></label>
                  <label>Horas de trabajo por pieza<input type="number" min={0} step={0.25} required value={s.hours} onInput={(e) => cambiarSerie(i, { hours: Number(valor(e)) })} /></label>
                </div>
                <button type="button" class="enlace" onClick={() => alCambiar({ ...aire, series: aire.series.filter((_, j) => j !== i) })}>Quitar serie</button>
              </fieldset>
            );
          })}
          <fieldset>
            <legend>Salidas sueltas</legend>
            {aire.sueltas.map((s, i) => (
              <div class="dos" key={i}>
                <label>Canal<select value={s.channel} onChange={(e) => alCambiar({ ...aire, sueltas: aire.sueltas.map((x, j) => (j === i ? { ...x, channel: valor(e) } : x)) })}>
                  {CANALES_AL_AIRE.map((c) => <option key={c}>{c}</option>)}</select></label>
                <label>Fecha y hora<span class="enlace-copiable"><input type="datetime-local" required value={s.at} onInput={(e) => alCambiar({ ...aire, sueltas: aire.sueltas.map((x, j) => (j === i ? { ...x, at: valor(e) } : x)) })} />
                  <button type="button" aria-label="Quitar salida" onClick={() => alCambiar({ ...aire, sueltas: aire.sueltas.filter((_, j) => j !== i) })}>✕</button></span></label>
              </div>
            ))}
            <button type="button" class="mas-opciones" onClick={() => alCambiar({ ...aire, sueltas: [...aire.sueltas, { channel: 'Instagram', at: `${primera?.slice(0, 10) ?? sumarDias(plazo > hoySantiago() ? plazo : hoySantiago(), 2)}T10:00` }] })}>＋ Salida suelta</button>
          </fieldset>
          <label class="casilla" style={{ justifySelf: 'start' }}>
            <input type="checkbox" checked={aire.reservar} onChange={(e) => alCambiar({ ...aire, reservar: (e.target as HTMLInputElement).checked })} /> Reservar las horas de trabajo en el calendario de la persona responsable
          </label>
          <p class="resumen-aire" role="status">
            Total: <strong>{piezas} pieza(s) al aire</strong>{horas > 0 && <> · <strong>{horas} h de trabajo</strong></>}
            {primera && <> · primera salida el {fechaCorta(primera.slice(0, 10))} a las {primera.slice(11)}. Fecha límite de trabajo propuesta: <strong>{fechaCorta(propuesto!)}</strong> (2 días de revisión).</>}
          </p>
        </>
      )}
    </>
  );
};
