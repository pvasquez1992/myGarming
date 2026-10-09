const number = { type: ['number', 'null'] };
const position = {
  type: ['object', 'null'],
  properties: { latitude: { type: 'number' }, longitude: { type: 'number' } },
  required: ['latitude', 'longitude'],
};
const activityProperties = {
  id: { type: 'string', description: 'Identificador Garmin; se devuelve como texto.' },
  name: { type: 'string' }, sport: { type: 'string' },
  startedAt: { type: 'string', format: 'date-time', description: 'UTC' },
  localDate: { type: 'string', format: 'date' },
  utcOffsetMinutes: number,
  durationSeconds: { type: 'number' }, elapsedSeconds: number, movingSeconds: number,
  distanceMeters: { type: 'number' }, averageSpeedMps: number, maxSpeedMps: number,
  averagePaceSecondsPerKm: number, elevationGainMeters: number, elevationLossMeters: number,
  caloriesKcal: number, averageHeartRateBpm: number, maxHeartRateBpm: number,
  averagePowerWatts: number, maxPowerWatts: number, steps: number,
  aerobicTrainingEffect: number, anaerobicTrainingEffect: number, trainingLoad: number,
  vo2Max: number, startPosition: position, endPosition: position, lapCount: number,
};
const dailyProperties = {
  date: { type: 'string', format: 'date' }, steps: number, stepGoal: number,
  distanceMeters: number, totalCaloriesKcal: number, activeCaloriesKcal: number,
  restingCaloriesKcal: number, moderateIntensityMinutes: number,
  vigorousIntensityMinutes: number, highlyActiveSeconds: number, activeSeconds: number,
  floorsAscendedMeters: number, floorsDescendedMeters: number,
  includesActivityData: { type: 'boolean' }, includesWellnessData: { type: 'boolean' },
};
const aggregateProperties = {
  activityCount: { type: 'integer' }, distanceMeters: { type: 'number' },
  durationSeconds: { type: 'number' }, caloriesKcal: number, elevationGainMeters: number,
  firstDate: { type: ['string', 'null'], format: 'date' },
  lastDate: { type: ['string', 'null'], format: 'date' },
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonResponse = (description: string, schema: object) => ({
  description, content: { 'application/json': { schema } },
});
const envelope = (schema: object) => ({ type: 'object', properties: { data: schema }, required: ['data'] });
const list = (schema: object) => ({
  type: 'object',
  properties: { data: { type: 'array', items: schema }, pagination: ref('Pagination') },
  required: ['data', 'pagination'],
});
const filterParameters = [
  { name: 'from', in: 'query', description: 'Fecha local inclusiva.', schema: { type: 'string', format: 'date' } },
  { name: 'to', in: 'query', description: 'Fecha local inclusiva.', schema: { type: 'string', format: 'date' } },
];
const sportParameter = { name: 'sport', in: 'query', schema: { type: 'string', example: 'running' } };
const pageParameters = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
  { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 100000, default: 0 } },
];
const errors = {
  '400': jsonResponse('Parámetros inválidos.', ref('Error')),
  '401': jsonResponse('Se requiere un Bearer válido cuando API_KEY está configurada.', ref('Error')),
  '500': jsonResponse('Error interno.', ref('Error')),
};
const security = [{}, { bearerAuth: [] }];
const syncSecurity = [{ syncBearer: [] }];
const syncErrors = {
  ...errors,
  '401': jsonResponse('Se requiere SYNC_KEY, diferente de la clave de lectura.', ref('Error')),
  '413': jsonResponse('El cuerpo supera 256 KiB.', ref('Error')),
  '503': jsonResponse('Sincronización deshabilitada: falta SYNC_KEY.', ref('Error')),
};
const writeProperties = Object.fromEntries(Object.entries(activityProperties)
  .filter(([key]) => !['averagePaceSecondsPerKm', 'startPosition', 'endPosition'].includes(key)));
