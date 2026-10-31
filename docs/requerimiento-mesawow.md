# mesawow · Requerimiento funcional y técnico

> Versión 0.1 · 31-10-2026 · Fuente de verdad para construir la versión real de mesawow sobre Cloudflare.
> Construido a partir de la lectura completa de `prototipo/mesawow.html` (1.430 líneas, HTML + CSS + ~370 KB de JavaScript en capas).
> Regla principal: **la versión real no puede perder ninguna funcionalidad del prototipo.** Donde el prototipo tiene un error evidente, se describe el comportamiento correcto y se marca como *Corrección*. Lo que requiere una decisión está en **§14 Preguntas abiertas**.

---

## Decisiones tomadas (31-10-2026)

| # | Decisión |
|---|---|
| D1 (P1) | **`mesawow.cl`** = vista pública de mandantes. **`app.mesawow.cl`** = la app del equipo, detrás de Cloudflare Access. |
| D2 (P3) | **WhatsApp entra en la V1** con un uso acotado: avisar por WhatsApp cuando una tarea **queda lista para que la persona la desarrolle** (asignada y desbloqueada: sin bloqueo y con sus dependencias hechas), para quien no está frente a su computador ni ha visto el correo o la app. El mensaje lleva el resumen de la tarea y el enlace directo. Los demás avisos van por app, push y correo (Brevo). |
| D3 (P4) | **Feriados oficiales de Chile cargados automáticamente** (cron anual y al iniciar cada año, desde una fuente oficial), más días no laborables manuales que agregue coordinación. Aplican a agenda, sprints, propuesta semanal, webinars y Semana del equipo. |
| D4 (P20) | **Google Calendar entra en la V1**: cada persona conecta su Google Calendar (OAuth); mesawow lee sus reuniones y escribe sus bloques de trabajo. Una reunión nueva o movida en Google **recalcula** las tareas afectadas y avisa del nuevo término. |
| D5 | **Vista semanal tipo horario escolar** (ver §4.7 bis). |
| D6 | **Jornada 09:00–14:00 y 15:00–18:00**, lunes a viernes (colación 14:00–15:00). Reemplaza el 09–13 / 14–18 del prototipo en agenda, sprints, capacidad, propuesta semanal y vista semanal. |
| D7 | **Ingreso**: Cloudflare Access verifica el correo (código de un solo uso o Google) y deja pasar a cualquiera que lo verifique; **mesawow autoriza**: solo personas activas o con invitación vigente. Invitar y dar de baja se hace solo en mesawow. Guía: `docs/acceso-cloudflare.md`. "Ver la app como" es solo lectura y se audita con la identidad real. |

---

## 0. Cómo leer este documento

- El prototipo se construyó en capas que sobrescriben funciones anteriores. **La versión final de cada función es la última capa.** Las capas finales que mandan son:
  - `render` final: línea 1427 (campana) → 1396 (automatizaciones al aire) → 1370 (calendarios) → 1325 (experiencia simple) → 1276 (al aire) → 1108 (muro) → capas anteriores.
  - `taskForm` final: 1163 · `taskModal` final: 1273 · `boot` final: 1121 · `newQuarterCampaign` final: 1164 · `webinarForm` final: 1165 · `taskNotice` final: 925 (reemplaza a la de 721) · `notifications` y `notificationModal` finales: 928–929.
- Términos:
  - **Tarea** (en la interfaz también "encargo"): unidad de trabajo asignada.
  - **Mesa**: área de trabajo (Marketing, Comercial y Ventas, TI, etc.).
  - **Marca**: empresa del grupo cuyo trabajo se coordina.
  - **Pieza / salida al aire**: publicación concreta en un canal (un mail, un post, un anuncio).
  - **Mandante**: cliente o dueño que ve la vista pública de avances.
  - **Hecha** (`done`): estado `Aprobada` o `Completada`.
- Zona horaria de todo cálculo: **America/Santiago**. Idioma: **es-CL**.

---

## 1. Alcance y principios

1. Plataforma de trabajo para ~30 personas en varias mesas. Lema: *"La plataforma donde el trabajo se vive, se comparte y se celebra."*
2. Mobile first (uso principal en teléfono) y también escritorio.
3. Todo dato vive en el servidor (D1 + R2). Nada de `localStorage` salvo preferencias de interfaz.
4. **Permisos y reglas se validan siempre en el servidor.** La interfaz solo oculta lo que no corresponde.
5. Las automatizaciones corren en el servidor (Cron Triggers + Queues), nunca en el navegador, y son **idempotentes**.
6. Referencias por **ID**, nunca por nombre o título (el prototipo usa nombres de persona y títulos de tarea como llave; ver §13).
7. Envíos reales de correo por **Brevo**, push por Web Push. WhatsApp: ver §14.
8. Sin datos personales reales hasta que el acceso esté listo (Fase 2). Los datos de ejemplo son inventados.

---

## 2. Roles y permisos

### 2.1 Roles globales (exactos del prototipo)

| Rol | Tipo | Notas |
|---|---|---|
| Administrador general | equipo | Uno solo a la vez. Transferible con confirmación (el anterior pasa a "Coordinación de Marketing"). No puede desactivarse ni degradarse sin transferir antes. |
| Administración | equipo · coordina | |
| Coordinación de Marketing | equipo · coordina | |
| Responsable de marca o área | equipo · coordina | |
| Ejecutor | equipo | Rol por defecto de una invitación. |
| Revisor o aprobador | equipo | |
| Consulta | equipo · solo lectura | *Corrección*: en el prototipo no se aplica; en la versión real es solo lectura (§14-P7). |
| Mandante | externo | Solo vista pública de mandantes. |
| Consulta externa | externo | |
| Administrador técnico | externo | |

Funciones derivadas (se calculan en el servidor):

- `esAdmin` = rol Administrador general.
- `coordina` = esAdmin o rol ∈ {Administración, Coordinación de Marketing, Responsable de marca o área}.
- `coordinaODirige` = coordina o el rol/cargo coincide con `/Direcci[oó]n|Director/` (ver §14-P8: hoy no existe un rol "Dirección").
- `esEquipo` = sesión iniciada y rol ∉ {Mandante, Consulta externa, Administrador técnico}.
- `marcasPermitidas` = esAdmin → todas; resto → las marcas asignadas a la persona.

### 2.2 Roles por tarea

Responsable (owner, uno), Revisor (uno, opcional), Colaboradores (varios), Aprobadores (varios). Todos deben estar activos y tener asignada la marca de la tarea.

### 2.3 Matriz de permisos

| Acción | Quién |
|---|---|
| Ver una tarea | Marca permitida **y** (esAdmin o coordina, o participa en ella). Si `confidencial`: solo esAdmin o participantes. |
| Crear / editar / reasignar tarea | coordina |
| Empezar tarea (Pendiente → En curso) | coordina, responsable o colaborador; sin bloqueo y con dependencias hechas |
| Bloquear / desbloquear ("Necesito ayuda") | participantes y coordina (*Corrección*: el prototipo no lo restringe) |
| Entregar | responsable, revisor, aprobador o esAdmin (los colaboradores no entregan) |
| Adjuntar resultado | responsable, revisor, aprobador o esAdmin |
| Aprobar / pedir ajustes | revisor, aprobador o esAdmin |
| Reabrir tarea hecha (con motivo) | coordina |
| Marcar confidencial | coordina |
| Registrar recepción entre áreas | inicia coordina; confirma el receptor (o esAdmin) |
| Sprints: crear, editar, iniciar, revisión, cierre, backlog, días no laborables, preparar tarea | coordina |
| Avance diario | responsable o colaborador de la tarea (o coordina) |
| Horas restantes | coordina, responsable o colaborador · `inputsReady` solo coordina |
| Campañas 360, webinars, trabajos del catálogo, plantillas personalizadas, propuesta semanal | coordina |
| Aprobar / programar campaña (versión) | *Corrección*: coordina (el prototipo no valida rol; §14-P9) |
| Registrar lanzamiento real | coordina |
| Programar una salida al aire, "Cambiar fecha" | coordina |
| Marcar pieza al aire | coordina o responsable de la tarea, y solo si la tarea está hecha |
| Mesa estratégica: ver | coordinaODirige |
| Mesa estratégica: planes, métricas, iniciativas, aprobar reportes, publicar vista de mandantes | esAdmin |
| Equipo, invitaciones, permisos, marcas (crear/editar), mesas (crear/editar/archivar), moderación, "Ver la app como" | esAdmin |
| Bases y segmentos, Correo y WhatsApp, Plataformas, Alcance | coordina |
| Logros del equipo, Informes | coordinaODirige |
| Comunidad, perfiles, felicitar, comentar, reportar, compromisos del día | esEquipo |
| Quitar tareas de un compromiso ya confirmado | coordina (el resto solo agrega, con motivo) |
| Ver calendario de otra persona | *ver §14-P10* (hoy cualquiera puede) |
| Ver avisos de todos | esAdmin |

---

## 3. Navegación final

### 3.1 Entrada

- Ruta pública `/` → **vista de mandantes** ("La mesa de avances"). El equipo entra por `/admin-login` (en la versión real: login de Cloudflare Access). Ver §14-P1.
- Con sesión válida el equipo entra directo. Primer render tras ingresar: **Inicio (muro)**, una vez por sesión. Roles no-equipo nunca ven el muro: van a "Mi mesa".
- Enlaces profundos: `#task=<id>` abre la tarea; `#invite=<token>` abre el registro por invitación.

