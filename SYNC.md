# Sincronización Garmin → BookTrip

El reloj sincroniza con Garmin Connect a través de tu teléfono o Garmin Express. Después, GitHub Actions ejecuta un programa Python aproximadamente cada 30 minutos que consulta las actividades de tu cuenta y las importa en tu API de Cloudflare. La sección Ejercicio lee esa misma API al abrirse o pulsar Actualizar.

No usa Azure, Foundry ni un modelo de IA. El equipo personal puede estar apagado una vez conectada la cuenta. El repositorio es público y utiliza runners estándar gratuitos de GitHub; los datos personales y las claves no se publican en él.

Estado al 9 de octubre de 2026: cuenta conectada, `GARMIN_SYNC_ENABLED=true` y [primera ejecución real desde GitHub completada](https://github.com/pvasquez1992/myGarming/actions/runs/37964911235). Se importaron 329 actividades, hasta el 8 de octubre; repetir la importación completa mantuvo las mismas 329 filas sin duplicarlas.

## Primer acceso y renovación

En este equipo ya está preparado Python portable y un entorno aislado dentro de `.tools`, fuera de Git. Las claves locales están protegidas mediante Windows DPAPI para este usuario. Ejecuta:

```powershell
cd C:\myGarming\myGarming
.\scripts\connect-garmin.ps1
```

Introduce el correo, la contraseña y, si Garmin lo solicita, el código MFA en esa ventana local. La contraseña y el código no se guardan en GitHub ni en Cloudflare. El programa comprueba el acceso a las actividades y guarda una sesión cifrada con AES-256-GCM en D1. La clave para descifrarla está en GitHub Secrets y en la configuración local protegida; el Worker almacena únicamente el contenido cifrado. La sesión permite acceder a la cuenta: trátala y a sus claves como credenciales.

Si Garmin invalida la sesión, Ejercicio mostrará que debes reconectar. Vuelve a ejecutar el mismo comando; no es necesario modificar el workflow ni introducir credenciales en el chat. Evita conectar la cuenta mientras hay una sincronización en marcha: la revisión de sesión impide sobrescribir una renovación concurrente y el siguiente intento recupera el trabajo.

Para comprobar una sincronización desde este equipo:

```powershell
.\scripts\connect-garmin.ps1 -Sync
# Revisar todo el historial:
.\scripts\connect-garmin.ps1 -Sync -Full
```

El entorno local de recuperación no es necesario para las ejecuciones alojadas en GitHub. En otro equipo, crea un entorno Python 3.13, instala `sync/requirements.txt` con `pip install --require-hashes`, y configura las tres variables que usa `sync/connect.py` mediante un gestor de secretos. No copies archivos de sesión en texto plano al repositorio.

## Workflow y secretos

[Sincronizar Garmin](https://github.com/pvasquez1992/myGarming/actions/workflows/garmin-sync.yml) admite una ejecución manual con la opción `full` y ejecuciones programadas a los minutos 13 y 43 de cada hora UTC. La variable de repositorio `GARMIN_SYNC_ENABLED=true` habilita el trabajo; ponerla en `false` lo detiene sin borrar el historial.

GitHub Secrets contiene `GARMIN_SYNC_KEY` y `GARMIN_SESSION_KEY`. Cloudflare contiene `SYNC_KEY`, igual a `GARMIN_SYNC_KEY`, y conserva la clave de lectura existente `API_KEY`. La web solo recibe acceso de lectura a través de su función protegida por Cloudflare Access. No tiene la clave de importación ni la clave de cifrado.

El job no guarda artefactos, exportaciones ni sesiones en caché; únicamente cachea dependencias Python. Los logs muestran estado y número de actividades procesadas, no correos, contraseñas, nombres de actividades ni coordenadas. Las dependencias y acciones se fijan a versiones/hashes para poder revisar actualizaciones antes de adoptarlas.

## Recuperación de actividades

La primera ejecución recorre todas las páginas del historial. Las ejecuciones normales vuelven a revisar una ventana de siete días; alrededor de las 03:00 UTC y tras interrupciones de más de siete días se revisa de nuevo todo el historial. Así se recuperan también actividades antiguas sincronizadas tarde o modificadas en Garmin.

Cada lote admite hasta 100 actividades y se valida completo antes de escribir. El ID de Garmin es la clave del UPSERT: repetir la sincronización no crea duplicados. Los datos existentes se conservan si Garmin omite una métrica opcional. Una interrupción deja los lotes anteriores importados; el siguiente intento los puede repetir sin duplicarlos. No se borran automáticamente actividades eliminadas en Garmin y no se descargan archivos FIT, muestras de ruta ni resúmenes de salud diarios: el alcance actual son los resúmenes de actividades que muestra Ejercicio.

Puedes borrar nuestra copia desde el detalle de una actividad en Ejercicio, usando **Eliminar de esta web** y confirmando, o mediante `DELETE /api/activities/{id}` en Swagger. La API exige `DELETE_KEY` (esquema `deleteBearer`), diferente de las claves de lectura e importación; Pages conserva la misma clave como secreto `GARMIN_DELETE_KEY` y comprueba tu sesión de Access y que la petición proceda de esta web. La clave no llega al navegador. DELETE repetido devuelve `deleted=false` sin error si ya no existe.

La eliminación no modifica Garmin ni crea un bloqueo permanente de importación. Si la actividad sigue en Garmin, se recupera al volver a consultar su página: las recientes normalmente en la siguiente sincronización, las antiguas en la revisión completa diaria o al ejecutar el workflow manual con `full`. Si la has eliminado también de Garmin, la sincronización ya no la recibe y no la recrea. Una importación manual de un ZIP antiguo todavía puede recuperarla porque ese ZIP contiene su copia.

Swagger documenta las nuevas rutas en `/docs`: `/sync/activities`, `/sync/session`, `/sync/status` requieren la clave de escritura `syncBearer`. `/api/sync-status` requiere la misma clave de lectura que las demás consultas y muestra únicamente el estado de sincronización.

## Límites del servicio

Se utiliza [python-garminconnect](https://github.com/cyberjunky/python-garminconnect), un cliente **no oficial** de los servicios utilizados por Garmin Connect. No requiere la aprobación del Developer Program, pero Garmin puede modificar el acceso o exigir una nueva autenticación. Reutilizamos la sesión y evitamos iniciar sesión con contraseña en cada ejecución.

[GitHub advierte](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) que las ejecuciones programadas pueden retrasarse o descartarse y que se deshabilitan en repositorios públicos sin actividad durante 60 días. No es un servicio con entrega garantizada cada 30 minutos. Ejercicio avisa si pasan más de dos horas sin una actualización correcta. Si el calendario se deshabilita, vuelve a habilitar el workflow en Actions y ejecútalo manualmente con `full` para recuperar el historial.

[Los runners estándar son gratuitos para repositorios públicos](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Este flujo utiliza el Worker y D1 existentes; sigue sujeto a las cuotas del plan gratuito de Cloudflare.

## Validación

```powershell
. .\scripts\use-node.ps1
npm run typecheck
npm test
.\.tools\garmin-venv\Scripts\python.exe -m unittest discover -s sync -p test_*.py
```

Las pruebas usan datos ficticios. Verifican unidades del JSON en vivo, fechas locales, paginación, repetición de importaciones, separación de claves, validación antes de escribir, cifrado y conflictos de renovación de sesión.
