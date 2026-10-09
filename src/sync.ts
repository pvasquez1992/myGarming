import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { Bindings } from './types';

const fields = {
  id: 'id', name: 'name', sport: 'sport', startedAt: 'started_at', localDate: 'local_date',
  utcOffsetMinutes: 'utc_offset_minutes', durationSeconds: 'duration_seconds', elapsedSeconds: 'elapsed_seconds',
  movingSeconds: 'moving_seconds', distanceMeters: 'distance_meters', averageSpeedMps: 'average_speed_mps',
  maxSpeedMps: 'max_speed_mps', elevationGainMeters: 'elevation_gain_meters', elevationLossMeters: 'elevation_loss_meters',
  caloriesKcal: 'calories_kcal', averageHeartRateBpm: 'average_heart_rate_bpm', maxHeartRateBpm: 'max_heart_rate_bpm',
  averagePowerWatts: 'average_power_watts', maxPowerWatts: 'max_power_watts', steps: 'steps',
  aerobicTrainingEffect: 'aerobic_training_effect', anaerobicTrainingEffect: 'anaerobic_training_effect',
  trainingLoad: 'training_load', vo2Max: 'vo2_max', startLatitude: 'start_latitude', startLongitude: 'start_longitude',
  endLatitude: 'end_latitude', endLongitude: 'end_longitude', lapCount: 'lap_count',
} as const;
const required = new Set(['id', 'name', 'sport', 'startedAt', 'localDate', 'durationSeconds', 'distanceMeters']);
const columns = Object.values(fields);
const sql = `INSERT INTO activities (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})
  ON CONFLICT(id) DO UPDATE SET ${Object.entries(fields).filter(([key]) => key !== 'id').map(([key, column]) =>
    `${column} = ${required.has(key) ? `excluded.${column}` : `COALESCE(excluded.${column}, activities.${column})`}`).join(',')}`;

export const syncRoutes = new Hono<{ Bindings: Bindings }>();
syncRoutes.use('*', async (c, next) => {
  if (!c.env.SYNC_KEY) return c.json({ error: { code: 'sync_disabled', message: 'Sincronización no configurada.' } }, 503);
  return bearerAuth<{ Bindings: Bindings }>({ token: c.env.SYNC_KEY })(c, next);
});
syncRoutes.use('*', bodyLimit({ maxSize: 256 * 1024 }));

syncRoutes.post('/activities', async c => {
  const body = await readObject(c.req);
  exactKeys(body, ['activities']);
  if (!Array.isArray(body.activities) || body.activities.length < 1 || body.activities.length > 100) fail('Envía entre 1 y 100 actividades.');
  const rows = body.activities.map(validateActivity);
  if (new Set(rows.map(row => row[0])).size !== rows.length) fail('Identificadores repetidos en el lote.');
  await c.env.DB.batch(rows.map(row => c.env.DB.prepare(sql).bind(...row)));
  return c.json({ data: { processed: rows.length } });
});

syncRoutes.get('/session', async c => {
  const row = await c.env.DB.prepare('SELECT encrypted_json, revision FROM sync_session WHERE id = 1')
    .first<{ encrypted_json: string; revision: number }>();
  return c.json({ data: row ? { session: JSON.parse(row.encrypted_json), revision: row.revision } : null });
});
syncRoutes.put('/session', async c => {
  const body = await readObject(c.req);
  exactKeys(body, ['session', 'expectedRevision']);
  const session = asObject(body.session);
  exactKeys(session, ['format', 'nonce', 'ciphertext']);
  if (session.format !== 1 || typeof session.nonce !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(session.nonce)
    || typeof session.ciphertext !== 'string' || session.ciphertext.length < 24 || session.ciphertext.length > 32000
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(session.ciphertext) || session.ciphertext.length % 4 !== 0) fail('Sesión cifrada inválida.');
  const revision = body.expectedRevision;
  if (revision !== null && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1)) fail('Revisión inválida.');
  const encrypted = JSON.stringify(session), now = new Date().toISOString();
  const result = revision === null
    ? await c.env.DB.prepare('INSERT INTO sync_session (id, encrypted_json, revision, updated_at) VALUES (1, ?, 1, ?) ON CONFLICT(id) DO NOTHING').bind(encrypted, now).run()
    : await c.env.DB.prepare('UPDATE sync_session SET encrypted_json = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?').bind(encrypted, now, revision).run();
  if (result.meta.changes !== 1) return c.json({ error: { code: 'session_conflict', message: 'La sesión cambió en otra ejecución.' } }, 409);
  return c.json({ data: { revision: revision === null ? 1 : revision + 1 } });
});