### 3.2 Cinco espacios (equipo)

| Espacio | Pestañas (vista → etiqueta → visible para) |
|---|---|
| **Inicio** | muro → Inicio · plaza → Comunidad · recognition → Logros del equipo (coordinaODirige) |
| **Mi trabajo** | agenda → Mi mesa · calendario → Dos calendarios · tasks → Mis encargos · gantt → Tiempo de trabajo · home → Resumen · notifications → Avisos · preferences → Mis avisos |
| **Mesas** | mesas → Mis mesas · metro → Mesa de trabajo · scrum → Sprints · campaigns → Proyectos · library → Entregables · brands → Marcas y mínimos · strategy → Mesa estratégica (coordinaODirige) |
| **Al aire** | aire → Mesa al aire · calendario → Dos calendarios · bases → Bases y segmentos (coordina) · connections → Correo y WhatsApp (coordina) · settings → Plataformas (coordina) |
| **Equipo** | team → Equipo (esAdmin) · profile → Mi perfil · reports → Informes (coordinaODirige) · coverage → Alcance (coordina) · moderation → Moderación (esAdmin) |

- Tocar un espacio abre su primera pestaña visible (para no-admin en Equipo: su perfil).
- **Escritorio**: menú lateral con los 5 espacios y las sub-pestañas del espacio activo.
- **Teléfono**: barra inferior **Inicio · Mi trabajo · ＋ · Mesas · Más**. "Más" queda activo en las vistas `more`, Al aire y Equipo. Barra de pestañas tipo píldora sobre el contenido si el espacio tiene 2+ pestañas.
- **Más** ("Todo mesawow"): los 5 espacios con todas sus pestañas visibles + "Tu cuenta y cerrar sesión".
- **Barra superior**: logo (→ Inicio), campana con contador, avatar (menú de cuenta).
- *Corrección*: "Dos calendarios" vive en dos espacios; el espacio activo debe ser aquel desde el que se entró (el prototipo siempre marca Mi trabajo).
- Roles no-equipo: menú heredado (Inicio redirige a Mi mesa, Mesas, Mesa al aire, Proyectos, Sprints, + Herramientas). Ver §14-P2.

### 3.3 Botón ＋ "¿Qué quieres crear?"

| Opción | Visible para | Abre |
|---|---|---|
| Una tarea | coordina | Formulario de tarea por pasos |
| Una salida al aire | coordina | "Programar una salida al aire" |
| Una campaña o trabajo del catálogo | todos | Centro de planificación (360, webinar, catálogo, encargo personalizado) |
| Mi compromiso de hoy | esEquipo | Compromisos del día |

### 3.4 Menú de cuenta (avatar)

Iniciales, nombre y rol · **Mi perfil** · **Mis avisos** · **Ver la mesa de mandantes** · **Ver la app como** (solo esAdmin: "Coordinación · Todas las tareas" o "Mi espacio · <persona>"; muestra banda amarilla "Estás viendo el espacio de X" + "Volver a coordinación") · **Cerrar sesión**.

En la versión real, "Ver la app como" es **solo lectura**: el servidor sigue autorizando con la identidad real del administrador.

### 3.5 Campana de alertas

Ver §7.2.

---

## 4. Pantallas y funciones

### 4.1 Inicio (muro)

- **Hero**: fecha es-CL, pastilla "En vivo", "¡Hola, <nombre>! 👋", texto con el número de logros de hoy.
- **4 métricas**: Mis tareas (propias abiertas visibles) · En progreso (propias "En curso") · Completadas (propias hechas, histórico) · Logros hoy (→ Comunidad).
- **Momento WOW**: el logro válido más reciente de tipo Sprint completo / Objetivo del sprint alcanzado / Lanzamiento verificado creado hace < 48 h. Título "¡Sprint completado!" o "¡Lanzamiento verificado!". Botón felicitar. **Confeti una sola vez** por hito (en la versión real: una vez por persona y hito, persistido).
- **Logros del día**: logros válidos de hoy (sin el hito). Detalle oculto → "Un aporte al equipo fue completado / Detalle reservado a participantes". Vacío: últimos 3 logros + "Ver mis encargos" + "Ver un ejemplo con el equipo activo" (modo demo en memoria, no se guarda).
- **Actividad del equipo (en vivo)**: chips Todo · Logros · Entregas · Revisiones · Sprints · Reconocimientos; 8 ítems + "Ver más actividad" (+10); los nuevos se resaltan. Fuentes: eventos de auditoría (tarea iniciada/entregada, revisión solicitada, ajustes, tarea aprobada, versión aprobada, sprint iniciado/en revisión/cerrado), logros válidos, felicitaciones ("reconoció a"), comentarios (90 caracteres). Privacidad: "una tarea de otra mesa" / "de otra mesa".
- **Tu día**: anillo hechas/total de mis tareas que vencen hoy; mensaje (todo listo 🎉 / "Te quedan N encargos" / "Nada vence hoy…" / "Sin encargos pendientes"); hasta 4 pendientes (Atrasada / Hoy / fecha); botones "Ir a Mi mesa" y "Mis compromisos".
- **Tus paneles** (con contador): Mis encargos · Mi mesa (vencen hoy) · Mesas (activas) · Sprints (activo o "Planificar el próximo") · Proyectos · Comunidad (menciones sin leer) · "Todos →".
- Saludo por hora (Buenos días < 12, Buenas tardes < 20, Buenas noches): calculado pero no mostrado en el prototipo (§14-P15).
- Felicitar: alterna la sonrisa; toast con rayos "Reconociste a X · La persona verá tu sonrisa en su logro".
- Actualización en vivo por Durable Object (reemplaza el sondeo de 30 s / 4 s y el evento `storage`).

### 4.2 Comunidad, logros y reconocimientos

- **Comunidad (plaza)**: filtros tipo, persona, mesa (+ filtro global de marca); páginas de 12 ("Ver más logros"); logros de tarea agrupados por encargo y día ("N aportes al mismo encargo"). Tarjeta: avatares, enlaces a perfiles, hora es-CL, insignia "Automático" o "Reconocimiento en actualización" (si dejó de ser válido). Botones: Felicitar/Felicitaste (n) · Comentar (n) · Ver resultado · Reportar. Cabecera: "Mis compromisos del día", "Mi perfil". Lateral: "Mis avisos sociales".
- **Detalle de logro**: tipo, título (o genérico), personas, Validado / En actualización, tareas, comentarios (el autor puede retirar el suyo), formulario de comentario (≤ 1.000 caracteres) con mención opcional.
- **Los logros no se publican a mano y su publicación no se puede desactivar.** Tipos y reglas en §5.9.
- **Logros del equipo** (coordinaODirige): conteo de logros válidos por mesa activa (sin rankings), 24 recientes, "Descargar resumen" (txt).
- **Moderación** (esAdmin): lista de reportes → Revisar → acción `revisado` / `restringir detalle` / `retirar comentarios`, con motivo obligatorio → Resuelto + auditoría.
- **Niveles de celebración**:
  1. Logro publicado → solo la **sonrisa** (botón felicitar con animación).
  2. Reconocimiento → **rayos + sonrisa** (toast) y **aviso a la persona reconocida**.
  3. Momento WOW → solo hitos, **confeti una vez**.
  - Todo respeta `prefers-reduced-motion`.

### 4.3 Perfil

Avatar, nombre, rol, área, bio, marcas (intersección con las del visitante), "Perfil histórico · Inactivo" si está inactivo, últimos 24 logros. Propio: "Editar mi perfil" (bio ≤ 300; foto PNG/JPEG/WebP ≤ 100 KB → R2; quitar foto).

### 4.4 Compromisos del día

Día = hoy (Santiago); hora de término (por defecto 18:00); checklist de mis tareas visibles (por defecto las que vencen hoy; confidenciales solo si son mías); ≥ 1 tarea. Editar exige motivo; un no-coordinador no puede quitar una tarea ya confirmada ("Solicita a coordinación retirar…"). Se guarda la línea base original y el historial de cambios. Habilita el logro **Día cumplido**.

### 4.5 Mis avisos (preferencias)

Menciones en la app (sí/no) · Resumen externo: Diario / Semanal (defecto) / Sin resumen externo · Preferir correo · Preferir WhatsApp · (nuevo) Push. La publicación de logros "siempre activa".

### 4.6 Mi mesa (agenda)

- Selector de persona (esAdmin: todas las activas; resto: solo uno mismo), selector de día (por defecto hoy), "Configurar Google Calendar".
- Agenda del día: bloques de trabajo + reuniones, ordenados.
- "Tareas planificadas": horas, nº de bloques, inicio pedido, término calculado, Editar.
- "Cambios de término y avisos al equipo": últimos 10 cambios.
- Acciones: "＋ Reservar trabajo" (tarea pendiente propia, inicio, horas 0,5–320 paso 0,5, por defecto 8 → "Calcular y reservar") · "＋ Reunión" (nombre, inicio, término > inicio; recalcula y avisa a quienes se desplazan).
- Reglas en §5.4.

