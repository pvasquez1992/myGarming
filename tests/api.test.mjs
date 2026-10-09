import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const environment = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };
let state, worker, baseUrl;
let output = '';

function cli(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root, env: environment, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function request(route, options = {}) {
  const response = await fetch(baseUrl + route, {
    ...options, headers: { Authorization: 'Bearer test-secret', ...options.headers },
  });
  return { response, body: await response.json() };
}

before(async () => {
  state = await mkdtemp(path.join(tmpdir(), 'my-garmin-api-test-'));
  cli(['d1', 'migrations', 'apply', 'my-garmin', '--local', '--persist-to', state]);
  cli(['d1', 'execute', 'my-garmin', '--local', '--persist-to', state, '--file', 'tests/fixtures.sql']);
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--persist-to', state, '--var', 'API_KEY:test-secret', '--var', 'CORS_ORIGINS:https://example.com'],
  { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', chunk => { output += chunk.toString(); });
  worker.stderr.on('data', chunk => { output += chunk.toString(); });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl + '/health');
      if (response.ok) return;
    } catch { /* servidor aún arrancando */ }
    if (worker.exitCode !== null) throw new Error(output);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('El Worker no arrancó: ' + output);
}, { timeout: 180000 });

after(async () => {
  if (worker && worker.exitCode === null) {
    const stopped = once(worker, 'exit');
    worker.kill();
    await stopped;
  }
  if (state) await rm(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('health comprueba D1 y OpenAPI describe las rutas', async () => {
  const health = await request('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.status, 'ok');
  const docs = await request('/openapi.json');
  assert.equal(docs.body.openapi, '3.1.0');
  assert.ok(docs.body.paths['/api/activities/{id}']);
});

test('paginación, orden estable y fin de lista', async () => {
  const first = await request('/api/activities?limit=1');
  assert.equal(first.body.data[0].id, '102');
  assert.deepEqual(first.body.pagination, { limit: 1, offset: 0, total: 2, nextOffset: 1 });
  const last = await request('/api/activities?limit=1&offset=1');
  assert.equal(last.body.data[0].id, '101');
  assert.equal(last.body.pagination.nextOffset, null);
});

test('filtros inclusivos usan fecha local y deporte', async () => {
  const result = await request('/api/activities?from=2024-02-12&to=2024-02-12&sport=running');
  assert.equal(result.body.pagination.total, 1);
  assert.equal(result.body.data[0].startedAt, '2024-02-13T01:50:00.000Z');
  assert.equal(result.body.data[0].localDate, '2024-02-12');
});

test('detalle conserva coordenadas cero, calcula ritmo y devuelve null cuando falta un dato', async () => {
  const result = await request('/api/activities/101');
  assert.deepEqual(result.body.data.startPosition, { latitude: 0, longitude: 0 });
  assert.equal(result.body.data.averagePaceSecondsPerKm, 360);
  assert.equal(result.body.data.averageHeartRateBpm, null);
  assert.equal(result.body.data.caloriesKcal, 300);
  assert.equal((await request('/api/activities/999')).response.status, 404);
});

test('resúmenes diarios y estadísticas con filtros', async () => {
  const daily = await request('/api/daily-stats?from=2024-02-12&to=2024-02-12');
  assert.equal(daily.body.data[0].totalCaloriesKcal, 2000);
  assert.equal(daily.body.data[0].includesWellnessData, true);
  const stats = await request('/api/stats?sport=running');
  assert.equal(stats.body.data.totals.activityCount, 1);
  assert.equal(stats.body.data.totals.distanceMeters, 5000);
  assert.equal(stats.body.data.bySport[0].sport, 'running');
  const sports = await request('/api/sports');
  assert.equal(sports.body.data.length, 2);
  const empty = await request('/api/stats?sport=cycling');
  assert.equal(empty.body.data.totals.distanceMeters, 0);
  assert.equal(empty.body.data.totals.caloriesKcal, null);
});

test('rechaza fechas inválidas, parámetros repetidos, paginación incorrecta e inyección SQL', async () => {
  for (const route of [
    '/api/activities?from=2024-02-30', '/api/activities?from=2024-03-01&to=2024-02-01',
    '/api/activities?limit=101', '/api/activities?limit=1.5', '/api/activities?offset=-1',
    '/api/activities?limit=1&limit=2', '/api/activities?unknown=1',
    '/api/activities?sport=running%27%20OR%201%3D1', '/api/activities/not-an-id',
  ]) {
    const result = await request(route);
    assert.equal(result.response.status, 400, route);
    assert.equal(typeof result.body.error.message, 'string');
  }
});

test('API_KEY opcional protege todas las consultas personales', async () => {
  for (const route of ['/api/activities', '/api/activities/101', '/api/daily-stats', '/api/stats', '/api/sports']) {
    const response = await fetch(baseUrl + route);
    assert.equal(response.status, 401, route);
    const wrong = await request(route, { headers: { Authorization: 'Bearer wrong' } });
    assert.equal(wrong.response.status, 401, route);
  }
});

test('CORS solo permite orígenes explícitos y las respuestas no se cachean', async () => {
  const allowed = await request('/api/activities', { headers: { Origin: 'https://example.com' } });
  assert.equal(allowed.response.headers.get('access-control-allow-origin'), 'https://example.com');
  assert.equal(allowed.response.headers.get('cache-control'), 'no-store');
  const blocked = await request('/api/activities', { headers: { Origin: 'https://evil.example' } });
  assert.equal(blocked.response.headers.get('access-control-allow-origin'), null);
  const preflight = await fetch(baseUrl + '/api/activities', { method: 'OPTIONS', headers: {
    Origin: 'https://example.com', 'Access-Control-Request-Method': 'GET',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://example.com');
});
