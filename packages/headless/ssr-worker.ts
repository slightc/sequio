/**
 * Server-side render worker (Route A: headless Chrome), the **RPC client**.
 *
 * It spawns Vite, drives a headless Chrome (Puppeteer + Chrome-for-Testing, which
 * ships WebGL + WebCodecs) to the SSR page, and calls the typed
 * {@link RenderService} the page {@link expose}s — over a Puppeteer-bridged
 * {@link Endpoint} (the CDP boundary has no `MessagePort`, so we adapt
 * `page.exposeFunction` + `page.evaluate`). The encoded video comes back as base64
 * and is written to `--out`. Same render core as the live preview (contract #3).
 *
 * Run with tsx (like Route B's worker), which resolves `@sequio/*` from source via
 * the tsconfig `paths`, so no prior build is needed:
 *   tsx ssr-worker.ts [--timeline <spec.json>] [--bundle <bundle.json>] [--out <file>] [--verify]
 *
 * Requires a one-time browser fetch: `pnpm exec puppeteer browsers install chrome`.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Page } from 'puppeteer';
import { type Endpoint, type RenderResult, type RenderService, wrap } from '@sequio/server';

interface Args {
  timeline: string | null;
  bundle: string | null;
  out: string | null;
  verify: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { timeline: null, bundle: null, out: null, verify: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--timeline') args.timeline = argv[++i] ?? null;
    else if (a === '--bundle') args.bundle = argv[++i] ?? null;
    else if (a === '--out') args.out = argv[++i] ?? null;
    else if (a === '--verify') args.verify = true;
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);
const PORT = 5198;

// Resolve Vite's CLI whether it's hoisted here or at the workspace root. Resolve
// via the package.json (always exported) then join `bin/vite.js`, so newer Vite
// versions that don't list the bin in their `exports` map still work.
const require = createRequire(import.meta.url);
const VITE_PKG = require.resolve('vite/package.json', { paths: [ROOT, process.cwd()] });
const VITE_BIN = path.join(path.dirname(VITE_PKG), 'bin/vite.js');

function waitForServer(url: string, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = (): void => {
      const req = http.get(url, (res) => {
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
function detectContainer(buf: Buffer): 'mp4' | 'webm' | null {
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  return null;
}

/**
 * Adapt the Puppeteer CDP boundary to an {@link Endpoint}: the page → Node
 * direction rides an exposed function (`__rpcFromPage`); Node → page rides
 * `page.evaluate` into `window.__rpcToPage` (installed by the page's endpoint).
 */
async function puppeteerNodeEndpoint(page: Page): Promise<Endpoint> {
  const listeners = new Set<(event: { data: unknown }) => void>();
  await page.exposeFunction('__rpcFromPage', (message: unknown) => {
    listeners.forEach((l) => l({ data: message }));
  });
  return {
    postMessage: (message) => {
      void page.evaluate((m) => {
        (window as unknown as { __rpcToPage: (x: unknown) => void }).__rpcToPage(m);
      }, message);
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: tsx ssr-worker.ts [--timeline <spec.json>] [--bundle <bundle.json>] [--out <file>] [--verify]');
    return;
  }
  if (args.timeline && args.bundle) throw new Error('pass only one of --timeline / --bundle');

  const spec = args.timeline ? JSON.parse(fs.readFileSync(path.resolve(args.timeline), 'utf8')) : null;
  const bundle = args.bundle ? JSON.parse(fs.readFileSync(path.resolve(args.bundle), 'utf8')) : null;

  const vite = spawn(process.execPath, [VITE_BIN, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
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
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // Expose the RPC bridge before navigation so the page can post back on load.
    const endpoint = await puppeteerNodeEndpoint(page);
    await page.goto(`http://localhost:${PORT}/ssr-render.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__RPC_READY__ === true', { timeout: 30000 });

    const remote = wrap<RenderService>(endpoint);
    const onProgress = (p: number): void => {
      process.stdout.write(`\r  ${Math.round(p * 100)}%   `);
    };

    let result: RenderResult;
    if (bundle) {
      console.log(`Rendering code bundle ${path.resolve(args.bundle!)} …`);
      result = await remote.renderBundle(bundle, onProgress);
    } else {
      const timeline = spec ?? (await remote.sample());
      console.log(`Rendering ${args.timeline ? path.resolve(args.timeline) : 'built-in demo'} …`);
      result = await remote.render(timeline, onProgress);
    }
    process.stdout.write('\n');

    if (!result || !result.ok) {
      if (errors.length) console.log('page errors:', errors.filter((e) => !/favicon/.test(e)));
      throw new Error(`render failed: ${result && result.error ? result.error : 'unknown'}`);
    }

    const outPath = path.resolve(args.out ?? `out.${result.container}`);
    const buf = Buffer.from(result.base64 ?? '', 'base64');
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
    console.error('\n❌', err instanceof Error ? err.message : err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    vite.kill('SIGTERM');
  }
  process.exit(exitCode);
}

void main();
