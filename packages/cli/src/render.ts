/**
 * `sequio render <file>` — encode a composition to a video file.
 *
 * The full-fidelity render path already exists as the server package's **Route A**
 * page (`route-a/ssr-render.html` → `window.__SSR__.renderBundle`): a headless
 * browser (which has WebGL + WebCodecs) re-runs the composition's own builder
 * (contract #3) and returns the encoded container as base64. This command drives
 * that page: it snapshots the entry file's project into a {@link RuntimeBundle},
 * boots a Vite dev server rooted in the server package (the same programmatic Vite
 * the `preview` command uses — so it works regardless of how the `vite` binary is
 * exposed), points Puppeteer at the page, and writes the bytes it hands back.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readBundle } from './bundle';

const require = createRequire(import.meta.url);

/** Absolute path to the server package root (its Route A page lives under it). */
export function resolveServerRoot(): string {
  // '@sequio/server' resolves to its `src/index.ts`; the package root is two up.
  return dirname(dirname(require.resolve('@sequio/server')));
}

const ENGINE_SRC = () => resolve(resolveServerRoot(), '../engine/src/index.ts');
const RUNTIME_SRC = () => resolve(resolveServerRoot(), '../runtime/src/index.ts');

export interface RenderOptions {
  out?: string;
  verify?: boolean;
  /** Dev-server port used while driving the headless render. @default 6182 */
  port?: number;
}

/** Sniff the container from magic bytes so --verify catches truncated/HTML output. */
function detectContainer(buf: Uint8Array): 'mp4' | 'webm' | null {
  if (buf.length >= 12 && Buffer.from(buf.subarray(4, 8)).toString('latin1') === 'ftyp') return 'mp4';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  return null;
}

interface SsrResult {
  ok: boolean;
  container?: 'mp4' | 'webm';
  videoCodec?: string;
  base64?: string;
  error?: string;
}

/**
 * Render `entryFile` to a video, returning the process exit code (0 = success).
 */
export async function runRender(entryFile: string, options: RenderOptions = {}): Promise<number> {
  const bundle = readBundle(entryFile);
  const serverRoot = resolveServerRoot();
  const port = options.port ?? 6182;

  const [{ createServer }, { default: puppeteer }] = await Promise.all([
    import('vite'),
    import('puppeteer'),
  ]);

  const server = await createServer({
    configFile: false,
    root: serverRoot,
    logLevel: 'warn',
    server: { port, host: 'localhost', strictPort: true },
    resolve: {
      alias: {
        '@sequio/runtime/node-fs': resolve(serverRoot, '../runtime/src/node-fs.ts'),
        '@sequio/engine': ENGINE_SRC(),
        '@sequio/runtime': RUNTIME_SRC(),
      },
    },
  });
  await server.listen();

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto(`http://localhost:${port}/route-a/ssr-render.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__SSR__ !== undefined', { timeout: 30000 });

    console.log(`Rendering ${entryFile} (headless Chrome) …`);
    const result = (await page.evaluate((b) => (window as any).__SSR__.renderBundle(b), bundle)) as SsrResult;

    if (!result || !result.ok || !result.base64) {
      const detail = result?.error ?? (errors.length ? errors.filter((e) => !/favicon/.test(e)).join('; ') : 'unknown');
      throw new Error(`render failed: ${detail}`);
    }

    const outPath = resolve(options.out ?? `out.${result.container}`);
    const buf = Buffer.from(result.base64, 'base64');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, buf);
    console.log(`✅ wrote ${outPath} (${result.container}/${result.videoCodec}, ${buf.length} bytes)`);

    if (options.verify) {
      const kind = detectContainer(buf);
      if (!kind || buf.length < 500) {
        throw new Error(`--verify failed: not a valid container (detected=${kind}, size=${buf.length})`);
      }
      console.log(`✅ verified: valid ${kind} container.`);
    }
    return 0;
  } catch (err) {
    console.error('✖', err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await browser.close();
    await server.close();
  }
}
