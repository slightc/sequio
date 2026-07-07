/**
 * End-to-end verification for the `sequio` CLI (run: `pnpm verify:cli`).
 *
 * Exercises both commands against the bundled `example/` composition:
 *  1. `render` → drives the headless render and asserts a valid MP4/WebM came out;
 *  2. `preview` → boots the dev server, points Chrome-for-Testing at the page and
 *     asserts the composition ran in-browser (`window.__PREVIEW_TEST__.ok`).
 *
 * Needs a WebCodecs-capable browser (Puppeteer's Chrome-for-Testing):
 *   pnpm exec puppeteer browsers install chrome
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { runRender } from '../src/render';
import { startPreviewServer } from '../src/preview';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = resolve(HERE, '../example/index.ts');

async function verifyRender(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sequio-verify-'));
  const out = join(dir, 'out.mp4');
  try {
    const code = await runRender(EXAMPLE, { out, verify: true, port: 6183 });
    if (code !== 0) throw new Error(`render exited ${code}`);
    const size = statSync(out).size;
    if (size < 500) throw new Error(`render output too small (${size} bytes)`);
    console.log(`✅ render: wrote ${size} bytes`);
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
  console.log('▸ verify:cli — preview');
  await verifyPreview();
  console.log('\n✅ verify:cli passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ verify:cli failed:', err?.message || err);
  process.exit(1);
});
