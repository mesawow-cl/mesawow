# Conectar Google Calendar

Con esta conexión, mesawow trabaja con el Google Calendar de cada integrante en los dos sentidos:

- Lee las reuniones cada 5 minutos. Si aparece una inesperada, las tareas se corren solas y se avisa del nuevo término.
- Escribe los bloques de trabajo como eventos 🛠 en el calendario de cada persona.

Las credenciales se crean una sola vez para todo el equipo, en la cuenta de Google del negocio.

## 1. Crear el proyecto

1. Abre <https://console.cloud.google.com> e inicia sesión con la cuenta de Google del negocio.
2. Arriba a la izquierda, junto al logo de Google Cloud, abre el **selector de proyectos** y elige **Proyecto nuevo**.
3. En **Nombre del proyecto** escribe `mesawow` y haz clic en **Crear**. Espera la notificación y luego selecciona el proyecto `mesawow`.

## 2. Activar Google Calendar API

1. Menú ☰ → **APIs y servicios** → **Biblioteca**.
2. Busca **Google Calendar API**, ábrela y haz clic en **Habilitar**.

## 3. Pantalla de consentimiento

1. Menú ☰ → **APIs y servicios** → **Pantalla de consentimiento de OAuth**. En consolas nuevas aparece como **Google Auth Platform** → **Comenzar**.
2. **Nombre de la app:** `mesawow`. **Correo de asistencia:** el del negocio.
3. **Público:** elige **Externo**. Si el equipo usa Google Workspace con el dominio del negocio, elige **Interno**.
4. **Información de contacto:** el correo del negocio. Acepta la política y haz clic en **Crear**.
5. En **Acceso a los datos** → **Agregar o quitar permisos**, busca `calendar.events`, marca `.../auth/calendar.events` y guarda.
6. Si elegiste **Externo**, entra a **Público** → **Usuarios de prueba** → **Agregar usuarios** y suma el correo de cada integrante.

> Mientras la app esté en modo **Prueba**, Google pide reconectar cada 7 días. Para el uso diario, en **Público** elige **Publicar app**. Google puede pedir una verificación porque el permiso de calendario es sensible. Con **Interno** (Workspace) no hace falta.

## 4. Crear el cliente OAuth

1. **Clientes** (o **Credenciales**) → **Crear cliente** (o **Crear credenciales** → **ID de cliente de OAuth**).
2. **Tipo de aplicación:** **Aplicación web**. **Nombre:** `mesawow`.
3. En **URI de redireccionamiento autorizados** agrega estas tres:
   - `http://localhost:5173/api/v1/google/callback`
   - `https://staging.mesawow.cl/api/v1/google/callback`
   - `https://app.mesawow.cl/api/v1/google/callback`
4. Haz clic en **Crear**. Aparecen el **ID de cliente** y el **Secreto del cliente**.

## 5. Entregar las credenciales

- **ID de cliente** (termina en `.apps.googleusercontent.com`): pásaselo a Claude. No es secreto y va en `wrangler.jsonc`.
- **Secreto del cliente:** **no lo pegues en el chat.** Guárdalo tú.

  Para desarrollo local, en la Terminal (al pegar, no se ve lo que escribes):

  ```sh
  cd ~/Documents/La\ Procesadora/Mesa\ WOW && read -s -p "Secreto de Google: " S && sed -i '' "s|^GOOGLE_CLIENT_SECRET=.*|GOOGLE_CLIENT_SECRET=$S|" .dev.vars && unset S && echo && echo "Guardado en .dev.vars"
  ```

  Para staging y production, cuando estén publicados:

  ```sh
  npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
  npx wrangler secret put CLAVE_CIFRADO --env staging
  ```

## Cómo lo usa cada persona

**Mi mesa** → **Google Calendar** → **Conectar Google Calendar** → elegir su cuenta → **Permitir**. Desde ahí la sincronización es automática.
