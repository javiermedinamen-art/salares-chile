import { initMap, loadSalares, setBasemap, setHover, setSelected, setVisibleIds, setLens, flyToBBox, fitAll, toggle3D, TERRAIN_EXAGGERATION } from './map.js';
import {
  DISCIPLINES, ACTIVITY_TYPES, STATUS, MEDIA_KIND, BASEMAPS, LENSES, LENS_KEYS, COLORS,
  disc, lensColor, lensDim, ELEV_GRADIENT, ELEV_MIN, ELEV_MAX,
} from './config.js';
import { silhouetteSvg } from './shape.js';
import { createTransect } from './transect.js';
import { asset } from './base.js';

// ───────────── utilidades ─────────────

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const nf = (n, d = 0) => n.toLocaleString('es-CL', { maximumFractionDigits: d });
const fmtArea = (a) => nf(a, a < 10 ? 2 : a < 100 ? 1 : 0);
const fmtDate = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;
// Datos estáticos en data/ (npm run db:build). Compatible con GitHub Pages, Live Server y npm start.
const api = (path) => {
  const file = path === 'salares' ? 'salares.geojson'
    : path.startsWith('salares/') ? `${path}.json`
    : `${path}.json`;
  return fetch(asset(`data/${file}`)).then((r) => { if (!r.ok) throw new Error(`${r.status} ${file}`); return r.json(); });
};
const withAssets = (d) => (d?.media
  ? { ...d, media: d.media.map((m) => ({ ...m, src: asset(m.src), thumb_url: m.thumb_url ? asset(m.thumb_url) : m.thumb_url })) }
  : d);
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
}

function haversine([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// ───────────── estado ─────────────

const S = {
  features: [], byId: new Map(), bySlug: new Map(), geomById: new Map(),
  projects: [], activities: [], publications: [], stats: null,
  view: 'salares',                // salares | ciencia | divulgacion | detail
  lens: 'alt', autoLens: null,
  slug: null, detail: null, detailTab: 'resumen', pendingTab: null,
  detailCache: new Map(),
  f: { kind: '', region: '', env: '', onlyContent: false, sort: 'name' },
  fp: { disc: '', status: '' },
  fa: { type: '' },
};

const panel = $('#panel-body');
let T;   // perfil norte→sur

// ───────────── arranque ─────────────

async function main() {
  document.documentElement.style.setProperty('--elev-gradient', ELEV_GRADIENT);
  const mapReady = initMap($('#map'), {
    select: (slug) => openSalar(slug),
    hover: (id) => { hoverList(id); T?.setHover(id); },
  });
  initChrome();

  panel.innerHTML = '<div class="loading">Cargando salares…</div>';
  try {
    const [fc, projects, activities, publications, stats] = await Promise.all([
      api('salares'), api('projects'), api('activities'), api('publications'), api('stats'),
    ]);
    S.features = fc.features;
    for (const f of fc.features) { S.byId.set(f.id, f.properties); S.bySlug.set(f.properties.slug, f.properties); S.geomById.set(f.id, f.geometry); }
    Object.assign(S, { projects, activities, publications, stats });
  } catch (e) {
    panel.innerHTML = `<div class="loading">No se pudieron cargar los datos.<br><small>${esc(e.message)}</small></div>`;
    return;
  }

  T = createTransect($('#transect-plot'), {
    onSelect: (slug) => openSalar(slug),
    onHover: (id) => { setHover(id); hoverList(id); },
  });
  T.set({ features: S.features, lens: S.lens });
  renderLegend();

  if (!location.hash.startsWith('#/salar/')) renderSalares();     // la lista aparece sin esperar al mapa
  await mapReady;
  await loadSalares({ type: 'FeatureCollection', features: S.features });
  setLens(S.lens);
  window.addEventListener('hashchange', () => route());
  route(true);
}

/** Controles fijos: lentes, mapas base, 3D, paneles, buscador, atajos. */
function initChrome() {
  // lentes
  const lenses = $('#lenses');
  lenses.innerHTML = LENS_KEYS.map((k) => `<button role="radio" data-lens="${k}" aria-checked="${k === S.lens}" title="${esc(LENSES[k].hint)}">${LENSES[k].label}</button>`).join('');
  lenses.addEventListener('click', (e) => { const b = e.target.closest('[data-lens]'); if (b) changeLens(b.dataset.lens); });

  // mapa base
  const bm = $('#basemaps');
  bm.innerHTML = Object.entries(BASEMAPS).map(([k, v]) => `<button role="radio" data-base="${k}" aria-checked="${k === 'sat'}">${v.label}</button>`).join('');
  bm.addEventListener('click', (e) => {
    const b = e.target.closest('[data-base]'); if (!b) return;
    setBasemap(b.dataset.base);
    bm.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', x === b));
  });

  // 3D
  const terrainNote = $('#terrain-note');
  terrainNote.textContent = `Relieve 3D exagerado ×${TERRAIN_EXAGGERATION} · solo para visualización; las altitudes reales están en cada ficha`;
  $('#btn3d').addEventListener('click', (e) => {
    const on = toggle3D();
    e.currentTarget.setAttribute('aria-pressed', on);
    terrainNote.hidden = !on;
    if (on) toast(`Relieve ×${TERRAIN_EXAGGERATION} · clic derecho (o Ctrl) para girar`);
  });

  // paneles
  $('#drawer-toggle').addEventListener('click', () => document.body.classList.toggle('drawer-closed'));
  $('#strip-toggle').addEventListener('click', () => {
    document.body.classList.toggle('strip-collapsed');
    setTimeout(() => T?.resize(), 340);
  });
  const sheet = $('#sheet-handle');
  const toggleSheet = () => $('#drawer').classList.toggle('expanded');
  sheet.addEventListener('click', toggleSheet);
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSheet(); } });

  // sorpresa
  $('#surprise').addEventListener('click', surprise);

  initOmni();

  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); $('#omni-input').focus(); }
    else if (e.key === 'Escape') {
      if (!$('#lightbox').hidden) closeLightbox();
      else if (document.activeElement === $('#omni-input')) { $('#omni-input').blur(); closeOmni(); }
      else if (S.view === 'detail') go('#/');
    }
  });
}