syncRoutes.get('/status', async c => c.json({ data: await readSyncStatus(c.env.DB) }));
syncRoutes.put('/status', async c => {
  const body = await readObject(c.req);
  exactKeys(body, ['state', 'processed']);
  if (!['ok', 'failed', 'reauth_required'].includes(String(body.state)) || typeof body.processed !== 'number'
    || !Number.isSafeInteger(body.processed) || body.processed < 0 || body.processed > 100000) fail('Estado inválido.');
  const now = new Date().toISOString();
  await c.env.DB.prepare(`INSERT INTO sync_status (id, state, last_attempt_at, last_success_at, processed_count)
    VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state,
    last_attempt_at = excluded.last_attempt_at,
    last_success_at = CASE WHEN excluded.state = 'ok' THEN excluded.last_success_at ELSE sync_status.last_success_at END,
    processed_count = excluded.processed_count`).bind(body.state as string, now, body.state === 'ok' ? now : null, body.processed).run();
  return c.json({ data: await readSyncStatus(c.env.DB) });
});

export async function readSyncStatus(db: D1Database) {
  const row = await db.prepare('SELECT state, last_attempt_at, last_success_at, processed_count FROM sync_status WHERE id = 1')
    .first<{ state: string; last_attempt_at: string; last_success_at: string | null; processed_count: number }>();
  return row ? { state: row.state, lastAttemptAt: row.last_attempt_at, lastSuccessAt: row.last_success_at, processedCount: row.processed_count } : {
    state: 'not_configured', lastAttemptAt: null, lastSuccessAt: null, processedCount: 0,
  };
}

function validateActivity(value: unknown): (string | number | null)[] {
  const activity = asObject(value);
  exactKeys(activity, Object.keys(fields), false);
  for (const key of required) if (!(key in activity)) fail(`Falta ${key}.`);
  if (typeof activity.id !== 'string' || !/^[1-9]\d{0,19}$/.test(activity.id)) fail('Identificador inválido.');
  if (typeof activity.name !== 'string' || !activity.name.trim() || activity.name.length > 500) fail('Nombre inválido.');
  if (typeof activity.sport !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(activity.sport)) fail('Deporte inválido.');
  if (typeof activity.startedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(activity.startedAt)
    || !Number.isFinite(Date.parse(activity.startedAt)) || new Date(activity.startedAt).toISOString() !== activity.startedAt) fail('Inicio UTC inválido.');
  if (typeof activity.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(activity.localDate)
    || !Number.isFinite(Date.parse(`${activity.localDate}T00:00:00Z`))
    || new Date(`${activity.localDate}T00:00:00Z`).toISOString().slice(0, 10) !== activity.localDate) fail('Fecha local inválida.');
  return Object.keys(fields).map(key => {
    const field = activity[key];
    if (['id', 'name', 'sport', 'startedAt', 'localDate'].includes(key)) return field as string;
    if (field === undefined || field === null) {
      if (required.has(key)) fail(`Falta ${key}.`);
      return null;
    }
    if (typeof field !== 'number' || !Number.isFinite(field) || Math.abs(field) > 1e12) fail(`Valor inválido: ${key}.`);
    if (key.includes('Latitude') ? Math.abs(field) > 90 : key.includes('Longitude') ? Math.abs(field) > 180
      : key === 'utcOffsetMinutes' ? Math.abs(field) > 840 || !Number.isInteger(field) : field < 0) fail(`Fuera de rango: ${key}.`);
    if (['steps', 'lapCount'].includes(key) && !Number.isSafeInteger(field)) fail(`Entero inválido: ${key}.`);
    return field;
  });
}
function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Objeto JSON requerido.');
  return value as Record<string, unknown>;
}
async function readObject(request: { json: () => Promise<unknown> }) {
  try { return asObject(await request.json()); } catch (error) {
    if (error instanceof HTTPException) throw error;
    fail('JSON inválido.');
  }
}
function exactKeys(object: Record<string, unknown>, allowed: string[], all = true) {
  if (Object.keys(object).some(key => !allowed.includes(key)) || (all && allowed.some(key => !(key in object)))) fail('Campos JSON inválidos.');
}
function fail(message: string): never { throw new HTTPException(400, { message }); }
