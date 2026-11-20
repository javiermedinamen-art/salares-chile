// Capa de mapa (MapLibre). La app habla con este módulo a través de una API pequeña.

import { Map as MLMap, NavigationControl, Popup } from '../vendor/maplibre/maplibre-gl.mjs';
import { BASEMAPS, DEM, LENS_KEYS, COLORS, lensColor, lensDim, radiusFor } from './config.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const CHILE_NORTH = [[-71.4, -28.2], [-66.4, -17.0]];
const FONT = ['Open Sans Regular', 'Arial Unicode MS Regular'];

/** Factor de exageración vertical del relieve 3D (× respecto a la altitud real). */
export const TERRAIN_EXAGGERATION = 3;

let map, popup, ready;
let hoverId = null, selectedId = null, lens = 'alt', is3D = false;
let handlers = { select() {}, hover() {} };
let areaById = new Map();
let pulseTimer = 0;

const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

/** Márgenes seguros: el mapa es a pantalla completa, así que evitamos los paneles flotantes. */
function padding() {
  const drawer = document.getElementById('drawer');
  const strip = document.getElementById('transect');
  if (isMobile()) {
    const d = drawer.getBoundingClientRect();
    return { top: 110, bottom: d.height + 30, left: 24, right: 24 };
  }
  const open = !document.body.classList.contains('drawer-closed');
  const s = strip.getBoundingClientRect();
  const top = Math.max(84, document.getElementById('tools').getBoundingClientRect().bottom + 18);
  return { top, bottom: window.innerHeight - s.top + 24, left: open ? drawer.getBoundingClientRect().right + 28 : 40, right: 70 };
}

export function initMap(el, h) {
  handlers = { ...handlers, ...h };

  const sources = { dem: { type: 'raster-dem', tiles: DEM.tiles, tileSize: 256, maxzoom: DEM.maxzoom, encoding: 'terrarium', attribution: DEM.attribution } };
  const layers = [];
  for (const [id, b] of Object.entries(BASEMAPS)) {
    sources[`base-${id}`] = { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution };
    layers.push({ id: `base-${id}`, type: 'raster', source: `base-${id}`, layout: { visibility: id === 'sat' ? 'visible' : 'none' } });
  }

  map = new MLMap({
    container: el,
    style: { version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf', sources, layers },
    bounds: CHILE_NORTH,
    fitBoundsOptions: { padding: padding() },
    maxPitch: 0,
    attributionControl: { compact: true },
  });
  window.__map = map;   // útil para depurar desde la consola
  map.on('error', (e) => console.warn('[map]', e.error?.message ?? e));
  map.addControl(new NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
  popup = new Popup({ closeButton: false, closeOnClick: false, offset: 14, maxWidth: '280px', className: 'tip-popup' });

  ready = new Promise((res) => map.on('load', res));
  return ready;
}

export function setBasemap(id) {
  for (const k of Object.keys(BASEMAPS)) map.setLayoutProperty(`base-${k}`, 'visibility', k === id ? 'visible' : 'none');
}

// ───────────── datos ─────────────

/** Precalcula color/opacidad por lente en cada feature, para cambiar de lente sin recargar datos. */
function enrich(fc) {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const p = { ...f.properties, r: radiusFor(f.properties.area_km2) };
      for (const l of LENS_KEYS) {
        const dim = lensDim(p, l);
        p[`col_${l}`] = lensColor(p, l);
        p[`op_${l}`] = dim ? 0.1 : 0.62;
        p[`lo_${l}`] = dim ? 0.22 : 0.95;
        p[`do_${l}`] = dim ? 0.3 : 0.95;
      }
      return { ...f, properties: p };
    }),
  };
}

/** Puntos con altitud (m s.n.m.) para que no se hundan bajo el relieve 3D. */
const toPoints = (fc) => ({
  type: 'FeatureCollection',
  features: fc.features.map((f) => ({
    type: 'Feature', id: f.id,
    geometry: { type: 'Point', coordinates: [...f.properties.center, f.properties.elevation_m ?? 0] },
    properties: f.properties,
  })),
});

const lensPaint = () => ({
  color: ['get', `col_${lens}`],
  fillOp: ['case', ['boolean', ['feature-state', 'selected'], false], 0.28, ['boolean', ['feature-state', 'hover'], false], 0.8, ['get', `op_${lens}`]],
  lineOp: ['get', `lo_${lens}`],
  dotOp: ['interpolate', ['linear'], ['zoom'], 8, ['get', `do_${lens}`], 11, 0],
});