// ───────────── lentes y leyenda ─────────────

function changeLens(lens, auto = false) {
  if (auto) S.autoLens ??= S.lens; else S.autoLens = null;     // si la lente la cambió la vista, se restaura al volver
  S.lens = lens;
  document.querySelectorAll('#lenses button').forEach((b) => b.setAttribute('aria-checked', b.dataset.lens === lens));
  setLens(lens);
  T?.set({ lens });
  recolorList();
  renderLegend();
  const hero = $('.hero', panel);
  if (hero && S.slug) hero.style.setProperty('--c', lensColor(S.bySlug.get(S.slug), lens));
}

function renderLegend() {
  const dot = (c, t) => `<div class="li"><i class="sw" style="background:${c}"></i>${t}</div>`;
  let body = '', note = '';
  switch (S.lens) {
    case 'tipo':
      body = dot(COLORS.salar, 'Salar') + dot(COLORS.laguna, 'Laguna o lago'); break;
    case 'ciencia': {
      const used = [...new Set(S.projects.flatMap((p) => p.discipline))];
      body = used.map((k) => dot(disc(k).color, disc(k).label)).join('') + dot(COLORS.none, 'Sin proyectos');
      note = 'Color = disciplina principal'; break;
    }
    case 'div':
      body = dot(COLORS.accent, 'Con actividades') + dot(COLORS.none, 'Sin actividades'); break;
    default:
      body = `<div class="ramp"></div><div class="ramp-l"><span>${nf(ELEV_MIN)} m</span><span>${nf(ELEV_MAX)} m</span></div>`;
      note = 'Altitud media sobre el nivel del mar';
  }
  $('#legend').innerHTML = `<h6>${LENSES[S.lens].label}</h6>${body}<div class="li" style="margin-top:6px"><span class="pl" aria-hidden="true"><i></i><i></i><b></b></span>Con contenido de la fundación</div>${note ? `<p>${note}</p>` : ''}`;
}

function recolorList() {
  panel.querySelectorAll('.item[data-id]').forEach((el) => {
    const p = S.byId.get(Number(el.dataset.id));
    el.style.setProperty('--c', lensColor(p, S.lens));
    el.classList.toggle('dim', lensDim(p, S.lens));
  });
}

// ───────────── router (hash) ─────────────

const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

function openSalar(slug, tab) {
  if (!slug) return;
  if (tab) S.pendingTab = tab;
  go(`#/salar/${slug}`);
}

async function route(first = false) {
  closeOmni();
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'salar' && b) {
    const p = S.bySlug.get(b);
    if (!p) { toast('Ese salar no existe'); location.hash = '#/'; return; }
    await openDetail(p, first);
  } else {
    S.view = ['ciencia', 'divulgacion'].includes(a) ? a : 'salares';
    S.slug = null; S.detail = null;
    setSelected(null, null);
    renderView();
    syncAll();
    fitAll(visibleFeatures().map((f) => f.properties.bbox), { duration: first ? 0 : 800 });
  }
}

