import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// CLI package. The `preview` command boots a Vite dev server at runtime (see
// src/preview.ts) rooted in `preview/`; this config is only what vitest needs to
// run the pure-logic unit tests (arg parsing, bundle collection). Both resolve
// the engine and runtime straight from source so no prior `pnpm build` is needed.
export default defineConfig({
  resolve: {
    alias: {
      // node-fs subpath first so it wins over the bare '@sequio/runtime' prefix.
      '@sequio/runtime/node-fs': resolve(__dirname, '../runtime/src/node-fs.ts'),
      '@sequio/engine': resolve(__dirname, '../engine/src/index.ts'),
      '@sequio/server': resolve(__dirname, '../server/src/index.ts'),
      '@sequio/runtime': resolve(__dirname, '../runtime/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
