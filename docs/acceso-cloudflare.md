# Activar el ingreso con Cloudflare Access

Cómo funciona el ingreso a mesawow:

1. **Cloudflare Access** pide el correo y comprueba que es de quien dice ser: envía un código de un solo uso al correo o permite entrar con Google.
2. **mesawow** decide quién entra. Entran las personas activas del equipo y quienes tienen una invitación vigente. Cualquier otro correo ve "Aún no tienes acceso a mesawow".

Así, invitar o dar de baja a alguien se hace solo dentro de mesawow, sin tocar Cloudflare.

Plan necesario: Cloudflare Zero Trust **Free**, que permite hasta 50 usuarios.

## Pasos (una vez por entorno: primero staging, después production)

1. Entra a <https://one.dash.cloudflare.com> con la cuenta de Cloudflare donde está `mesawow.cl`.
2. Si es la primera vez, elige el **nombre del equipo**, por ejemplo `mesawow`, y el plan **Free**.
   Tu dominio de equipo quedará como `mesawow.cloudflareaccess.com`.
3. En **Settings → Authentication → Login methods**, deja activo **One-time PIN**.
   Si el equipo usa Gmail o Google Workspace, agrega también **Google**.
4. En **Access → Applications → Add an application → Self-hosted**, completa:
   - **Application name:** `mesawow staging` (o `mesawow` para production).
   - **Domain:** `staging.mesawow.cl` (o `app.mesawow.cl`).
   - **Session duration:** 1 month, para no pedir el código a cada rato en el teléfono.
5. En **Policies → Add a policy**, completa:
   - **Policy name:** `Equipo mesawow`.
   - **Action:** Allow.
   - **Include:** Everyone. mesawow filtra después quién entra.
6. Guarda. En la ficha de la aplicación, copia el **Application Audience (AUD) Tag**.
7. Pásale a Claude dos datos: el **dominio del equipo** (`xxxx.cloudflareaccess.com`) y el **AUD Tag**.
   Van en `wrangler.jsonc` como `ACCESS_EQUIPO` y `ACCESS_AUD`. No son secretos, pero no hace falta publicarlos.

`mesawow.cl`, la vista pública de mandantes, **no** va detrás de Access.

## Excepción para el calendario de bloques (Google Calendar por iCal)

Google lee el enlace privado de bloques de trabajo de cada persona sin iniciar sesión. Ese enlace ya lleva un token secreto. Para que Google llegue a él, en la misma aplicación de Access agrega una segunda política:

- **Policy name:** `Calendario iCal`.
- **Action:** Bypass.
- **Include:** Everyone.
- En **Application → Overview → Additional domains / paths**, agrega la ruta `app.mesawow.cl/api/v1/ical/feed/*` (y `staging.mesawow.cl/api/v1/ical/feed/*`) asociada a esa política.

## Excepción para el webhook de Brevo (Fase 6)

Brevo avisa a mesawow si cada correo se entregó o rebotó. Brevo no inicia sesión: la dirección lleva una clave secreta (`BREVO_WEBHOOK_CLAVE`) y mesawow rechaza cualquier llamada sin ella. Agrega la ruta a la misma política Bypass del calendario:

- `app.mesawow.cl/api/v1/webhooks/brevo` (y `staging.mesawow.cl/api/v1/webhooks/brevo`).

## Cerrar sesión

El botón "Cerrar sesión" de mesawow usa `/cdn-cgi/access/logout`, que cierra la sesión de Access en ese dispositivo.
