// Construye db/salares.db desde el inventario SNGM 2023 + el contenido de ejemplo.
//   npm run db:build
//
// Es idempotente: borra y recrea la base completa cada vez.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEOJSON = join(ROOT, 'data', 'SNGM_2023.geojson');
const CONTENT = join(ROOT, 'data', 'content.json');
const SCHEMA = join(ROOT, 'db', 'schema.sql');
const DB_PATH = join(ROOT, 'db', 'salares.db');

// ───────────── utilidades geométricas (coordenadas lon/lat, WGS84) ─────────────

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/** Douglas–Peucker iterativo (sin recursión: los anillos del Salar de Atacama son enormes). */
function simplifyRing(ring, tol) {
  const n = ring.length;
  if (n <= 4) return ring;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      let d2;
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d2 > maxD) { maxD = d2; idx = i; }
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

function ringArea(ring) { // área con signo (shoelace) en grados²
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return s / 2;
}

function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  a /= 2;
  return a === 0 ? ring[0] : [cx / (6 * a), cy / (6 * a)];
}

const polygons = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

function bboxOf(g) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const poly of polygons(g)) for (const [x, y] of poly[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return { w, s, e, n };
}

function centroidOf(g) {
  // centroide del polígono exterior más grande (los salares son cóncavos, pero sirve como ancla de etiqueta/zoom)
  let best = null, bestA = -1;
  for (const poly of polygons(g)) {
    const a = Math.abs(ringArea(poly[0]));
    if (a > bestA) { bestA = a; best = poly[0]; }
  }
  return ringCentroid(best);
}

function simplifyGeometry(g) {
  const bb = bboxOf(g);
  const diag = Math.hypot(bb.e - bb.w, bb.n - bb.s);
  // tolerancia proporcional al tamaño (~0.4 % de la diagonal), entre ~5 m y ~110 m
  const tol = Math.min(0.001, Math.max(0.00005, diag * 0.004));
  const outPolys = [];
  for (const poly of polygons(g)) {
    const rings = [];
    poly.forEach((ring, i) => {
      const s = simplifyRing(ring, tol);
      if (s.length >= 4 && (i === 0 || Math.abs(ringArea(s)) > tol * tol * 4)) {
        rings.push(s.map(([x, y]) => [round(x, 5), round(y, 5)]));
      }
    });
    if (rings.length) outPolys.push(rings);
  }
  if (!outPolys.length) return g;
  return outPolys.length === 1
    ? { type: 'Polygon', coordinates: outPolys[0] }
    : { type: 'MultiPolygon', coordinates: outPolys };
}

const roundRing = (r) => r.map(([x, y]) => [round(x, 6), round(y, 6)]);
const roundGeometry = (g) =>
  g.type === 'Polygon'
    ? { type: 'Polygon', coordinates: g.coordinates.map(roundRing) }
    : { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(roundRing)) };

const countPoints = (g) => polygons(g).reduce((a, p) => a + p.reduce((b, r) => b + r.length, 0), 0);

// ───────────── utilidades de texto ─────────────

const slugify = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
function titleCaseRegion(s) {
  const r = s.replace(/^REGI[ÓO]N\s+(DE|DEL)\s+/i, '').toLowerCase();
  return r.split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

const clean = (s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : s);

// ───────────── construcción ─────────────

if (!existsSync(GEOJSON)) {
  console.error(`No encuentro ${GEOJSON}`);
  process.exit(1);
}

mkdirSync(dirname(DB_PATH), { recursive: true });
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) rmSync(f, { force: true });

const db = new DatabaseSync(DB_PATH);
db.exec(readFileSync(SCHEMA, 'utf8'));

const content = JSON.parse(readFileSync(CONTENT, 'utf8'));
const fc = JSON.parse(readFileSync(GEOJSON, 'utf8'));
console.log(`GeoJSON: ${fc.features.length} features`);

const warnings = [];
const usedSlugs = new Set();
const idByCode = new Map();

