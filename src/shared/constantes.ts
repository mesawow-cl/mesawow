// Constantes de negocio compartidas por el Worker y la app.
// Fuente: docs/requerimiento-mesawow.md (y prototipo/mesawow.html donde se indica).

export const ZONA_HORARIA = 'America/Santiago';

/** Jornada laboral (D6): lunes a viernes, 09:00–14:00 y 15:00–18:00. Minutos desde medianoche. */
export const JORNADA_POR_DEFECTO = [
  { inicio: 9 * 60, fin: 14 * 60 },
  { inicio: 15 * 60, fin: 18 * 60 },
] as const;

/** Días de revisión antes de la primera salida al aire (MW_AIR_REVIEW_DAYS). */
export const DIAS_REVISION_AIRE = 2;

/** Capacidad semanal de referencia en "Semana del equipo". */
export const HORAS_SEMANA_EQUIPO = 40;

/** Tope de carga de un sprint sobre la capacidad disponible. */
export const TOPE_CARGA_SPRINT = 0.8;

export const MINIMOS_DE_MARCA = [
  'Definición y propuesta de valor',
  'Voz y tono de marca',
  'Identidad visual completa',
  'Manual de marca',
  'Brandboard',
  'Plantilla de presentación descargable',
  'Presentación institucional',
  'Materiales acordados con Comercial',
  'Plantillas de correos transaccionales',
  'Plantillas de mailing',
  'Plantillas de newsletter',
  'Página web funcional',
  'Experiencia móvil tipo aplicación',
  'Redes según perfil de marca',
  'Plantillas de contenido social',
  'Contenido orgánico misceláneo',
  'Google Analytics verificado',
  'Meta y eventos verificados',
  'Atención y respaldo de confianza',
  'Documentos del servicio',
  'Recursos editables y descargables',
] as const;

export const ESTADOS_MINIMO = ['Pendiente de verificar', 'Vigente', 'Incompleto', 'Desactualizado', 'Faltante'] as const;

export const MESAS_POR_DEFECTO = [
  'Dirección',
  'Marketing',
  'Comercial y Ventas',
  'Operaciones',
  'TI',
  'Finanzas',
  'Contabilidad',
  'Legal',
] as const;

export const PLATAFORMAS = [
  'Brevo',
  'Meta Ads',
  'Google Ads',
  'Meta Business Suite',
  'YouTube Studio',
  'Google Analytics',
  'Meta Eventos',
] as const;

export const CANALES_AL_AIRE = [
  'Instagram',
  'Facebook',
  'TikTok',
  'LinkedIn',
  'YouTube',
  'Correo (Brevo)',
  'WhatsApp',
  'Sitio web',
  'Meta Ads',
  'Google Ads',
  'TikTok Ads',
  'LinkedIn Ads',
  'Prensa y medios',
] as const;
export type CanalAlAire = (typeof CANALES_AL_AIRE)[number];

export const esCanalDeAnuncios = (canal: string) => /Ads$/.test(canal);

export const ESTADOS_TAREA = [
  'Pendiente',
  'En curso',
  'Entregada para revisión',
  'Ajustes solicitados',
  'Aprobada',
  'Completada',
] as const;
export type EstadoTarea = (typeof ESTADOS_TAREA)[number];

export const tareaHecha = (estado: string) => estado === 'Aprobada' || estado === 'Completada';

export const ESTADOS_PIEZA = ['En la mesa', 'En riesgo', 'Lista para salir', 'Atrasada', 'Al aire'] as const;
