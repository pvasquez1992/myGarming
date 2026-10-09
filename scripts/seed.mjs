import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(root, 'data/import.sql'))) {
  console.error('Falta data/import.sql. Ejecuta npm run data:import primero.');
  process.exit(1);
}
const result = spawnSync(process.execPath, [
  path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
  'd1', 'execute', 'my-garmin', '--local', '--file', 'data/import.sql', '--json',
], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (result.status !== 0) {
  console.error(result.error?.message ?? (result.stderr + result.stdout));
  process.exit(1);
}
const results = JSON.parse(result.stdout);
if (!Array.isArray(results) || results.some(item => !item.success)) {
  console.error('D1 no confirmó todas las operaciones.');
  process.exit(1);
}
console.log(`D1 local actualizada: ${results.length} operaciones correctas.`);