const syncStatus = {
  type: 'object', properties: {
    state: { type: 'string', enum: ['not_configured', 'ok', 'failed', 'reauth_required'] },
    lastAttemptAt: { type: ['string', 'null'], format: 'date-time' },
    lastSuccessAt: { type: ['string', 'null'], format: 'date-time' },
    processedCount: { type: 'integer', minimum: 0 },
  }, required: ['state', 'lastAttemptAt', 'lastSuccessAt', 'processedCount'],
};
const requestBody = (schema: object) => ({ required: true, content: { 'application/json': { schema } } });

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'My Garmin API', version: '0.2.0',
    description: 'Historial personal importado desde Garmin. Sin OAuth2. Bearer opcional mediante API_KEY o protección externa con Cloudflare Access. Campos ausentes se devuelven como null. Las fechas de filtros corresponden a la fecha local de la actividad.',
  },
  servers: [{ url: '/' }],
  paths: {
    '/api/sync-status': { get: {
      summary: 'Última sincronización, sin credenciales ni sesión', security,
      responses: { '200': jsonResponse('Estado.', envelope(ref('SyncStatus'))), ...errors },
    } },
    '/sync/activities': { post: {
      summary: 'Importar o actualizar un lote por ID Garmin', security: syncSecurity, tags: ['Sincronización'],
      description: 'Clave de escritura separada. Valida el lote completo antes de escribir. Las métricas opcionales ausentes conservan el valor previo. Unidades: metros, segundos, m/s y kcal.',
      requestBody: requestBody({ type: 'object', additionalProperties: false, required: ['activities'], properties: {
        activities: { type: 'array', minItems: 1, maxItems: 100, items: ref('ActivityImport') },
      } }),
      responses: { '200': jsonResponse('Importadas.', envelope({ type: 'object', properties: { processed: { type: 'integer' } } })), ...syncErrors },
    } },
    '/sync/session': {
      get: { summary: 'Recuperar sesión cifrada y revisión', security: syncSecurity, tags: ['Sincronización'],
        responses: { '200': jsonResponse('Sesión o null.', envelope({ oneOf: [
          { type: 'null' }, { type: 'object', properties: { session: ref('EncryptedSession'), revision: { type: 'integer', minimum: 1 } } },
        ] })), ...syncErrors } },
      put: { summary: 'Guardar sesión cifrada sin sobrescribir otra renovación', security: syncSecurity, tags: ['Sincronización'],
        requestBody: requestBody({ type: 'object', additionalProperties: false, required: ['session', 'expectedRevision'], properties: {
          session: ref('EncryptedSession'), expectedRevision: { type: ['integer', 'null'], minimum: 1, description: 'null solo para crear la primera sesión.' },
        } }),
        responses: { '200': jsonResponse('Guardada.', envelope({ type: 'object', properties: { revision: { type: 'integer' } } })),
          '409': jsonResponse('Otra ejecución cambió la sesión: vuelve a leerla.', ref('Error')), ...syncErrors } },
    },
    '/sync/status': {
      get: { summary: 'Consultar estado desde el sincronizador', security: syncSecurity, tags: ['Sincronización'],
        responses: { '200': jsonResponse('Estado.', envelope(ref('SyncStatus'))), ...syncErrors } },
      put: { summary: 'Registrar resultado conservando la última fecha de éxito', security: syncSecurity, tags: ['Sincronización'],
        requestBody: requestBody({ type: 'object', additionalProperties: false, required: ['state', 'processed'], properties: {
          state: { type: 'string', enum: ['ok', 'failed', 'reauth_required'] }, processed: { type: 'integer', minimum: 0, maximum: 100000 },
        } }),
        responses: { '200': jsonResponse('Estado.', envelope(ref('SyncStatus'))), ...syncErrors } },
    },
    '/health': { get: { summary: 'Comprobar API y conexión a D1', responses: {
      '200': jsonResponse('Disponible.', { type: 'object', properties: { status: { const: 'ok' } } }),
      '500': errors['500'],
    } } },
    '/api/activities': { get: {
      summary: 'Consultar actividades, de más reciente a más antigua', security,
      parameters: [...filterParameters, sportParameter, ...pageParameters],
      responses: { '200': jsonResponse('Actividades.', list(ref('Activity'))), ...errors },
    } },
    '/api/activities/{id}': { get: {
      summary: 'Consultar una actividad', security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' } }],
      responses: {
        '200': jsonResponse('Actividad.', envelope(ref('Activity'))), ...errors,
        '404': jsonResponse('Actividad no encontrada.', ref('Error')),
      },
    }, delete: {
      summary: 'Eliminar una actividad de esta API', security: [{ deleteBearer: [] }],
      description: 'No modifica Garmin. No bloquea futuras importaciones: si la actividad sigue en Garmin, el sincronizador puede recuperarla. Repetir DELETE devuelve deleted=false si ya no existe.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' } }],
      responses: { '200': jsonResponse('Resultado.', envelope({ type: 'object', required: ['id', 'deleted'], properties: {
        id: { type: 'string' }, deleted: { type: 'boolean' },
      } })), ...errors,
        '401': jsonResponse('Se requiere DELETE_KEY; la clave de lectura no permite eliminar.', ref('Error')),
        '503': jsonResponse('Eliminación deshabilitada: falta DELETE_KEY.', ref('Error')),
      },
    } },
    '/api/daily-stats': { get: {
      summary: 'Consultar resúmenes diarios, de más reciente a más antiguo', security,
      parameters: [...filterParameters, ...pageParameters],
      responses: { '200': jsonResponse('Resúmenes diarios.', list(ref('DailyStats'))), ...errors },
    } },
    '/api/sports': { get: {
      summary: 'Listar deportes y número de actividades', security,
      responses: { '200': jsonResponse('Deportes.', envelope({ type: 'array', items: {
        type: 'object', properties: { sport: { type: 'string' }, activityCount: { type: 'integer' } },
      } })), ...errors },
    } },
    '/api/stats': { get: {
      summary: 'Totales y desglose por deporte', security,
      parameters: [...filterParameters, sportParameter],
      responses: { '200': jsonResponse('Estadísticas.', envelope({ type: 'object', properties: {
        totals: ref('Aggregate'),
        bySport: { type: 'array', items: { type: 'object', properties: { sport: { type: 'string' }, ...aggregateProperties } } },
      } })), ...errors },
    } },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'API_KEY: consultas de lectura.' },
      syncBearer: { type: 'http', scheme: 'bearer', description: 'SYNC_KEY: importación y sesión del sincronizador. No se entrega a la web.' },
      deleteBearer: { type: 'http', scheme: 'bearer', description: 'DELETE_KEY: eliminar únicamente actividades de esta API. El navegador no recibe esta clave.' },
    },
    schemas: {
      SyncStatus: syncStatus,
      EncryptedSession: { type: 'object', additionalProperties: false, required: ['format', 'nonce', 'ciphertext'], properties: {
        format: { const: 1 }, nonce: { type: 'string', pattern: '^[A-Za-z0-9+/]{16}$', description: 'Nonce AES-GCM de 12 bytes, base64.' },
        ciphertext: { type: 'string', minLength: 24, maxLength: 32000, description: 'Sesión AES-256-GCM con etiqueta, base64. La clave nunca se envía al Worker.' },
      } },
      ActivityImport: { type: 'object', additionalProperties: false, properties: {
        ...writeProperties, id: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' },
        name: { type: 'string', minLength: 1, maxLength: 500 }, sport: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' },
        startedAt: { type: 'string', format: 'date-time', example: '2026-10-09T12:00:00.000Z' },
        durationSeconds: { type: 'number', minimum: 0 }, distanceMeters: { type: 'number', minimum: 0 },
        startLatitude: { ...number, minimum: -90, maximum: 90 }, endLatitude: { ...number, minimum: -90, maximum: 90 },
        startLongitude: { ...number, minimum: -180, maximum: 180 }, endLongitude: { ...number, minimum: -180, maximum: 180 },
      }, required: ['id', 'name', 'sport', 'startedAt', 'localDate', 'durationSeconds', 'distanceMeters'] },
      Activity: { type: 'object', properties: activityProperties, required: Object.keys(activityProperties) },
      DailyStats: { type: 'object', properties: dailyProperties, required: Object.keys(dailyProperties) },
      Aggregate: { type: 'object', properties: aggregateProperties, required: Object.keys(aggregateProperties) },
      Pagination: { type: 'object', properties: {
        limit: { type: 'integer' }, offset: { type: 'integer' }, total: { type: 'integer' },
        nextOffset: { type: ['integer', 'null'] },
      }, required: ['limit', 'offset', 'total', 'nextOffset'] },
      Error: { type: 'object', properties: { error: {
        type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } }, required: ['code', 'message'],
      } }, required: ['error'] },
    },
  },
};
