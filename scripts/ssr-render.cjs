#!/usr/bin/env node
/**
 * Server-side render worker (Route A: headless Chrome).
 *
 * Renders a timeline JSON to a video file on disk, entirely on a server: it
 * spawns Vite, drives a headless Chrome (Puppeteer + Chrome-for-Testing, which
 * ships WebGL + WebCodecs) to the SSR page, hands it the spec, and writes the
 * bytes it returns to `--out`. This is the productized form of the `verify-*`
 * harness — the same render core the browser preview uses (contract #3).
 *
 * Usage:
 *   node scripts/ssr-render.cjs [--timeline <spec.json>] [--out <file>] [--verify]
 *
 *   --timeline <file>  timeline spec JSON; omit to render the built-in demo
 *   --out <file>       output path (default: out.mp4 / out.webm by container)
 *   --verify           assert a valid container came out (exit non-zero if not)
 *
 * Requires a one-time browser fetch: `pnpm exec puppeteer browsers install chrome`.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { timeline: null, out: null, verify: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--timeline') args.timeline = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--verify') args.verify = true;
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

const ROOT = path.resolve(__dirname, '..');
const PORT = 5198;

function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = require('node:http').get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('vite did not start'));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

/** Sniff the container from its magic bytes so --verify catches truncated/HTML output. */
function detectContainer(buf) {
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: ssr-render.cjs [--timeline <spec.json>] [--out <file>] [--verify]');
    return;
  }

  const spec = args.timeline ? JSON.parse(fs.readFileSync(path.resolve(args.timeline), 'utf8')) : null;

  const puppeteer = require('puppeteer');
  const vite = spawn(
    path.join(ROOT, 'node_modules/.bin/vite'),
    ['--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore' },
  );

  let browser;
  let exitCode = 0;
  try {
    await waitForServer(`http://localhost:${PORT}/`);
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--ignore-gpu-blocklist',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto(`http://localhost:${PORT}/example/ssr-render.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__SSR__ !== undefined', { timeout: 30000 });

    // Demo mode: pull the built-in sample from the page so the whole Node→browser
    // round trip is exercised even without a spec file.
    const timeline = spec ?? (await page.evaluate('window.__SSR__.sample()'));

    console.log(`Rendering ${args.timeline ? path.resolve(args.timeline) : 'built-in demo'} …`);
    const result = await page.evaluate((s) => window.__SSR__.render(s), timeline);

    if (!result || !result.ok) {
      if (errors.length) console.log('page errors:', errors.filter((e) => !/favicon/.test(e)));
      throw new Error(`render failed: ${result && result.error ? result.error : 'unknown'}`);
    }

    const outPath = path.resolve(args.out ?? `out.${result.container}`);
    const buf = Buffer.from(result.base64, 'base64');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    console.log(`✅ wrote ${outPath} (${result.container}/${result.videoCodec}, ${buf.length} bytes)`);

    if (args.verify) {
      const kind = detectContainer(buf);
      if (!kind || buf.length < 500) {
        throw new Error(`--verify failed: output is not a valid container (detected=${kind}, size=${buf.length})`);
      }
      console.log(`✅ verified: valid ${kind} container.`);
    }
  } catch (err) {
    console.error('\n❌', err.message || err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    vite.kill('SIGTERM');
  }
  process.exit(exitCode);
}

main();
