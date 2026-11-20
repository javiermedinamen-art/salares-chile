// Exporta la base SQLite a JSON/SVG estáticos en public/data/
// y copia MapLibre a public/vendor/, para poder abrir la web con Live Server.
// Se ejecuta al final de `npm run db:build`.

import { DatabaseSync } from 'node:sqlite';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'db', 'salares.db');
const OUT = join(ROOT, 'public', 'data');
const VENDOR = join(ROOT, 'public', 'vendor', 'maplibre');
const ML_DIST = join(ROOT, 'node_modules', 'maplibre-gl', 'dist');

if (!existsSync(DB_PATH)) {
  console.error('Falta db/salares.db. Ejecuta primero el build de la base.');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'salares'), { recursive: true });
mkdirSync(join(OUT, 'placeholder'), { recursive: true });
mkdirSync(VENDOR, { recursive: true });

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const write = (rel, data) => writeFileSync(join(OUT, rel), typeof data === 'string' ? data : JSON.stringify(data));

const linkedSalares = (table, col, ids) => {
  const map = new Map(ids.map((i) => [i, []]));
  if (!ids.length) return map;
  const rows = all(
    `SELECT l.${col} AS ref, s.slug, s.name, s.code FROM ${table} l JOIN salares s ON s.id = l.salar_id
     WHERE l.${col} IN (${ids.map(() => '?').join(',')}) ORDER BY s.name`, ...ids);
  for (const r of rows) map.get(r.ref).push({ slug: r.slug, name: r.name, code: r.code });
  return map;
};
const attach = (rows, table, col) => {
  const m = linkedSalares(table, col, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, salares: m.get(r.id) }));
};

const listProjects = (where = '', ...p) =>
  attach(all(`SELECT * FROM projects ${where} ORDER BY (status='activo') DESC, start_year DESC, title`, ...p), 'project_salares', 'project_id');
const listActivities = (where = '', ...p) =>
  attach(all(`SELECT * FROM activities ${where} ORDER BY date DESC, title`, ...p), 'activity_salares', 'activity_id');
const listPublications = (where = '', ...p) =>
  attach(all(`SELECT * FROM publications ${where} ORDER BY year DESC, title`, ...p), 'publication_salares', 'publication_id');

const counts = (table) => new Map(all(`SELECT salar_id AS id, COUNT(*) AS n FROM ${table} GROUP BY salar_id`).map((r) => [r.id, r.n]));
const nProj = counts('project_salares');
const nAct = counts('activity_salares');
const nPub = counts('publication_salares');
const nMed = counts('media');
const discs = new Map();
for (const r of all(`SELECT DISTINCT ps.salar_id AS id, p.discipline AS d FROM project_salares ps JOIN projects p ON p.id = ps.project_id`)) {
  if (!discs.has(r.id)) discs.set(r.id, []);
  discs.get(r.id).push(r.d);
}

const rows = all(`SELECT id, code, slug, name, kind, environment, region, elevation_m, area_km2,
  centroid_lon, centroid_lat, bbox_w, bbox_s, bbox_e, bbox_n, geom_simple FROM salares ORDER BY name`);

const fc = {
  type: 'FeatureCollection',
  features: rows.map((r) => {
    const projects = nProj.get(r.id) ?? 0, activities = nAct.get(r.id) ?? 0, pubs = nPub.get(r.id) ?? 0, media = nMed.get(r.id) ?? 0;
    return {
      type: 'Feature',
      id: r.id,
      geometry: JSON.parse(r.geom_simple),
      properties: {
        id: r.id, code: r.code, slug: r.slug, name: r.name, kind: r.kind, environment: r.environment, region: r.region,
        elevation_m: r.elevation_m, area_km2: r.area_km2,
        center: [r.centroid_lon, r.centroid_lat],
        bbox: [r.bbox_w, r.bbox_s, r.bbox_e, r.bbox_n],
        projects, activities, publications: pubs, media,
        disciplines: discs.get(r.id) ?? [],
        has_content: projects + activities + pubs + media > 0,
      },
    };
  }),
};

write('salares.geojson', fc);
write('projects.json', listProjects());
write('activities.json', listActivities());
write('publications.json', listPublications());
write('stats.json', {
  salares: get(`SELECT COUNT(*) n FROM salares WHERE kind='salar'`).n,
  lagunas: get(`SELECT COUNT(*) n FROM salares WHERE kind='laguna'`).n,
  area_km2: get('SELECT ROUND(SUM(area_km2),1) n FROM salares').n,
  regions: all('SELECT region, COUNT(*) n FROM salares GROUP BY region ORDER BY n DESC'),
  projects: get('SELECT COUNT(*) n FROM projects').n,
  activities: get('SELECT COUNT(*) n FROM activities').n,
  publications: get('SELECT COUNT(*) n FROM publications').n,
  media: get('SELECT COUNT(*) n FROM media').n,
  salares_with_content: get(`SELECT COUNT(DISTINCT salar_id) n FROM (
    SELECT salar_id FROM project_salares UNION SELECT salar_id FROM activity_salares
    UNION SELECT salar_id FROM publication_salares UNION SELECT salar_id FROM media)`).n,
});

const ICONS = { foto: '▲', dron: '✦', video: '▶', audio: '♪' };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const allSalares = all('SELECT * FROM salares');
for (const s of allSalares) {
  const { geom_simple, geom_full, ...props } = s;
  const media = all('SELECT * FROM media WHERE salar_id = ? ORDER BY id', s.id).map((m) => ({
    ...m, src: m.url ?? `/data/placeholder/${m.id}.svg`,
  }));
  write(`salares/${s.slug}.json`, {
    ...props,
    geometry: JSON.parse(geom_full),
    projects: listProjects('WHERE id IN (SELECT project_id FROM project_salares WHERE salar_id = ?)', s.id),
    publications: listPublications('WHERE id IN (SELECT publication_id FROM publication_salares WHERE salar_id = ?)', s.id),
    activities: listActivities('WHERE id IN (SELECT activity_id FROM activity_salares WHERE salar_id = ?)', s.id),
    media,
  });
}

for (const m of all(`SELECT m.id, m.kind, m.caption, s.name FROM media m JOIN salares s ON s.id = m.salar_id`)) {
  const h = (m.id * 67 + 20) % 360;
  write(`placeholder/${m.id}.svg`,
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${h},45%,78%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},50%,45%)"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#g)"/>
<path d="M0 230 L90 170 L160 210 L250 130 L330 190 L400 150 L400 300 L0 300Z" fill="rgba(255,255,255,.28)"/>
<text x="200" y="150" font-size="54" text-anchor="middle" fill="rgba(255,255,255,.85)" font-family="sans-serif">${ICONS[m.kind] ?? '▲'}</text>
<text x="200" y="278" font-size="15" text-anchor="middle" fill="rgba(255,255,255,.9)" font-family="sans-serif">${esc(m.name)} · imagen de ejemplo</text>
</svg>`);
}

// MapLibre para servir sin node_modules (Live Server)
for (const f of ['maplibre-gl.mjs', 'maplibre-gl.mjs.map', 'maplibre-gl.css', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs']) {
  cpSync(join(ML_DIST, f), join(VENDOR, f));
}

db.close();
console.log(`Estáticos exportados → public/data/ (${allSalares.length} fichas) + public/vendor/maplibre/`);
console.log('Live Server: abre la carpeta public/ (o el archivo public/index.html).');