### 4.7 Dos calendarios

- Explicación: Calendario de trabajo (horas, de Mi mesa) vs Calendario al aire (de Mesa al aire).
- Modo **Ambos / Trabajo / Al aire**; selector de persona (coordinaODirige: "Todo el equipo" por defecto + cada persona).
- **Mes**: lunes primero, 6 semanas (5 si la última queda fuera), ← →; totales del mes (horas de trabajo, nº de piezas al aire); cada celda: horas, nº al aire, hasta 3 chips ("<h> · tarea", "HH:MM pieza", "▸ N anuncios activos / se activa(n)") y "+N más". En teléfono: puntos contadores.
- **Panel del día**: bloques (desde–hasta, tarea, persona, plazo) y piezas ("Activo" o hora, pieza, canal, hasta, estado); cada uno abre la tarea. Los anuncios con fin aparecen activos cada día hasta su fin.
- **Semana del equipo** (coordinaODirige y "Todo el equipo"): semana con ← →. Columna "En qué estamos ocupados": cada persona activa, ordenada por horas, "<h> de 40 h", tareas abiertas, atrasadas, bloqueadas, barra (normal; `mid` > 24 h; `full` > 36 h), hasta 3 tareas "y N más" o "Sin horas reservadas esta semana". Columna "Qué sale al aire (N)": hasta 12 piezas + "y N más en el calendario".

### 4.7 bis Vista semanal "horario escolar" (nueva, D5)

- Disponible en **Dos calendarios** (modo Ambos, Trabajo o Al aire) y en **Mi mesa**, como alternativa a la vista de mes: **Mes | Semana**.
- Grilla de **lunes a viernes** (columnas) por **horas de la jornada** (filas), como un horario de colegio. Filas de 09:00 a 18:00; la colación (14:00–15:00) se ve como franja gris (D6).
- En cada casilla, en lugar de "materias":
  - **Bloques de trabajo** de cada tarea (color teal): título, horas, marca; ocupan su alto real (p. ej. 2 h = 2 filas).
  - **Reuniones** (color violeta), incluidas las que vienen de Google Calendar.
  - **Salidas al aire** (color rosa) como marcador a su hora ("10:00 · Mail 3 · Correo"); los anuncios activos como franja delgada en la parte superior del día.
  - Feriados y días no laborables: columna atenuada con su nombre.
- Selector de persona (mismas reglas que el calendario) y ← → por semana; "Hoy" resalta la columna actual y una línea de la hora actual.
- Tocar un bloque abre la tarea; tocar un espacio libre permite (coordina o la propia persona) **"＋ Reunión"** en esa hora.
- **Recálculo**: si aparece una reunión inesperada (cargada a mano o llegada desde Google Calendar), las tareas que ocupaban ese horario se **corren automáticamente** al siguiente espacio libre respetando dependencias; la vista se actualiza en vivo y se avisa a los involucrados del nuevo término (regla §5.4; ya existía en el prototipo).
- Teléfono: un día por pantalla con deslizamiento lateral entre lunes y viernes (sin scroll horizontal de página).

### 4.8 Mis encargos (tareas) y detalle de tarea

- Lista: búsqueda (título + responsable), filtro persona (cualquier rol en la tarea), filtro estado (todos los estados, *Corrección*: incluir Completada), tabla Tarea y marca (+ Bloqueada) · Responsable · Plazo (+ "Atrasada") · Complejidad · Estado · Abrir. En teléfono, tabla → tarjetas.
- **Detalle "Tu tarea"**: marca, título, descripción, insignias estado/complejidad/prioridad, caja de entregable (responsable, revisor o "Sin revisión", inicio, plazo, colaboradores, aprobadores), criterio de aceptación, resultado, "Entregas conectadas" (ESTA TAREA NECESITA / DESPUÉS DE ESTA ENTREGA), horas estimadas y término planificado, bloqueo, herramienta, horas restantes, riesgo de planificación, "Inputs disponibles y validados", **"Sale al aire"** (canal · fecha · estado → "Ver en Mesa al aire"), "Comentarios y avisos", "Reconocimiento y privacidad", enlace a campaña.
- Acciones: Editar asignaciones · Necesito ayuda / Resolver bloqueo · Empezar · Entregar (y avisar) · Pedir ajustes (y avisar) · Aprobar (y avisar) · Adjuntar resultado · Reabrir con motivo · Registrar recepción entre áreas · Comentar y preparar aviso · Avisar al encargado e involucrados · Guardar y recalcular agenda.
- **Formulario de tarea por pasos** (Atrás / Siguiente, "Paso i de n", validación por paso, Enter avanza, envío valida todo):
  1. **Qué hacer**: plan estratégico, título, marca, campaña (de esa marca), mesa/área (solo mesas activas), descripción, entregable.
  2. **Equipo**: responsable, revisor; *Más opciones*: colaboradores, aprobadores.
  3. **Salida al aire**: interruptor + bloque al aire (§5.6).
  4. **Plazos**: inicio, fecha límite, criterio de aceptación; *Más opciones*: horas estimadas (0,5 paso 0,5), complejidad, prioridad, dependencias.
  - "＋ Más opciones" se abre solo al editar si hay valores dentro.
- Adjuntar resultado: tipo Documento de texto / Correo HTML / Gráfica o imagen / Documento PDF; archivo .html .htm .txt .pdf .png .jpg .jpeg .webp ≤ 700 KB (→ R2).
- Modales apilables con "← Atrás".

### 4.9 Resumen

"Cada entrega, a la vista." Ver informe · ＋ Nueva tarea. Métricas: marcas en el espacio, campañas, tareas completadas x/y, requieren atención (atrasadas + bloqueadas). "Lo que necesita avanzar" (5), "Campañas en preparación", 3 tarjetas de marca.

### 4.10 Tiempo de trabajo (Gantt)

Barras por tarea (responsable · estado; hecha / bloqueada) por mes. *Corrección*: mes seleccionable (el prototipo fija noviembre 2026). En teléfono, lista. Imprimible.

### 4.11 Mis mesas

Tarjeta por mesa: Activa/Archivada, "Mesa de X", descripción, encargado, "n de m entregas aceptadas", "Ver trabajo" (→ Mesa de trabajo filtrada por área). esAdmin: "＋ Nueva mesa", Editar, Archivar/Restaurar (ve también archivadas). Mesas por defecto: Dirección, Marketing, Comercial y Ventas, Operaciones, TI, Finanzas, Contabilidad, Legal.

### 4.12 Mesa de trabajo (mapa metro)

"El trabajo tiene un recorrido." Controles: mes, área, modo (Todas / Bloqueadas / En revisión / Terminadas), Dependencias, Todas/Ninguna, interruptor por marca (persistido por persona). Una línea por marca; estaciones en la fecha límite; carriles sin superposición; flechas de dependencia; línea HOY. Tocar una estación resalta su cadena (todo lo anterior recursivo + lo inmediato posterior); interruptor visual por estación. Panel: Ver resultado / Abrir tarea / Ver toda la red. Leyenda ○ Pendiente ◐ En curso ↗ En revisión ! Bloqueada ✓ Terminada. Versión lista en teléfono.

### 4.13 Sprints (Scrum)

"Cinco días. Un objetivo compartido." ＋ Crear sprint · ＋ Tarea al backlog · selector de sprint · Días no laborables. Pestañas:

- **Tablero**: métricas; columnas Por hacer (Pendiente + Ajustes solicitados) · En curso · En revisión · Terminadas; tarjeta con área · horas, título, responsable, bloqueada, nº dependencias; Abrir/Ver evidencia, Retirar del sprint (motivo), Empezar.
- **Backlog**: tareas no hechas sin sprint de la marca; orden por rango y prioridad; ↑ ↓ (coordina); preparación ("Falta: …" o Lista); Abrir · Preparar · Agregar al sprint.
- **Capacidad**: por integrante jornada diaria, ocupado, disponible, comprometido, Sobrecarga / Con capacidad.
- **Avance diario**: registrar (solo sprint Activo).
- **Revisión y retrospectiva**: registros, resultado del objetivo, revisión*, retro*, mejora (+ responsable + fecha), evidencia del objetivo, cierre con excepción, historial de alcance.
- Acciones del resumen: Iniciar sprint · Pasar a revisión · Editar planificación · Ver en mapa · Ver en Gantt.
- Filtro global de sprint en Mesa de trabajo, Gantt, Mis encargos e Informes.
- Reglas en §5.5.

### 4.14 Proyectos (campañas)

- Selector de campaña "<marca> · <nombre>", estado y versión. Pestañas: Brief y objetivos · Base y segmentos · Contenidos y HTML · Configuración · Revisión · Programación · Protocolo y tareas.
- Contenidos: asunto, preheader, CTA, URL, HTML, vista previa aislada escritorio/teléfono, descargar HTML.
- Revisión: resumen, vista previa, checklist de 5 puntos (§5.3), observación, Enviar a revisión / Solicitar ajustes / Aprobar versión.
- Programación: fecha*, hora* (Santiago, 10:00), ID externo, evidencia; Calendarizar / Registrar programación externa.
- Protocolo: inicio→fin, hechas/total, tabla de tareas. Webinar: fecha y hora Chile, minutos, plataforma, horas del equipo, sin asignar, en riesgo, "Descargar agenda (.ics)", "Ver agenda del equipo".
- Registrar lanzamiento real (fecha ≤ hoy + URL de evidencia).
- **Centro de planificación** ("Campaña 360, webinar y trabajos estándar"): ＋ Crear trabajo del catálogo · ＋ Encargo personalizado / nueva plantilla · lista de plantillas (Editar) · por campaña "Validar inputs y planificar" · por trabajo "Planificar pendientes" · "Descargar agenda semanal ICS".
- Formularios por pasos: **Campaña 360** (Campaña · Alcance y canales · Fechas y equipo · Revisar y crear) y **Webinar** (Evento · Fecha y formato · Equipo y crear). Reglas en §5.7.