async function openDetail(p, first) {
  const changed = S.slug !== p.slug;
  document.body.classList.remove('drawer-closed');
  S.view = 'detail'; S.slug = p.slug;
  if (changed) S.detailTab = S.pendingTab ?? 'resumen';
  S.pendingTab = null;
  S.detail = S.detailCache.get(p.slug) ?? null;
  renderDetail(p, changed);                 // pinta ya con los datos ligeros; el resto llega enseguida
  syncAll();
  flyToBBox(p.bbox, { duration: first ? 0 : 1100 });
  setSelected(p.id, S.detail?.geometry ?? null);
  if (S.detail) return;
  try {
    const d = withAssets(await api(`salares/${p.slug}`));
    S.detailCache.set(p.slug, d);
    if (S.slug !== p.slug) return;          // el usuario ya se fue a otro lado
    S.detail = d;
    setSelected(p.id, d.geometry);
    renderDetail(p, false);
  } catch (e) { toast('No se pudo cargar la ficha'); console.error(e); }
}

// ───────────── filtros ─────────────

function filteredSalares() {
  const { kind, region, env, onlyContent, sort } = S.f;
  const out = S.features.filter(({ properties: p }) =>
    (!kind || p.kind === kind) && (!region || p.region === region) && (!env || p.environment === env) && (!onlyContent || p.has_content));
  const sum = (p) => p.projects + p.activities + p.media;
  const cmp = {
    name: (a, b) => a.properties.name.localeCompare(b.properties.name, 'es'),
    area: (a, b) => b.properties.area_km2 - a.properties.area_km2,
    elev: (a, b) => (b.properties.elevation_m ?? 0) - (a.properties.elevation_m ?? 0),
    lat: (a, b) => b.properties.center[1] - a.properties.center[1],
    content: (a, b) => sum(b.properties) - sum(a.properties),
  }[sort];
  return out.sort(cmp);
}
const filteredProjects = () => S.projects.filter((p) => (!S.fp.disc || p.discipline === S.fp.disc) && (!S.fp.status || p.status === S.fp.status));
const filteredActivities = () => S.activities.filter((a) => !S.fa.type || a.type === S.fa.type);

const slugsToFeatures = (items) => {
  const slugs = new Set(items.flatMap((i) => i.salares.map((s) => s.slug)));
  return S.features.filter((f) => slugs.has(f.properties.slug));
};

function visibleFeatures() {
  if (S.view === 'ciencia') return slugsToFeatures(filteredProjects());
  if (S.view === 'divulgacion') return slugsToFeatures(filteredActivities());
  if (S.view === 'detail') return S.features;
  return filteredSalares();
}

/** Sincroniza mapa y perfil con lo que está filtrado en el panel. */
function syncAll() {
  const feats = visibleFeatures();
  const all = feats.length === S.features.length;
  const ids = all ? null : feats.map((f) => f.id);
  setVisibleIds(ids);
  T?.set({ visible: ids ? new Set(ids) : null, selected: S.view === 'detail' ? S.bySlug.get(S.slug)?.id ?? null : null });
}

let refitTimer;
const refit = () => { clearTimeout(refitTimer); refitTimer = setTimeout(() => fitAll(visibleFeatures().map((f) => f.properties.bbox)), 140); };

// ───────────── estructura común del panel ─────────────

function paint(html, animate = true) {
  if (animate) { panel.style.animation = 'none'; void panel.offsetHeight; panel.style.animation = ''; }
  panel.innerHTML = html;
}

