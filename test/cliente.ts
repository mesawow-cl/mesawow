import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import worker from '../src/worker';

export interface Opciones {
  como?: string;
  metodo?: string;
  cuerpo?: unknown;
  cabeceras?: Record<string, string>;
  entorno?: Env;
}

/** Llama a la API como si fuera la app. `como` = correo de la identidad de desarrollo. */
export const llamar = async (ruta: string, o: Opciones = {}) => {
  const cabeceras = new Headers(o.cabeceras);
  if (o.como) cabeceras.set('x-mesawow-dev', o.como);
  let body: BodyInit | undefined;
  if (o.cuerpo instanceof ArrayBuffer || o.cuerpo instanceof Uint8Array) body = o.cuerpo as BodyInit;
  else if (o.cuerpo !== undefined) { body = JSON.stringify(o.cuerpo); cabeceras.set('content-type', 'application/json'); }
  const ctx = createExecutionContext();
  const r = await worker.fetch(new Request(`https://app.mesawow.test/api/v1${ruta}`, { method: o.metodo ?? 'GET', headers: cabeceras, body }), o.entorno ?? env, ctx);
  await waitOnExecutionContext(ctx);
  const tipo = r.headers.get('content-type') ?? '';
  return { status: r.status, cabeceras: r.headers, cuerpo: (tipo.includes('json') ? await r.json() : await r.arrayBuffer()) as any };
};