### 4.15 Entregables

Campañas con HTML: Ver correo, Descargar. Resultados de tareas descargables.

### 4.16 Marcas y mínimos

Tarjetas: iniciales/color, "n de 21 mínimos vigentes", %, Editar (esAdmin), Revisar mínimos (estado + nota por mínimo → "Guardar diagnóstico"). Formulario de marca: nombre (único, ≤ 80), descripción, color, director del equipo. Los 21 mínimos están en §8.3.

### 4.17 Mesa estratégica

Planes trimestrales por marca: objetivo, público, presupuesto, diagnóstico, notas; métricas KPI / Resultado clave OKR (base, meta, actual, unidad, fuente, fecha, dirección Subir/Bajar); iniciativas (tipo, campaña, fechas, estado, evidencia); seguimiento al cerrar sprints (borradores automáticos, revisar/aprobar). Botones: Editar plan, Crear trabajo desde este plan, ＋ KPI, ＋ Iniciativa, Aprobar vista de mandantes. Métricas: trabajo estimado (h), entregables aprobados, vigencia.

### 4.18 Vista pública de mandantes ("La mesa de avances")

Filtro por plan; por plan: marca y color, objetivo, fechas, "Actualizado <fecha>", métricas (actual/meta/base/dirección/fecha), línea de tiempo de iniciativas con "Ver resultado aprobado", reportes de sprint aprobados. Muestra **solo la instantánea publicada** (nunca datos privados). Botón "Entrar a mi mesa".

### 4.19 Mesa al aire

- Botones "Ver los dos calendarios" y "＋ Programar una salida" (coordina).
- Franja de flujo: 1. Sale al aire (manda la fecha) · 2. Revisión, 2 días antes · 3. Mesa de trabajo.
- Métricas: Salen esta semana · Listas para salir · En riesgo o atrasadas · Ya salieron al aire.
- "Campañas y eventos en el aire" (ventana al aire vigente o evento futuro).
- Filtro canal; alternar Próximas / Ya publicadas y pasadas.
- Lista por día ("· Hoy"): hora, canal, estado, pieza + tarea, marca · mesa · responsable, "Activo hasta…", plazo de trabajo, "Ver publicación", **Marcar al aire** (URL opcional), **Cambiar fecha**.
- "Programar una salida al aire": elegir tarea existente o crear nueva → formulario en el paso 3.

### 4.20 Bases y segmentos

CSV de ejemplo, Cargar CSV, selector de base, métricas (Registros / Habilitados / Inválidos o duplicados / Bajas o sin respaldo), crear segmento (nombre, ubicación contiene, interés contiene), primeras 30 filas, segmentos guardados con Exportar CSV. Reglas en §5.8.

### 4.21 Correo y WhatsApp · Plataformas

- Fichas por canal: proveedor, cuenta, responsable, plantilla, estado de integración real (en la versión real: Brevo conectado, dominio verificado, último envío, rebotes).
- Plataformas: Brevo, Meta Ads, Google Ads, Meta Business Suite, YouTube Studio, Google Analytics, Meta Eventos — cuenta, responsable, URL, "Abrir herramienta". **Nunca se guardan claves en fichas.** Respond.io queda fuera (Comercial y Ventas).

### 4.22 Equipo e invitaciones (esAdmin)

Tarjetas de personas (área · rol, correo, WhatsApp, activa/inactiva, marcas, Editar permisos, Ver sus tareas). "＋ Invitar integrante": correo*, nombre, área, rol (Coordinación de Marketing / Responsable de marca o área / Ejecutor / Revisor o aprobador / Consulta), marcas (≥ 1). Invitaciones: Pendiente / Aceptada / Revocada / Vencida (7 días), Revocar. Salida de un integrante: ver §5.10.

### 4.23 Informes

Filtros persona y estado; corte con fecha/hora Santiago; métricas Tareas / Completadas / Atrasadas / Bloqueadas; tabla. Imprimir / PDF, Compartir (correo, WhatsApp), Descargar JSON.

### 4.24 Avisos (bandeja) y Alcance

- Avisos: menciones + tabla de envíos (evento + tarea, persona, canal, estado real) → detalle (estado, intentos, mensaje, reenviar).
- Alcance: página informativa del alcance V1 (se actualiza con lo construido).

---

## 5. Reglas de negocio

### 5.1 Tareas: estados y ciclo de vida

Estados: `Pendiente` · `En curso` · `Entregada para revisión` · `Ajustes solicitados` · `Aprobada` · `Completada`. Hecha = Aprobada o Completada.

| Transición | Condiciones |
|---|---|
| Crear → Pendiente | coordina; título, descripción, entregable, inicio, plazo; inicio ≤ plazo; sin ciclo de dependencias; todas las personas activas y con la marca |
| Pendiente → En curso ("Empezar") | sin bloqueo, dependencias hechas (en sprint: sprint Activo) |
| → Entregada para revisión | resultado no vacío, sin bloqueo, dependencias hechas, y la tarea tiene revisor o aprobadores |
| → Completada | igual que arriba pero sin revisor ni aprobadores |
| Entregada → Aprobada | revisor/aprobador/esAdmin; criterio de aceptación no vacío; evidencia (resultado o archivo); sin bloqueo; dependencias hechas. Guarda aprobado por / en |
| Entregada → Ajustes solicitados | motivo obligatorio, se agrega al historial de resultado |
| Hecha → Ajustes solicitados ("Reabrir") | coordina, motivo; *Corrección*: incrementa el ciclo de ejecución (§14-P13) |
| Cambiar el resultado de una tarea hecha | vuelve a Entregada para revisión |

- **Atrasada**: no hecha y plazo < hoy.
- **Bloqueo**: motivo; en avance diario además "quién lo resuelve" y "para cuándo".
- *Corrección*: el criterio de aceptación es obligatorio al crear (si no, la tarea nunca puede aprobarse) — §14-P6.
- Complejidad Baja/Media/Alta; prioridad Urgente/Alta/Media/Baja (valor 4/3/2/1).
- Recepción entre áreas: tarea aceptable, área receptora, receptor activo con la marca, evidencia; confirma el receptor.

### 5.2 Visibilidad

Una tarea es visible si su marca está permitida y (esAdmin, o el modo "Mi espacio" no está activo para coordinación, o la persona participa). Confidencial: solo participantes o esAdmin. En el muro, las tareas no visibles se enmascaran.

### 5.3 Campañas y versiones

- Estados: `Borrador` · `En revisión` · `Ajustes solicitados` · `Aprobada` · `Calendarizada` · `Programada en el canal`.
- Cualquier cambio de brief, contenido, configuración o segmento → versión + 1, estado Borrador, aprobación anulada.
- Aprobar exige: (1) objetivo, indicador y meta (≠ "Por definir"); (2) segmento de la misma marca con ≥ 1 contacto; (3) HTML y asunto; (4) remitente y respuesta configurados; (5) todas las tareas de la campaña hechas. Pedir ajustes exige comentario.
- Programar exige versión aprobada = versión actual. Programación externa exige ID externo y evidencia.
- Lanzamiento real: fecha ≤ hoy + URL http(s).

### 5.4 Agenda y bloques de trabajo

- Jornada: **lunes a viernes, 09:00–14:00 y 15:00–18:00** (480 min/día; colación 14:00–15:00), hora de Santiago. Es configuración del sistema (D6). *Cambio respecto del prototipo*, que usaba 09–13 / 14–18.
- *Requerido por el prompt, no presente en el prototipo*: **feriados** (§14-P4) y reuniones reales.
- Asignar N horas: desde el inicio pedido, ocupar ventanas libres saltando reuniones y bloques ya asignados de la misma persona; el término es el fin del último bloque. Si no hay disponibilidad en el horizonte → error.
- Recalcular: en orden de inicio; el inicio efectivo de un plan es el máximo entre lo pedido y el término de sus dependencias planificadas; detectar ciclos. Si el término se mueve más tarde → registrar cambio (antes, ahora, desplazamiento, causa) y avisar. **La fecha comprometida (plazo) nunca cambia sola.**
- Al guardar una tarea con responsable, horas > 0, no hecha y (reserva activada o sin salidas al aire) → se reservan sus horas desde `inicio 09:00` y se recalcula (§14-P11). Si el término queda después de la primera salida al aire → advertencia.

### 5.5 Sprints

