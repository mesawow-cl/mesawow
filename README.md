# mesawow

La plataforma donde el trabajo se vive, se comparte y se celebra.

Versión real del prototipo (`prototipo/mesawow.html`) sobre Cloudflare Workers, D1 y R2.
El requerimiento completo, con decisiones y preguntas abiertas, está en [docs/requerimiento-mesawow.md](docs/requerimiento-mesawow.md).

## Desarrollo local

Requisitos: Node 22.18 o superior.

```sh
npm install
npm run db:migrate:local   # crea la base D1 local con el esquema y los datos base
npm run db:seed:local      # agrega personas y marcas de ejemplo (inventadas)
npm run dev                # http://localhost:5173
```

En local, la app pide elegir con qué persona de ejemplo entrar ("Entrar como"), para probar cada rol.
Atajo: `http://localhost:5173/?entrar=bruno@mesawow.test`. En staging y production el ingreso es con Cloudflare Access.

Para probar en el teléfono, abre la dirección "Network" que muestra `npm run dev` (misma red wifi).

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas (corren en el motor de Workers, con D1 en memoria) |
| `npm run typecheck` | Revisión de tipos del Worker, la app y los scripts |
| `npm run build` | Compila la app y el Worker en `dist/` |
| `npm run db:reset:local` | Borra la base local y la vuelve a crear con los datos de ejemplo |
| `npm run datos-base` | Regenera `migrations/0002_datos_base.sql` y `seed/desarrollo.sql` desde `src/shared/` |
| `npm run types` | Regenera los tipos de `wrangler.jsonc` (`worker-configuration.d.ts`) |

## Importar el respaldo del prototipo

En el prototipo: Plataformas → "Descargar respaldo local" (`respaldo_mesa.json`). Luego:

```sh
npm run importar -- ruta/respaldo_mesa.json                  # genera importacion/ y muestra el informe
npm run importar -- ruta/respaldo_mesa.json --aplicar-local  # además lo carga en D1 y R2 locales
```

El importador descarta contraseñas e invitaciones, convierte nombres en IDs, pasa archivos a R2 y se puede
ejecutar más de una vez sin duplicar nada. La carpeta `importacion/` puede contener datos personales:
está excluida del repositorio.

## Estructura

```
prototipo/    el prototipo original y el manual de marca (referencia, no se modifica)
marca/        logos, isotipo, sonrisa y favicon (SVG y PNG)
docs/         requerimiento
migrations/   esquema D1 versionado
seed/         datos de ejemplo para desarrollo local
src/shared/   reglas y constantes compartidas por el Worker y la app
src/worker/   API REST /api/v1 (Hono)
src/app/      la app (Preact)
src/importador/  importador del respaldo del prototipo
scripts/      generación de datos base e importación
test/         pruebas
```

## Entornos

`wrangler.jsonc` define `local`, `staging` y `production`, cada uno con su D1 y su R2. Los IDs reales de
staging y production se completan en la Fase 8. Los secretos (por ejemplo `BREVO_API_KEY`) se cargan con
`wrangler secret put` y nunca van en el código.
