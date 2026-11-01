// Canales de envío: correo (Brevo), WhatsApp (Brevo) y push (Web Push con VAPID, sin contenido cifrado:
// el teléfono despierta al service worker, que pide el aviso a la API con su sesión).

export interface Correo { para: string; nombre?: string; asunto: string; html: string; texto: string; etiqueta: string }

type Secretos = Env & { BREVO_API_KEY?: string; VAPID_PRIVADA?: string };
const secretos = (env: Env) => env as Secretos;

export const correoConfigurado = (env: Env) => !!secretos(env).BREVO_API_KEY && !!env.BREVO_REMITENTE;
export const whatsappConfigurado = (env: Env) => !!secretos(env).BREVO_API_KEY && !!env.WHATSAPP_REMITENTE && !!env.WHATSAPP_PLANTILLA_ID;
export const pushConfigurado = (env: Env) => !!env.VAPID_PUBLICA && !!secretos(env).VAPID_PRIVADA;

export class ErrorCanal extends Error {
  constructor(message: string, readonly reintentar: boolean) { super(message); }
}

/** Envía un correo transaccional con Brevo. Devuelve el messageId para seguir su entrega por webhook. */
export const enviarCorreo = async (env: Env, c: Correo, f: typeof fetch = fetch) => {
  if (!correoConfigurado(env)) throw new ErrorCanal('Correo sin configurar (falta la clave de Brevo o el remitente).', false);
  const r = await f('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': secretos(env).BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: env.BREVO_REMITENTE, name: env.BREVO_REMITENTE_NOMBRE || 'mesawow' },
      to: [{ email: c.para, ...(c.nombre ? { name: c.nombre } : {}) }],
      ...(env.BREVO_RESPONDER_A ? { replyTo: { email: env.BREVO_RESPONDER_A } } : {}),
      subject: c.asunto, htmlContent: c.html, textContent: c.texto, tags: ['mesawow', c.etiqueta],
    }),
  });
  if (!r.ok) throw new ErrorCanal(`Brevo respondió ${r.status}: ${(await r.text()).slice(0, 200)}`, r.status >= 500 || r.status === 429);
  return ((await r.json()) as { messageId?: string }).messageId ?? null;
};

/** WhatsApp con plantilla aprobada (Brevo · WhatsApp Business). */
export const enviarWhatsapp = async (env: Env, telefono: string, params: Record<string, string>, f: typeof fetch = fetch) => {
  if (!whatsappConfigurado(env)) throw new ErrorCanal('WhatsApp sin configurar (falta el número remitente o la plantilla aprobada en Brevo).', false);
  const r = await f('https://api.brevo.com/v3/whatsapp/sendMessage', {
    method: 'POST',
    headers: { 'api-key': secretos(env).BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ senderNumber: env.WHATSAPP_REMITENTE, contactNumbers: [telefono.replace(/^\+/, '')], templateId: Number(env.WHATSAPP_PLANTILLA_ID), params }),
  });
  if (!r.ok) throw new ErrorCanal(`Brevo WhatsApp respondió ${r.status}: ${(await r.text()).slice(0, 200)}`, r.status >= 500 || r.status === 429);
  return ((await r.json()) as { messageId?: string }).messageId ?? null;
};

// ─────────────────────────────── Web Push (VAPID, RFC 8292)

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const desdeB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

const firmaVapid = async (env: Env, audiencia: string) => {
  const pub = desdeB64url(env.VAPID_PUBLICA); // 65 bytes: 0x04 || x || y
  const clave = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: secretos(env).VAPID_PRIVADA, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cabeza = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const cuerpo = b64url(new TextEncoder().encode(JSON.stringify({ aud: audiencia, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_CONTACTO || 'mailto:avisos@mesawow.cl' })));
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, clave, new TextEncoder().encode(`${cabeza}.${cuerpo}`));
  return `${cabeza}.${cuerpo}.${b64url(firma)}`;
};

/** Push sin contenido: despierta al teléfono. Devuelve 'vencida' si la suscripción ya no existe. */
export const enviarPush = async (env: Env, endpoint: string, f: typeof fetch = fetch) => {
  if (!pushConfigurado(env)) throw new ErrorCanal('Push sin configurar (faltan las claves VAPID).', false);
  const jwt = await firmaVapid(env, new URL(endpoint).origin);
  const r = await f(endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'normal', authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLICA}`, 'content-length': '0' } });
  if (r.status === 404 || r.status === 410) return 'vencida' as const;
  if (!r.ok) throw new ErrorCanal(`Servicio de push respondió ${r.status}`, r.status >= 500 || r.status === 429);
  return 'ok' as const;
};

// ─────────────────────────────── plantilla de correo con la identidad mesawow

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const plantillaCorreo = (p: { titulo: string; lineas: string[]; boton?: { texto: string; url: string }; pie?: string }) => {
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#FBF6FA;font-family:Poppins,Segoe UI,Arial,sans-serif;color:#0F1B3D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6FA;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #ECE6F0">
<tr><td style="height:6px;background:linear-gradient(90deg,#F22E62,#FF7A00);background-color:#F22E62"></td></tr>
<tr><td style="padding:28px 28px 8px;font-size:26px;font-weight:800;letter-spacing:-0.5px">mesa<span style="color:#F22E62">wow</span></td></tr>
<tr><td style="padding:8px 28px 0;font-size:20px;font-weight:700">${esc(p.titulo)}</td></tr>
<tr><td style="padding:12px 28px 4px;font-size:15px;line-height:1.55;color:#4A5274">${p.lineas.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join('')}</td></tr>
${p.boton ? `<tr><td style="padding:12px 28px 24px"><a href="${esc(p.boton.url)}" style="display:inline-block;background:#F22E62;background-image:linear-gradient(90deg,#F22E62,#FF7A00);color:#ffffff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px">${esc(p.boton.texto)}</a></td></tr>` : ''}
<tr><td style="padding:16px 28px 24px;font-size:12px;color:#5E6382;border-top:1px solid #ECE6F0">${esc(p.pie ?? 'La plataforma donde el trabajo se vive, se comparte y se celebra. Cambia qué avisos recibes en Mis avisos.')}</td></tr>
</table></td></tr></table></body></html>`;
  const texto = [p.titulo, '', ...p.lineas, ...(p.boton ? ['', `${p.boton.texto}: ${p.boton.url}`] : []), '', '— mesawow'].join('\n');
  return { html, texto };
};