- Estados `Planificado` → `Activo` → `En revisión` → `Cerrado`. Resultado del objetivo: Alcanzado / Parcialmente alcanzado / No alcanzado.
- Sprint = semana **lunes a viernes**; debe empezar en lunes; los feriados reducen capacidad (no extienden).
- Miembros con la marca del sprint, jornada 0–8 h (por defecto 8). Editar solo en Planificado (motivo — *Corrección*: se guarda).
- **Capacidad** = días × jornada − horas ocupadas (reuniones + bloques de tareas fuera del sprint) dentro de las ventanas. **Carga** = Σ horas estimadas de las tareas del sprint del miembro.
- **Lista para sprint**: responsable activo, instrucción, entregable, criterio de aceptación, horas > 0, sin bloqueo, sin dependencias externas pendientes.
- **Iniciar**: ≥ 1 tarea, todas listas; bloqueo duro si alguna tarea está bloqueada, sin inputs validados o con dependencia externa pendiente, o si algún miembro supera el **80 %** de su capacidad; superposición de un miembro con otro sprint → excepción con motivo (§14-P12). Guarda línea base y avisa "Inicio de sprint".
- Agregar al sprint: coordina, la tarea no está en otro sprint, el responsable es miembro; si el sprint no está Planificado, motivo (cambio de alcance). Retirar: motivo.
- Avance diario: solo Activo, fecha dentro del sprint; bloqueo con quién lo resuelve y fecha → aviso "Bloqueo registrado en sprint".
- Pasar a revisión: aviso "Sprint en revisión".
- **Cerrar** (En revisión): revisión y retro obligatorias; mejora exige responsable y fecha (crea tarea de mejora); "Alcanzado" exige evidencia del objetivo; con tareas pendientes **solo con excepción** (autorización, causa, responsable, fecha ≥ hoy) — las pendientes vuelven al backlog con riesgo "requiere nueva planificación". Aviso "Cierre de sprint".
- **El sprint solo cubre el trabajo de las mesas, no las salidas al aire.**

### 5.6 Mesa al aire: series y salidas

- **Canales (13)**: Instagram, Facebook, TikTok, LinkedIn, YouTube, Correo (Brevo), WhatsApp, Sitio web, Meta Ads, Google Ads, TikTok Ads, LinkedIn Ads, Prensa y medios. Canal de anuncios = termina en "Ads".
- Una tarea puede tener **varias series** y **salidas sueltas**.
- **Serie de publicaciones en días fijos** (`dias`): nombre de pieza, canal, días de la semana (L M X J V S D), hora, desde, semanas (1–52), horas por pieza. Genera una pieza por cada día elegido durante `semanas × 7` días, numeradas.
- **Serie de anuncios activos** (`periodo`): fecha de activación, semanas, nº de creatividades (1–50, defecto 3), horas por pieza. Genera N piezas en la fecha de activación, activas hasta `desde + semanas×7 − 1`.
- Elegir canal de anuncios fuerza `periodo`; los demás, `dias`. El nombre de pieza por defecto depende del canal (Mail, Post, Video, Mensaje, Nota, Anuncio, Pieza).
- Plantillas rápidas: **Mail** (Correo, L-X-V, 10:00, 4 semanas, 0,5 h) · **Orgánico** (Instagram, L–V, 12:00, 4 semanas, 1 h) · **Anuncios** (Meta Ads, período, 09:00, 4 semanas, 3 creatividades, 2 h).
- **Horas**: total de la serie = piezas × horas por pieza → pasa a las horas estimadas de la tarea (§14-P11). Las salidas sueltas no suman horas.
- **Plazos**: revisión = **2 días**. La fecha de salida propone la fecha límite = primera salida − 2 días (acotada a ≥ hoy y ≤ primera salida). **No se puede guardar un plazo posterior a la primera salida.** Si quedan < 2 días: advertencia.
- Validación: con salida al aire activa, ≥ 1 serie o salida suelta; serie de días con ≥ 1 día.
- **Estado de cada pieza** (primera regla que se cumple): Al aire → **Al aire** · fecha pasada → **Atrasada** · tarea hecha → **Lista para salir** · plazo > fecha de salida o salida ≤ hoy + 2 días → **En riesgo** · si no → **En la mesa**.
- Marcar al aire: tarea hecha; URL opcional; registra quién y cuándo. Con URL → verifica lanzamiento de la campaña.
- *Corrección*: editar una serie no debe perder el estado, URL ni aviso de piezas ya existentes (el prototipo las recrea al cambiar la fecha).

### 5.7 Campañas 360, webinar y catálogo

- **Campaña 360 (protocolo `360-2`)**: alcance por mes — orgánicas 12 (0–60), reels 4 (0–30), mailings 4 (0–30), piezas de campaña 4 (0–30), inputs validados, canales (≥ 1: Meta Ads, Google Ads, Brevo · mailing y newsletter, Instagram / Facebook, YouTube, LinkedIn, TikTok), ventana al aire (inicio, fin = inicio + 3 meses − 1 día; fin ≥ inicio), responsables de Marketing, de inputs comerciales y revisor.
  - 8 tareas de preparación (3 h): Inputs y oferta comercial · Objetivo, KPI y presupuesto · Revisar y depurar base de datos · Segmentar audiencia · Validar medición GA4 y Meta · Preparar landing y experiencia móvil · Definir mensaje y piezas maestras · Aprobar preparación y lanzamiento (dependencias: cadena; 5 y 6 dependen de 3; 7 de 4, 5 y 6).
  - Cadenas del catálogo "Públicos de Meta" (5) y "Landing de captación" (6), plazo inicio + 14 días.
  - Por cada uno de los 3 meses: unidades orgánicas (6 pasos), video/reel (5), mailing (7), pieza de campaña (4, herramienta Canva), cada unidad en cadena tras la aprobación de preparación; + 3 tareas mensuales de 3 h (Configurar y aprobar Meta Ads / Google Ads; Optimizar pauta y registrar pruebas; Informe mensual y calidad comercial).
  - Cierre trimestral y aprendizajes (3 h), depende de todo.
  - Con el alcance por defecto: **8 + 5 + 6 + 3 × 139 + 1 = 437 tareas**. *Corrección*: se generan directamente (el prototipo crea 33 y borra 24).
  - Al crear: propuesta semanal de sprints. Si hay plan estratégico: iniciativa "Campaña 360" automática.
- **Webinar (`webinar-1`)**: 31 tareas (~84,5 h), 20 días hábiles antes y 5 después del evento, offsets en días hábiles; evento ≥ hoy; hora por defecto 18:00, 90 min (30–480), plataforma Google Meet; responsables por área + revisor; reunión del evento para cada responsable; tareas con inputs sin validar (deben validarse antes de proponer sprints); herramienta según título; exportación .ics. La tabla completa de 31 pasos (título, offset, horas, área, dependencias) se toma literal del prototipo (`webinarProtocol`).
- **Catálogo de servicios** (14, con pasos, horas y herramienta): Presentación Canva (16 h) · Presentación interactiva Canva (24 h) · Contenido orgánico (9 h) · Video o reel (12 h) · Elemento gráfico (8 h) · Mailing o newsletter HTML (12 h) · Landing de captación (27 h) · Sitio web institucional (54 h) · Plataforma tecnológica (48 h) · Públicos de Meta (12 h) · Medición digital (16 h) · Informe de resultados (10 h) · Sistema de marca y plantillas (42 h) · Correo transaccional HTML (12 h). Los pasos exactos se toman del prototipo (`SERVICE_CATALOG`).
- **Trabajo del catálogo**: servicio, nombre, marca, inicio, entrega comprometida (defecto +5 días hábiles), urgencia, cantidad 1–30, responsable, revisor, inputs validados. Una cadena por unidad; los pasos de "Revisión/Aprobar" van al revisor.
- **Encargo personalizado / plantilla**: pasos con título, horas (> 0), herramienta, instrucción, entregable, criterio, dependencia (paso anterior o ninguna), rol (ejecuta / revisa). Guardar plantilla crea **nueva versión** sin cambiar trabajos existentes (el trabajo guarda copia de los pasos).
- **Propuesta semanal** (coordina): propaga prioridad a prerrequisitos; ordena; cada tarea debe caber **entera en una semana** al **≤ 80 %** de la capacidad neta, buscando hasta 26 semanas; marca "Fuera de plazo"; problemas posibles (sprint iniciado, sin responsable, bloqueo, inputs sin validar, dependencia inexistente, no cabe, dependencias pendientes). Aplicar: busca o crea el sprint "Semana <lunes>" de la marca, agrega al responsable (8 h), reserva agenda.

### 5.8 Bases y segmentos (datos personales de contactos)

- CSV ≤ 2 MB, separador `;` o `,` autodetectado, comillas; columna de correo obligatoria (email/correo/e-mail); opcionales nombre, ubicación (ciudad/comuna), interés, autorizado/consentimiento, baja.
- Estado por fila: Inválido → Baja → Duplicado → Pendiente de respaldo (sin consentimiento) → Habilitado. Una baja en cualquier fila del archivo degrada las demás del mismo correo.
- Supresión por marca: todas las bajas de todas las bases de esa marca.
- Segmento: habilitados no suprimidos, filtros "contiene"; ≥ 1 contacto; *Corrección*: el conteo se recalcula (no se congela).
- Exportar con protección contra inyección de fórmulas.
- Las bajas que informe el webhook de Brevo se agregan a la supresión de la marca.

### 5.9 Logros automáticos