function tabs(active) {
  const t = (id, label, n) => `<button role="tab" data-view="${id}" aria-selected="${active === id}">${label}<span class="n">${n}</span></button>`;
  return `<div class="tabs" role="tablist">${t('salares', 'Salares', S.features.length)}${t('ciencia', 'Ciencia', S.projects.length)}${t('divulgacion', 'Divulgación', S.activities.length)}</div>`;
}
function bindTabs() {
  panel.querySelectorAll('.tabs [data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view === 'salares' ? '#/' : `#/${b.dataset.view}`)));
}
function renderView() {
  if (S.view === 'ciencia') return renderCiencia();
  if (S.view === 'divulgacion') return renderDivulgacion();
  return renderSalares();
}

// ───────────── vista: salares ─────────────

function renderSalares() {
  if (S.autoLens) changeLens(S.autoLens);
  const regions = [...new Set(S.features.map((f) => f.properties.region))].sort((a, b) => a.localeCompare(b, 'es'));
  const envs = [...new Set(S.features.map((f) => f.properties.environment).filter(Boolean))];
  const f = S.f, st = S.stats;
  paint(`
    ${tabs('salares')}
    <div class="summary">
      <span><b>${st.salares}</b>salares</span><span><b>${st.lagunas}</b>lagunas y lagos</span>
      <span><b>${nf(st.area_km2)}</b>km² mapeados</span><span><b>${st.salares_with_content}</b>con contenido</span>
    </div>
    <span class="demo-flag" title="Los proyectos, actividades y fotos son marcadores de posición">Prototipo · contenido de ejemplo</span>
    <div class="filters">
      <div class="row">
        <button class="chip" data-kind="salar" aria-pressed="${f.kind === 'salar'}">Salares</button>
        <button class="chip" data-kind="laguna" aria-pressed="${f.kind === 'laguna'}">Lagunas</button>
        <button class="chip" id="onlyc" aria-pressed="${f.onlyContent}">Con contenido</button>
      </div>
      <div class="row">
        <select id="region" aria-label="Región"><option value="">Todas las regiones</option>${regions.map((r) => `<option ${f.region === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        <select id="env" aria-label="Ambiente"><option value="">Todo ambiente</option>${envs.map((r) => `<option ${f.env === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        <select id="sort" aria-label="Ordenar">
          ${[['name', 'A–Z'], ['lat', 'Norte → sur'], ['area', 'Mayor superficie'], ['elev', 'Mayor altitud'], ['content', 'Más contenido']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="count"><span id="count"></span><button class="link" id="reset" hidden>Limpiar filtros</button></div>
    </div>
    <div class="scroll" id="list-wrap"></div>`);
  bindTabs();

  const upd = () => { updateSalaresList(); syncAll(); };
  panel.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    S.f.kind = S.f.kind === b.dataset.kind ? '' : b.dataset.kind;
    panel.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', S.f.kind === x.dataset.kind));
    upd(); refit();
  }));
  $('#onlyc', panel).addEventListener('click', (e) => { S.f.onlyContent = !S.f.onlyContent; e.currentTarget.setAttribute('aria-pressed', S.f.onlyContent); upd(); refit(); });
  $('#region', panel).addEventListener('change', (e) => { S.f.region = e.target.value; upd(); refit(); });
  $('#env', panel).addEventListener('change', (e) => { S.f.env = e.target.value; upd(); refit(); });
  $('#sort', panel).addEventListener('change', (e) => { S.f.sort = e.target.value; updateSalaresList(); });
  $('#reset', panel).addEventListener('click', () => {
    S.f = { kind: '', region: '', env: '', onlyContent: false, sort: S.f.sort };
    renderSalares(); syncAll(); refit();
  });
  updateSalaresList();
}

const glyph = (p) => `<span class="g">${silhouetteSvg(p.id, S.geomById.get(p.id), { size: 44, pad: 5 })}</span>`;

function itemHtml(p, extra = '') {
  return `<button class="item${lensDim(p, S.lens) ? ' dim' : ''}" data-id="${p.id}" data-slug="${esc(p.slug)}" style="--c:${lensColor(p, S.lens)}">
    ${glyph(p)}
    <span class="b">
      <span class="t">${esc(p.name)}</span>
      <span class="m">${esc(p.region)} · ${fmtArea(p.area_km2)} km²${p.elevation_m ? ` · ${nf(p.elevation_m)} m` : ''}</span>
      ${extra}
    </span></button>`;
}

function updateSalaresList() {
  const rows = filteredSalares();
  const f = S.f;
  $('#count', panel).textContent = `${rows.length} de ${S.features.length}`;
  $('#reset', panel).hidden = !(f.kind || f.region || f.env || f.onlyContent);
  const wrap = $('#list-wrap', panel);
  if (!rows.length) { wrap.innerHTML = '<div class="empty">Ningún salar coincide con los filtros.</div>'; return; }
  wrap.innerHTML = `<ul class="list">${rows.map(({ properties: p }) => `<li>${itemHtml(p, p.has_content ? `<span class="tags">
        ${p.projects ? `<span class="tag c">${plural(p.projects, 'proyecto', 'proyectos')}</span>` : ''}
        ${p.activities ? `<span class="tag d">${plural(p.activities, 'actividad', 'actividades')}</span>` : ''}
        ${p.media ? `<span class="tag p">${plural(p.media, 'imagen', 'imágenes')}</span>` : ''}</span>` : '')}</li>`).join('')}</ul>`;
  bindItems(wrap);
}

function bindItems(root) {
  root.querySelectorAll('.item[data-slug]').forEach((el) => {
    el.addEventListener('click', () => openSalar(el.dataset.slug));
    el.addEventListener('mouseenter', () => { const id = Number(el.dataset.id); setHover(id); T?.setHover(id); });
    el.addEventListener('mouseleave', () => { setHover(null); T?.setHover(null); });
  });
}

function hoverList(id) {
  panel.querySelectorAll('.item.hover').forEach((e) => e.classList.remove('hover'));
  if (id == null) return;
  const el = panel.querySelector(`.item[data-id="${id}"]`);
  if (el) { el.classList.add('hover'); el.scrollIntoView({ block: 'nearest' }); }
}

// ───────────── vista: ciencia ─────────────

const salarChips = (list) => `<div class="chips">${list.map((s) => `<a class="chip" href="#/salar/${esc(s.slug)}">${esc(s.name)}</a>`).join('')}</div>`;

function projectCard(p, withSalares = true) {
  const d = disc(p.discipline);
  const years = p.start_year ? `${p.start_year}–${p.end_year ?? 'hoy'}` : '';
  return `<article class="card">
    ${p.is_demo ? '<span class="badge soft demo">ejemplo</span>' : ''}
    <span class="badge" style="--c:${d.color}">${esc(d.label)}</span> <span class="badge soft">${esc(STATUS[p.status] ?? p.status)}</span>
    <h3>${esc(p.title)}</h3>
    <p>${esc(p.summary)}</p>
    <div class="meta">${[years, p.lead && `Responsable: ${p.lead}`, p.institution].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
    ${withSalares ? salarChips(p.salares) : ''}
    ${p.url ? `<p style="margin-top:8px"><a href="${esc(p.url)}" target="_blank" rel="noopener">Más información ↗</a></p>` : ''}
  </article>`;
}

function renderCiencia() {
  paint(`
    ${tabs('ciencia')}
    <div class="filters">
      <div class="row">${Object.entries(DISCIPLINES).map(([k, v]) => `<button class="chip" data-d="${k}" aria-pressed="${S.fp.disc === k}">${v.label}</button>`).join('')}</div>
      <div class="row"><select id="status" aria-label="Estado"><option value="">Cualquier estado</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${S.fp.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <span class="count" id="count" style="margin-left:auto"></span></div>
    </div>
    <div class="scroll"><div class="cards" id="cards"></div></div>`);
  bindTabs();
  const upd = () => { updateCiencia(); syncAll(); refit(); };
  panel.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
    S.fp.disc = S.fp.disc === b.dataset.d ? '' : b.dataset.d;
    panel.querySelectorAll('[data-d]').forEach((x) => x.setAttribute('aria-pressed', S.fp.disc === x.dataset.d));
    upd();
  }));
  $('#status', panel).addEventListener('change', (e) => { S.fp.status = e.target.value; upd(); });
  updateCiencia();
  if (S.lens !== 'ciencia') changeLens('ciencia', true);       // la vista de ciencia colorea el mapa por disciplina
}

