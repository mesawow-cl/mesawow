// En qué fase se construye cada vista (docs/requerimiento-mesawow.md, plan de fases).
import type { Vista } from '../../shared/navegacion';

export const FASE_DE: Record<Exclude<Vista, 'more' | 'team' | 'profile' | 'tasks' | 'mesas' | 'brands' | 'agenda' | 'scrum' | 'campaigns' | 'library' | 'bases' | 'home' | 'gantt' | 'metro' | 'strategy'>, { fase: number; detalle: string }> = {
  muro: { fase: 3, detalle: 'Métricas, Tu día y Tus paneles con datos reales (Fase 3); actividad en vivo (Fase 5); Momento WOW y logros (Fase 7).' },
  plaza: { fase: 7, detalle: 'Logros automáticos del equipo, felicitaciones, comentarios y menciones.' },
  recognition: { fase: 7, detalle: 'Logros válidos por mesa, sin rankings, con resumen descargable.' },
  calendario: { fase: 4, detalle: 'Calendario de trabajo y calendario al aire: vista de mes, vista semanal tipo horario escolar y Semana del equipo.' },
  notifications: { fase: 6, detalle: 'Tus avisos por app, push, correo (Brevo) y WhatsApp, con su estado de entrega.' },
  preferences: { fase: 6, detalle: 'Cómo y cuándo quieres recibir avisos y resúmenes.' },
  aire: { fase: 4, detalle: 'Series y salidas al aire por canal, con su estado y aviso de riesgo.' },
  connections: { fase: 6, detalle: 'Brevo para correo y WhatsApp: cuenta, dominio y estado de envíos.' },
  settings: { fase: 6, detalle: 'Fichas de plataformas: Brevo, Meta, Google y más. Sin claves.' },
  reports: { fase: 7, detalle: 'Informe del estado actual, para imprimir o compartir.' },
  coverage: { fase: 8, detalle: 'Alcance de la versión y lo que queda por hacer.' },
  moderation: { fase: 7, detalle: 'Reportes de la Comunidad y su resolución.' },
};