Se evalúan en el servidor tras cada cambio relevante y en un cron (reemplaza el intervalo de 60 s del navegador).

| Tipo | Clave única | Válido cuando |
|---|---|---|
| Tarea aceptada | tarea + ciclo de ejecución | hecha, sin bloqueo, con criterio y evidencia, ≥ 1 participante activo. Solo nace si **cambia** a aceptable (no se publican retroactivamente tareas ya hechas al iniciar). Si deja de cumplirse → "Reconocimiento en actualización" |
| Día cumplido | persona + día | compromiso con ≥ 1 tarea, todas aceptables, y ya pasó la hora de término (Santiago) |
| Sprint completo | sprint | Cerrado, con registros, todos aprobados y todas sus tareas aceptables |
| Objetivo del sprint alcanzado | sprint | Cerrado, resultado Alcanzado, revisión y evidencia |
| Lanzamiento verificado | campaña | fecha y evidencia de lanzamiento (mesa Marketing) |
| Entrega entre áreas | tarea | aceptable y recepción confirmada; personas = participantes + receptor |

Visibilidad del detalle: sesión, no restringido, marca permitida, todas las tareas visibles (y confidenciales solo a participantes o esAdmin); si no, título genérico. Una felicitación por persona (alterna). Menciones → bandeja, salvo que la persona las desactive.

### 5.10 Equipo, accesos y mesas

- Invitación: solo esAdmin; correo único (personas e invitaciones vigentes); vence a los 7 días; un solo uso. En la versión real el acceso lo da Cloudflare Access; la invitación crea la persona y habilita su correo en Access.
- Persona: nombre (≤ 90) y correo únicos; WhatsApp `+` y 8–15 dígitos; área, rol, estado, marcas (≥ 1).
- **Salida de un integrante** (generalización de una migración del prototipo hecha para una persona puntual): queda inactiva con nota; sus avisos pendientes se cancelan; sus tareas abiertas quedan bloqueadas con "Revisar asignación por salida de X"; si era administrador, se exige transferir antes.
- Mesas: nombre único (≤ 70), descripción ≤ 300; renombrar actualiza las tareas; no se archiva una mesa con tareas abiertas.
- Marcas: nombre único (≤ 80), 21 mínimos al crear, % vigentes = Vigente / 21.

### 5.11 Plan estratégico y vista de mandantes

- Plan trimestral: fin = inicio + 3 meses − 1 día. La marca no cambia si ya tiene trabajo o iniciativas. Trabajo del plan = tareas vinculadas + tareas de sus campañas.
- Métrica con valor actual exige fuente. Iniciativas dentro del trimestre; evidencia http(s).
- Al cerrar un sprint con trabajo del plan se crea un borrador de reporte (*Corrección*: se actualiza si cambian los registros).
- Publicar (esAdmin): ≥ 1 métrica, ≥ 1 iniciativa dentro del trimestre; reemplaza la instantánea anterior; solo reportes aprobados.

---

## 6. Automatizaciones (servidor, Cron + Queues, idempotentes)

| # | Automatización | Disparo | Idempotencia |
|---|---|---|---|
| A1 | Proponer fecha límite = primera salida − 2 días; impedir plazo > primera salida | Al guardar tarea (API) | Validación |
| A2 | Reservar horas estimadas en la agenda del responsable y recalcular | Al guardar tarea, reunión, plan o al cambiar dependencias | Plan único por tarea (upsert) |
| A3 | Entrar sola al sprint **Planificado** de la semana de sus horas (misma marca, responsable miembro). Nunca a un sprint iniciado | Tras A2 | `sprint_id` nulo como condición; evento único |
| A4 | Pieza de tarea aprobada pasa a "Al aire" al llegar su hora | Cron cada minuto | `UPDATE … WHERE status='Programada'` |
| A5 | Aviso de riesgo (salida ≤ 2 días, tarea sin aprobar) **una sola vez** a responsable, revisor y aprobadores por app, push y Brevo | Cron cada 15 min | Clave única `riesgo:<pieza>:<fecha de salida>` (si la fecha cambia, puede volver a avisar — §14-P14) |
| A6 | Pieza marcada al aire con enlace verifica el lanzamiento de la campaña | Al marcar | Solo si la campaña no tiene lanzamiento |
| A7 | Programar series de mails en Brevo con fecha y hora | Al aprobar la tarea / al guardar la serie | ID de campaña Brevo guardado por pieza |
| A8 | Avisos agrupados en resúmenes según preferencias (no uno por cambio) | Cron diario 08:00 y semanal lunes 08:00 | Clave por persona y período |
| A9 | Logros automáticos | Tras cambios + cron cada 5 min | Clave única por logro |
| A10 | Invitaciones vencidas | Cron diario | Estado |
| A11 | Borradores de reporte del plan al cerrar sprint | Al cerrar sprint | Clave sprint + plan |
| A12 | Reintentos de envío con backoff y registro de estado | Queue | `dedupe_key` en el outbox |

---

## 7. Avisos

### 7.1 Envíos (outbox)

Cada aviso es una fila por persona × canal (`app`, `push`, `email`, `whatsapp`) con estado real: `pendiente` → `encolado` → `enviado` → `entregado` / `rebotado` / `fallido` / `cancelado`, intentos y error. Brevo informa entregas, rebotes y bajas por webhook.

Eventos que generan aviso (del prototipo): Nueva tarea asignada · Cambio de tarea o asignación · Retiro de asignación · Entrega para revisión · Ajustes solicitados · Tarea aprobada · Nuevo comentario · Seguimiento de tarea (manual) · Bloqueo registrado en sprint · Inicio / revisión / cierre de sprint · Término recalculado por agenda (a responsable, director de la marca e involucrados — §14-P16) · Salida al aire en riesgo · Invitación · Mención · Reconocimiento.

Mensaje estándar: `[mesawow] <evento>` · Mesa · Marca · Tarea · Responsable · Estado · Plazo (America/Santiago) · Entregable · Comentario · enlace directo seguro a la tarea.

### 7.2 Campana (por persona, con no leídas)

| Clave | Condición | Para quién | Título |
|---|---|---|---|
| `m:<mención>` | mención en Comunidad | mencionado | "<X> te mencionó" |
| `late:<tarea>:<plazo>` | propia, no hecha, plazo < hoy | responsable | Tarea atrasada |
| `adj:<tarea>:<versión>` | propia en Ajustes solicitados | responsable | Te pidieron ajustes |
| `rev:<tarea>:<versión>` | Entregada para revisión | revisor y aprobadores | Tienes una entrega para revisar |
| `blk:<tarea>:<motivo>` | bloqueada | coordinaODirige e involucrados | Tu tarea está bloqueada / Tarea bloqueada |
| `spr:<tarea>:<sprint>` | entró sola a un sprint (≤ 7 días) | responsable | Tu tarea entró sola a un sprint |
| `air:<tarea>:<piezas>` | piezas no al aire, tarea no hecha, salida ≤ hoy + 2 | coordinaODirige e involucrados | Piezas en riesgo / Piezas atrasadas |
| `on:<tarea>:<n>` | piezas que salieron solas (≤ 7 días) | coordinaODirige e involucrados | Salió al aire … publicada(s) sola(s) |
| `new:<tarea>` | tarea nueva asignada (≤ 7 días) | asignado | Te asignaron una tarea |

Panel: no leídas primero, 40 ítems, contador "9+", "Marcar todo como leído", abrir marca como leída, cerrar con Escape o tocando fuera. Si la condición cambia (nueva clave) vuelve a aparecer como no leída. En la versión real las alertas se **materializan** en D1 y se empujan por el Durable Object.

---

## 8. Modelo de datos (D1)

Convenciones: IDs texto (UUID); fechas `TEXT` ISO (`YYYY-MM-DD` o `YYYY-MM-DDTHH:MM` hora de pared Santiago donde se indica; marcas de tiempo en UTC ISO); `created_at`, `updated_at`; borrado lógico donde aplica. Archivos en R2 con su llave en D1.

### 8.1 Tablas

**Organización y personas**
- `brands` (id, name UNIQUE, color, description, director_id, archived)
- `brand_minimums` (brand_id, idx 0–20, title, state, note, updated_by, updated_at) — PK (brand_id, idx)
- `brand_team_roles` (brand_id, role_key, person_id)
- `mesas` (id, name UNIQUE, active, owner_id, description)
- `people` (id, name, email UNIQUE, phone, role, mesa_id, active, departed, departure_note, bio, photo_key, admin_general BOOL, last_seen_at)
- `person_brands` (person_id, brand_id)
- `invitations` (id, token_hash, email, name, mesa_id, role, status, expires_at, inviter_id, accepted_at)
- `invitation_brands` (invitation_id, brand_id)
- `preferences` (person_id, mentions, summary, email, whatsapp, push, metro_brands_json)

