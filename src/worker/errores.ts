import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Error de negocio con mensaje en español para mostrar tal cual en la app. */
export class ErrorApi extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const cuerpoError = (code: string, message: string) => ({ error: { code, message } });
