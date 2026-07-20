import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The `@sequio/headless` package — Route A server-side rendering (headless
// Chrome). It is a **repo-internal verify harness**, NOT a published library, so
// there is no `vite build` here: the only jobs are the dev server that serves the
// SSR page (`ssr-render.html` → `ssr-render.ts`) for the Puppeteer worker
// (`ssr-render.cjs`) and for `pnpm verify:ssr`.
//
// The page imports the engine, the runtime and the server's browser-safe
// TimelineSpec barrel (`@sequio/server`); all three resolve straight from source
// via the aliases below, so no prior `pnpm build` is ever needed.
export default defineConfig({
  server: {
    port: 6176,
  },
  resolve: {
    alias: {
      '@sequio/engine': resolve(__dirname, '../engine/src/index.ts'),
      '@sequio/runtime': resolve(__dirname, '../runtime/src/index.ts'),
      '@sequio/server': resolve(__dirname, '../server/src/index.ts'),
    },
  },
});
