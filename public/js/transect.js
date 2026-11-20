// Perfil norte→sur: cada salar es un círculo. X = latitud, Y = altitud, tamaño = superficie.
// Funciona como gráfico y como navegador, sincronizado con el mapa y la lista.

import { lensColor, lensDim, radiusFor, COLORS } from './config.js';

const NS = 'http://www.w3.org/2000/svg';
const LAT_N = -17.3, LAT_S = -27.8;
const ELEV_MIN = 300, ELEV_MAX = 4900;
const M = { l: 46, r: 14, t: 22, b: 22 };
// límites regionales aproximados (solo como orientación visual)
const REGIONS = [['Arica y Parinacota', -17.3, -19.2], ['Tarapacá', -19.2, -21.4], ['Antofagasta', -21.4, -26.0], ['Atacama', -26.0, -27.8]];

const fmt = (n, d = 0) => n.toLocaleString('es-CL', { maximumFractionDigits: d });
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

export function createTransect(host, { onSelect, onHover }) {
  host.innerHTML = '<svg role="img" aria-label="Perfil norte a sur de altitud de los salares"></svg><div class="tip" hidden></div>';
  const svg = host.querySelector('svg');
  const tip = host.querySelector('.tip');
  let st = { features: [], visible: null, lens: 'alt', selected: null, hover: null };
  let W = 0, H = 0;

  const x = (lat) => M.l + ((LAT_N - lat) / (LAT_N - LAT_S)) * (W - M.l - M.r);
  const y = (m) => M.t + (1 - (Math.min(m, ELEV_MAX) - ELEV_MIN) / (ELEV_MAX - ELEV_MIN)) * (H - M.t - M.b);

  function draw() {
    if (!W || !H) return;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.replaceChildren();

    // regiones
    REGIONS.forEach(([name, a, b], i) => {
      const x0 = x(a), x1 = x(b);
      if (i % 2 === 0) el('rect', { x: x0, y: M.t - 10, width: x1 - x0, height: H - M.t - M.b + 10, class: 'band' }, svg);
      const t = el('text', { x: (x0 + x1) / 2, y: 11, class: 'reg', 'text-anchor': 'middle' }, svg);
      t.textContent = x1 - x0 > 70 ? name : '';
    });
    // rejilla de altitud
    for (const m of [1000, 2000, 3000, 4000]) {
      el('line', { x1: M.l, x2: W - M.r, y1: y(m), y2: y(m), class: 'grid' }, svg);
      const t = el('text', { x: M.l - 6, y: y(m) + 3.5, class: 'ax', 'text-anchor': 'end' }, svg);
      t.textContent = `${fmt(m)} m`;
    }
    // latitudes
    for (let lat = -18; lat >= -27; lat -= 2) {
      const t = el('text', { x: x(lat), y: H - 6, class: 'ax', 'text-anchor': 'middle' }, svg);
      t.textContent = `${-lat}°S`;
    }

    // círculos: los grandes al fondo, los chicos encima
    const feats = [...st.features].sort((a, b) => b.properties.area_km2 - a.properties.area_km2);
    for (const { properties: p } of feats) {
      if (p.elevation_m == null) continue;
      const visible = !st.visible || st.visible.has(p.id);
      const dim = lensDim(p, st.lens);
      const g = el('circle', {
        cx: x(p.center[1]), cy: y(p.elevation_m), r: radiusFor(p.area_km2) * 0.78,
        fill: lensColor(p, st.lens), 'data-id': p.id,
        class: `pt${p.has_content ? ' has' : ''}${!visible ? ' off' : ''}${dim ? ' dim' : ''}${st.selected === p.id ? ' sel' : ''}${st.hover === p.id ? ' hov' : ''}`,
      }, svg);
      g.setAttribute('tabindex', visible ? '0' : '-1');
      g.setAttribute('aria-label', `${p.name}, ${fmt(p.elevation_m)} metros`);
    }
    // etiqueta del seleccionado
    const sel = st.features.find((f) => f.properties.id === st.selected)?.properties;
    if (sel?.elevation_m != null) {
      const cx = x(sel.center[1]), cy = y(sel.elevation_m);
      el('line', { x1: cx, x2: cx, y1: cy, y2: H - M.b, class: 'drop' }, svg);
      const left = cx > W * 0.7;
      const t = el('text', { x: cx + (left ? -12 : 12), y: cy - 10, class: 'sel-label', 'text-anchor': left ? 'end' : 'start' }, svg);
      t.textContent = sel.name;
    }
  }

  const ro = new ResizeObserver(() => {
    const r = host.getBoundingClientRect();
    W = Math.round(r.width); H = Math.round(r.height);
    draw();
  });
  ro.observe(host);

  const idOf = (e) => { const id = e.target.closest?.('circle.pt')?.dataset.id; return id ? Number(id) : null; };
  const find = (id) => st.features.find((f) => f.properties.id === id)?.properties;

  svg.addEventListener('pointermove', (e) => {
    const id = idOf(e);
    if (id !== st.hover) { setHover(id); onHover?.(id); }
    if (id == null) return;
    const p = find(id);
    const r = host.getBoundingClientRect();
    tip.hidden = false;
    tip.replaceChildren();
    const b = document.createElement('b'); b.textContent = p.name;
    const s = document.createElement('span'); s.textContent = `${fmt(p.elevation_m)} m · ${fmt(p.area_km2, p.area_km2 < 10 ? 1 : 0)} km² · ${p.region}`;
    tip.append(b, s);
    const tx = Math.min(Math.max(e.clientX - r.left, 90), r.width - 90);
    tip.style.left = `${tx}px`;
    tip.style.top = `${e.clientY - r.top - 14}px`;
  });
  svg.addEventListener('pointerleave', () => { setHover(null); onHover?.(null); });
  svg.addEventListener('click', (e) => {
    const id = idOf(e);
    if (id == null || (st.visible && !st.visible.has(id))) return;
    onSelect?.(find(id)?.slug);
  });
  svg.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const id = idOf(e); if (id != null) onSelect?.(find(id)?.slug); } });

  function setHover(id) {
    st.hover = id;
    svg.querySelectorAll('circle.hov').forEach((c) => c.classList.remove('hov'));
    if (id == null) { tip.hidden = true; return; }
    svg.querySelector(`circle[data-id="${id}"]`)?.classList.add('hov');
  }

  return {
    set(patch) { Object.assign(st, patch); draw(); },
    setHover,
    resize() { ro.takeRecords(); const r = host.getBoundingClientRect(); W = Math.round(r.width); H = Math.round(r.height); draw(); },
    legendColor: COLORS.accent,
  };
}
