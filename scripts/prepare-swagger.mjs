import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.dirname(require.resolve('swagger-ui-dist/package.json'));
const destination = path.join(root, 'public/swagger');
await mkdir(destination, { recursive: true });
for (const name of ['swagger-ui.css', 'swagger-ui-bundle.js', 'LICENSE']) {
  await copyFile(path.join(source, name), path.join(destination, name));
}
console.log('Swagger UI preparada.');
