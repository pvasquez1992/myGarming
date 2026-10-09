import { HTTPException } from 'hono/http-exception';

const supported = {
  activities: new Set(['from', 'to', 'sport', 'limit', 'offset']),
  daily: new Set(['from', 'to', 'limit', 'offset']),
  stats: new Set(['from', 'to', 'sport']),
};

export function parseQuery(url: string, kind: keyof typeof supported) {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) {
    if (!supported[kind].has(key)) fail(`Parámetro desconocido: ${key}`);
    if (params.getAll(key).length !== 1) fail(`Parámetro repetido: ${key}`);
  }
  const from = parseDate(params.get('from'), 'from');
  const to = parseDate(params.get('to'), 'to');
  if (from && to && from > to) fail('from debe ser anterior o igual a to.');
  const sport = params.get('sport');
  if (sport !== null && !/^[a-z][a-z0-9_]{0,63}$/.test(sport)) {
    fail('sport debe ser un identificador como running o treadmill_running.');
  }
  const limit = parseInteger(params.get('limit'), 'limit', 50, 1, 100);
  const offset = parseInteger(params.get('offset'), 'offset', 0, 0, 100_000);
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  const dateColumn = kind === 'daily' ? 'date' : 'local_date';
  if (from) { conditions.push(`${dateColumn} >= ?`); values.push(from); }
  if (to) { conditions.push(`${dateColumn} <= ?`); values.push(to); }
  if (sport) { conditions.push('sport = ?'); values.push(sport); }
  return {
    from, to, sport, limit, offset, values,
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
  };
}

function parseDate(value: string | null, name: string) {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${name} debe usar YYYY-MM-DD.`);
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    fail(`${name} no es una fecha válida.`);
  }
  return value;
}

function parseInteger(value: string | null, name: string, fallback: number, min: number, max: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    fail(`${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return parsed;
}

function fail(message: string): never {
  throw new HTTPException(400, { message });
}