export async function loadSalares(raw) {
  await ready;
  const fc = enrich(raw);
  areaById = new Map(fc.features.map((f) => [f.id, f.properties.area_km2]));
  const lp = lensPaint();

  map.addSource('salares', { type: 'geojson', data: fc });
  map.addSource('points', { type: 'geojson', data: toPoints(fc) });
  map.addSource('selected', { type: 'geojson', data: EMPTY });

  map.addLayer({ id: 'fill', type: 'fill', source: 'salares', paint: { 'fill-color': lp.color, 'fill-opacity': lp.fillOp } });
  map.addLayer({
    id: 'line', type: 'line', source: 'salares',
    paint: {
      'line-color': ['case', ['get', 'has_content'], COLORS.accent, '#ffffff'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['get', 'has_content'], 1.4, 0.7], 11, ['case', ['get', 'has_content'], 2.6, 1.3]],
      'line-opacity': lp.lineOp,
    },
  });
  map.addLayer({
    id: 'dots', type: 'circle', source: 'points',
    paint: {
      'circle-color': lp.color,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['*', ['get', 'r'], 0.8], 8, ['*', ['get', 'r'], 1.15]],
      'circle-stroke-color': '#0b1216',
      'circle-stroke-width': 1.2,
      'circle-opacity': lp.dotOp,
      'circle-stroke-opacity': lp.dotOp,
    },
  });
  map.addLayer({ id: 'selected-glow', type: 'line', source: 'selected', paint: { 'line-color': '#ffffff', 'line-width': 12, 'line-blur': 10, 'line-opacity': 0.45 } });
  map.addLayer({ id: 'selected-line', type: 'line', source: 'selected', paint: { 'line-color': '#ffffff', 'line-width': 3 } });
  map.addLayer({
    id: 'labels', type: 'symbol', source: 'points', minzoom: 6.2,
    layout: {
      'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 10, 14],
      'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-max-width': 8,
      'symbol-sort-key': ['-', 0, ['get', 'area_km2']],
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(6,12,15,.92)', 'text-halo-width': 1.6, 'text-opacity': ['get', `do_${lens}`] },
  });

  // Pulsos de “con contenido”: capa nativa (no HTML Marker). Los Marker de MapLibre se proyectan
  // a nivel del mar y con relieve 3D parecen flotar sobre el océano.
  const contentFilter = ['==', ['get', 'has_content'], true];
  // pitch-alignment: viewport → el círculo mira a la cámara (como un pin), anclado a la cota del DEM.
  const pulsePaint = { 'circle-pitch-alignment': 'viewport', 'circle-pitch-scale': 'viewport' };
  map.addLayer({
    id: 'pulse-ring', type: 'circle', source: 'points', maxzoom: 9.5,
    filter: contentFilter,
    paint: {
      ...pulsePaint,
      'circle-radius': 10,
      'circle-color': COLORS.accent,
      'circle-opacity': 0,
      'circle-stroke-color': COLORS.accent,
      'circle-stroke-width': 2.5,
      'circle-stroke-opacity': 0.85,
    },
  });
  map.addLayer({
    id: 'pulse-ring-2', type: 'circle', source: 'points', maxzoom: 9.5,
    filter: contentFilter,
    paint: {
      ...pulsePaint,
      'circle-radius': 16,
      'circle-color': COLORS.accent,
      'circle-opacity': 0,
      'circle-stroke-color': COLORS.accent,
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 0.4,
    },
  });
  map.addLayer({
    id: 'pulse-core', type: 'circle', source: 'points', maxzoom: 9.5,
    filter: contentFilter,
    paint: {
      ...pulsePaint,
      'circle-radius': 5.5,
      'circle-color': COLORS.accent,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-opacity': 1,
    },
  });
  startPulse();
  bindPointer();
}

/** Anima los anillos de contenido (capa GL, compatible con terreno 3D). */
function startPulse() {
  if (pulseTimer) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  let t0 = performance.now();
  const tick = (now) => {
    if (!map.getLayer('pulse-ring')) { pulseTimer = 0; return; }
    const t = ((now - t0) / 2600) % 1;
    const t2 = (t + 0.5) % 1;
    map.setPaintProperty('pulse-ring', 'circle-radius', 6 + 14 * t);
    map.setPaintProperty('pulse-ring', 'circle-stroke-opacity', Math.max(0, 0.95 * (1 - t)));
    map.setPaintProperty('pulse-ring-2', 'circle-radius', 6 + 14 * t2);
    map.setPaintProperty('pulse-ring-2', 'circle-stroke-opacity', Math.max(0, 0.75 * (1 - t2)));
    pulseTimer = requestAnimationFrame(tick);
  };
  pulseTimer = requestAnimationFrame(tick);
}

let visibleSet = null;
function syncPulseFilter() {
  if (!map.getLayer('pulse-core')) return;
  const base = ['==', ['get', 'has_content'], true];
  const filter = visibleSet
    ? ['all', base, ['in', ['get', 'id'], ['literal', [...visibleSet]]]]
    : base;
  for (const l of ['pulse-ring', 'pulse-ring-2', 'pulse-core']) map.setFilter(l, filter);
}

