// Generadores de trabajo (§5.7): campaña 360 de tres meses, webinar, trabajos del catálogo,
// y propuesta semanal de sprints. Funciones puras: devuelven tareas con claves locales.
import { TOPE_CARGA_SPRINT } from '../constantes.ts';
import { type PasoPlantilla, CATALOGO_SERVICIOS, pasosDeServicio } from '../catalogo.ts';
import { aMinuto, aPared, asignar, esLaboral, minutosPorDia, SinDisponibilidad, type ConfigJornada, type Rango } from './agenda.ts';
import { PROTOCOLO_TRIMESTRAL, PROTOCOLO_WEBINAR } from './protocolos-datos.ts';

export type Rol = 'Marketing' | 'Comercial' | 'Coordinación' | 'Diseño' | 'Operación' | 'Revisión';

export interface TareaGenerada {
  clave: string; titulo: string; area: string; descripcion: string; entregable: string; criterio: string;
  inicio: string; plazo: string; horas: number; herramienta: string; dependencias: string[]; rol: Rol;
  paso: number | null; eventoFijo?: boolean; inputsListos: boolean; complejidad: 'Media' | 'Alta';
}

/** campaignDate del prototipo: mismo día del mes `meses` después (acotado al último día) y luego `dias` corridos. */
export const fechaCampana = (inicio: string, meses = 0, dias = 0) => {
  const [y, m, d] = inicio.split('-').map(Number) as [number, number, number];
  const ultimo = new Date(Date.UTC(y, m - 1 + meses + 1, 0)).getUTCDate();
  const f = new Date(Date.UTC(y, m - 1 + meses, Math.min(d, ultimo)));
  f.setUTCDate(f.getUTCDate() + dias);
  return f.toISOString().slice(0, 10);
};

/** webinarDay: ± días hábiles (lunes a viernes, sin considerar feriados, como el prototipo). */
export const diaHabil = (fecha: string, desplazamiento: number) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  let n = Math.abs(desplazamiento);
  const paso = Math.sign(desplazamiento);
  while (n) { d.setUTCDate(d.getUTCDate() + paso); if (![0, 6].includes(d.getUTCDay())) n--; }
  return d.toISOString().slice(0, 10);
};

const complejidad = (h: number) => (h >= 5 ? 'Alta' : 'Media');
const servicio = (clave: string) => CATALOGO_SERVICIOS.find((s) => s[0] === clave)!;

export interface Alcance360 { organic: number; video: number; email: number; ads: number }
export const ALCANCE_POR_DEFECTO: Alcance360 = { organic: 12, video: 4, email: 4, ads: 4 };

