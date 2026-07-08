/**
 * `sequio preview <file> [--watch]` — serve a live, in-browser preview.
 *
 * This boots a Vite dev server rooted in this package's `preview/` folder. The
 * page there fetches `/__bundle` (the current project snapshot), runs it through
 * the same `Runtime` → `Composer` → `composer.preview()` path the studio Code
 * Mode uses, and plays it on a canvas with transport controls. Because the
 * browser owns WebGL/WebCodecs/Web Audio, this is the full-fidelity render core
 * (contract #3) — no headless worker needed for previewing.
 *
 * `/__bundle` is read fresh from disk on every request, so a reload always sees
 * the latest edits. With `--watch`, the server watches the project directory and
 * pushes a full-reload the moment any file changes.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveAssetPath } from '@sequio/runtime';
import { readBundle } from './bundle';
import { mimeForAsset } from './assets';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREVIEW_ROOT = resolve(HERE, '../preview');
const ENGINE_SRC = resolve(HERE, '../../engine/src/index.ts');
const RUNTIME_SRC = resolve(HERE, '../../runtime/src/index.ts');

export interface PreviewServerOptions {
  port?: number;
  host?: boolean;
  watch?: boolean;
}

export interface PreviewServer {
  /** The URL the preview is served at. */
  url: string;
  /** Shut the server (and any file watcher) down. */
  close(): Promise<void>;
}

/**
 * Start the preview dev server for `entryFile`. Resolves once it is listening;
 * the returned handle carries the URL and a {@link PreviewServer.close}.
 */
export async function startPreviewServer(
  entryFile: string,
  options: PreviewServerOptions = {},
): Promise<PreviewServer> {
  const abs = resolve(entryFile);
  const projectDir = dirname(abs);
  // Fail fast if the entry (or project) can't be read at all.
  readBundle(abs);

  // Import Vite lazily: it's a dev/tooling dependency, only needed for preview.
  const { createServer } = await import('vite');

  const server = await createServer({
    configFile: false,
    root: PREVIEW_ROOT,
    logLevel: 'warn',
    server: {
      port: options.port ?? 6180,
      host: options.host ? true : 'localhost',
      strictPort: true,
    },
    resolve: {
      alias: {
        '@sequio/engine': ENGINE_SRC,
        '@sequio/runtime': RUNTIME_SRC,
      },
    },
    plugins: [
      {
        name: 'sequio-preview-bundle',
        configureServer(vite) {
          // Serve the current project snapshot as JSON. Re-read per request so a
          // reload (manual or watch-driven) always gets the latest source.
          vite.middlewares.use('/__bundle', (_req, res: ServerResponse) => {
            try {
              const bundle = readBundle(abs);
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Cache-Control', 'no-store');
              res.end(JSON.stringify(bundle));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
            }
          });

          // Serve the composition's own local media files (referenced from code
          // via `loadAsset('./clip.mp4')` — the runtime's asset hook). These never
          // enter the JSON bundle (readBundle skips binary assets), so the browser
          // fetches them straight from the project directory here. The render side
          // reads the same files off disk (see assets-node.ts), so a local
          // `image`/`video` looks identical in preview and render (contract #3).
          vite.middlewares.use('/__asset', (req: IncomingMessage, res: ServerResponse) => {
            try {
              const rawPath = (req.url ?? '').split('?')[0];
              const rel = resolveAssetPath(decodeURIComponent(rawPath));
              const full = resolve(projectDir, rel);
              if (full !== projectDir && !full.startsWith(projectDir + '/')) {
                res.statusCode = 403;
                return res.end('forbidden');
              }
              if (!existsSync(full) || !statSync(full).isFile()) {
                res.statusCode = 404;
                return res.end(`asset not found: ${rel}`);
              }
              res.setHeader('Content-Type', mimeForAsset(rel));
              res.setHeader('Cache-Control', 'no-store');
              createReadStream(full).pipe(res);
            } catch (err) {
              res.statusCode = 400;
              res.end(err instanceof Error ? err.message : String(err));
            }
          });

          if (options.watch) {
            // The project files live outside Vite's module graph (they're fetched
            // as JSON), so Vite won't watch them on its own — add them, and turn
            // any change into a full page reload that re-fetches the bundle.
            vite.watcher.add(projectDir);
            const reload = (changed: string): void => {
              if (resolve(changed).startsWith(projectDir)) {
                vite.ws.send({ type: 'full-reload', path: '*' });
              }
            };
            vite.watcher.on('change', reload);
            vite.watcher.on('add', reload);
            vite.watcher.on('unlink', reload);
          }
        },
      },
    ],
  });

  await server.listen();
  const resolved = server.resolvedUrls?.local[0] ?? `http://localhost:${options.port ?? 6180}/`;

  return {
    url: resolved,
    async close() {
      await server.close();
    },
  };
}