const insSalar = db.prepare(`
  INSERT INTO salares (code, slug, name, kind, environment, region, elevation_m, area_km2,
    centroid_lon, centroid_lat, bbox_w, bbox_s, bbox_e, bbox_n, geom_simple, geom_full,
    source_authors, source_date, summary, is_demo)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

db.exec('BEGIN');

const features = [...fc.features].sort((a, b) => clean(a.properties['Nombre']).localeCompare(clean(b.properties['Nombre']), 'es'));
let ptsFull = 0, ptsSimple = 0;

for (const f of features) {
  const p = f.properties;
  const code = clean(p['Código']);
  const name = clean(p['Nombre']);
  if (!code || !name) { warnings.push(`Feature sin código/nombre (OBJECTID ${p['OBJECTID_1']})`); continue; }
  if (!f.geometry || !['Polygon', 'MultiPolygon'].includes(f.geometry.type)) { warnings.push(`${code}: geometría inválida`); continue; }

  let slug = slugify(name);
  if (usedSlugs.has(slug)) { slug = `${slug}-${code.toLowerCase()}`; warnings.push(`Nombre duplicado "${name}" → slug ${slug}`); }
  usedSlugs.add(slug);

  const kind = /laguna|lago/i.test(p['Descripci']) ? 'laguna' : 'salar';
  const full = roundGeometry(f.geometry);
  const simple = simplifyGeometry(full);
  ptsFull += countPoints(full); ptsSimple += countPoints(simple);
  const bb = bboxOf(full);
  const [clon, clat] = centroidOf(full);
  const date = p['Fecha_de_e'] ? new Date(p['Fecha_de_e']).toISOString().slice(0, 10) : null;
  const authors = [p['Elaborado'] && `Elaborado: ${clean(p['Elaborado'])}`, p['Revisado'] && `Revisado: ${clean(p['Revisado'])}`].filter(Boolean).join(' · ');
  const summary = content.salar_summaries?.[code] ?? null;

  const r = insSalar.run(
    code, slug, name, kind, clean(p['Ambiente']) || null, titleCaseRegion(p['Región']),
    p['Cota_prome'] != null ? round(p['Cota_prome'], 1) : null, round(p['Área__km2'], 3),
    round(clon, 5), round(clat, 5), round(bb.w, 5), round(bb.s, 5), round(bb.e, 5), round(bb.n, 5),
    JSON.stringify(simple), JSON.stringify(full), authors || null, date, summary, summary ? 1 : 0,
  );
  idByCode.set(code, Number(r.lastInsertRowid));
  if (!p['Cota_prome']) warnings.push(`${code} ${name}: sin cota`);
}

// ───────────── contenido de la fundación ─────────────

const salarId = (code, ctx) => {
  const id = idByCode.get(code);
  if (!id) throw new Error(`content.json (${ctx}): código de salar desconocido "${code}"`);
  return id;
};

const insProject = db.prepare(`INSERT INTO projects (slug,title,summary,discipline,status,start_year,end_year,lead,institution,funding,url,is_demo)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`);
const insProjSalar = db.prepare('INSERT INTO project_salares VALUES (?,?)');
const projectIdBySlug = new Map();
for (const pr of content.projects ?? []) {
  const r = insProject.run(pr.slug, pr.title, pr.summary, pr.discipline, pr.status ?? 'activo', pr.start_year ?? null, pr.end_year ?? null,
    pr.lead ?? null, pr.institution ?? null, pr.funding ?? null, pr.url ?? null);
  const id = Number(r.lastInsertRowid);
  projectIdBySlug.set(pr.slug, id);
  for (const c of pr.salares ?? []) insProjSalar.run(id, salarId(c, pr.slug));
}

const insPub = db.prepare(`INSERT INTO publications (title,authors,year,venue,doi,url,kind,project_id,is_demo) VALUES (?,?,?,?,?,?,?,?,1)`);
const insPubSalar = db.prepare('INSERT INTO publication_salares VALUES (?,?)');
for (const pb of content.publications ?? []) {
  const r = insPub.run(pb.title, pb.authors ?? null, pb.year ?? null, pb.venue ?? null, pb.doi ?? null, pb.url ?? null,
    pb.kind ?? 'articulo', pb.project ? projectIdBySlug.get(pb.project) ?? null : null);
  for (const c of pb.salares ?? []) insPubSalar.run(Number(r.lastInsertRowid), salarId(c, pb.title));
}

const insAct = db.prepare(`INSERT INTO activities (slug,title,description,type,date,place,audience,url,is_demo) VALUES (?,?,?,?,?,?,?,?,1)`);
const insActSalar = db.prepare('INSERT INTO activity_salares VALUES (?,?)');
for (const a of content.activities ?? []) {
  const r = insAct.run(a.slug, a.title, a.description, a.type, a.date ?? null, a.place ?? null, a.audience ?? null, a.url ?? null);
  for (const c of a.salares ?? []) insActSalar.run(Number(r.lastInsertRowid), salarId(c, a.slug));
}

const insMedia = db.prepare(`INSERT INTO media (salar_id,kind,url,thumb_url,caption,credit,license,taken_at,lon,lat,project_id,activity_id,is_demo)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`);
for (const m of content.media ?? []) {
  insMedia.run(salarId(m.salar, 'media'), m.kind ?? 'foto', m.url ?? null, m.thumb_url ?? null, m.caption ?? null, m.credit ?? null,
    m.license ?? null, m.taken_at ?? null, m.lon ?? null, m.lat ?? null, null, null);
}

db.exec('COMMIT');
db.exec('VACUUM');

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log(`\nBase creada en ${DB_PATH}`);
console.log(`  salares:      ${count('salares')} (${db.prepare("SELECT COUNT(*) n FROM salares WHERE kind='salar'").get().n} salares + ${db.prepare("SELECT COUNT(*) n FROM salares WHERE kind='laguna'").get().n} lagunas)`);
console.log(`  proyectos:    ${count('projects')}`);
console.log(`  publicaciones:${count('publications')}`);
console.log(`  actividades:  ${count('activities')}`);
console.log(`  media:        ${count('media')}`);
console.log(`  vértices:     ${ptsFull.toLocaleString('es')} → ${ptsSimple.toLocaleString('es')} tras simplificar (${(100 * ptsSimple / ptsFull).toFixed(1)} %)`);
if (warnings.length) console.log(`\nAvisos de calidad de datos:\n  - ${warnings.join('\n  - ')}`);
db.close();
