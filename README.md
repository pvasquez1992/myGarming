# My Garmin API

API personal en **TypeScript + Hono**, ejecutada en **Cloudflare Workers** con **D1**.
El importador es una consola de **C# / .NET 10**, sin paquetes externos.

En esta carpeta ya se preparó la base **local** con **304 actividades** y **901 resúmenes diarios**, desde el 12 de febrero de 2024 hasta el 31 de julio de 2026. No se ha creado ningún recurso en tu cuenta de Cloudflare.

## Probar lo que ya está preparado

Abre PowerShell en `C:\myGarming`. Como el Node global de este equipo es 18, se descargó Node 24 LTS portable dentro de `.tools`, verificado con el SHA-256 publicado por Node.js. Para usarlo únicamente en esta terminal:

```powershell
. .\scripts\use-node.ps1
npm run dev
```

Abre **Swagger UI** en <http://127.0.0.1:8787/docs> para explorar las rutas y ejecutar consultas con **Try it out**.
También puedes abrir <http://127.0.0.1:8787/health> o <http://127.0.0.1:8787/api/activities?limit=5>.
El servidor escucha solo en tu ordenador. En desarrollo no exige autenticación por defecto.

## Instalar en otro equipo

Requisitos: **Node.js 24 LTS** (mínimo 22), **.NET SDK 10** y el ZIP de exportación de Garmin.

```powershell
npm ci
npm run setup:local
npm run dev
```

`setup:local` crea las tablas, convierte el ZIP y carga los datos en D1 local. No requiere login de Cloudflare.
Si hay más de un ZIP en la carpeta, ejecuta los pasos indicando cuál importar:

```powershell
npm run db:migrate
npm run data:import -- --zip "ruta\exportacion.zip"
npm run db:seed
npm run dev
```

Para actualizar tu historial, vuelve a ejecutar el importador con el nuevo ZIP y `db:seed`.
Se actualizan registros por ID/fecha mediante UPSERT: no se duplican y no se borra el historial que no venga en el nuevo archivo. Los duplicados contradictorios dentro de una misma exportación se rechazan.

## Rutas

| Método | Ruta | Datos |
|---|---|---|
| GET | `/health` | Estado de API y conexión a D1 |
| GET | `/docs` | Swagger UI interactiva para explorar y probar la API |
| GET | `/swagger` | Redirección a `/docs` |
| GET | `/openapi.json` | Contrato OpenAPI 3.1, importable en Postman |
| GET | `/api/activities` | Lista de actividades |
| GET | `/api/activities/{id}` | Detalle de una actividad |
| GET | `/api/daily-stats` | Resúmenes diarios |
| GET | `/api/sports` | Deportes y cantidad de actividades |
| GET | `/api/stats` | Totales y desglose por deporte |

`activities` admite `from`, `to`, `sport`, `limit` y `offset`.
`daily-stats` admite `from`, `to`, `limit` y `offset`.
`stats` admite `from`, `to` y `sport`.

- Fechas `YYYY-MM-DD`, inclusivas y correspondientes a la **fecha local** de la actividad.
- `sport` usa los identificadores Garmin, por ejemplo `running`, `treadmill_running` o `cycling`. `/api/sports` lista los disponibles.
- `limit`: entre 1 y 100; por defecto 50.
- `offset`: entre 0 y 100000; por defecto 0.
- Los resultados paginados devuelven `{ data, pagination: { limit, offset, total, nextOffset } }`.
- Los campos ausentes se devuelven como `null`; los identificadores se devuelven como texto.
- Los filtros inválidos responden HTTP 400, una actividad inexistente 404.
- Orden de actividades: inicio UTC descendente e ID descendente para desempatar.

```powershell
Invoke-RestMethod 'http://127.0.0.1:8787/api/activities?from=2026-01-01&to=2026-07-31&sport=running&limit=10'
Invoke-RestMethod 'http://127.0.0.1:8787/api/stats?sport=running'
Invoke-RestMethod 'http://127.0.0.1:8787/api/daily-stats?from=2026-07-01&limit=31'
```

## Datos y unidades

El importador lee los JSON `*_summarizedActivities.json` y `UDSFile_*.json` directamente desde el ZIP. No extrae archivos ni importa el perfil, correo, imágenes o datos de contactos.

| Campo de actividad exportado | API |
|---|---|
| `distance` en centímetros | `distanceMeters`: dividir entre 100 |
| `duration`, `elapsedDuration`, `movingDuration` en milisegundos | Segundos: dividir entre 1000 |
| `avgSpeed`, `maxSpeed` en cm/ms | Metros por segundo: multiplicar por 10 |
| `elevationGain`, `elevationLoss` en centímetros | Metros: dividir entre 100 |
| `calories` en kilojulios | `caloriesKcal`: dividir entre 4.184 |
| `beginTimestamp` en epoch milisegundos | `startedAt` en ISO 8601 UTC |
| `startTimeLocal` | Fecha local y desfase UTC en minutos |