function showPopup(p, lngLat) {
  popup.setLngLat(lngLat).setHTML(`<b>${esc(p.name)}</b><span>${esc(p.region)} · ${fmtArea(p.area_km2)} km²${p.elevation_m ? ` · ${Math.round(p.elevation_m).toLocaleString('es-CL')} m` : ''}</span>`).addTo(map);
}

function bindPointer() {
  const interactive = ['pulse-core', 'pulse-ring', 'dots', 'fill'];
  const pick = (e) => {
    const feats = map.queryRenderedFeatures(e.point, { layers: interactive });
    if (!feats.length) return null;
    return feats.reduce((a, b) => (areaById.get(a.id) <= areaById.get(b.id) ? a : b));   // gana el más pequeño si se solapan
  };
  let raf = 0;
  map.on('mousemove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const f = pick(e);
      map.getCanvas().style.cursor = f ? 'pointer' : '';
      const id = f?.id ?? null;
      if (id !== hoverId) { setHover(id); handlers.hover(id); }
      if (f) showPopup(f.properties, e.lngLat); else popup.remove();
    });
  });
  map.on('mouseout', () => { setHover(null); popup.remove(); handlers.hover(null); });
  map.on('click', (e) => { const f = pick(e); if (f) handlers.select(f.properties.slug); });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtArea = (a) => a.toLocaleString('es-CL', { maximumFractionDigits: a < 10 ? 2 : a < 100 ? 1 : 0 });

// ───────────── estado visual ─────────────

function fs(id, state) {
  if (id == null || !map.getSource('salares')) return;
  map.setFeatureState({ source: 'salares', id }, state);
  map.setFeatureState({ source: 'points', id }, state);
}

export function setHover(id) {
  if (hoverId === id) return;
  fs(hoverId, { hover: false });
  hoverId = id;
  fs(id, { hover: true });
}

export function setSelected(id, geometry) {
  if (!map.getSource('selected')) return;
  fs(selectedId, { selected: false });
  selectedId = id;
  fs(id, { selected: true });
  map.getSource('selected').setData(geometry ? { type: 'Feature', geometry, properties: {} } : EMPTY);
}

export function setLens(next) {
  lens = next;
  if (!map.getLayer('fill')) return;
  const lp = lensPaint();
  map.setPaintProperty('fill', 'fill-color', lp.color);
  map.setPaintProperty('fill', 'fill-opacity', lp.fillOp);
  map.setPaintProperty('line', 'line-opacity', lp.lineOp);
  map.setPaintProperty('dots', 'circle-color', lp.color);
  map.setPaintProperty('dots', 'circle-opacity', lp.dotOp);
  map.setPaintProperty('dots', 'circle-stroke-opacity', lp.dotOp);
  map.setPaintProperty('labels', 'text-opacity', ['get', `do_${lens}`]);
}

/** Muestra solo los salares cuyo id esté en `ids` (null = todos). */
export function setVisibleIds(ids) {
  visibleSet = ids ? new Set(ids) : null;
  if (!map.getLayer('fill')) return;
  const filter = ids ? ['in', ['get', 'id'], ['literal', [...ids]]] : null;
  for (const l of ['fill', 'line', 'dots', 'labels']) map.setFilter(l, filter);
  syncPulseFilter();
}

// ───────────── cámara ─────────────

export function flyToBBox(bbox, { maxZoom = 12, duration = 900 } = {}) {
  if (!map) return;
  const cam = map.cameraForBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: padding(), maxZoom, bearing: map.getBearing() });
  if (!cam) return;
  const target = { ...cam, pitch: is3D ? 58 : 0 };
  if (!duration) map.jumpTo(target);
  else map.flyTo({ ...target, duration, essential: true, curve: 1.3 });
}

export function fitAll(bboxes, opts) {
  if (!bboxes.length) return;
  const b = bboxes.reduce((a, x) => [Math.min(a[0], x[0]), Math.min(a[1], x[1]), Math.max(a[2], x[2]), Math.max(a[3], x[3])], [180, 90, -180, -90]);
  flyToBBox(b, { maxZoom: 9, ...opts });
}

/** Activa/desactiva el relieve 3D. Devuelve el nuevo estado. */
export function toggle3D(force) {
  is3D = force ?? !is3D;
  if (is3D) {
    map.setMaxPitch(80);
    map.setTerrain({ source: 'dem', exaggeration: TERRAIN_EXAGGERATION });
    // Los puntos genéricos se ocultan; los pulsos de contenido siguen (capa GL anclada al terreno).
    if (map.getLayer('dots')) map.setLayoutProperty('dots', 'visibility', 'none');
    map.easeTo({ pitch: 55, duration: 1300 });
  } else {
    if (map.getLayer('dots')) map.setLayoutProperty('dots', 'visibility', 'visible');
    map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
    map.once('moveend', () => { if (!is3D) { map.setTerrain(null); map.setMaxPitch(0); } });
  }
  return is3D;
}

export const get3D = () => is3D;
