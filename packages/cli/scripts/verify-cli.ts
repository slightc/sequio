/**
 * End-to-end verification for the `sequio` CLI (run: `pnpm verify:cli`).
 *
 * Exercises all five commands against the bundled `example/` composition:
 *  1. `check`  → statically validates the composition offline (no GPU) — asserts
 *     the example passes and a deliberately-broken one fails with a non-zero exit;
 *  2. `render` → drives the headless render and asserts a valid MP4/WebM came out;
 *  3. `frame`  → exports a single frame at a time and asserts a valid PNG came out;
 *  4. `audio`  → exports the audio-only mix and asserts a valid audio file came out;
 *  5. `preview` → boots the dev server, points Chrome-for-Testing at the page and
 *     asserts the composition ran in-browser (`window.__PREVIEW_TEST__.ok`).
 *
 * Needs:
 *  - a WebGPU host for `render` (Route B): a GPU, or Mesa lavapipe
 *    (`apt install mesa-vulkan-drivers`; export VK_ICD_FILENAMES=…/lvp_icd.json);
 *  - a WebCodecs-capable browser for `preview` (Puppeteer's Chrome-for-Testing):
 *    `pnpm exec puppeteer browsers install chrome`.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { runCheck } from '../src/check';
import { runRender } from '../src/render';
import { runFrame } from '../src/frame';
import { runAudio } from '../src/audio';
import { startPreviewServer } from '../src/preview';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = resolve(HERE, '../example/index.ts');

/** `check` is GPU-free — assert the example passes and a broken one fails. */
async function verifyCheck(): Promise<void> {
  const ok = await runCheck(EXAMPLE);
  if (ok !== 0) throw new Error(`check on the example exited ${ok} (expected 0)`);

  const dir = mkdtempSync(join(tmpdir(), 'sequio-verify-'));
  const bad = join(dir, 'bad.ts');
  try {
    // end ≤ start (C1) → must be a non-zero exit.
    writeFileSync(
      bad,
      `import { Compositor, VisualTrack, ShapeClip } from '@sequio/engine';
       import { defineComposition } from '@sequio/runtime';
       export default defineComposition(async (env) => {
         const compositor = new Compositor({ width: 320, height: 240, ...env.compositorOptions });
         await compositor.init();
         const track = new VisualTrack();
         const clip = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
         clip.start = 2; clip.end = 1; // illegal
         track.add(clip); compositor.addTrack(track);
         return { compositor, duration: 2 };
       });`,
    );
    const failed = await runCheck(bad, { json: true });
    if (failed === 0) throw new Error('check on a broken composition exited 0 (expected non-zero)');
    console.log('✅ check: example clean, broken composition flagged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function verifyRender(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sequio-verify-'));
  const out = join(dir, 'out.mp4');
  try {
    const code = await runRender(EXAMPLE, { out, verify: true });
    if (code !== 0) throw new Error(`render exited ${code}`);
    const size = statSync(out).size;
    if (size < 500) throw new Error(`render output too small (${size} bytes)`);
    console.log(`✅ render: wrote ${size} bytes`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function verifyFrame(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sequio-verify-'));
  const out = join(dir, 'frame.png');
  try {
    const code = await runFrame(EXAMPLE, { out, time: 2 });
    if (code !== 0) throw new Error(`frame exited ${code}`);
    const buf = readFileSync(out);
    if (buf.length < 100 || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
      throw new Error(`frame output is not a PNG (${buf.length} bytes)`);
    }
    console.log(`✅ frame: wrote a valid PNG (${buf.length} bytes)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function verifyAudio(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sequio-verify-'));
  const out = join(dir, 'out.m4a');
  try {
    const code = await runAudio(EXAMPLE, { out });
    if (code !== 0) throw new Error(`audio exited ${code}`);
    const buf = readFileSync(out);
    // An audio-only MP4 (m4a) still carries an `ftyp` box at bytes 4..8.
    if (buf.length < 200 || buf.subarray(4, 8).toString('latin1') !== 'ftyp') {
      throw new Error(`audio output is not a valid m4a (${buf.length} bytes)`);
    }
    console.log(`✅ audio: wrote a valid m4a (${buf.length} bytes)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function verifyPreview(): Promise<void> {
  const { default: puppeteer } = await import('puppeteer');
  const server = await startPreviewServer(EXAMPLE, { port: 6184 });
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__PREVIEW_TEST__ !== undefined', { timeout: 30000 });
    const result = (await page.evaluate('window.__PREVIEW_TEST__')) as {
      ok: boolean;
      tracks?: number;
      clips?: number;
      duration?: number;
      error?: string;
    };
    if (!result.ok) throw new Error(`preview did not run: ${result.error ?? 'unknown'}`);
    console.log(`✅ preview: ${result.tracks} track(s), ${result.clips} clip(s), ${result.duration}s`);
  } finally {
    await browser.close();
    await server.close();
  }
}

async function main(): Promise<void> {
  console.log('▸ verify:cli — check');
  await verifyCheck();
  console.log('▸ verify:cli — render');
  await verifyRender();
  console.log('▸ verify:cli — frame');
  await verifyFrame();
  console.log('▸ verify:cli — audio');
  await verifyAudio();
  console.log('▸ verify:cli — preview');
  await verifyPreview();
  console.log('\n✅ verify:cli passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ verify:cli failed:', err?.message || err);
  process.exit(1);
});
