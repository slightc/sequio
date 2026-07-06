import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Studio app: `pnpm dev` serves the editor (index.html → src/main.ts) and the
// code-mode page (code.html → src/code-mode.ts). It resolves the engine, the
// server's TimelineSpec protocol and the runtime straight from source, so the
// editor and its tests run without a prior `pnpm build` of the other packages.
export default defineConfig({
  server: {
    port: 6173,
  },
  resolve: {
    alias: {
      '@video-editor-canvas/engine': resolve(__dirname, '../engine/src/index.ts'),
      '@video-editor-canvas/server': resolve(__dirname, '../server/src/index.ts'),
      '@video-editor-canvas/runtime': resolve(__dirname, '../runtime/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      // Multi-page: the editor (index.html) and Code Mode (code.html).
      input: {
        main: resolve(__dirname, 'index.html'),
        code: resolve(__dirname, 'code.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