function updateCiencia() {
  const rows = filteredProjects();
  $('#count', panel).textContent = plural(rows.length, 'proyecto', 'proyectos');
  $('#cards', panel).innerHTML = rows.length ? rows.map((p) => projectCard(p)).join('') : '<div class="empty">No hay proyectos con ese filtro.</div>';
}

// ───────────── vista: divulgación ─────────────

function activityCard(a, withSalares = true) {
  return `<article class="card">
    ${a.is_demo ? '<span class="badge soft demo">ejemplo</span>' : ''}
    <span class="badge" style="--c:${COLORS.accent}">${esc(ACTIVITY_TYPES[a.type] ?? a.type)}</span>
    <h3>${esc(a.title)}</h3>
    <div class="meta">${[fmtDate(a.date), a.place, a.audience].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
    <p>${esc(a.description)}</p>
    ${withSalares ? salarChips(a.salares) : ''}
    ${a.url ? `<p style="margin-top:8px"><a href="${esc(a.url)}" target="_blank" rel="noopener">Ver más ↗</a></p>` : ''}
  </article>`;
}

function renderDivulgacion() {
  paint(`
    ${tabs('divulgacion')}
    <div class="filters">
      <div class="row">${Object.entries(ACTIVITY_TYPES).map(([k, v]) => `<button class="chip" data-t="${k}" aria-pressed="${S.fa.type === k}">${v}</button>`).join('')}</div>
      <div class="count"><span id="count"></span></div>
    </div>
    <div class="scroll"><div class="cards" id="cards"></div></div>`);
  bindTabs();
  panel.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
    S.fa.type = S.fa.type === b.dataset.t ? '' : b.dataset.t;
    panel.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-pressed', S.fa.type === x.dataset.t));
    updateDivulgacion(); syncAll(); refit();
  }));
  updateDivulgacion();
  if (S.lens !== 'div') changeLens('div', true);
}

function updateDivulgacion() {
  const rows = filteredActivities();
  $('#count', panel).textContent = plural(rows.length, 'actividad', 'actividades');
  $('#cards', panel).innerHTML = rows.length ? rows.map((a) => activityCard(a)).join('') : '<div class="empty">No hay actividades con ese filtro.</div>';
}

// ───────────── vista: ficha de un salar ─────────────

