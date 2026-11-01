// En vivo (Fase 5): una sala con WebSocket Hibernation a la que se conecta cada pantalla abierta.
// La sala solo envía señales ("hubo un cambio"); cada pantalla vuelve a pedir sus datos con sus permisos,
// así ningún dato viaja a quien no debe verlo.
import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { ErrorApi } from './errores';
import type { Entorno } from './identidad';

export interface Senal { tipo: 'cambio' | 'alertas'; personas?: string[]; origen?: string }

export class SalaEnVivo extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Los "ping" del teléfono se responden sin despertar la sala.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === '/emitir') {
      const s = (await req.json()) as Senal;
      const mensaje = JSON.stringify({ tipo: s.tipo, origen: s.origen ?? null, en: Date.now() });
      const destino = s.personas ? s.personas.flatMap((p) => this.ctx.getWebSockets(p)) : this.ctx.getWebSockets();
      for (const ws of destino) { try { ws.send(mensaje); } catch { /* conexión cerrada */ } }
      return new Response(null, { status: 204 });
    }
    if (req.headers.get('upgrade') !== 'websocket') return new Response('Se esperaba WebSocket', { status: 426 });
    const persona = url.searchParams.get('persona');
    if (!persona) return new Response('Falta persona', { status: 400 });
    const par = new WebSocketPair();
    this.ctx.acceptWebSocket(par[1], [persona]);
    return new Response(null, { status: 101, webSocket: par[0] });
  }

  async webSocketMessage() { /* los clientes no envían datos */ }
  async webSocketClose(ws: WebSocket, code: number) { try { ws.close(code, 'Hasta pronto'); } catch { /* ya cerrada */ } }
}

const sala = (env: Env) => env.VIVO.get(env.VIVO.idFromName('equipo'));

/** Envía una señal a todas las pantallas (o solo a las de ciertas personas). Nunca falla la petición original. */
export const emitir = async (env: Env, s: Senal) => {
  try { await sala(env).fetch('https://sala/emitir', { method: 'POST', body: JSON.stringify(s) }); } catch (e) { console.error('vivo', e); }
};

export const vivo = new Hono<Entorno>();
vivo.get('/vivo', async (c) => {
  if (c.req.header('upgrade') !== 'websocket') throw new ErrorApi(426, 'websocket', 'Se esperaba una conexión en vivo.');
  const persona = c.get('actor');
  return sala(c.env).fetch(`https://sala/conectar?persona=${encodeURIComponent(persona.id)}`, { headers: { upgrade: 'websocket' } });
});
