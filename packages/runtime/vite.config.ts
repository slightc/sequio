import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Runtime package: the dev server (`pnpm dev` / `pnpm -F @video-editor-canvas/runtime dev`)
// serves the e2e verify page in `example/`; vitest runs the pure-logic unit tests
// (VFS resolution, transpile, module linking). Resolves the engine straight from
// source so no prior `pnpm build` is needed.
export default defineConfig({
  server: {
    port: 6177,
  },
  resolve: {
    alias: {
      '@video-editor-canvas/engine': resolve(__dirname, '../engine/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