function renderDetail(p, animate = true) {
  const d = S.detail;
  const n = { ciencia: d ? d.projects.length + d.publications.length : p.projects + p.publications, divulgacion: d ? d.activities.length : p.activities, galeria: d ? d.media.length : p.media };
  const tabBtn = (id, label, count) => `<button role="tab" data-dt="${id}" aria-selected="${S.detailTab === id}">${label}${count != null ? `<span class="n">${count}</span>` : ''}</button>`;
  const hero = d?.media?.[0];

  paint(`
    <div class="hero${hero ? ' img' : ''}" style="--c:${lensColor(p, S.lens)};${hero ? `background-image:url('${esc(hero.src)}')` : ''}">
      ${silhouetteSvg(p.id, S.geomById.get(p.id), { size: 150, pad: 8, cls: 'sil sil-big' })}
      <button class="back" id="back">← Todos los salares</button>
      <div>
        <div class="kicker">${p.kind === 'salar' ? 'Salar' : 'Laguna / lago'} · ${esc(p.region)} · ${esc(p.code)}</div>
        <h2>${esc(p.name)}</h2>
      </div>
    </div>
    <div class="tabs" role="tablist">
      ${tabBtn('resumen', 'Resumen')}${tabBtn('ciencia', 'Ciencia', n.ciencia)}${tabBtn('divulgacion', 'Divulgación', n.divulgacion)}${tabBtn('galeria', 'Galería', n.galeria)}
    </div>
    <div class="scroll" id="dbody">${d ? detailBody(p, d) : '<div class="loading">Cargando ficha…</div>'}</div>`, animate);

  $('#back', panel).addEventListener('click', () => go('#/'));
  panel.querySelectorAll('[data-dt]').forEach((b) => b.addEventListener('click', () => { S.detailTab = b.dataset.dt; renderDetail(p, false); }));
  panel.querySelectorAll('[data-go-tab]').forEach((b) => b.addEventListener('click', () => { S.detailTab = b.dataset.goTab; renderDetail(p, false); }));
  panel.querySelectorAll('[data-shot]').forEach((b) => b.addEventListener('click', () => openLightbox(d.media, Number(b.dataset.shot))));
  bindItems(panel);
}

function nearby(p, k = 4) {
  return S.features
    .filter((f) => f.properties.id !== p.id)
    .map((f) => ({ p: f.properties, km: haversine(p.center, f.properties.center) }))
    .sort((a, b) => a.km - b.km).slice(0, k);
}

function detailBody(p, d) {
  switch (S.detailTab) {
    case 'ciencia': return `
      ${d.projects.length ? `<div class="cards">${d.projects.map((x) => projectCard(x, false)).join('')}</div>` : emptyMsg('Aún no hay proyectos científicos registrados en este lugar.')}
      ${d.publications.length ? `<div class="section"><h4>Publicaciones</h4>${d.publications.map((b) => `
        <div class="pub"><div class="t">${b.url || b.doi ? `<a href="${esc(b.url || `https://doi.org/${b.doi}`)}" target="_blank" rel="noopener">${esc(b.title)}</a>` : esc(b.title)}</div>
        <div class="m">${[b.authors, b.year, b.venue].filter(Boolean).map(esc).join(' · ')}</div></div>`).join('')}</div>` : ''}`;
    case 'divulgacion': return d.activities.length
      ? `<div class="cards">${d.activities.map((a) => activityCard(a, false)).join('')}</div>`
      : emptyMsg('Aún no hay actividades de divulgación registradas en este lugar.');
    case 'galeria': return d.media.length
      ? `<div class="gallery">${d.media.map((m, i) => `
          <button class="shot" data-shot="${i}" aria-label="${esc(m.caption ?? 'Ver imagen')}">
            <img loading="lazy" src="${esc(m.thumb_url || m.src)}" alt="${esc(m.caption ?? p.name)}">
            <span class="k">${esc(MEDIA_KIND[m.kind] ?? m.kind)}</span>
            ${m.caption ? `<span class="c">${esc(m.caption)}</span>` : ''}
          </button>`).join('')}</div>`
      : emptyMsg('Aún no hay fotos ni videos de este lugar.');
    default: return summaryTab(p, d);
  }
}

