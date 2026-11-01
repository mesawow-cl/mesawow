# Avisos por correo, WhatsApp y push (Brevo + Web Push)

mesawow envía tres tipos de aviso fuera de la app:

| Canal | Qué envía | Requiere |
|---|---|---|
| Correo (Brevo) | Invitaciones, resumen diario o semanal, salida al aire en riesgo | Dominio autenticado, remitente y clave API |
| WhatsApp (Brevo) | "Tarea recién lista para desarrollar" (D2), agrupada si son varias | Número de WhatsApp Business conectado a Brevo y plantilla aprobada |
| Push | Tareas nuevas, entregas, ajustes y riesgos | Claves VAPID (ya generadas en local) |

Sin estas piezas mesawow funciona igual: el aviso queda en la app y en **Correo y WhatsApp** aparece "Falta configurar".

Ninguna clave se pega en el chat ni en el código. Se cargan con `wrangler secret put` (Cloudflare) o en `.dev.vars` (tu computador, ignorado por git).

## 1. Dominio y remitentes

Decisión: los avisos salen desde **`avisos@mesawow.cl`** (nombre `mesawow`) y las respuestas van a **`contacto@mesawow.cl`**. Ambos están en `wrangler.jsonc` (`BREVO_REMITENTE`, `BREVO_RESPONDER_A`); no son secretos.

1. Dominio `mesawow.cl` autenticado en Brevo (Domains → Add a domain → registros DNS en Cloudflare con la nube gris).
2. Brevo → **Senders → Add a sender**: `mesawow` · `avisos@mesawow.cl`, y otro `mesawow` · `contacto@mesawow.cl`. Con el dominio autenticado no piden código.
3. Para que existan los buzones (respuestas y rebotes), Cloudflare → `mesawow.cl` → **Email → Email Routing**: reenvía `contacto@mesawow.cl` y `avisos@mesawow.cl` a `mesawow.cl@gmail.com`. Si ya existe un registro SPF (`v=spf1 …`), debe quedar **uno solo** que incluya ambos: `v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all`.

## 2. Clave API de Brevo

Brevo → **SMTP & API → API Keys → Generate a new API key** (nombre `mesawow`). Cópiala y cárgala tú:

```sh
# Producción y staging (Fase 8)
npx wrangler secret put BREVO_API_KEY --env production
npx wrangler secret put BREVO_API_KEY --env staging

# Local (no queda en el historial ni en pantalla)
read -s "K?Clave de Brevo: " && echo "BREVO_API_KEY=$K" >> .dev.vars && unset K
```

## 3. Webhook de entregas

1. Inventa una clave larga para el webhook y cárgala:
   ```sh
   npx wrangler secret put BREVO_WEBHOOK_CLAVE --env production
   ```
2. Brevo → **Transactional → Settings → Webhook → Add a new webhook**:
   - URL: `https://app.mesawow.cl/api/v1/webhooks/brevo?clave=LA_MISMA_CLAVE`
   - Eventos: *Delivered, Hard bounce, Soft bounce, Blocked, Invalid email*.
3. En Cloudflare Access agrega la excepción del webhook (ver `docs/acceso-cloudflare.md`).

## 4. WhatsApp (D2)

1. Brevo → **WhatsApp** → conecta el número de WhatsApp Business de la organización.
2. Crea una plantilla de categoría *Utility* y espera su aprobación por Meta. Texto sugerido:

   > Hola {{params.NOMBRE}}, tienes {{params.CANTIDAD}} tarea(s) lista(s) para desarrollar en mesawow: {{params.TAREA}}. Ábrela aquí: {{params.ENLACE}}

3. Pon en `wrangler.jsonc` el número remitente (`WHATSAPP_REMITENTE`, solo dígitos, ej. `569XXXXXXXX`) y el ID de la plantilla (`WHATSAPP_PLANTILLA_ID`). No son secretos.
4. Cada persona necesita su número en **Equipo**. Cada persona decide en **Mis avisos** si lo recibe (viene encendido).

## 5. Push (Web Push con VAPID)

En local ya hay un par de claves. Para producción genera uno nuevo:

```sh
npx web-push generate-vapid-keys
```

- La **pública** va en `wrangler.jsonc` → `VAPID_PUBLICA` (no es secreta).
- La **privada** se carga con `npx wrangler secret put VAPID_PRIVADA --env production`.

En iPhone el push solo funciona con mesawow instalada en la pantalla de inicio (Compartir → Agregar a inicio).

## Cómo se envía

1. Cada acción crea el aviso en la app (`outbox`, canal `app`).
2. Tras la acción, y cada 5 minutos por cron, mesawow agrupa por persona y crea los avisos de push, WhatsApp y correo según sus preferencias.
3. Esos avisos van a la cola `AVISOS`. La cola envía con reintentos exponenciales (máximo 5) sin duplicar (`dedupe_key`).
4. Brevo informa entregas y rebotes por el webhook. El estado se ve en **Avisos** y en **Correo y WhatsApp**.
5. Los resúmenes salen a las 11:00 UTC (08:00 en Chile en horario de verano, 07:00 en invierno): diario cada día y semanal los lunes.
