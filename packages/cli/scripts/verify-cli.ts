/**
 * End-to-end verification for the `sequio` CLI (run: `pnpm verify:cli`).
 *
 * Exercises all four commands against the bundled `example/` composition:
 *  1. `render` → drives the headless render and asserts a valid MP4/WebM came out;
 *  2. `frame`  → exports a single frame at a time and asserts a valid PNG came out;
 *  3. `audio`  → exports the audio-only mix and asserts a valid audio file came out;
 *  4. `preview` → boots the dev server, points Chrome-for-Testing at the page and
 *     asserts the composition ran in-browser (`window.__PREVIEW_TEST__.ok`).
 *
 * Needs:
 *  - a WebGPU host for `render` (Route B): a GPU, or Mesa lavapipe
 *    (`apt install mesa-vulkan-drivers`; export VK_ICD_FILENAMES=…/lvp_icd.json);
 *  - a WebCodecs-capable browser for `preview` (Puppeteer's Chrome-for-Testing):
 *    `pnpm exec puppeteer browsers install chrome`.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { runRender } from '../src/render';
import { runFrame } from '../src/frame';
import { runAudio } from '../src/audio';
import { startPreviewServer } from '../src/preview';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = resolve(HERE, '../example/index.ts');

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