function summaryTab(p, d) {
  const n = S.features.length;
  const withElev = S.features.filter((f) => f.properties.elevation_m != null);
  const below = withElev.filter((f) => f.properties.elevation_m < p.elevation_m).length;
  const pct = p.elevation_m != null ? Math.round((below / (withElev.length - 1)) * 100) : null;
  const rankArea = [...S.features].sort((a, b) => b.properties.area_km2 - a.properties.area_km2).findIndex((f) => f.properties.id === p.id) + 1;
  const pos = p.elevation_m != null ? Math.max(0, Math.min(1, (p.elevation_m - ELEV_MIN) / (ELEV_MAX - ELEV_MIN))) * 100 : 0;

  return `
    <div class="metrics">
      <div class="metric"><b>${fmtArea(p.area_km2)} km²</b><span>superficie</span></div>
      <div class="metric"><b>${p.elevation_m ? `${nf(p.elevation_m)} m` : '—'}</b><span>altitud media</span></div>
      <div class="metric"><b>${esc(d.environment ?? '—')}</b><span>ambiente</span></div>
    </div>
    <div class="section">
      ${d.summary ? `<h4>Sobre este lugar</h4><p>${esc(d.summary)}</p>${d.is_demo ? '<p class="note">Texto de ejemplo.</p>' : ''}` : ''}
      ${p.elevation_m ? `
      <h4>Posición en el perfil</h4>
      <div class="gauge"><i style="left:${pos}%"></i></div>
      <div class="gauge-l"><span>${nf(ELEV_MIN)} m</span><span>${nf(ELEV_MAX)} m</span></div>
      <p class="fact">Está más alto que el <em>${pct} %</em> de los ${n} cuerpos de agua del inventario y es el <em>n.º ${rankArea}</em> por superficie.</p>` : ''}

      <h4>En esta ficha</h4>
      <div class="chips">
        <button class="chip" data-go-tab="ciencia">${plural(d.projects.length, 'proyecto', 'proyectos')} · ${plural(d.publications.length, 'publicación', 'publicaciones')}</button>
        <button class="chip" data-go-tab="divulgacion">${plural(d.activities.length, 'actividad', 'actividades')}</button>
        <button class="chip" data-go-tab="galeria">${plural(d.media.length, 'imagen', 'imágenes')}</button>
      </div>
      ${!d.summary && !d.projects.length && !d.activities.length ? '<p class="note">Esta ficha aún no tiene contenido propio de la fundación; los datos provienen del inventario oficial.</p>' : ''}

      <h4>Cerca de aquí</h4>
      <div class="near">${nearby(p).map(({ p: q, km }) => `<div class="item-wrap">${itemHtml(q, `<span class="dist">${nf(km)} km</span>`)}</div>`).join('')}</div>

      <h4>Ficha técnica</h4>
      <dl class="kv">
        <dt>Código SNGM</dt><dd>${esc(d.code)}</dd>
        <dt>Tipo</dt><dd>${d.kind === 'salar' ? 'Salar' : 'Laguna / lago'}</dd>
        <dt>Región</dt><dd>${esc(d.region)}</dd>
        <dt>Ubicación</dt><dd>${d.centroid_lat.toFixed(4)}°, ${d.centroid_lon.toFixed(4)}° · <a href="https://www.google.com/maps/search/?api=1&query=${d.centroid_lat},${d.centroid_lon}" target="_blank" rel="noopener">abrir ↗</a></dd>
      </dl>
      <p class="note">Contorno: ${esc(d.source_dataset)}${d.source_date ? ` (${fmtDate(d.source_date)})` : ''}, Servicio Nacional de Geología y Minería. ${esc(d.source_authors ?? '')}</p>
    </div>`;
}
const emptyMsg = (t) => `<div class="empty">${esc(t)}</div>`;

// ───────────── buscador (paleta de comandos) ─────────────

let omniIdx = -1, omniItems = [];

