// Bases de contactos (§5.8): lectura de CSV, clasificación y exportación segura. Funciones puras.

export const MAX_CSV = 2 * 1024 * 1024;
export const ESTADOS_CONTACTO = ['Inválido', 'Baja', 'Duplicado', 'Pendiente de respaldo', 'Habilitado'] as const;
export type EstadoContacto = (typeof ESTADOS_CONTACTO)[number];

/** Lee un CSV con separador ';' o ',' (el que más aparezca en la primera línea) y comillas con "" escapadas. */
export const parsearCSV = (texto: string): string[][] => {
  const limpio = texto.replace(/^﻿/, '');
  const primera = limpio.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ',';
  const filas: string[][] = [];
  let fila: string[] = [], celda = '', comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i]!;
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') { celda += '"'; i++; }
      else if (ch === '"') comillas = false;
      else celda += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(celda); celda = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      if (fila.some((c) => c.trim())) filas.push(fila);
      fila = [];
    } else celda += ch;
  }
  if (comillas) throw new Error('El archivo tiene comillas sin cerrar.');
  fila.push(celda);
  if (fila.some((c) => c.trim())) filas.push(fila);
  return filas;
};

const COLUMNAS = {
  email: ['email', 'correo', 'e-mail'],
  name: ['nombre', 'name'],
  location: ['ubicacion', 'ubicación', 'ciudad', 'comuna'],
  interest: ['interes', 'interés', 'interest'],
  autorizado: ['autorizado', 'consentimiento', 'authorized'],
  baja: ['baja', 'unsubscribed'],
} as const;
const SI = new Set(['si', 'sí', 'true', '1']);
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Contacto { email: string; name: string; location: string; interest: string; status: EstadoContacto }
export interface Analisis { filas: Contacto[]; stats: { total: number; invalid: number; duplicates: number; excluded: number; pending: number; eligible: number } }

/** Clasifica cada fila: Inválido → Baja → Duplicado → Pendiente de respaldo → Habilitado. Una baja anula el mismo correo en todo el archivo. */
export const analizarContactos = (filas: string[][]): Analisis => {
  if (filas.length < 2) throw new Error('El archivo necesita una fila de títulos y al menos un contacto.');
  const titulos = filas[0]!.map((t) => t.trim().toLowerCase());
  const col = (k: keyof typeof COLUMNAS) => titulos.findIndex((t) => (COLUMNAS[k] as readonly string[]).includes(t));
  const iEmail = col('email');
  if (iEmail < 0) throw new Error('Falta la columna de correo (email o correo).');
  const [iNombre, iUbic, iInteres, iAut, iBaja] = [col('name'), col('location'), col('interest'), col('autorizado'), col('baja')];
  const celda = (f: string[], i: number) => (i >= 0 ? (f[i] ?? '').trim() : '');
  const vistos = new Set<string>();
  const salida: Contacto[] = filas.slice(1).map((f) => {
    const email = celda(f, iEmail).toLowerCase();
    const base = { email, name: celda(f, iNombre), location: celda(f, iUbic), interest: celda(f, iInteres) };
    let status: EstadoContacto;
    if (!CORREO.test(email)) status = 'Inválido';
    else if (SI.has(celda(f, iBaja).toLowerCase())) status = 'Baja';
    else if (vistos.has(email)) status = 'Duplicado';
    else if (iAut >= 0 && !SI.has(celda(f, iAut).toLowerCase())) status = 'Pendiente de respaldo';
    else status = 'Habilitado';
    if (CORREO.test(email)) vistos.add(email);
    return { ...base, status };
  });
  const bajas = new Set(salida.filter((c) => c.status === 'Baja').map((c) => c.email));
  for (const c of salida) if (c.status === 'Habilitado' && bajas.has(c.email)) c.status = 'Baja';
  const n = (s: EstadoContacto) => salida.filter((c) => c.status === s).length;
  return {
    filas: salida,
    stats: { total: salida.length, invalid: n('Inválido'), duplicates: n('Duplicado'), excluded: n('Baja'), pending: n('Pendiente de respaldo'), eligible: n('Habilitado') },
  };
};

/** Celda CSV segura: comillas y prefijo ' para evitar fórmulas (= + - @ tabulación o retorno). */
export const celdaCSV = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;

export const exportarCSV = (filas: { name: string; email: string; location: string; interest: string }[]) =>
  ['nombre,email,ubicacion,interes', ...filas.map((f) => [f.name, f.email, f.location, f.interest].map(celdaCSV).join(','))].join('\r\n');

// ─────────────────────────────── campañas (§5.3)

export interface CampanaRevision {
  objective: string; metric: string; target: string; segmentoContactos: number; segmentoMismaMarca: boolean;
  html: boolean; subject: string; sender: string; reply_to: string; tareasPendientes: number;
}

/** Checklist de aprobación de una versión de campaña (campaignChecks del prototipo). */
export const revisionDeCampana = (c: CampanaRevision) => [
  { item: 'Objetivo, indicador y meta definidos', ok: !!c.objective.trim() && !!c.metric.trim() && !!c.target.trim() && c.target.trim() !== 'Por definir' },
  { item: 'Segmento validado de la misma marca con contactos', ok: c.segmentoMismaMarca && c.segmentoContactos > 0 },
  { item: 'Contenido HTML y asunto listos', ok: c.html && !!c.subject.trim() },
  { item: 'Remitente y respuesta configurados', ok: !!c.sender.trim() && !!c.reply_to.trim() && c.sender !== 'Por configurar' && c.reply_to !== 'Por configurar' },
  { item: 'Tareas de la campaña terminadas', ok: c.tareasPendientes === 0 },
];
