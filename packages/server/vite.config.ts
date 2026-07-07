import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Server package: the dev server (`pnpm dev:server`) serves the Route A page in
// `route-a/`; vitest runs the headless timeline-protocol unit tests. Both resolve
// the engine and the runtime straight from source so no prior `pnpm build` is needed.
export default defineConfig({
  server: {
    port: 6175,
  },
  resolve: {
    alias: {
      '@video-editor-canvas/engine': resolve(__dirname, '../engine/src/index.ts'),
      '@video-editor-canvas/runtime': resolve(__dirname, '../runtime/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