function initOmni() {
  const input = $('#omni-input'), box = $('#omni-results');
  input.addEventListener('focus', () => runOmni());
  input.addEventListener('input', () => runOmni());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!omniItems.length) return;
      omniIdx = (omniIdx + (e.key === 'ArrowDown' ? 1 : -1) + omniItems.length) % omniItems.length;
      paintOmniSelection();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickOmni(omniItems[Math.max(omniIdx, 0)]);
    }
  });
  box.addEventListener('mousedown', (e) => {          // mousedown: se ejecuta antes del blur
    const el = e.target.closest('[data-oi]'); if (!el) return;
    e.preventDefault(); pickOmni(omniItems[Number(el.dataset.oi)]);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#omni')) closeOmni(); });
}

function closeOmni() { $('#omni-results').hidden = true; $('#omni-input').setAttribute('aria-expanded', 'false'); omniIdx = -1; }

function runOmni() {
  const q = norm($('#omni-input').value.trim());
  let groups;
  if (!q) {
    groups = [['Con contenido', S.features.filter((f) => f.properties.has_content).slice(0, 6).map((f) => ({ type: 'salar', slug: f.properties.slug, label: f.properties.name, sub: `${f.properties.region}`, p: f.properties }))]];
  } else {
    const score = (s) => { const i = norm(s).indexOf(q); return i < 0 ? -1 : i === 0 ? 2 : 1; };
    const sal = S.features.map((f) => ({ f, s: Math.max(score(f.properties.name), score(f.properties.code) - 1, score(f.properties.region) - 1) })).filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.f.properties.name.localeCompare(b.f.properties.name, 'es')).slice(0, 7)
      .map(({ f }) => ({ type: 'salar', slug: f.properties.slug, label: f.properties.name, sub: `${f.properties.region} · ${f.properties.code}`, p: f.properties }));
    const pro = S.projects.filter((p) => score(p.title) >= 0 || score(disc(p.discipline).label) >= 0).slice(0, 4)
      .map((p) => ({ type: 'proyecto', slug: p.salares[0]?.slug, tab: 'ciencia', label: p.title, sub: disc(p.discipline).label }));
    const act = S.activities.filter((a) => score(a.title) >= 0 || score(a.place ?? '') >= 0).slice(0, 4)
      .map((a) => ({ type: 'actividad', slug: a.salares[0]?.slug, tab: 'divulgacion', label: a.title, sub: [ACTIVITY_TYPES[a.type], a.place].filter(Boolean).join(' · ') }));
    groups = [['Salares y lagunas', sal], ['Proyectos de ciencia', pro], ['Divulgación', act]].filter(([, l]) => l.length);
  }
  omniItems = groups.flatMap(([, l]) => l);
  omniIdx = omniItems.length ? 0 : -1;
  const hl = (t) => {
    if (!q) return esc(t);
    const i = norm(t).indexOf(q);
    return i < 0 ? esc(t) : `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}`;
  };
  let k = 0;
  $('#omni-results').innerHTML = omniItems.length
    ? groups.map(([title, list]) => `<h5>${title}</h5>${list.map((it) => `
        <div role="option" data-oi="${k++}" aria-selected="false">
          ${it.p ? `<span class="g" style="--c:${lensColor(it.p, S.lens)};width:30px;height:30px;display:grid;place-items:center">${silhouetteSvg(it.p.id, S.geomById.get(it.p.id), { size: 30, pad: 3 })}</span>` : `<span style="width:30px;text-align:center">${it.type === 'proyecto' ? '🔬' : '📣'}</span>`}
          <span><span>${hl(it.label)}</span><br><span class="sub">${esc(it.sub)}</span></span>
        </div>`).join('')}`).join('')
    : '<div class="none">Sin resultados</div>';
  $('#omni-results').hidden = false;
  $('#omni-input').setAttribute('aria-expanded', 'true');
  paintOmniSelection();
}

function paintOmniSelection() {
  $('#omni-results').querySelectorAll('[data-oi]').forEach((el) => {
    const on = Number(el.dataset.oi) === omniIdx;
    el.setAttribute('aria-selected', on);
    if (on) el.scrollIntoView({ block: 'nearest' });
  });
}

function pickOmni(it) {
  if (!it?.slug) return;
  $('#omni-input').value = ''; $('#omni-input').blur(); closeOmni();
  openSalar(it.slug, it.tab);
}

function surprise() {
  const pool = S.features.filter((f) => f.properties.has_content && f.properties.slug !== S.slug);
  if (!pool.length) return;
  const f = pool[Math.floor(Math.random() * pool.length)].properties;
  toast(`✦ ${f.name}`);
  openSalar(f.slug);
}

// ───────────── lightbox ─────────────

let lb = { list: [], i: 0 };
function openLightbox(list, i) {
  lb = { list, i };
  const box = $('#lightbox');
  const draw = () => {
    const m = lb.list[lb.i];
    box.innerHTML = `
      <button class="x" aria-label="Cerrar">×</button>
      ${lb.list.length > 1 ? '<button class="nav prev" aria-label="Anterior">‹</button><button class="nav next" aria-label="Siguiente">›</button>' : ''}
      <img src="${esc(m.src)}" alt="${esc(m.caption ?? '')}">
      <div class="cap">${esc(m.caption ?? '')}<small>${[m.credit && `Crédito: ${m.credit}`, m.license, m.taken_at && fmtDate(m.taken_at)].filter(Boolean).map(esc).join(' · ')}</small></div>`;
    $('.x', box).onclick = closeLightbox;
    lb.step = (k) => { lb.i = (lb.i + k + lb.list.length) % lb.list.length; draw(); };
    if ($('.prev', box)) { $('.prev', box).onclick = () => lb.step(-1); $('.next', box).onclick = () => lb.step(1); }
  };
  draw();
  box.hidden = false;
  box.onclick = (e) => { if (e.target === box) closeLightbox(); };
}
function closeLightbox() { $('#lightbox').hidden = true; }
window.addEventListener('keydown', (e) => {
  if ($('#lightbox').hidden || !lb.step) return;
  if (e.key === 'ArrowRight') lb.step(1);
  if (e.key === 'ArrowLeft') lb.step(-1);
});

main();
