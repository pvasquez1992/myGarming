import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { activityDto, dailyDto } from './mappers';
import { openApiDocument } from './openapi';
import { parseQuery } from './query';
import { swaggerHtml } from './swagger';
import type { ActivityRow, Bindings, DailyRow } from './types';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});

app.use('/api/*', async (c, next) => {
  const origins = (c.env.CORS_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean);
  return cors({
    origin: origin => origins.includes(origin) ? origin : undefined,
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
  })(c, next);
});

// Punto único de autenticación: opcional hoy; extensible a OIDC/JWT después.
app.use('/api/*', async (c, next) => {
  if (c.env.API_KEY) return bearerAuth<{ Bindings: Bindings }>({ token: c.env.API_KEY })(c, next);
  await next();
});

app.get('/', c => c.json({ name: 'my-garmin-api', version: '0.1.0', documentation: '/docs', openapi: '/openapi.json' }));
app.get('/docs', c => c.html(swaggerHtml));
app.get('/swagger', c => c.redirect('/docs'));
app.get('/openapi.json', c => c.json(openApiDocument));
app.get('/health', async c => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ status: 'ok' });
});

app.get('/api/activities', async c => {
  const q = parseQuery(c.req.url, 'activities');
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM activities ${q.where}`)
    .bind(...q.values).first<{ total: number }>();
  const rows = await c.env.DB.prepare(`SELECT * FROM activities ${q.where} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...q.values, q.limit, q.offset).all<ActivityRow>();
  const total = count?.total ?? 0;
  return c.json({ data: rows.results.map(activityDto), pagination: pagination(q.limit, q.offset, total) });
});

app.get('/api/activities/:id', async c => {
  const id = c.req.param('id');
  if (!/^[1-9]\d{0,19}$/.test(id)) throw new HTTPException(400, { message: 'id debe ser un identificador numérico positivo.' });
  const row = await c.env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first<ActivityRow>();
  if (!row) throw new HTTPException(404, { message: 'Actividad no encontrada.' });
  return c.json({ data: activityDto(row) });
});

app.get('/api/daily-stats', async c => {
  const q = parseQuery(c.req.url, 'daily');
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM daily_stats ${q.where}`)
    .bind(...q.values).first<{ total: number }>();
  const rows = await c.env.DB.prepare(`SELECT * FROM daily_stats ${q.where} ORDER BY date DESC LIMIT ? OFFSET ?`)
    .bind(...q.values, q.limit, q.offset).all<DailyRow>();
  return c.json({ data: rows.results.map(dailyDto), pagination: pagination(q.limit, q.offset, count?.total ?? 0) });
});

app.get('/api/sports', async c => {
  const rows = await c.env.DB.prepare('SELECT sport, COUNT(*) AS activityCount FROM activities GROUP BY sport ORDER BY activityCount DESC, sport').all();
  return c.json({ data: rows.results });
});

app.get('/api/stats', async c => {
  const q = parseQuery(c.req.url, 'stats');
  const columns = `COUNT(*) AS activityCount, COALESCE(SUM(distance_meters), 0) AS distanceMeters,
    COALESCE(SUM(duration_seconds), 0) AS durationSeconds,
    SUM(calories_kcal) AS caloriesKcal, SUM(elevation_gain_meters) AS elevationGainMeters,
    MIN(local_date) AS firstDate, MAX(local_date) AS lastDate`;
  const totals = await c.env.DB.prepare(`SELECT ${columns} FROM activities ${q.where}`).bind(...q.values).first();
  const bySport = await c.env.DB.prepare(`SELECT sport, ${columns} FROM activities ${q.where} GROUP BY sport ORDER BY activityCount DESC, sport`)
    .bind(...q.values).all();
  return c.json({ data: { totals, bySport: bySport.results } });
});

app.notFound(c => c.json({ error: { code: 'not_found', message: 'Ruta no encontrada.' } }, 404));
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    const challenge = error.getResponse().headers.get('WWW-Authenticate');
    if (challenge) c.header('WWW-Authenticate', challenge);
    const code = error.status === 401 ? 'unauthorized' : error.status === 404 ? 'not_found' : 'invalid_request';
    return c.json({ error: { code, message: error.message } }, error.status);
  }
  // No registrar parámetros ni datos personales del ZIP.
  console.error('Database/request failure:', error.name);
  return c.json({ error: { code: 'internal_error', message: 'No se pudo completar la consulta.' } }, 500);
});

function pagination(limit: number, offset: number, total: number) {
  return { limit, offset, total, nextOffset: offset + limit < total ? offset + limit : null };
}

export default app;
