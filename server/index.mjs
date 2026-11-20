// Servidor estático liviano. Los datos viven en public/data/ (generados por `npm run db:build`).
//   npm start  → http://localhost:3000
// También puedes abrir public/ con Live Server de VS Code / Cursor.

import express from 'express';
import compression from 'compression';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

if (!existsSync(join(PUBLIC, 'data', 'salares.geojson'))) {
  console.error('Faltan los datos estáticos. Ejecuta primero:  npm run db:build');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.static(PUBLIC, { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`Salares Chile → http://localhost:${PORT}`);
  console.log('(también puedes abrir public/ con Live Server)');
});
