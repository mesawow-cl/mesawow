// En qué fase se construye cada vista (docs/requerimiento-mesawow.md, plan de fases).
import type { Vista } from '../../shared/navegacion';

export const FASE_DE: Record<Exclude<Vista, 'more' | 'team' | 'profile' | 'tasks' | 'mesas' | 'brands' | 'agenda' | 'scrum' | 'campaigns' | 'library' | 'bases' | 'home' | 'gantt' | 'metro' | 'strategy' | 'aire' | 'calendario' | 'notifications' | 'preferences' | 'connections' | 'settings' | 'plaza' | 'recognition' | 'reports' | 'moderation' | 'muro'>, { fase: number; detalle: string }> = {
  coverage: { fase: 8, detalle: 'Alcance de la versión y lo que queda por hacer.' },
};
