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

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'My Garmin API', version: '0.1.0',
    description: 'Historial personal importado desde Garmin. Sin OAuth2. Bearer opcional mediante API_KEY o protección externa con Cloudflare Access. Campos ausentes se devuelven como null. Las fechas de filtros corresponden a la fecha local de la actividad.',
  },
  servers: [{ url: '/' }],
  paths: {
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
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    schemas: {
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