**Trabajo**
- `campaigns` (id, brand_id, type `360|webinar|email|otra`, name, objective, metric, target, budget, audience, platform, segment_id, subject, preheader, sender, reply_to, cta, url, html_key, account, utm_source, utm_campaign, start, end, live_start, live_end, sched_date, sched_time, status, version, approved_version, approved_at, approved_by, review_comment, external_id, evidence, launched_at, launch_evidence, protocol_version, protocol_reviewer_id, scope_json, event_date, event_time, event_minutes, event_platform, speakers, planning_note, estimated_hours, notes)
- `campaign_channels` (campaign_id, channel)
- `tasks` (id, brand_id, campaign_id, job_id, plan_id, mesa_id, title, description, deliverable, acceptance, owner_id, reviewer_id, start, due, complexity, priority, status, blocked, block_reason, block_resolver_id, block_due, estimated_hours, remaining_hours, planned_finish, inputs_ready, tool, sprint_id, backlog_rank, planning_risk, confidential, approved_by, approved_at, reopened_at, execution_cycle, exchange_mesa_id, exchange_person_id, exchange_evidence, exchange_accepted_at, protocol_version, protocol_step, fixed_event, air_book, created_by, version)
- `task_people` (task_id, person_id, role `collaborator|approver`)
- `task_dependencies` (task_id, depends_on_id)
- `task_results` (id, task_id, type `text|html|image|pdf`, text, file_key, filename, created_by, created_at)
- `task_comments` (id, task_id, author_id, text, created_at)
- `task_events` (id, task_id, event, sprint_id, reason, actor_id, created_at) — incluye historial de sprint
- `air_series` (id, task_id, name, channel, mode `dias|periodo`, days, time, from_date, weeks, count, hours)
- `air_slots` (id, task_id, series_id NULL, channel, piece, at, end_date, status `Programada|Al aire`, published_at, url, published_by, auto, risk_notified_at, brevo_campaign_id)
- `service_templates` (id, key, name, version, steps_json, builtin, archived, updated_at)
- `jobs` (id, title, brand_id, template_id, template_version, steps_snapshot_json, created_by)

**Agenda y sprints**
- `holidays` (date PK, name, source `manual|oficial`)
- `meetings` (id, person_id, title, start, end, campaign_id, source `manual|google`)
- `work_plans` (task_id PK, person_id, start, hours, week, weekly, late, finish)
- `work_blocks` (id, task_id, person_id, start, end)
- `plan_changes` (id, task_id, old_finish, new_finish, delay_minutes, cause, created_at)
- `sprints` (id, brand_id, mesa_id, name, goal, start, end, facilitator_id, status, weekly, goal_result, goal_evidence, review, retro, improvement, improvement_owner_id, improvement_date, close_exception_json, baseline_json, closed_at)
- `sprint_members` (sprint_id, person_id, daily_hours)
- `sprint_daily` (id, sprint_id, task_id, person_id, day, progress, next, block, resolver_id, required_date, created_at)
- `sprint_changes` (id, sprint_id, action, reason, actor_id, created_at)
- `sprint_closed_records` (sprint_id, task_id, title, status, approved, evidence)

**Estrategia y mandantes**
- `strategic_plans` (id, brand_id, name, start, end, objective, audience, budget, diagnosis, notes)
- `plan_metrics`, `plan_initiatives`, `plan_reports` (con snapshot de métricas)
- `public_snapshots` (plan_id PK, payload_json, published_at, published_by)

**Comunidad**
- `achievements` (id, key UNIQUE, type, source, source_id, title, brand_id, mesa_id, sprint_id, grp, day, valid, restricted, created_at, updated_at)
- `achievement_people`, `achievement_tasks`, `achievement_history` (valid, at)
- `reactions` (achievement_id, person_id, created_at) — PK compuesta
- `achievement_comments` (id, achievement_id, person_id, text, mention_id, removed, created_at)
- `achievement_reports` (id, achievement_id, by_id, reason, status, resolution, resolved_at)
- `mentions` (id, person_id, achievement_id, from_id, read_at)
- `commitments` (id, person_id, day, end_time, UNIQUE(person, day)) + `commitment_tasks` (commitment_id, task_id, baseline) + `commitment_changes`
- `wow_seen` (person_id, achievement_id) — confeti una vez

**Bases**
- `contact_bases` (id, brand_id, filename, stats_json, created_by)
- `contact_rows` (id, base_id, email, name, location, interest, status)
- `segments` (id, brand_id, base_id, name, location, interest)

**Avisos e integraciones**
- `outbox` (id, dedupe_key UNIQUE, event_id, person_id, channel, event, task_id, payload_json, status, attempts, provider_id, error, created_at, sent_at)
- `alerts` (id, person_id, key, type, task_id, title, body, target, created_at, read_at, UNIQUE(person_id, key))
- `email_events` (id, provider_id, event, email, payload_json, received_at)
- `push_subscriptions` (id, person_id, endpoint UNIQUE, keys_json, created_at)
- `platform_cards` (name PK, account, url, owner_id) · `channel_cards` (channel PK, provider, account, owner_id, template)
- `audit_log` (id, at, actor_id, action, entity, entity_id, details_json) — reemplaza `history` y alimenta el muro
- `import_runs` (id, source, summary_json, created_at)

### 8.2 Enumeraciones

Ver §2.1 (roles), §5.1 (estados de tarea), §5.3 (estados de campaña), §5.5 (sprint), §5.6 (canales, modos, estados de pieza), §5.8 (filas de contacto), §5.9 (logros), §7.1 (estados de envío). Estados de mínimo: Pendiente de verificar · Vigente · Incompleto · Desactualizado · Faltante. Iniciativas: tipos Campaña 360 · Webinar · Contenido continuo · Sitio web · Plataforma · Presentación · Otra iniciativa; estados Planificada · En preparación · Activa · Finalizada · Pausada.

### 8.3 Datos semilla

- 21 mínimos de marca: Definición y propuesta de valor · Voz y tono de marca · Identidad visual completa · Manual de marca · Brandboard · Plantilla de presentación descargable · Presentación institucional · Materiales acordados con Comercial · Plantillas de correos transaccionales · Plantillas de mailing · Plantillas de newsletter · Página web funcional · Experiencia móvil tipo aplicación · Redes según perfil de marca · Plantillas de contenido social · Contenido orgánico misceláneo · Google Analytics verificado · Meta y eventos verificados · Atención y respaldo de confianza · Documentos del servicio · Recursos editables y descargables.
- 8 mesas por defecto (§4.11), 14 servicios del catálogo, 3 plantillas de serie, 7 plataformas.
- Marcas: en desarrollo, **marcas inventadas**; las reales llegan con el importador o el administrador (§14-P5).

### 8.4 Importador del respaldo del prototipo

Entrada: `respaldo_mesa.json` (estado completo del prototipo). Reglas:
- **Descarta** `passwordHash`, `salt` y cualquier sesión.
- Convierte nombres de persona y títulos de tarea en IDs (reporta ambigüedades).
- Archivos `data:` (resultados, fotos) → R2.
- Normaliza formatos de fecha (`publishedAt` mixto), `airSeries` objeto → lista, alias de áreas.
- Idempotente (re-ejecutable): ID de origen conservado; informe de importación.
- En desarrollo funciona contra D1 local; con datos reales solo cuando el acceso esté listo.

---

## 9. API REST (Worker, TypeScript)

Base `/api/v1`. JSON. Identidad desde el JWT de Cloudflare Access (`Cf-Access-Jwt-Assertion`), validado en cada petición. Errores `{error:{code,message}}` en español. Control de concurrencia por `version` (409 si cambió).

| Recurso | Endpoints |
|---|---|
| Sesión | `GET /me` (persona, rol, permisos derivados, marcas) |
| Inicio | `GET /home` (métricas, hito, logros del día, actividad, tu día, paneles) |
| Tareas | `GET /tasks?filtros` · `POST /tasks` · `GET/PATCH /tasks/:id` · `POST /tasks/:id/{start,block,unblock,deliver,approve,request-changes,reopen,exchange,results,comments,notify}` |
| Al aire | `GET /air?canal&rango` · `PUT /tasks/:id/air` (series + sueltas) · `POST /air/:slotId/publish` |
| Agenda | `GET /agenda?persona&dia` · `POST /plans` · `POST /meetings` · `GET /calendar?mes&persona&modo` · `GET /team-week?semana` |
| Sprints | `GET/POST /sprints` · `PATCH /sprints/:id` · `POST /sprints/:id/{start,review,close,tasks,daily}` · `DELETE /sprints/:id/tasks/:taskId` · `GET/PUT /holidays` · `POST /backlog/rank` |
| Campañas | `GET/POST /campaigns` · `PATCH /campaigns/:id` · `POST /campaigns/:id/{submit,request-changes,approve,schedule,launch,validate-inputs}` · `POST /campaigns/360` · `POST /campaigns/webinar` · `GET /campaigns/:id/ics` |
| Catálogo | `GET /services` · `POST /jobs` · `GET/POST/PUT /templates` · `POST /planning/proposal` · `POST /planning/apply` · `GET /planning/ics` |
| Mesas y marcas | `GET/POST/PATCH /mesas` · `GET/POST/PATCH /brands` · `PUT /brands/:id/minimums` |
| Estrategia | `GET/POST/PATCH /plans` · métricas, iniciativas, reportes · `POST /plans/:id/publish` · `GET /public/mesa` (sin sesión, solo instantáneas) |
| Comunidad | `GET /achievements` · `POST /achievements/:id/{react,comments,report}` · `DELETE /comments/:id` · `GET/PUT /commitments/today` · `GET /recognition` · `GET/POST /moderation` |
| Personas | `GET /people` · `GET/PATCH /people/:id` · `PUT /me/profile` · `PUT /me/photo` · `GET/PUT /me/preferences` · `POST /invitations` · `POST /invitations/:id/revoke` · `POST /people/:id/depart` |
| Avisos | `GET /alerts` · `POST /alerts/read` · `GET /notifications` · `POST /push/subscribe` |
| Bases | `POST /bases` (CSV) · `GET /bases/:id` · `POST /segments` · `GET /segments/:id/export` |
| Informes | `GET /reports?persona&estado` |
| Integraciones | `POST /webhooks/brevo` (firma) · `GET/PUT /platforms` · `GET/PUT /channels` |
| En vivo | `GET /live` (WebSocket → Durable Object por equipo) |
| Admin | `POST /admin/import` (respaldo del prototipo) |

