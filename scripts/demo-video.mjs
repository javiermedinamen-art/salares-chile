// Recorrido corto de la web → MP4 sin audio (para propuesta).
//   npm run demo:video
// Salida: demos/salares-chile-propuesta.mp4

import { chromium } from 'playwright';
import { mkdirSync, existsSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'demos');
const TMP = join(OUT_DIR, '_record');
const FINAL = join(OUT_DIR, 'salares-chile-propuesta.mp4');
const URL = process.env.DEMO_URL || 'http://localhost:3000/';
const W = 1440, H = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitMap(page) {
  await page.waitForFunction(() => window.__map && window.__map.getLayer && window.__map.getLayer('fill'), null, { timeout: 30000 });
  await sleep(1800); // teselas
}

async function run() {
  if (!existsSync(join(ROOT, 'public', 'data', 'salares.geojson'))) {
    console.error('Faltan datos. Ejecuta: npm run db:build');
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: TMP, size: { width: W, height: H } },
  });
  const page = await context.newPage();

  console.log('Abriendo', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitMap(page);
  await page.evaluate(() => {
    document.body.classList.remove('drawer-closed', 'strip-collapsed');
    document.body.classList.add('strip-open');
  });
  await sleep(600);

  // 1) Vista general + lentes
  await page.locator('#lenses [data-lens="tipo"]').click();
  await sleep(900);
  await page.locator('#lenses [data-lens="ciencia"]').click();
  await sleep(1000);
  await page.locator('#lenses [data-lens="alt"]').click();
  await sleep(700);

  // 2) Pestaña Ciencia
  await page.locator('.tabs [data-view="ciencia"]').click();
  await sleep(1400);

  // 3) Divulgación
  await page.locator('.tabs [data-view="divulgacion"]').click();
  await sleep(1200);

  // 4) Volver a salares + filtro con contenido
  await page.locator('.tabs [data-view="salares"]').click();
  await sleep(500);
  await page.locator('#onlyc').click();
  await sleep(900);

  // 5) Buscador → Salar de Huasco
  await page.locator('#omni-input').click();
  await page.locator('#omni-input').fill('huasco');
  await sleep(600);
  await page.locator('#omni-results [data-oi="0"]').click();
  await sleep(2200);

  // 6) Recorrer pestañas de la ficha
  for (const tab of ['ciencia', 'divulgacion', 'galeria', 'resumen']) {
    await page.locator(`.tabs [data-dt="${tab}"]`).click();
    await sleep(750);
  }

  // 7) 3D + un poco de órbita
  await page.locator('#btn3d').click();
  await sleep(2200);
  const map = page.locator('#map');
  const box = await map.boundingBox();
  if (box) {
    const cx = box.x + box.width * 0.62;
    const cy = box.y + box.height * 0.42;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(cx + 140, cy + 30, { steps: 18 });
    await page.mouse.up({ button: 'right' });
    await sleep(900);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(cx + 40, cy - 20, { steps: 12 });
    await page.mouse.up({ button: 'right' });
  }
  await sleep(1000);

  // 8) Sorpréndeme + cierre
  await page.locator('#surprise').click();
  await sleep(2200);
  await page.locator('#back').click();
  await sleep(1000);
  await page.locator('#btn3d').click(); // volver a 2D
  await sleep(1200);

  const videoPath = await page.video().path();
  await context.close();
  await browser.close();

  // Playwright guarda webm; lo convertimos a mp4 silencioso y lo aceleramos un poco si hace falta
  const webm = videoPath;
  console.log('Grabación cruda:', webm);

  // Recortar/acelerar a ~18 s: primero medir duración
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', webm], { encoding: 'utf8' });
  const dur = Number(probe.stdout.trim()) || 25;
  const target = 18;
  const speed = Math.max(1, dur / target);
  console.log(`Duración ${dur.toFixed(1)}s → objetivo ${target}s (×${speed.toFixed(2)})`);

  const setpts = `setpts=PTS/${speed.toFixed(3)}`;
  const ff = spawnSync('ffmpeg', [
    '-y', '-i', webm,
    '-an',
    '-vf', `${setpts},fps=30,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-movflags', '+faststart',
    FINAL,
  ], { encoding: 'utf8' });

  if (ff.status !== 0) {
    console.error(ff.stderr);
    // fallback: copiar webm
    const fallback = join(OUT_DIR, 'salares-chile-propuesta.webm');
    renameSync(webm, fallback);
    console.log('No se pudo convertir a mp4. WebM en', fallback);
    process.exit(1);
  }

  rmSync(TMP, { recursive: true, force: true });
  console.log('Listo →', FINAL);
}

run().catch((e) => { console.error(e); process.exit(1); });
