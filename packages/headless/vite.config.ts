import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The `@sequio/headless` package — Route A server-side rendering (headless
// Chrome) plus the TimelineSpec protocol + RPC it rides on (`src/`). It is a
// **repo-internal harness**, NOT a published library, so there is no `vite build`
// here: the jobs are the dev server that serves the SSR page (`ssr-render.html` →
// `ssr-render.ts`) for the Puppeteer worker and for `pnpm verify:ssr`, plus vitest
// for the protocol/RPC unit tests (`tests/`).
//
// The page + protocol import only the engine and the runtime; both resolve
// straight from source via the aliases below, so no prior `pnpm build` is needed.
export default defineConfig({
  server: {
    port: 6176,
  },
  resolve: {
    alias: {
      '@sequio/engine': resolve(__dirname, '../engine/src/index.ts'),
      '@sequio/runtime': resolve(__dirname, '../runtime/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
