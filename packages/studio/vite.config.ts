import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Studio app: `pnpm dev` serves the editor (index.html → src/main.ts). It resolves
// the engine and the server's TimelineSpec protocol straight from source, so the
// editor and its tests run without a prior `pnpm build` of the other packages.
export default defineConfig({
  server: {
    port: 6173,
  },
  resolve: {
    alias: {
      '@video-editor-canvas/engine': resolve(__dirname, '../engine/src/index.ts'),
      '@video-editor-canvas/server': resolve(__dirname, '../server/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
