// Catálogos de etiquetas/colores y "lentes" (qué variable colorea el mapa, la lista y el perfil).

export const DISCIPLINES = {
  microbiologia: { label: 'Microbiología', color: '#35d0a8' },
  hidrologia: { label: 'Hidrología', color: '#4aa3ff' },
  geologia: { label: 'Geología', color: '#c9915a' },
  biodiversidad: { label: 'Biodiversidad', color: '#9be15d' },
  geoquimica: { label: 'Geoquímica', color: '#c084fc' },
  teledeteccion: { label: 'Teledetección', color: '#ff8a5c' },
  sociedad: { label: 'Sociedad y territorio', color: '#f5c542' },
};

export const ACTIVITY_TYPES = {
  taller: 'Taller',
  charla: 'Charla',
  terreno: 'Salida a terreno',
  exposicion: 'Exposición',
  escuela: 'Escuela',
  medios: 'Medios',
  comunidad: 'Comunidad',
};

export const STATUS = { activo: 'Activo', finalizado: 'Finalizado', planificado: 'Planificado' };
export const MEDIA_KIND = { foto: 'Foto', video: 'Video', audio: 'Audio', dron: 'Dron' };

export const disc = (k) => DISCIPLINES[k] ?? { label: k, color: '#99a' };

// Mapas base (para producción conviene un proveedor con contrato: MapTiler, Mapbox, o teselas propias).
export const BASEMAPS = {
  sat: {
    label: 'Satélite',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics', maxzoom: 17,
  },
  dark: {
    label: 'Oscuro',
    tiles: ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`),
    attribution: '© OpenStreetMap, © CARTO', maxzoom: 19,
  },
  topo: {
    label: 'Relieve',
    tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
    attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)', maxzoom: 17,
  },
};

// Relieve para el modo 3D (teselas Terrarium abiertas, AWS Open Data).
export const DEM = {
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  attribution: 'Relieve: Mapzen, SRTM, NASA',
  maxzoom: 14,
};

// ───────────── lentes ─────────────

export const LENSES = {
  alt: { label: 'Altitud', hint: 'De la costa al altiplano' },
  tipo: { label: 'Tipo', hint: 'Salares y lagunas' },
  ciencia: { label: 'Ciencia', hint: 'Dónde se investiga' },
  div: { label: 'Divulgación', hint: 'Dónde se divulga' },
};

export const COLORS = { salar: '#f5b942', laguna: '#3fd6d0', accent: '#ff6b4a', none: '#cfd8d6' };

const ELEV_STOPS = [[700, '#ffe08a'], [2300, '#ff9f43'], [3300, '#ee5a6f'], [4000, '#a855f7'], [4600, '#5b6cff']];
export const ELEV_MIN = ELEV_STOPS[0][0];
export const ELEV_MAX = ELEV_STOPS.at(-1)[0];
export const ELEV_GRADIENT = `linear-gradient(90deg, ${ELEV_STOPS.map(([m, c]) => `${c} ${((m - ELEV_MIN) / (ELEV_MAX - ELEV_MIN)) * 100}%`).join(', ')})`;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function elevColor(m) {
  if (m == null) return COLORS.none;
  if (m <= ELEV_STOPS[0][0]) return ELEV_STOPS[0][1];
  for (let i = 1; i < ELEV_STOPS.length; i++) {
    const [m1, c1] = ELEV_STOPS[i];
    if (m <= m1) {
      const [m0, c0] = ELEV_STOPS[i - 1];
      const t = (m - m0) / (m1 - m0);
      const a = hex(c0), b = hex(c1);
      return `#${a.map((v, k) => Math.round(v + (b[k] - v) * t).toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return ELEV_STOPS.at(-1)[1];
}

/** Color de un salar (propiedades GeoJSON) bajo una lente. */
export function lensColor(p, lens) {
  switch (lens) {
    case 'tipo': return p.kind === 'laguna' ? COLORS.laguna : COLORS.salar;
    case 'ciencia': return p.disciplines.length ? disc(p.disciplines[0]).color : COLORS.none;
    case 'div': return p.activities ? COLORS.accent : COLORS.none;
    default: return elevColor(p.elevation_m);
  }
}

/** ¿Se atenúa este salar en la lente actual? (para destacar solo los que tienen contenido) */
export function lensDim(p, lens) {
  if (lens === 'ciencia') return !p.projects;
  if (lens === 'div') return !p.activities;
  return false;
}

export const LENS_KEYS = Object.keys(LENSES);

/** Radio base (px) de un círculo según superficie; compartido por mapa y perfil. */
export const radiusFor = (areaKm2) => 3.5 + 2.6 * Math.log10(areaKm2 + 1);