Las unidades se contrastaron con los `unitEnum` de las mediciones de los splits del propio ZIP. Los JSON UDS ya contienen metros y kilocalorías, por lo que se conservan sin estas conversiones. Las métricas numéricas se redondean a tres decimales y las coordenadas a siete.

`averagePaceSecondsPerKm` se calcula a partir de la velocidad media; devuelve `null` si no hay velocidad positiva. Es una conversión de velocidad aplicable a cualquier deporte, no una estimación nueva de Garmin.

`data/import.sql` e `import-report.json` son archivos locales generados. El reporte registra el hash SHA-256, la fecha de generación, cantidades y rango de fechas. `.gitignore` excluye el ZIP, FIT, datos generados, base local, herramientas portables y secretos.

**Alcance actual:** resúmenes de actividades y resúmenes diarios. Todavía no decodifica los FIT, recorridos GPS completos, series de sensores, vueltas individuales, sueño ni métricas de preparación. El detalle incluye las coordenadas de inicio/final que aparecen en el resumen.

## Autenticación y CORS

La API no implementa OAuth2. Toda la autenticación de las rutas `/api/*` está concentrada en un middleware de `src/index.ts`, para poder ampliarla después.

Swagger usa el contrato de `/openapi.json` y carga sus archivos desde la propia aplicación. Si activas `API_KEY`, pulsa **Authorize** y escribe solo la clave, sin el prefijo `Bearer`; Swagger añade ese prefijo al ejecutar las peticiones. La clave no se conserva al recargar la página.

Para activar una clave Bearer local, crea `.dev.vars` desde `.dev.vars.example` y define `API_KEY` con un secreto propio. Reinicia el servidor y consulta con:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8787/api/activities' -Headers @{ Authorization = 'Bearer TU_CLAVE' }
```

Si `API_KEY` no está configurada, las consultas son anónimas. `.dev.vars` solo se usa localmente; en Cloudflare se configura con `npx wrangler secret put API_KEY`.

Para acceso desde el navegador por ti y tu esposa, **Cloudflare Access** puede proteger la API externamente y permitir solo vuestros correos. Debe cubrir el hostname de la API, incluidas las URLs alternativas que se habiliten. Para scripts, Access admite service tokens. Si usas Access y no configuras `API_KEY`, no tendrás que implementar el login en esta API.

Para conectar una web alojada en otro origen, configura `CORS_ORIGINS` en `wrangler.jsonc` con los orígenes exactos separados por comas, por ejemplo `https://mi-web.pages.dev`. Por defecto no se habilita CORS entre orígenes. CORS controla el acceso del navegador; la autenticación la hace Access o la clave Bearer. Si usas Access entre dominios, también hay que configurar allí las peticiones OPTIONS y la sesión del navegador.

## Desplegar en Cloudflare

Estos pasos sí crean y modifican recursos en tu cuenta; aún no se han ejecutado:

```powershell
npx wrangler login
npx wrangler d1 create my-garmin
```

Sustituye el `database_id` de ejemplo en `wrangler.jsonc` por el UUID que devuelve el comando. Mantén el binding `DB` y el nombre `my-garmin`.

```powershell
npx wrangler d1 migrations apply my-garmin --remote
npx wrangler d1 execute my-garmin --remote --file data/import.sql
# Opcional: activar la clave Bearer antes de publicar.
npx wrangler secret put API_KEY
npm run deploy
```

La URL será `https://my-garmin-api.<tu-subdominio>.workers.dev`. También puedes configurar un dominio propio y protegerlo con Access. Al desplegar sin Access ni `API_KEY`, las actividades quedan accesibles a quien conozca la URL.

## Validación

```powershell
npm run typecheck
npm test
npm run build
```

Los tests del importador verifican las conversiones, fechas locales, identificadores grandes, campos ausentes, SQL con comillas y lectura del ZIP. Las pruebas HTTP levantan el runtime real de Workers con D1 local y datos ficticios en una base temporal separada de tus datos; verifican consultas, paginación, fechas inválidas, filtros, autenticación opcional y CORS. `build` empaqueta con `--dry-run`, sin desplegar.

Documentación de referencia: [Hono en Workers](https://hono.dev/docs/getting-started/cloudflare-workers), [D1](https://developers.cloudflare.com/d1/get-started/), [Access en Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
