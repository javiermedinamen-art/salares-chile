// Siluetas: convierte el polígono real de cada salar en un path SVG (su "huella digital").

const cache = new Map();

const polys = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

/** Devuelve { d, w, h }: path en un cuadro de `size` px, conservando proporciones geográficas. */
export function silhouette(id, geometry, size = 40, pad = 3) {
  const key = `${id}:${size}:${pad}`;
  if (cache.has(key)) return cache.get(key);

  let w = 180, s = 90, e = -180, n = -90;
  for (const p of polys(geometry)) for (const [x, y] of p[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  const k = Math.cos(((s + n) / 2) * Math.PI / 180);      // corrección de longitud por latitud
  const gw = (e - w) * k || 1e-6, gh = (n - s) || 1e-6;
  const scale = (size - pad * 2) / Math.max(gw, gh);
  const ox = (size - gw * scale) / 2, oy = (size - gh * scale) / 2;

  const d = polys(geometry).map((poly) => poly.map((ring) =>
    `M${ring.map(([x, y], i) => `${i ? 'L' : ''}${(ox + (x - w) * k * scale).toFixed(1)} ${(oy + (n - y) * scale).toFixed(1)}`).join('')}Z`).join('')).join('');

  const out = { d, size };
  cache.set(key, out);
  return out;
}

export function silhouetteSvg(id, geometry, { size = 40, pad = 3, cls = 'sil' } = {}) {
  const { d } = silhouette(id, geometry, size, pad);
  return `<svg class="${cls}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><path d="${d}" fill-rule="evenodd"/></svg>`;
}