/** Campaña 360 (protocolo "360-2"): 8 pasos de preparación, públicos y landing, unidades mensuales y cierre. */
export const generar360 = (p: { inicio: string; alcance: Alcance360; canales: string[]; inputsListos: boolean }): TareaGenerada[] => {
  const t: TareaGenerada[] = [];
  const herramientaPrep = (titulo: string) => (titulo.includes('base') ? 'Brevo' : titulo.includes('medición') ? 'GA4 / Meta' : 'ChatGPT');
  PROTOCOLO_TRIMESTRAL.slice(0, 8).forEach(([titulo, area, mes, a, b, criterio], i) => {
    const dependencias = i === 5 || i === 6 ? ['p3'] : i === 7 ? ['p4', 'p5', 'p6'] : i ? [`p${i - 1}`] : [];
    t.push({
      clave: `p${i}`, titulo, area, criterio, entregable: criterio,
      descripcion: `${criterio}\nPlataformas: ${p.canales.join(', ')}. Registrar evidencia y solicitar revisión antes de avanzar.`,
      inicio: fechaCampana(p.inicio, mes, a), plazo: fechaCampana(p.inicio, mes, b), horas: 3, herramienta: herramientaPrep(titulo),
      dependencias, rol: area === 'Comercial' ? 'Comercial' : 'Marketing', paso: i, inputsListos: p.inputsListos, complejidad: 'Media',
    });
  });
  const padre = 'p7';
  for (const [clave, etiqueta] of [['audiences', 'Públicos de Meta'], ['landing', 'Landing de captación']] as const) {
    let previa = padre;
    servicio(clave)[2].forEach(([titulo, horas, herramienta], i) => {
      const k = `${clave}${i}`;
      t.push({
        clave: k, titulo: `${etiqueta} · ${titulo}`, area: 'Marketing', descripcion: `${titulo} en ${herramienta}. Registrar evidencia.`, entregable: titulo,
        criterio: 'Resultado completo, revisado y aprobado.', inicio: p.inicio, plazo: fechaCampana(p.inicio, 0, 14), horas, herramienta,
        dependencias: [previa], rol: 'Marketing', paso: null, inputsListos: p.inputsListos, complejidad: complejidad(horas),
      });
      previa = k;
    });
  }
  for (let mes = 0; mes < 3; mes++) {
    const inicio = fechaCampana(p.inicio, mes), plazo = fechaCampana(p.inicio, mes + 1, -1);
    for (const [clave, cantidad] of [['organic', p.alcance.organic], ['video', p.alcance.video], ['email', p.alcance.email], ['graphic', p.alcance.ads]] as const) {
      const s = servicio(clave);
      for (let u = 0; u < cantidad; u++) {
        let previa = padre;
        s[2].forEach(([titulo, horas, herr], i) => {
          const herramienta = clave === 'graphic' ? 'Canva' : herr;
          const k = `m${mes}-${clave}${u}-${i}`;
          t.push({
            clave: k, titulo: `Mes ${mes + 1} · ${clave === 'graphic' ? 'Pieza de campaña' : s[1]} ${u + 1} · ${titulo}`, area: 'Marketing',
            descripcion: `${titulo} en ${herramienta}. Registrar editable y resultado final.`, entregable: titulo, criterio: 'Revisión aprobada y evidencia accesible.',
            inicio, plazo, horas, herramienta, dependencias: [previa], rol: 'Marketing', paso: null, inputsListos: p.inputsListos, complejidad: complejidad(horas),
          });
          previa = k;
        });
      }
    }
    for (const [i, titulo] of ['Configurar y aprobar Meta Ads / Google Ads', 'Optimizar pauta y registrar pruebas', 'Informe mensual y calidad comercial'].entries()) {
      t.push({
        clave: `m${mes}-fija${i}`, titulo: `Mes ${mes + 1} · ${titulo}`, area: 'Marketing', descripcion: titulo, entregable: 'Configuración o informe con evidencia',
        criterio: 'Revisión aprobada y evidencia accesible.', inicio, plazo, horas: 3,
        herramienta: titulo.includes('Informe') ? 'Canva / GA4 / Meta' : 'Meta Ads / Google Ads', dependencias: [padre], rol: 'Marketing', paso: null,
        inputsListos: p.inputsListos, complejidad: 'Media',
      });
    }
  }
  const [tc, , mc, ac, bc, cc] = PROTOCOLO_TRIMESTRAL[32]!;
  t.push({
    clave: 'p32', titulo: tc, area: 'Marketing', criterio: cc, entregable: cc, descripcion: `${cc}\nPlataformas: ${p.canales.join(', ')}. Registrar evidencia y solicitar revisión antes de avanzar.`,
    inicio: fechaCampana(p.inicio, mc, ac), plazo: fechaCampana(p.inicio, mc, bc), horas: 3, herramienta: 'Canva',
    dependencias: t.map((x) => x.clave), rol: 'Marketing', paso: 32, inputsListos: p.inputsListos, complejidad: 'Media',
  });
  return t;
};

