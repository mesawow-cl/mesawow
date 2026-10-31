// Catálogo de servicios (SERVICE_CATALOG del prototipo · líneas 777–790 y 953–954).
// Cada paso: [título, horas, herramienta]. Los pasos de "Revisión" o "Aprobar" los hace el revisor.

export type PasoCatalogo = readonly [titulo: string, horas: number, herramienta: string];
export type ServicioCatalogo = readonly [clave: string, nombre: string, pasos: readonly PasoCatalogo[]];

export const CATALOGO_SERVICIOS: readonly ServicioCatalogo[] = [
  ['presentation', 'Presentación Canva', [['Brief y materiales', 2, 'ChatGPT'], ['Guion y textos', 4, 'ChatGPT'], ['Diseñar presentación', 6, 'Canva'], ['Revisión y ajustes', 3, 'Canva'], ['Aprobar y entregar editable y PDF', 1, 'Canva']]],
  ['interactive', 'Presentación interactiva Canva', [['Brief y rutas', 3, 'Canva'], ['Guion navegable', 4, 'ChatGPT'], ['Diseño de pantallas', 8, 'Canva'], ['Enlaces y navegación interactiva', 5, 'Canva'], ['Pruebas revisión y entrega', 4, 'Canva']]],
  ['organic', 'Contenido orgánico', [['Brief y objetivo', 1, 'ChatGPT'], ['Copy y CTA', 2, 'ChatGPT'], ['Diseño de pieza', 3, 'Canva'], ['Revisión y ajustes', 1, 'Canva'], ['Aprobar y programar publicación', 1, 'Meta Business Suite'], ['Registrar publicación y métricas', 1, 'Meta Business Suite']]],
  ['video', 'Video o reel', [['Brief y guion', 2, 'ChatGPT'], ['Material y grabación', 3, 'Cámara'], ['Edición y subtítulos', 4, 'CapCut'], ['Revisión y ajustes', 2, 'CapCut'], ['Aprobar y programar', 1, 'Meta Business Suite']]],
  ['graphic', 'Elemento gráfico', [['Brief y referencias', 1, 'ChatGPT'], ['Diseño editable', 4, 'Illustrator'], ['Revisión y ajustes', 2, 'Illustrator'], ['Aprobar y exportar formatos', 1, 'Illustrator']]],
  ['email', 'Mailing o newsletter HTML', [['Brief y revisión de base', 2, 'Brevo'], ['Segmentación y exclusiones', 2, 'Brevo'], ['Asunto preheader copy y HTML móvil', 3, 'ChatGPT'], ['Revisión de HTML y enlaces', 1, 'ChatGPT'], ['Configurar y probar envío', 2, 'Brevo'], ['Aprobar y programar', 1, 'Brevo'], ['Informe de entrega y resultados', 1, 'Brevo']]],
  ['landing', 'Landing de captación', [['Brief oferta y campos', 2, 'ChatGPT'], ['Estructura y textos', 4, 'ChatGPT'], ['Diseño móvil y escritorio', 5, 'Canva'], ['Desarrollo de página', 8, 'Plataforma web de la marca'], ['Formulario GA4 Meta y UTMs', 4, 'GA4 / Meta'], ['QA aprobación y publicación', 4, 'Plataforma web de la marca']]],
  ['web', 'Sitio web institucional', [['Levantamiento', 4, 'ChatGPT'], ['Arquitectura y alcance', 4, 'ChatGPT'], ['Contenidos', 8, 'ChatGPT'], ['Diseño de páginas', 8, 'Canva'], ['Desarrollo inicio', 8, 'Plataforma web de la marca'], ['Desarrollo páginas internas', 8, 'Plataforma web de la marca'], ['Formularios y medición', 6, 'GA4 / Meta'], ['QA móvil revisión y aprobación', 6, 'Navegador'], ['Publicación y entrega', 2, 'Plataforma web de la marca']]],
  ['platform', 'Plataforma tecnológica', [['Descubrir usuarios y problema', 8, 'ChatGPT'], ['Requerimientos y roles', 8, 'ChatGPT'], ['Flujos y datos', 8, 'ChatGPT'], ['Prototipo primera entrega', 8, 'Desarrollo web'], ['Prototipo segunda entrega', 8, 'Desarrollo web'], ['Validación y alcance de desarrollo', 8, 'Navegador']]],
  ['audiences', 'Públicos de Meta', [['Objetivo públicos y fuentes autorizadas', 2, 'Meta Ads'], ['Auditar fuentes y permisos', 2, 'Meta Ads'], ['Crear captación y personalizados', 3, 'Meta Ads · Públicos'], ['Remarketing similares y exclusiones', 3, 'Meta Ads · Públicos'], ['Validar y documentar públicos', 2, 'Meta Ads · Públicos']]],
  ['measurement', 'Medición digital', [['Objetivos y mapa de eventos', 3, 'GA4 / Meta'], ['Auditar configuración', 3, 'Google Tag Manager'], ['Configurar eventos y conversiones', 5, 'GA4 / Meta'], ['Pruebas y evidencia', 3, 'GA4 / Meta'], ['Aprobar y documentar', 2, 'ChatGPT']]],
  ['report', 'Informe de resultados', [['Recopilar datos', 2, 'GA4 / Meta / Brevo'], ['Validar fuentes', 2, 'GA4 / Meta'], ['Análisis y recomendaciones', 3, 'ChatGPT'], ['Presentación de resultados', 2, 'Canva'], ['Revisión y acuerdos', 1, 'Canva']]],
  ['branding', 'Sistema de marca y plantillas', [['Descubrimiento y diagnóstico', 4, 'ChatGPT'], ['Estrategia y voz de marca', 6, 'ChatGPT'], ['Identidad visual y editables', 12, 'Illustrator'], ['Revisión de identidad', 4, 'Canva'], ['Manual y brandboard', 8, 'Canva'], ['Plantillas y recursos descargables', 8, 'Canva']]],
  ['transactional', 'Correo transaccional HTML', [['Definir disparador y reglas', 2, 'ChatGPT'], ['Asunto texto y HTML móvil', 3, 'ChatGPT'], ['Revisión de contenido', 1, 'Canva'], ['Configurar envío e idempotencia', 3, 'Plataforma web de la marca'], ['Pruebas y aprobación', 2, 'Navegador'], ['Documentar y entregar', 1, 'ChatGPT']]],
];

export interface PasoPlantilla {
  title: string;
  hours: number;
  tool: string;
  instruction: string;
  deliverable: string;
  acceptance: string;
  /** 0 = sin dependencia; n = depende del paso n (1-based). */
  dependency: number;
  role: 'execute' | 'review';
}

/** Convierte un servicio del catálogo al formato de pasos de plantilla (cadena secuencial). */
export const pasosDeServicio = (s: ServicioCatalogo): PasoPlantilla[] =>
  s[2].map(([title, hours, tool], i) => ({
    title,
    hours,
    tool,
    instruction: '',
    deliverable: '',
    acceptance: 'Revisión aprobada y evidencia accesible.',
    dependency: i,
    role: /Revisión|Aprobar/.test(title) ? 'review' : 'execute',
  }));

export const horasDeServicio = (s: ServicioCatalogo) => s[2].reduce((t, [, h]) => t + h, 0);