---

## 10. Identidad mesawow

- Tipografía **Poppins** 400–800 (fallback system-ui).
- Colores: rosa **#F22E62**, naranja **#FF7A00**, amarillo **#FFFF00** (rayo en negativo; #FFC700 en color), violeta **#9B5CFF**, teal **#00A2AF**, azul noche **#0F1B3D**. Fondo #FBF6FA, líneas #ECE6F0, texto secundario #4A5274.
- **Degradado WOW**: `linear-gradient(90deg,#F22E62,#FF7A00)` (y diagonal 135°).
- Logos, isotipo y sonrisa desde `marca/` (SVG). La sonrisa es el símbolo de reconocimiento.
- Radios 10/16/24 px, píldoras 999 px; sombra `0 10px 30px rgba(15,27,61,.08)`.
- Un solo punto de quiebre móvil (*Corrección*: el prototipo mezcla 750 y 760 px).
- Accesibilidad (*Correcciones*): texto sobre el degradado en peso ≥ 600 y tamaño ≥ 18 px o sobre fondo oscuro para cumplir contraste; gris secundario oscurecido para AA; enlace "saltar al contenido"; `aria-live` en la actividad en vivo; íconos de navegación con texto accesible; áreas táctiles ≥ 44 px sin excepciones; sin scroll horizontal; navegación con teclado; `prefers-reduced-motion`.
- Textos de prototipo que se eliminan: "Prototipo local", avisos de demostración, "/ marketing", pie de prototipo.

---

## 11. Criterios de aceptación (resumen por módulo)

Cada regla de §5–§7 tiene su prueba automatizada. Mínimos:

1. Un usuario sin rol coordina recibe 403 al crear o editar una tarea por API, aunque la interfaz lo permita.
2. Una tarea sin criterio de aceptación no puede crearse; una sin evidencia no puede aprobarse.
3. Entregar con dependencias pendientes o bloqueada → rechazo con el mensaje del prototipo.
4. No se puede guardar un plazo posterior a la primera salida al aire; la propuesta es primera salida − 2 días.
5. La serie "Mail L-X-V, 4 semanas, 0,5 h" genera 12 piezas y 6 h estimadas.
6. Las horas reservadas respetan 09–14 / 15–18, lunes a viernes, reuniones y feriados.
7. Una tarea entra sola a un sprint Planificado de su semana, y nunca a uno Activo.
8. Ejecutar dos veces el cron de "al aire" o de riesgo no duplica estados ni avisos.
9. La campaña 360 con alcance por defecto genera exactamente 437 tareas y sus dependencias.
10. El webinar genera 31 tareas con ~84,5 h.
11. Un sprint no inicia si un miembro supera el 80 % de su capacidad.
12. Cerrar un sprint con tareas pendientes exige excepción completa.
13. La vista pública no expone nada que no esté en una instantánea publicada.
14. Felicitar dos veces quita la felicitación; el confeti de un hito aparece una vez por persona.
15. Un aviso de Brevo rebotado queda registrado con su estado.
16. Pantalla por pantalla, la versión real ofrece todo lo listado en §3–§4.

---

## 12. Plataforma

Workers (app estática + API TypeScript) · D1 con migraciones en `migrations/` · Durable Objects con WebSocket Hibernation (Inicio, campana, calendarios) · R2 (fotos, evidencias, archivos) · Cloudflare Access (correo de cada integrante) · Queues + Cron Triggers · PWA instalable con Web Push · Brevo (API transaccional desde el Worker vía Queues; `BREVO_API_KEY` como secreto de Wrangler; plantillas con la identidad; webhook de eventos; SPF, DKIM y DMARC) · Entornos local (`wrangler dev`), `staging` y `production`, cada uno con su D1 y su R2.

---

## 13. Diferencias deliberadas con el prototipo (correcciones)

1. IDs en vez de nombres de persona y títulos de tarea como llave (tareas, avisos, historial, muro).
2. Historial con el usuario real (el prototipo fija a una persona).
3. Permisos aplicados en servidor, incluido el rol Consulta y la aprobación de campañas.
4. Criterio de aceptación obligatorio al crear una tarea.
5. Fechas por defecto = hoy (el prototipo fija noviembre 2026 en Gantt, mapa y agenda).
6. 360 generada directamente (sin crear y borrar), alcance como parámetro.
7. Conteo de segmentos dinámico; reportes del plan actualizables.
8. Editar series conserva piezas existentes; `publishedAt` en un solo formato.
9. Motivo de edición de sprint guardado; prioridad Urgente en el orden del backlog.
10. Logros y automatizaciones en el servidor (no en un intervalo del navegador).
11. Respaldo sin hashes de contraseña; archivos en R2, no en base64.
12. Un solo punto de quiebre móvil y contraste AA.
13. Contraseñas locales eliminadas: el ingreso es por Cloudflare Access.
14. Dominio UID único en los .ics.

---

## 14. Preguntas abiertas

**Acceso y estructura**
- **P1. Dominio y entrada.** ¿`mesawow.cl` muestra la vista pública de mandantes a cualquiera y el equipo entra por `/admin-login` (como el prototipo), o todo queda detrás de Access y la vista de mandantes va en otra dirección (p. ej. `mandantes.mesawow.cl`)? *Propuesta*: app en `app.mesawow.cl` detrás de Access; `mesawow.cl` pública.
- **P2. Roles externos.** ¿Qué ven Mandante, Consulta externa y Administrador técnico dentro de la app? ¿Necesitan entrar o les basta la vista pública?
- **P3. WhatsApp.** El prompt pide Brevo para correo. El prototipo trata WhatsApp como canal obligatorio en producción. ¿Se integra WhatsApp (Brevo tiene WhatsApp Business, con costo y plantillas aprobadas por Meta) o en la V1 basta app + push + correo?

**Reglas**
- **P4. Feriados.** ¿Se cargan automáticamente los feriados oficiales de Chile cada año y se permiten días no laborables manuales adicionales?
- **P5. Marcas reales.** ¿Las 10 marcas (incluida Partner & Adviser y "Grupo Matchmaking") se cargan desde el importador o las crea el administrador? ¿Alguna se retira?
- **P6. Criterio de aceptación** obligatorio desde la creación de la tarea (propuesto) ¿o solo antes de aprobar?
- **P7. Rol Consulta.** ¿Confirmas que es solo lectura total?
- **P8. Dirección.** Existe la mesa "Dirección" pero no un rol "Dirección". ¿Se crea un rol, o "dirige" quien pertenece a la mesa Dirección?
- **P9. Aprobación de campañas.** ¿Quién aprueba una versión de campaña: coordinación, el director de la marca o un aprobador definido por campaña?
- **P10. Calendarios ajenos.** ¿Una persona sin rol de coordinación puede ver el calendario de otra (hoy sí, filtrando tareas)?
- **P11. Horas.** (a) ¿Toda tarea con horas reserva agenda, o solo cuando se marca "Reservar"? (b) ¿El total de las series reemplaza las horas escritas a mano o se suma?
- **P12. Inicio de sprint.** Sobre el 80 % de capacidad: ¿bloqueo duro (prototipo final) o excepción autorizada con motivo?
- **P13. Reabrir.** ¿Una tarea reabierta y vuelta a aprobar genera un nuevo logro (nuevo ciclo) o reactiva el anterior?
- **P14. Riesgo al aire.** Si cambia la fecha de salida, ¿se vuelve a avisar?
- **P15. Saludo por hora** (Buenos días / tardes / noches): ¿se muestra o queda "¡Hola, X!"?
- **P16. Avisos de atraso de agenda.** El prototipo avisa a todo el equipo de la marca. ¿Solo responsable, involucrados y director de marca?
- **P17. Tareas más grandes que una semana.** La planificación semanal exige que la tarea quepa en una semana (si no, "dividir el entregable"). ¿Se mantiene?
- **P18. Capacidad semanal.** "Semana del equipo" usa 40 h fijas por persona. ¿Capacidad individual (jornadas parciales, feriados)?
- **P19. Encargos personalizados.** Hoy siempre quedan en la mesa Marketing. ¿Se elige la mesa?
- **P20. Google Calendar.** Está en el prototipo como simulador. ¿Entra en la V1 (OAuth por persona, leer reuniones y escribir bloques) o queda para después?
- **P21. Vista previa "Ver un ejemplo con el equipo activo"** del muro: ¿se mantiene?
**Resueltas:** P1 → D1 · P3 → D2 · P4 → D3 · P20 → D4 · P22 (horario) → D6.