/** Webinar (protocolo "webinar-1"): 31 tareas desde 20 días hábiles antes hasta 5 después del evento. */
export const generarWebinar = (p: { fechaEvento: string; minutos: number; plataforma: string; canales: string[] }): TareaGenerada[] =>
  PROTOCOLO_WEBINAR.map(([titulo, desplazamiento, horasBase, area, deps, criterio], i) => {
    const horas = i === 24 ? p.minutos / 60 : horasBase;
    const dia = i === 22 ? fechaCampana(p.fechaEvento, 0, -1) : diaHabil(p.fechaEvento, desplazamiento);
    const herramienta = titulo.includes('presentación') || titulo.includes('gráficas') ? 'Canva' : titulo.includes('HTML') ? 'ChatGPT'
      : titulo.includes('Meta') ? 'Meta Ads' : titulo.includes('orgánico') ? 'Meta Business Suite' : titulo.includes('grabación') ? 'CapCut' : p.plataforma;
    return {
      clave: `w${i}`, titulo, area, criterio, entregable: criterio, descripcion: `${criterio}\nRegistrar avances y evidencia. Plataformas: ${p.canales.join(', ')}`,
      inicio: dia, plazo: dia, horas, herramienta, dependencias: deps.map((d) => `w${d}`), rol: area as Rol, paso: i, eventoFijo: i === 24,
      inputsListos: false, complejidad: complejidad(horas),
    };
  });

/** Trabajo del catálogo o de una plantilla: una cadena de pasos por unidad. Los pasos de revisión los hace el revisor. */
export const generarTrabajo = (p: { titulo: string; pasos: PasoPlantilla[]; cantidad: number; inicio: string; plazo: string; inputsListos: boolean }): TareaGenerada[] => {
  const t: TareaGenerada[] = [];
  for (let u = 0; u < p.cantidad; u++) {
    p.pasos.forEach((s, i) => {
      const prefijo = `${p.titulo}${p.cantidad > 1 ? ` · Unidad ${u + 1}` : ''}`;
      t.push({
        clave: `u${u}-${i}`, titulo: `${prefijo} · ${s.title}`, area: 'Marketing', descripcion: s.instruction || `${s.title} en ${s.tool}. Registrar evidencia.`,
        entregable: s.deliverable || s.title, criterio: s.acceptance || 'Revisión aprobada y evidencia accesible.', inicio: p.inicio, plazo: p.plazo,
        horas: s.hours, herramienta: s.tool, dependencias: s.dependency ? [`u${u}-${s.dependency - 1}`] : [],
        rol: s.role === 'review' ? 'Revisión' : 'Marketing', paso: i, inputsListos: p.inputsListos, complejidad: complejidad(s.hours),
      });
    });
  }
  return t;
};

export const pasosDelCatalogo = (clave: string) => {
  const s = CATALOGO_SERVICIOS.find((x) => x[0] === clave);
  return s ? pasosDeServicio(s) : null;
};

// ─────────────────────────────── propuesta semanal (§5.7)

export interface TareaPlanificable {
  id: string; titulo: string; responsable: string | null; responsableTieneMarca: boolean; horas: number; plazo: string; prioridad: string;
  bloqueada: boolean; inputsListos: boolean; sprintIniciado: boolean; dependencias: string[];
}
export interface Propuesta { id: string; semana: string; bloques: Rango[]; fin: number; tarde: boolean }
export interface Problema { id: string; motivo: string }

const VALOR: Record<string, number> = { Urgente: 4, Alta: 3, Media: 2, Baja: 1 };
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lunesDe = (f: string) => sumarDias(f, -((new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7));

/**
 * Propone en qué semana se hace cada tarea: debe caber entera en una semana sin pasar el 80 % de la capacidad neta
 * (días × jornada − reuniones), sumando lo ya reservado. Busca hasta 26 semanas desde `desde` o el término de sus dependencias.
 */
export const proponerSemanas = (p: {
  tareas: TareaPlanificable[]; hechas: ReadonlySet<string>; terminos: ReadonlyMap<string, number>;
  reuniones: ReadonlyMap<string, Rango[]>; reservado: ReadonlyMap<string, Rango[]>; cfg: ConfigJornada; desde: string;
}) => {
  const porId = new Map(p.tareas.map((t) => [t.id, t]));
  // La prioridad de una tarea sube a la de quienes dependen de ella.
  const rango = new Map(p.tareas.map((t) => [t.id, VALOR[t.prioridad] ?? 2]));
  for (let vuelta = 0, cambio = true; cambio && vuelta < p.tareas.length * 6; vuelta++) {
    cambio = false;
    for (const t of p.tareas) for (const d of t.dependencias) {
      if (porId.has(d) && rango.get(d)! < rango.get(t.id)!) { rango.set(d, rango.get(t.id)!); cambio = true; }
    }
  }
  const orden = [...p.tareas].sort((a, b) => rango.get(b.id)! - rango.get(a.id)! || a.dependencias.length - b.dependencias.length || a.plazo.localeCompare(b.plazo) || a.id.localeCompare(b.id));
  const ocupado = new Map<string, Rango[]>([...p.reservado].map(([k, v]) => [k, [...v]]));
  const fin = new Map(p.terminos);
  const propuestas: Propuesta[] = [], problemas: Problema[] = [];
  const pendientes = [...orden];
  // Varias pasadas: una tarea espera a que sus dependencias tengan término.
  for (let pasada = 0; pasada < 3 && pendientes.length; pasada++) {
    for (const t of [...pendientes]) {
      const problema = t.sprintIniciado ? 'Sprint iniciado o cerrado: cambio explícito de alcance requerido.'
        : !t.responsable || !t.responsableTieneMarca ? 'Responsable sin asignar o sin acceso a la marca.'
        : t.bloqueada ? 'Bloqueo pendiente.' : !t.inputsListos ? 'Inputs sin validar.' : !(t.horas > 0) ? 'Falta la estimación de horas.' : null;
      if (problema) { problemas.push({ id: t.id, motivo: problema }); pendientes.splice(pendientes.indexOf(t), 1); continue; }
      const inexistente = t.dependencias.find((d) => !porId.has(d) && !p.hechas.has(d) && !fin.has(d));
      if (inexistente) { problemas.push({ id: t.id, motivo: 'Dependencia inexistente.' }); pendientes.splice(pendientes.indexOf(t), 1); continue; }
      const sinTermino = t.dependencias.filter((d) => !p.hechas.has(d) && !fin.has(d));
      if (sinTermino.length) continue;
      let desde = aMinuto(`${p.desde}T00:00`);
      for (const d of t.dependencias) if (fin.has(d)) desde = Math.max(desde, fin.get(d)!);
      const persona = t.responsable!;
      const minutos = Math.round(t.horas * 60);
      let semana = lunesDe(aPared(desde).slice(0, 10));
      let lograda: Propuesta | null = null;
      for (let s = 0; s < 26 && !lograda; s++, semana = sumarDias(semana, 7)) {
        const dias = [0, 1, 2, 3, 4].map((i) => sumarDias(semana, i)).filter((d) => esLaboral(d, p.cfg));
        const ini = aMinuto(`${semana}T00:00`), finSemana = aMinuto(`${sumarDias(semana, 4)}T23:59`);
        const dentro = (r: Rango) => r.fin > ini && r.inicio < finSemana;
        const reuniones = (p.reuniones.get(persona) ?? []).filter(dentro);
        const reservado = (ocupado.get(persona) ?? []).filter(dentro);
        const neta = dias.length * minutosPorDia(p.cfg) - reuniones.reduce((n, r) => n + (r.fin - r.inicio), 0);
        const usado = reservado.reduce((n, r) => n + (Math.min(r.fin, finSemana) - Math.max(r.inicio, ini)), 0);
        if (usado + minutos > neta * TOPE_CARGA_SPRINT) continue;
        try {
          const r = asignar(Math.max(desde, ini), minutos, [...reuniones, ...reservado], p.cfg);
          if (r.fin > aMinuto(`${sumarDias(semana, 4)}T23:59`)) continue;
          lograda = { id: t.id, semana, bloques: r.bloques, fin: r.fin, tarde: aPared(r.fin).slice(0, 10) > t.plazo };
        } catch (e) { if (!(e instanceof SinDisponibilidad)) throw e; }
      }
      pendientes.splice(pendientes.indexOf(t), 1);
      if (!lograda) { problemas.push({ id: t.id, motivo: 'No cabe en un sprint: dividir el entregable o revisar capacidad.' }); continue; }
      propuestas.push(lograda);
      ocupado.set(persona, [...(ocupado.get(persona) ?? []), ...lograda.bloques]);
      fin.set(t.id, lograda.fin);
    }
  }
  for (const t of pendientes) problemas.push({ id: t.id, motivo: 'Dependencias pendientes o ciclo: se mantiene sin comprometer.' });
  return { propuestas, problemas };
};
